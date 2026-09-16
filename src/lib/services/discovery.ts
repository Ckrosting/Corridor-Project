import '@/lib/server-guard';
import { and, desc, eq, gte, inArray, isNull, or, sql as raw } from 'drizzle-orm';
import { db } from '@/db';
import {
  aiUsage, contacts, corridors, discoveryResults, discoverySuppressions, markets,
  properties, propertyContacts, propertyListingSources, propertyParcels,
} from '@/db/schema';
import type { Actor } from '@/lib/auth/guards';
import { NotFoundError, ValidationError } from '@/lib/errors';
import { classifyRelevance } from '@/lib/geo/polygon';
import type { Candidate } from '@/lib/ai/extraction';
import { addressHash, findMatch, normalizeUrl, type MatchCandidate } from './dedupe';
import { recordAudit } from './audit';
import { createProperty } from './properties';
import { getEdgeBufferMeters } from './settings';

/**
 * Stages AI-produced candidates for human review.
 *
 * Nothing here writes to `properties`. A candidate becomes a property only when
 * a person approves it, and an existing property is only ever *proposed* changes
 * — never silently overwritten.
 */

export interface StageOutcome {
  created: number;
  updatedExisting: number;
  suppressed: number;
  duplicates: number;
}

export async function stageCandidates(input: {
  candidates: Candidate[];
  scanId: string | null;
  corridorId: string | null;
  marketId: string | null;
  origin: 'scan' | 'manual_url' | 'manual_document' | 'manual_import';
}): Promise<StageOutcome> {
  const outcome: StageOutcome = { created: 0, updatedExisting: 0, suppressed: 0, duplicates: 0 };
  if (input.candidates.length === 0) return outcome;

  const [corridor] = input.corridorId
    ? await db.select().from(corridors).where(eq(corridors.id, input.corridorId)).limit(1)
    : [undefined];

  const edgeBuffer = await getEdgeBufferMeters();

  // Everything already decided by a human, so a rejected listing does not come
  // back as "new" on every subsequent scan.
  const suppressions = await db.select().from(discoverySuppressions);
  const suppressedUrls = new Set(suppressions.filter((s) => s.keyType === 'url').map((s) => s.keyValue));
  const suppressedHashes = new Set(suppressions.filter((s) => s.keyType === 'hash').map((s) => s.keyValue));

  const marketId = input.marketId ?? corridor?.marketId ?? null;

  const existingProperties: MatchCandidate[] = marketId
    ? (await db
        .select({
          id: properties.id,
          addressLine1: properties.addressLine1,
          city: properties.city,
          state: properties.state,
          postalCode: properties.postalCode,
          latitude: properties.latitude,
          longitude: properties.longitude,
          parcelIds: raw<string[]>`coalesce((select array_agg(pp.parcel_id_text)
            from property_parcels pp
            where pp.property_id = properties.id and pp.parcel_id_text is not null), '{}')`,
        })
        .from(properties)
        .where(and(eq(properties.marketId, marketId), isNull(properties.archivedAt))))
    : [];

  for (const candidate of input.candidates) {
    const primaryUrl = candidate.sources[0]?.url ?? null;
    const normalizedUrl = primaryUrl ? normalizeUrl(primaryUrl) : null;
    const hash = addressHash(candidate);

    // 1. Already reviewed and dismissed: skip entirely.
    if ((normalizedUrl && suppressedUrls.has(normalizedUrl)) || (hash && suppressedHashes.has(hash))) {
      outcome.suppressed++;
      continue;
    }

    // 2. Already staged from an earlier scan: bump last-seen instead of re-adding.
    //
    // Both keys are checked, not just whichever is present. The same property
    // listed on two different sites has two different URLs but one address, and
    // matching on the URL alone would stage it twice — which is exactly the
    // cross-source duplication this is meant to prevent.
    const dedupeMatches = [
      normalizedUrl ? eq(discoveryResults.normalizedUrl, normalizedUrl) : null,
      hash ? eq(discoveryResults.dedupeHash, hash) : null,
    ].filter((c) => c !== null);

    const [existingResult] = dedupeMatches.length
      ? await db.select().from(discoveryResults).where(or(...dedupeMatches)).limit(1)
      : [];

    if (existingResult) {
      await db.update(discoveryResults).set({
        lastSeenAt: new Date(),
        timesSeen: raw`${discoveryResults.timesSeen} + 1`,
        updatedAt: new Date(),
      }).where(eq(discoveryResults.id, existingResult.id));
      outcome.duplicates++;
      continue;
    }

    // 3. Geographic relevance against the SAVED boundary. Anything ambiguous or
    //    near the edge is flagged for review, never silently classified.
    const relevance = corridor?.boundary
      ? classifyRelevance(corridor.boundary, { lat: candidate.latitude, lng: candidate.longitude }, edgeBuffer)
      : 'unknown';

    // 4. Does this look like an existing property?
    const match = findMatch(candidate, existingProperties);

    const fieldSources: Record<string, unknown> = {};
    for (const key of ['ownerName', 'brokerName', 'brokerCompany', 'brokerPhone', 'brokerEmail', 'priceSource'] as const) {
      const field = candidate[key];
      if (field?.value != null) {
        fieldSources[key] = {
          value: field.value, sourceUrl: field.sourceUrl,
          excerpt: field.excerpt, confidence: field.confidence,
        };
      }
    }

    const needsVerification = [...new Set([
      ...candidate.needsVerification,
      // A value the model gave without naming a source is unverified by definition.
      ...(['ownerName', 'brokerName', 'brokerPhone', 'brokerEmail'] as const)
        .filter((k) => candidate[k]?.value != null && !candidate[k]?.sourceUrl),
    ])];

    await db.insert(discoveryResults).values({
      scanId: input.scanId,
      corridorId: input.corridorId,
      marketId,
      origin: input.origin,
      status: relevance === 'outside' ? 'needs_research' : 'new',

      name: candidate.name,
      addressLine1: candidate.addressLine1,
      city: candidate.city,
      state: candidate.state,
      postalCode: candidate.postalCode,
      county: candidate.county,
      latitude: candidate.latitude,
      longitude: candidate.longitude,
      propertyType: candidate.propertyType,
      askingPrice: candidate.askingPrice != null ? String(candidate.askingPrice) : null,
      buildingSqft: candidate.buildingSqft,
      landAcreage: candidate.landAcreage != null ? String(candidate.landAcreage) : null,
      listingDate: candidate.listingDate,

      ownerName: candidate.ownerName.value,
      brokerName: candidate.brokerName.value,
      brokerCompany: candidate.brokerCompany.value,
      brokerPhone: candidate.brokerPhone.value,
      brokerEmail: candidate.brokerEmail.value,

      fieldSources,
      needsVerification,
      sources: candidate.sources,
      evidenceExcerpt: candidate.evidenceExcerpt,

      geoRelevance: relevance,
      geoNote: candidate.locationNote,

      normalizedUrl,
      dedupeHash: hash,
      suggestedPropertyId: match?.propertyId ?? null,
      suggestedMatchScore: match ? String(match.score) : null,
      suggestedMatchReason: match?.reason ?? null,
      proposedChanges: match ? await buildProposedChanges(match.propertyId, candidate) : null,
    });

    if (match) outcome.updatedExisting++;
    else outcome.created++;
  }

  return outcome;
}

