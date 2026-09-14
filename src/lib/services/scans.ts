import '@/lib/server-guard';
import { and, asc, eq, inArray, isNull, sql as raw } from 'drizzle-orm';
import { db } from '@/db';
import { corridors, markets, properties, propertyCorridors, scanTargets, scans } from '@/db/schema';
import type { Actor } from '@/lib/auth/guards';
import { BudgetError, ConfigurationError, NotFoundError, ValidationError } from '@/lib/errors';
import { env } from '@/lib/env';
import { isAiConfigured } from '@/lib/ai/client';
import { researchCorridor } from '@/lib/ai/research';
import { monthToDateSpendUsd, recordUsage, stageCandidates } from './discovery';
import { enqueue, heartbeat, isCancelRequested } from './jobs';
import { getSetting, SETTING_KEYS } from './settings';
import { recordAudit } from './audit';

export type ScanScope = 'corridor' | 'market' | 'markets' | 'all';

/**
 * Queues a discovery scan.
 *
 * Runs the pre-flight checks that must happen BEFORE any money is spent:
 * configuration, monthly budget, and whether an identical scan is already in
 * flight. The scan itself runs in the worker process, so it is unaffected by
 * HTTP request timeouts.
 */
export async function queueScan(input: {
  scope: ScanScope;
  corridorId?: string;
  marketId?: string;
  marketIds?: string[];
}, actor: Actor) {
  if (!isAiConfigured()) {
    throw new ConfigurationError(
      'Discovery is not configured. An administrator needs to set ANTHROPIC_API_KEY on the server. Everything else in the app works without it.',
    );
  }

  const budget = await getSetting<number>(SETTING_KEYS.aiMonthlyBudgetUsd)
    ?? env.ai.monthlyBudgetUsd;
  const spent = await monthToDateSpendUsd();

  if (budget <= 0) {
    throw new BudgetError(
      'The monthly AI budget is set to $0, so scans are disabled. An administrator can raise it in Settings.',
      { budget, spent },
    );
  }
  if (spent >= budget) {
    throw new BudgetError(
      `This month's AI budget of $${budget.toFixed(2)} has been reached (about $${spent.toFixed(2)} recorded). Scans are paused until an administrator raises the budget or the month rolls over.`,
      { budget, spent },
    );
  }

  const corridorIds = await resolveCorridorIds(input);
  if (corridorIds.length === 0) {
    throw new ValidationError(
      'No corridors with a saved boundary were found for that selection. Draw or seed a corridor boundary first.',
    );
  }

  const [scan] = await db.insert(scans).values({
    scope: input.scope,
    corridorIds,
    status: 'queued',
    model: env.ai.model,
    targetsTotal: corridorIds.length,
    requestedBy: actor.id,
    requestedByLabel: actor.name,
  }).returning();

  const corridorRows = await db
    .select({ id: corridors.id, name: corridors.name })
    .from(corridors).where(inArray(corridors.id, corridorIds));

  await db.insert(scanTargets).values(corridorRows.map((c) => ({
    scanId: scan!.id,
    corridorId: c.id,
    corridorLabel: c.name,
    status: 'queued' as const,
  })));

  // The dedupe key makes a second identical scan impossible while one is live.
  const { job } = await enqueue({
    type: 'discovery_scan',
    payload: { scanId: scan!.id },
    dedupeKey: `scan:${input.scope}:${corridorIds.slice().sort().join(',')}`,
    actor,
  });

  await db.update(scans).set({ jobId: job.id }).where(eq(scans.id, scan!.id));

  await recordAudit({
    entityType: 'scan', entityId: scan!.id, action: 'queue',
    summary: `Queued a discovery scan over ${corridorIds.length} corridor(s)`,
    actor,
  });

  return { scan: scan!, job, corridorCount: corridorIds.length };
}

