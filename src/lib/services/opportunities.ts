import '@/lib/server-guard';
import { and, asc, desc, eq, isNull, sql as raw } from 'drizzle-orm';
import { db } from '@/db';
import {
  activities, markets, opportunities, opportunityProperties, opportunityStageHistory,
  properties, transactionStages,
} from '@/db/schema';
import type { Actor } from '@/lib/auth/guards';
import { NotFoundError, ValidationError } from '@/lib/errors';
import { propertyTitle } from '@/lib/format';
import { recordAudit, updateWithVersion } from './audit';

/**
 * THE PIPELINE RULE
 * -----------------
 * `promoteToOpportunity` is the ONLY function in the codebase that inserts into
 * `opportunities`. Nothing in the call-logging, follow-up, status-change or
 * discovery paths reaches it. A property enters the transaction pipeline when a
 * person decides it should and says why — never as a side effect of routine
 * outreach.
 */
export async function promoteToOpportunity(input: {
  propertyId: string;
  name?: string;
  stageId?: string;
  promotionReason: string;
  targetPrice?: string | null;
  nextStep?: string | null;
  nextStepDate?: string | null;
}, actor: Actor) {
  const [property] = await db.select().from(properties).where(eq(properties.id, input.propertyId)).limit(1);
  if (!property) throw new NotFoundError('Property');

  // One active opportunity per property at a time. Historical ones are fine.
  const [existing] = await db
    .select({ id: opportunities.id, name: opportunities.name })
    .from(opportunityProperties)
    .innerJoin(opportunities, eq(opportunities.id, opportunityProperties.opportunityId))
    .where(and(
      eq(opportunityProperties.propertyId, input.propertyId),
      eq(opportunities.state, 'active'),
      isNull(opportunities.archivedAt),
    ))
    .limit(1);

  if (existing) {
    throw new ValidationError(
      `This property is already in the pipeline as "${existing.name}". Open that opportunity instead, or remove it from the pipeline first.`,
    );
  }

  const stageId = input.stageId ?? (await defaultStageId());
  if (!stageId) throw new ValidationError('No transaction stages are configured. Add one in Settings first.');

  const [stage] = await db.select().from(transactionStages).where(eq(transactionStages.id, stageId)).limit(1);
  if (!stage) throw new NotFoundError('Transaction stage');

  return db.transaction(async (tx) => {
    const [opp] = await tx.insert(opportunities).values({
      name: input.name?.trim() || propertyTitle(property),
      marketId: property.marketId,
      stageId,
      state: 'active',
      promotionReason: input.promotionReason,
      promotedAt: new Date(),
      promotedBy: actor.id,
      promotedByLabel: actor.name,
      targetPrice: input.targetPrice ?? property.targetPurchasePrice ?? null,
      nextStep: input.nextStep ?? null,
      nextStepDate: input.nextStepDate ?? null,
      isSample: property.isSample,
      createdBy: actor.id,
      updatedBy: actor.id,
    }).returning();

    await tx.insert(opportunityProperties).values({
      opportunityId: opp!.id, propertyId: input.propertyId, isPrimary: true,
    });

    await tx.insert(opportunityStageHistory).values({
      opportunityId: opp!.id, toStageId: stageId, toStageLabel: stage.label,
      note: input.promotionReason, changedBy: actor.id, changedByLabel: actor.name,
    });

    // Visible on the property's own timeline, so the decision is part of its history.
    await tx.insert(activities).values({
      propertyId: input.propertyId, type: 'system', occurredAt: new Date(),
      subject: 'Promoted to opportunity',
      notes: input.promotionReason,
      metadata: { opportunityId: opp!.id, stage: stage.label },
      authorUserId: actor.id, authorLabel: actor.name,
    });

    await recordAudit({
      entityType: 'opportunity', entityId: opp!.id, action: 'promote',
      summary: `Promoted "${opp!.name}" into the pipeline at stage "${stage.label}"`,
      actor,
    }, tx as unknown as typeof db);

    return opp!;
  });
}

async function defaultStageId(): Promise<string | null> {
  const [row] = await db.select({ id: transactionStages.id })
    .from(transactionStages)
    .where(and(eq(transactionStages.isDefault, true), isNull(transactionStages.archivedAt)))
    .limit(1);
  if (row) return row.id;
  const [first] = await db.select({ id: transactionStages.id })
    .from(transactionStages)
    .where(isNull(transactionStages.archivedAt))
    .orderBy(asc(transactionStages.sortOrder)).limit(1);
  return first?.id ?? null;
}

/* -------------------------------------------------------------------------- */
/* Reads                                                                      */
/* -------------------------------------------------------------------------- */