/**
 * Computes what would change on an existing property.
 *
 * Only fields that are currently EMPTY, or whose change is evidenced, are
 * proposed — and even then they are proposals shown to a reviewer. Call notes,
 * outreach status and any human-entered value are never included.
 */
async function buildProposedChanges(
  propertyId: string, candidate: Candidate,
): Promise<Record<string, { from: unknown; to: unknown }> | null> {
  const [existing] = await db.select().from(properties).where(eq(properties.id, propertyId)).limit(1);
  if (!existing) return null;

  const changes: Record<string, { from: unknown; to: unknown }> = {};

  const propose = (field: string, current: unknown, next: unknown) => {
    if (next === null || next === undefined || next === '') return;
    if (String(current ?? '') === String(next)) return;

    // A human-verified record never has values replaced automatically; only
    // genuinely empty fields are proposed as fills.
    if (existing.humanVerified && current !== null && current !== undefined && current !== '') return;

    changes[field] = { from: current ?? null, to: next };
  };

  propose('name', existing.name, candidate.name);
  propose('addressLine1', existing.addressLine1, candidate.addressLine1);
  propose('city', existing.city, candidate.city);
  propose('state', existing.state, candidate.state);
  propose('postalCode', existing.postalCode, candidate.postalCode);
  propose('propertyType', existing.propertyType, candidate.propertyType);
  propose('buildingSqft', existing.buildingSqft, candidate.buildingSqft);
  propose('landAcreage', existing.landAcreage, candidate.landAcreage);
  propose('listingDate', existing.listingDate, candidate.listingDate);

  // A price CHANGE is proposed even on a verified record, because a moving
  // asking price is real news — but it is still only a proposal.
  if (candidate.askingPrice != null && String(existing.askingPrice ?? '') !== String(candidate.askingPrice)) {
    changes.askingPrice = { from: existing.askingPrice ?? null, to: candidate.askingPrice };
  }

  return Object.keys(changes).length > 0 ? changes : null;
}