async function resolveCorridorIds(input: {
  scope: ScanScope; corridorId?: string; marketId?: string; marketIds?: string[];
}): Promise<string[]> {
  // Only corridors with a saved boundary can be scanned — the boundary is what
  // makes "inside this corridor" a meaningful question, and what results are
  // checked against for geographic relevance.
  const hasBoundary = raw`${corridors.boundary} is not null`;

  switch (input.scope) {
    case 'corridor': {
      if (!input.corridorId) throw new ValidationError('Choose a corridor to scan.');
      const rows = await db.select({ id: corridors.id }).from(corridors)
        .where(and(eq(corridors.id, input.corridorId), isNull(corridors.archivedAt), hasBoundary));
      return rows.map((r) => r.id);
    }
    case 'market': {
      if (!input.marketId) throw new ValidationError('Choose a market to scan.');
      const rows = await db.select({ id: corridors.id }).from(corridors)
        .where(and(eq(corridors.marketId, input.marketId), isNull(corridors.archivedAt), hasBoundary));
      return rows.map((r) => r.id);
    }
    case 'markets': {
      if (!input.marketIds?.length) throw new ValidationError('Choose at least one market to scan.');
      const rows = await db.select({ id: corridors.id }).from(corridors)
        .where(and(inArray(corridors.marketId, input.marketIds), isNull(corridors.archivedAt), hasBoundary));
      return rows.map((r) => r.id);
    }
    case 'all': {
      const rows = await db.select({ id: corridors.id }).from(corridors)
        .where(and(isNull(corridors.archivedAt), hasBoundary));
      return rows.map((r) => r.id);
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Execution (worker side)                                                    */
/* -------------------------------------------------------------------------- */

export interface ScanRunSummary {
  status: 'completed' | 'partial' | 'cancelled' | 'failed';
  targetsCompleted: number;
  resultsFound: number;
  resultsNew: number;
  resultsDuplicate: number;
  coverageNotes: string[];
}

/**
 * Runs a queued scan, corridor by corridor.
 *
 * Checkpoints between corridors: it checks for a cancel request and re-checks
 * the monthly budget, so a long multi-market scan stops promptly and cannot blow
 * through the ceiling mid-run. A corridor that fails is recorded and the scan
 * continues — one bad corridor must not lose the results of thirty good ones.
 */
export async function runScan(scanId: string, jobId: string): Promise<ScanRunSummary> {
  const [scan] = await db.select().from(scans).where(eq(scans.id, scanId)).limit(1);
  if (!scan) throw new NotFoundError('Scan');

  await db.update(scans)
    .set({ status: 'running', startedAt: new Date() })
    .where(eq(scans.id, scanId));

  const rates = await getSetting<{ inputPerMTok: number; outputPerMTok: number; webSearchPerThousand: number }>(
    SETTING_KEYS.aiCostRates,
  );
  const budget = (await getSetting<number>(SETTING_KEYS.aiMonthlyBudgetUsd)) ?? env.ai.monthlyBudgetUsd;

  const targets = await db.select().from(scanTargets)
    .where(eq(scanTargets.scanId, scanId))
    .orderBy(asc(scanTargets.corridorLabel));

  const summary: ScanRunSummary = {
    status: 'completed', targetsCompleted: 0, resultsFound: 0,
    resultsNew: 0, resultsDuplicate: 0, coverageNotes: [],
  };
  let anyFailed = false;
  let anySucceeded = false;

  for (const target of targets) {
    await heartbeat(jobId);

    if (await isCancelRequested(jobId)) {
      summary.status = 'cancelled';
      summary.coverageNotes.push('The scan was cancelled. Results gathered before cancellation were kept.');
      break;
    }

    // Re-checked every corridor, not just at queue time: a long scan must not
    // sail past the ceiling.
    const spent = await monthToDateSpendUsd();
    if (spent >= budget) {
      summary.status = 'partial';
      summary.coverageNotes.push(
        `Stopped early: the monthly AI budget of $${budget.toFixed(2)} was reached (about $${spent.toFixed(2)} recorded). Results gathered so far were kept.`,
      );
      break;
    }

    await db.update(scanTargets)
      .set({ status: 'running', startedAt: new Date() })
      .where(eq(scanTargets.id, target.id));

    try {
      if (!target.corridorId) throw new Error('This corridor no longer exists.');

      const [corridor] = await db
        .select({
          c: corridors,
          marketName: markets.name,
        })
        .from(corridors)
        .leftJoin(markets, eq(markets.id, corridors.marketId))
        .where(eq(corridors.id, target.corridorId))
        .limit(1);
      if (!corridor) throw new Error('This corridor no longer exists.');

      // A sample of known addresses, so the model does not simply re-report what
      // we already track.
      const known = await db
        .select({ address: properties.addressLine1, city: properties.city })
        .from(properties)
        .innerJoin(propertyCorridors, eq(propertyCorridors.propertyId, properties.id))
        .where(and(eq(propertyCorridors.corridorId, target.corridorId), isNull(properties.archivedAt)))
        .limit(40);

      const outcome = await researchCorridor({
        corridorName: corridor.c.name,
        marketName: corridor.marketName ?? 'Unknown market',
        city: known[0]?.city ?? null,
        state: null,
        centerLat: corridor.c.centerLatitude,
        centerLng: corridor.c.centerLongitude,
        approxRadiusMiles: corridor.c.radiusMeters ? corridor.c.radiusMeters / 1609.34 : null,
        knownAddresses: known.map((k) => [k.address, k.city].filter(Boolean).join(', ')).filter(Boolean),
      }, rates);

      await recordUsage({
        scanId,
        model: env.ai.model,
        operation: 'scan_corridor',
        inputTokens: outcome.usage.inputTokens,
        outputTokens: outcome.usage.outputTokens,
        webSearches: outcome.usage.webSearches,
        estimatedCostUsd: outcome.usage.estimatedCostUsd,
      });

      const staged = await stageCandidates({
        candidates: outcome.result.candidates,
        scanId,
        corridorId: target.corridorId,
        marketId: corridor.c.marketId,
        origin: 'scan',
      });

      await db.update(scanTargets).set({
        status: 'completed',
        resultsFound: outcome.result.candidates.length,
        sourcesSearched: outcome.result.searchedSources,
        coverageNotes: outcome.result.coverageNotes,
        finishedAt: new Date(),
      }).where(eq(scanTargets.id, target.id));

      summary.targetsCompleted++;
      summary.resultsFound += outcome.result.candidates.length;
      summary.resultsNew += staged.created;
      summary.resultsDuplicate += staged.duplicates + staged.suppressed;
      summary.coverageNotes.push(...outcome.result.coverageNotes);
      anySucceeded = true;
    } catch (err) {
      anyFailed = true;
      const message = err instanceof Error ? err.message : String(err);
      await db.update(scanTargets).set({
        status: 'failed', error: message, finishedAt: new Date(),
      }).where(eq(scanTargets.id, target.id));
      summary.coverageNotes.push(`"${target.corridorLabel}" failed: ${message}`);
    }

    await db.update(scans).set({
      targetsCompleted: summary.targetsCompleted,
      resultsFound: summary.resultsFound,
      resultsNew: summary.resultsNew,
      resultsDuplicate: summary.resultsDuplicate,
    }).where(eq(scans.id, scanId));
  }

  if (summary.status === 'completed' && anyFailed) {
    summary.status = anySucceeded ? 'partial' : 'failed';
  }

  await db.update(scans).set({
    status: summary.status,
    coverageNotes: [...new Set(summary.coverageNotes)].slice(0, 60),
    finishedAt: new Date(),
  }).where(eq(scans.id, scanId));

  return summary;
}