export interface OpportunityFilters {
  marketId?: string;
  corridorId?: string;
  stageIds?: string[];
  /** Terminal stages are hidden from the active board unless asked for. */
  includeTerminal?: boolean;
  includeRemoved?: boolean;
  includeSample?: boolean;
  search?: string;
}

export async function listOpportunities(f: OpportunityFilters = {}) {
  const conds = [isNull(opportunities.archivedAt)];
  if (!f.includeRemoved) conds.push(eq(opportunities.state, 'active'));
  if (!f.includeSample) conds.push(eq(opportunities.isSample, false));
  if (!f.includeTerminal) conds.push(eq(transactionStages.isTerminal, false));
  if (f.marketId) conds.push(eq(opportunities.marketId, f.marketId));
  if (f.stageIds?.length) conds.push(raw`opportunities.stage_id = any(${f.stageIds}::uuid[])`);
  if (f.corridorId) {
    conds.push(raw`exists (select 1 from opportunity_properties op
      join property_corridors pc on pc.property_id = op.property_id
      where op.opportunity_id = opportunities.id and pc.corridor_id = ${f.corridorId})`);
  }
  if (f.search?.trim()) {
    const q = `%${f.search.trim().toLowerCase()}%`;
    conds.push(raw`(lower(opportunities.name) like ${q}
      or lower(coalesce(opportunities.notes, '')) like ${q})`);
  }

  return db
    .select({
      id: opportunities.id,
      name: opportunities.name,
      state: opportunities.state,
      stageId: opportunities.stageId,
      stageLabel: transactionStages.label,
      stageColor: transactionStages.color,
      stageSort: transactionStages.sortOrder,
      stageCategory: transactionStages.category,
      marketId: opportunities.marketId,
      marketName: markets.name,
      targetPrice: opportunities.targetPrice,
      offerPrice: opportunities.offerPrice,
      contractPrice: opportunities.contractPrice,
      expectedCloseDate: opportunities.expectedCloseDate,
      nextStep: opportunities.nextStep,
      nextStepDate: opportunities.nextStepDate,
      promotedAt: opportunities.promotedAt,
      promotionReason: opportunities.promotionReason,
      promotedByLabel: opportunities.promotedByLabel,
      updatedAt: opportunities.updatedAt,
      version: opportunities.version,
      isSample: opportunities.isSample,
      propertyCount: raw<number>`(select count(*)::int from opportunity_properties op
        where op.opportunity_id = opportunities.id)`,
    })
    .from(opportunities)
    .leftJoin(transactionStages, eq(transactionStages.id, opportunities.stageId))
    .leftJoin(markets, eq(markets.id, opportunities.marketId))
    .where(and(...conds))
    .orderBy(asc(transactionStages.sortOrder), desc(opportunities.promotedAt));
}

export async function getOpportunityDetail(id: string) {
  const [row] = await db
    .select({
      o: opportunities,
      stageLabel: transactionStages.label,
      stageColor: transactionStages.color,
      stageIsTerminal: transactionStages.isTerminal,
      marketName: markets.name,
    })
    .from(opportunities)
    .leftJoin(transactionStages, eq(transactionStages.id, opportunities.stageId))
    .leftJoin(markets, eq(markets.id, opportunities.marketId))
    .where(eq(opportunities.id, id))
    .limit(1);
  if (!row) throw new NotFoundError('Opportunity');

  const [linkedProperties, history] = await Promise.all([
    db.select({
      id: properties.id, name: properties.name, addressLine1: properties.addressLine1,
      city: properties.city, state: properties.state,
      latitude: properties.latitude, longitude: properties.longitude,
      askingPrice: properties.askingPrice, noi: properties.noi,
      isPrimary: opportunityProperties.isPrimary,
    })
      .from(opportunityProperties)
      .innerJoin(properties, eq(properties.id, opportunityProperties.propertyId))
      .where(eq(opportunityProperties.opportunityId, id))
      .orderBy(desc(opportunityProperties.isPrimary)),

    db.select().from(opportunityStageHistory)
      .where(eq(opportunityStageHistory.opportunityId, id))
      .orderBy(desc(opportunityStageHistory.changedAt)),
  ]);

  return { ...row.o, stageLabel: row.stageLabel, stageColor: row.stageColor, stageIsTerminal: row.stageIsTerminal, marketName: row.marketName, properties: linkedProperties, history };
}

/* -------------------------------------------------------------------------- */
/* Writes                                                                     */
/* -------------------------------------------------------------------------- */