/* -------------------------------------------------------------------------- */
/* Review actions                                                             */
/* -------------------------------------------------------------------------- */

/** Approves a candidate as a brand-new property record. */
export async function approveAsNewProperty(
  resultId: string,
  overrides: Record<string, unknown>,
  actor: Actor,
) {
  const [result] = await db.select().from(discoveryResults).where(eq(discoveryResults.id, resultId)).limit(1);
  if (!result) throw new NotFoundError('Discovery result');
  if (result.status === 'approved' || result.status === 'linked') {
    throw new ValidationError('This result has already been reviewed.');
  }

  const marketId = (overrides.marketId as string) ?? result.marketId;
  if (!marketId) throw new ValidationError('Choose which market this property belongs to.');

  const property = await createProperty({
    marketId,
    name: (overrides.name as string) ?? result.name ?? null,
    addressLine1: (overrides.addressLine1 as string) ?? result.addressLine1 ?? null,
    city: (overrides.city as string) ?? result.city ?? null,
    state: (overrides.state as string) ?? result.state ?? null,
    postalCode: (overrides.postalCode as string) ?? result.postalCode ?? null,
    county: (overrides.county as string) ?? result.county ?? null,
    latitude: (overrides.latitude as number) ?? result.latitude ?? null,
    longitude: (overrides.longitude as number) ?? result.longitude ?? null,
    propertyType: (overrides.propertyType as string) ?? result.propertyType ?? null,
    askingPrice: (overrides.askingPrice as string) ?? result.askingPrice ?? null,
    buildingSqft: (overrides.buildingSqft as number) ?? result.buildingSqft ?? null,
    landAcreage: (overrides.landAcreage as string) ?? result.landAcreage ?? null,
    listingStatus: 'for_sale',
    listingDate: result.listingDate ?? null,
    locationSource: 'discovery',
    researchNotes: buildProvenanceNote(result),
  } as never, actor);

  // The listing URL, so later scans recognise this property rather than
  // re-proposing it.
  if (result.normalizedUrl && result.sources?.[0]) {
    await db.insert(propertyListingSources).values({
      propertyId: property.id,
      url: result.sources[0].url,
      normalizedUrl: result.normalizedUrl,
      sourceName: result.sources[0].sourceName ?? result.sources[0].title ?? null,
      listingDate: result.listingDate ?? null,
    }).onConflictDoNothing();
  }

  // The broker, only when the extraction actually had a name for one.
  if (result.brokerName) {
    const [broker] = await db.insert(contacts).values({
      name: result.brokerName,
      company: result.brokerCompany,
      role: 'broker',
      phone: result.brokerPhone,
      email: result.brokerEmail,
      source: `Discovery — ${result.sources?.[0]?.url ?? 'unknown source'}`,
      notes: 'Imported from a discovery result. Verify before relying on these details.',
      createdBy: actor.id,
    }).returning();

    await db.insert(propertyContacts).values({
      propertyId: property.id, contactId: broker!.id, relationship: 'broker', isPrimary: true,
    }).onConflictDoNothing();
  }

  await db.update(discoveryResults).set({
    status: 'approved',
    linkedPropertyId: property.id,
    reviewedBy: actor.id,
    reviewedByLabel: actor.name,
    reviewedAt: new Date(),
    updatedAt: new Date(),
  }).where(eq(discoveryResults.id, resultId));

  await suppress(result, 'imported', property.id, actor);

  await recordAudit({
    entityType: 'discovery_result', entityId: resultId, action: 'approve',
    summary: `Approved a discovery result as a new property`,
    actor,
  });

  return property;
}

