import '@/lib/server-guard';
import { and, eq, inArray, sql as raw } from 'drizzle-orm';
import { db } from '@/db';
import { activities, outreachStatuses, properties, propertyTags, tags } from '@/db/schema';
import type { Actor } from '@/lib/auth/guards';
import { NotFoundError, ValidationError } from '@/lib/errors';
import { recordAudit } from './audit';

/**
 * A bulk write runs in one request and one transaction, so the batch has to stay
 * small enough that neither the request nor the row locks it holds outlive a
 * user's patience. 500 covers a full broker CSV import in a single pass.
 */
export const BULK_MAX_IDS = 500;

export interface BulkResult {
  updated: number;
  /** Ids that matched no live property, so the caller can say so rather than silently claiming success. */
  missing: string[];
}

function assertBatchSize(propertyIds: string[]) {
  if (propertyIds.length === 0) {
    throw new ValidationError('Select at least one property.');
  }
  if (propertyIds.length > BULK_MAX_IDS) {
    throw new ValidationError(
      `Too many properties selected: ${propertyIds.length}. Bulk actions handle up to ${BULK_MAX_IDS} at a time.`,
    );
  }
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * The list view never loads each row's version, so the client cannot supply one.
 * Re-reading the version inside the transaction immediately before the write keeps
 * the same guarantee the single-row path gets from `updateWithVersion`: a row
 * another user changed first fails its (id, version) match instead of being
 * clobbered.
 */
async function applyVersioned(
  tx: Tx,
  ids: string[],
  values: (current: typeof properties.$inferSelect) => Record<string, unknown> | null,
  actor: Actor,
  onUpdated?: (current: typeof properties.$inferSelect) => Promise<void>,
): Promise<BulkResult> {
  const current = await tx.select().from(properties).where(inArray(properties.id, ids));
  const byId = new Map(current.map((p) => [p.id, p]));
  const missing = ids.filter((id) => !byId.has(id));

  let updated = 0;
  for (const id of ids) {
    const row = byId.get(id);
    if (!row) continue;

    const patch = values(row);
    if (!patch) continue;

    const done = await tx.update(properties)
      .set({ ...patch, updatedBy: actor.id, updatedAt: new Date(), version: row.version + 1 })
      .where(and(eq(properties.id, id), eq(properties.version, row.version)))
      .returning({ id: properties.id });

    if (done.length === 0) continue;
    updated += 1;
    if (onUpdated) await onUpdated(row);
  }

  return { updated, missing };
}

export async function bulkUpdateOutreachStatus(
  propertyIds: string[], statusId: string, actor: Actor,
): Promise<BulkResult> {
  assertBatchSize(propertyIds);

  const [status] = await db.select().from(outreachStatuses).where(eq(outreachStatuses.id, statusId)).limit(1);
  if (!status) throw new NotFoundError('Outreach status');

  const result = await db.transaction(async (tx) => {
    const ids = [...new Set(propertyIds)];
    return applyVersioned(
      tx, ids,
      (row) => (row.outreachStatusId === statusId ? null : { outreachStatusId: statusId }),
      actor,
      // The single-property path writes a timeline entry for every status change;
      // dropping it in bulk would leave a property's history silently incomplete.
      async (row) => {
        await tx.insert(activities).values({
          propertyId: row.id, type: 'status_change', occurredAt: new Date(),
          subject: `Outreach status changed to ${status.label}`,
          metadata: { to: status.label, bulk: true },
          authorUserId: actor.id, authorLabel: actor.name,
        });
      },
    );
  });

  await recordAudit({
    entityType: 'property', action: 'bulk_status_change',
    summary: `Bulk: set outreach status to ${status.label} on ${result.updated} propert${result.updated === 1 ? 'y' : 'ies'}`,
    actor,
  });

  return result;
}

export async function bulkSetFollowUpDate(
  propertyIds: string[], date: string | null, actor: Actor,
): Promise<BulkResult> {
  assertBatchSize(propertyIds);

  const result = await db.transaction(async (tx) =>
    applyVersioned(tx, [...new Set(propertyIds)], () => ({ nextFollowUpDate: date }), actor));

  await recordAudit({
    entityType: 'property', action: 'bulk_follow_up',
    summary: date
      ? `Bulk: set follow-up to ${date} on ${result.updated} propert${result.updated === 1 ? 'y' : 'ies'}`
      : `Bulk: cleared follow-up on ${result.updated} propert${result.updated === 1 ? 'y' : 'ies'}`,
    actor,
  });

  return result;
}

export async function bulkAddTags(
  propertyIds: string[], tagIds: string[], actor: Actor,
): Promise<BulkResult> {
  assertBatchSize(propertyIds);
  if (tagIds.length === 0) throw new ValidationError('Pick at least one tag.');

  const found = await db.select({ id: tags.id, name: tags.name }).from(tags).where(inArray(tags.id, tagIds));
  if (found.length !== new Set(tagIds).size) throw new NotFoundError('Tag');

  const result = await db.transaction(async (tx) => {
    const ids = [...new Set(propertyIds)];
    const live = await tx.select({ id: properties.id }).from(properties).where(inArray(properties.id, ids));
    const liveIds = live.map((p) => p.id);
    const missing = ids.filter((id) => !liveIds.includes(id));

    if (liveIds.length > 0) {
      await tx.insert(propertyTags)
        .values(liveIds.flatMap((propertyId) => tagIds.map((tagId) => ({ propertyId, tagId }))))
        .onConflictDoNothing();

      // Tags live in their own table, so the property row is untouched by the
      // insert - bump it anyway so "recently updated" and any open editor notice.
      await tx.update(properties)
        .set({ updatedBy: actor.id, updatedAt: new Date(), version: raw`${properties.version} + 1` })
        .where(inArray(properties.id, liveIds));
    }

    return { updated: liveIds.length, missing };
  });

  await recordAudit({
    entityType: 'property', action: 'bulk_add_tags',
    summary: `Bulk: added ${found.map((t) => t.name).join(', ')} to ${result.updated} propert${result.updated === 1 ? 'y' : 'ies'}`,
    actor,
  });

  return result;
}