export async function updateOpportunity(id: string, input: {
  version: number;
  name?: string;
  stageId?: string;
  stageChangeNote?: string | null;
  targetPrice?: string | null;
  offerPrice?: string | null;
  contractPrice?: string | null;
  expectedCloseDate?: string | null;
  nextStep?: string | null;
  nextStepDate?: string | null;
  notes?: string | null;
}, actor: Actor) {
  const [before] = await db.select().from(opportunities).where(eq(opportunities.id, id)).limit(1);
  if (!before) throw new NotFoundError('Opportunity');

  const values: Record<string, unknown> = { updatedBy: actor.id };
  for (const key of ['name', 'targetPrice', 'offerPrice', 'contractPrice', 'expectedCloseDate', 'nextStep', 'nextStepDate', 'notes'] as const) {
    if (input[key] !== undefined) values[key] = input[key];
  }

  const stageChanging = input.stageId !== undefined && input.stageId !== before.stageId;
  let toStage: typeof transactionStages.$inferSelect | undefined;

  if (stageChanging) {
    [toStage] = await db.select().from(transactionStages).where(eq(transactionStages.id, input.stageId!)).limit(1);
    if (!toStage) throw new NotFoundError('Transaction stage');
    values.stageId = input.stageId;
    values.closedAt = toStage.category === 'closed_won' ? new Date() : null;
  }

  const updated = await updateWithVersion({
    table: opportunities, id, expectedVersion: input.version, values, entityLabel: 'opportunity',
  });

  if (stageChanging) {
    const [fromStage] = await db.select().from(transactionStages).where(eq(transactionStages.id, before.stageId)).limit(1);
    await db.insert(opportunityStageHistory).values({
      opportunityId: id,
      fromStageId: before.stageId, toStageId: input.stageId!,
      fromStageLabel: fromStage?.label ?? null, toStageLabel: toStage!.label,
      note: input.stageChangeNote ?? null,
      changedBy: actor.id, changedByLabel: actor.name,
    });
    await recordAudit({
      entityType: 'opportunity', entityId: id, action: 'stage_change',
      summary: `Stage: ${fromStage?.label ?? 'none'} -> ${toStage!.label}`,
      actor,
    });
  } else {
    await recordAudit({ entityType: 'opportunity', entityId: id, action: 'update', summary: `Updated "${before.name}"`, actor });
  }

  return updated;
}

/**
 * Removes an opportunity from the active pipeline while keeping every record, or
 * puts a previously removed one back. A dead or on-hold deal can always be
 * reopened; nothing here deletes history.
 */
export async function setOpportunityState(id: string, input: {
  state: 'active' | 'removed'; reason?: string | null; version: number;
}, actor: Actor) {
  const [before] = await db.select().from(opportunities).where(eq(opportunities.id, id)).limit(1);
  if (!before) throw new NotFoundError('Opportunity');

  const updated = await updateWithVersion({
    table: opportunities, id, expectedVersion: input.version,
    values: {
      state: input.state,
      removedAt: input.state === 'removed' ? new Date() : null,
      removedReason: input.state === 'removed' ? (input.reason ?? null) : null,
      updatedBy: actor.id,
    },
    entityLabel: 'opportunity',
  });

  await db.insert(opportunityStageHistory).values({
    opportunityId: id,
    fromStageId: before.stageId, toStageId: before.stageId,
    note: input.state === 'removed'
      ? `Removed from the active pipeline. ${input.reason ?? ''}`.trim()
      : 'Reopened into the active pipeline.',
    changedBy: actor.id, changedByLabel: actor.name,
  });

  await recordAudit({
    entityType: 'opportunity', entityId: id,
    action: input.state === 'removed' ? 'remove_from_pipeline' : 'reopen',
    summary: input.state === 'removed' ? `Removed "${before.name}" from the pipeline` : `Reopened "${before.name}"`,
    actor,
  });

  return updated;
}

export async function addPropertyToOpportunity(opportunityId: string, propertyId: string, actor: Actor) {
  const [opp] = await db.select().from(opportunities).where(eq(opportunities.id, opportunityId)).limit(1);
  if (!opp) throw new NotFoundError('Opportunity');

  await db.insert(opportunityProperties)
    .values({ opportunityId, propertyId, isPrimary: false })
    .onConflictDoNothing();

  await recordAudit({
    entityType: 'opportunity', entityId: opportunityId, action: 'link_property',
    summary: 'Linked an additional property to the opportunity', actor,
  });
}

export async function removePropertyFromOpportunity(opportunityId: string, propertyId: string, actor: Actor) {
  const rows = await db.select().from(opportunityProperties).where(eq(opportunityProperties.opportunityId, opportunityId));
  if (rows.length <= 1) {
    throw new ValidationError('An opportunity must keep at least one property. Remove the opportunity from the pipeline instead.');
  }
  await db.delete(opportunityProperties).where(and(
    eq(opportunityProperties.opportunityId, opportunityId),
    eq(opportunityProperties.propertyId, propertyId),
  ));
  await recordAudit({
    entityType: 'opportunity', entityId: opportunityId, action: 'unlink_property',
    summary: 'Unlinked a property from the opportunity', actor,
  });
}