/** Links a candidate to an existing property and applies only the accepted changes. */
export async function linkToProperty(
  resultId: string,
  propertyId: string,
  acceptedFields: string[],
  actor: Actor,
) {
  const [result] = await db.select().from(discoveryResults).where(eq(discoveryResults.id, resultId)).limit(1);
  if (!result) throw new NotFoundError('Discovery result');

  const [property] = await db.select().from(properties).where(eq(properties.id, propertyId)).limit(1);
  if (!property) throw new NotFoundError('Property');

  const proposed = result.proposedChanges ?? {};
  const patch: Record<string, unknown> = {};
  for (const field of acceptedFields) {
    if (field in proposed) patch[field] = proposed[field]!.to;
  }

  if (Object.keys(patch).length > 0) {
    await db.update(properties)
      .set({ ...patch, updatedAt: new Date(), updatedBy: actor.id, version: raw`${properties.version} + 1` })
      .where(eq(properties.id, propertyId));
  }

  if (result.normalizedUrl && result.sources?.[0]) {
    await db.insert(propertyListingSources).values({
      propertyId,
      url: result.sources[0].url,
      normalizedUrl: result.normalizedUrl,
      sourceName: result.sources[0].sourceName ?? null,
      listingDate: result.listingDate ?? null,
    }).onConflictDoUpdate({
      target: [propertyListingSources.propertyId, propertyListingSources.normalizedUrl],
      set: { lastSeenAt: new Date(), isActive: true },
    });
  }

  await db.update(discoveryResults).set({
    status: 'linked',
    linkedPropertyId: propertyId,
    reviewedBy: actor.id,
    reviewedByLabel: actor.name,
    reviewedAt: new Date(),
    updatedAt: new Date(),
  }).where(eq(discoveryResults.id, resultId));

  await suppress(result, 'imported', propertyId, actor);

  await recordAudit({
    entityType: 'property', entityId: propertyId, action: 'discovery_link',
    summary: `Linked a discovery result and applied ${Object.keys(patch).length} reviewed field(s)`,
    changes: Object.fromEntries(Object.entries(proposed).filter(([k]) => acceptedFields.includes(k))),
    actor,
  });
}

export async function reviewResult(
  resultId: string,
  status: 'rejected' | 'archived' | 'needs_research',
  note: string | null,
  actor: Actor,
) {
  const [result] = await db.select().from(discoveryResults).where(eq(discoveryResults.id, resultId)).limit(1);
  if (!result) throw new NotFoundError('Discovery result');

  await db.update(discoveryResults).set({
    status,
    reviewNote: note,
    reviewedBy: actor.id,
    reviewedByLabel: actor.name,
    reviewedAt: new Date(),
    updatedAt: new Date(),
  }).where(eq(discoveryResults.id, resultId));

  // Rejected and archived results are suppressed so they stop reappearing.
  // "Needs more research" is NOT suppressed — it stays in play.
  if (status === 'rejected' || status === 'archived') {
    await suppress(result, status, null, actor);
  }

  await recordAudit({
    entityType: 'discovery_result', entityId: resultId, action: status,
    summary: `Discovery result marked ${status.replace(/_/g, ' ')}`,
    actor,
  });
}

/**
 * Undoes a reject/archive: moves the result back to "new" so it shows up in
 * the main review queue again, and removes the suppression rows created when
 * it was dismissed. Without removing those, the same listing would silently
 * refuse to be (re-)staged by a future scan even though the reviewer just
 * asked to reconsider it - the whole point of undoing the dismissal.
 */
export async function reopenResult(resultId: string, actor: Actor) {
  const [result] = await db.select().from(discoveryResults).where(eq(discoveryResults.id, resultId)).limit(1);
  if (!result) throw new NotFoundError('Discovery result');
  if (result.status !== 'rejected' && result.status !== 'archived') {
    throw new ValidationError('Only a rejected or archived result can be reopened.');
  }

  const keys = [result.normalizedUrl, result.dedupeHash].filter((k): k is string => Boolean(k));
  if (keys.length > 0) {
    await db.delete(discoverySuppressions).where(or(
      ...(result.normalizedUrl ? [and(eq(discoverySuppressions.keyType, 'url'), eq(discoverySuppressions.keyValue, result.normalizedUrl))] : []),
      ...(result.dedupeHash ? [and(eq(discoverySuppressions.keyType, 'hash'), eq(discoverySuppressions.keyValue, result.dedupeHash))] : []),
    ));
  }

  await db.update(discoveryResults).set({
    status: 'new',
    reviewNote: null,
    reviewedBy: null,
    reviewedByLabel: null,
    reviewedAt: null,
    updatedAt: new Date(),
  }).where(eq(discoveryResults.id, resultId));

  await recordAudit({
    entityType: 'discovery_result', entityId: resultId, action: 'reopen',
    summary: 'Discovery result moved back to review',
    actor,
  });
}

/** Records the permanent "already dealt with" keys for a result. */
async function suppress(
  result: typeof discoveryResults.$inferSelect,
  reason: string,
  propertyId: string | null,
  actor: Actor,
) {
  const rows: Array<typeof discoverySuppressions.$inferInsert> = [];
  if (result.normalizedUrl) {
    rows.push({ keyType: 'url', keyValue: result.normalizedUrl, reason, propertyId, createdBy: actor.id });
  }
  if (result.dedupeHash) {
    rows.push({ keyType: 'hash', keyValue: result.dedupeHash, reason, propertyId, createdBy: actor.id });
  }
  if (rows.length > 0) await db.insert(discoverySuppressions).values(rows).onConflictDoNothing();
}

function buildProvenanceNote(result: typeof discoveryResults.$inferSelect): string {
  const lines = ['Imported from a discovery result. Values below are unverified unless checked.'];
  if (result.evidenceExcerpt) lines.push('', `Evidence: "${result.evidenceExcerpt}"`);
  if (result.sources?.length) {
    lines.push('', 'Sources:');
    for (const s of result.sources) lines.push(`- ${s.sourceName ?? s.title ?? 'source'}: ${s.url}`);
  }
  if (result.needsVerification?.length) {
    lines.push('', `Needs verification: ${result.needsVerification.join(', ')}`);
  }
  return lines.join('\n');
}

/* -------------------------------------------------------------------------- */
/* Reads                                                                      */
/* -------------------------------------------------------------------------- */

export async function listDiscoveryResults(filters: {
  status?: string[];
  corridorId?: string;
  marketId?: string;
  limit?: number;
} = {}) {
  const conds = [];
  if (filters.status?.length) conds.push(inArray(discoveryResults.status, filters.status as never[]));
  if (filters.corridorId) conds.push(eq(discoveryResults.corridorId, filters.corridorId));
  if (filters.marketId) conds.push(eq(discoveryResults.marketId, filters.marketId));

  return db
    .select({
      r: discoveryResults,
      corridorName: corridors.name,
      marketName: markets.name,
      suggestedPropertyName: raw<string | null>`(select coalesce(p.name, p.address_line1)
        from properties p where p.id = discovery_results.suggested_property_id)`,
    })
    .from(discoveryResults)
    .leftJoin(corridors, eq(corridors.id, discoveryResults.corridorId))
    .leftJoin(markets, eq(markets.id, discoveryResults.marketId))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(discoveryResults.createdAt))
    .limit(filters.limit ?? 200);
}

/* -------------------------------------------------------------------------- */
/* Budget                                                                     */
/* -------------------------------------------------------------------------- */

/** Recorded spend for the current calendar month. */
export async function monthToDateSpendUsd(): Promise<number> {
  const start = new Date();
  start.setUTCDate(1);
  start.setUTCHours(0, 0, 0, 0);

  const [row] = await db
    .select({ total: raw<string>`coalesce(sum(ai_usage.estimated_cost_usd), 0)::text` })
    .from(aiUsage)
    .where(gte(aiUsage.createdAt, start));

  return Number(row?.total ?? 0);
}

export async function recordUsage(input: {
  scanId: string | null;
  model: string;
  operation: string;
  inputTokens: number;
  outputTokens: number;
  webSearches: number;
  estimatedCostUsd: number;
}) {
  await db.insert(aiUsage).values({
    scanId: input.scanId,
    model: input.model,
    operation: input.operation,
    inputTokens: input.inputTokens,
    outputTokens: input.outputTokens,
    webSearches: input.webSearches,
    estimatedCostUsd: input.estimatedCostUsd.toFixed(4),
  });
}
