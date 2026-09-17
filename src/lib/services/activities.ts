import '@/lib/server-guard';
import { and, asc, desc, eq, isNotNull, isNull, lt, sql as raw } from 'drizzle-orm';
import { db } from '@/db';
import {
  activities, contacts, opportunities, opportunityProperties, outreachStatuses, properties,
} from '@/db/schema';
import type { Actor } from '@/lib/auth/guards';
import { NotFoundError, ValidationError } from '@/lib/errors';
import { recordAudit } from './audit';

/**
 * Entries a person actually logged, as opposed to ones the system appended on
 * their behalf ('status_change') or purely automated bookkeeping ('system').
 * Editing or deleting the latter would let someone quietly rewrite what the
 * timeline says actually happened, so both are restricted to these types.
 */
const EDITABLE_ACTIVITY_TYPES = new Set(['call', 'note', 'email', 'meeting']);

/**
 * Logs a call or note and optionally applies the follow-up / status side effects
 * in the same transaction, so one click from the map panel does everything.
 *
 * Two invariants enforced here:
 *  1. Changing outreach status NEVER touches existing activity rows. A status
 *     change appends a new 'status_change' entry; call history is untouched.
 *  2. Logging a call NEVER creates or moves an opportunity. Promotion into the
 *     transaction pipeline is a separate, explicit action.
 */
export async function logActivity(input: {
  propertyId: string;
  type?: 'call' | 'note' | 'email' | 'meeting';
  occurredAt?: string;
  contactId?: string | null;
  contactNameFreeText?: string | null;
  outcome?: string | null;
  subject?: string | null;
  notes?: string | null;
  sellerMotivation?: string | null;
  pricingExpectation?: string | null;
  timingNotes?: string | null;
  priceMentioned?: string | null;
  followUpDate?: string | null;
  setOutreachStatusId?: string | null;
  setNextFollowUpDate?: string | null;
}, actor: Actor) {
  const [property] = await db
    .select({ id: properties.id, outreachStatusId: properties.outreachStatusId, version: properties.version })
    .from(properties).where(eq(properties.id, input.propertyId)).limit(1);
  if (!property) throw new NotFoundError('Property');

  return db.transaction(async (tx) => {
    const [activity] = await tx.insert(activities).values({
      propertyId: input.propertyId,
      type: input.type ?? 'call',
      occurredAt: input.occurredAt ? new Date(input.occurredAt) : new Date(),
      contactId: input.contactId ?? null,
      contactNameFreeText: input.contactNameFreeText ?? null,
      outcome: (input.outcome ?? null) as never,
      subject: input.subject ?? null,
      notes: input.notes ?? null,
      sellerMotivation: input.sellerMotivation ?? null,
      pricingExpectation: input.pricingExpectation ?? null,
      timingNotes: input.timingNotes ?? null,
      priceMentioned: input.priceMentioned ?? null,
      followUpDate: input.followUpDate ?? input.setNextFollowUpDate ?? null,
      authorUserId: actor.id,
      authorLabel: actor.name,
    }).returning();

    // Side effects on the property record, applied atomically with the log entry.
    const propertyPatch: Record<string, unknown> = { updatedAt: new Date(), updatedBy: actor.id };
    let statusChanged = false;

    if (input.setNextFollowUpDate !== undefined) {
      propertyPatch.nextFollowUpDate = input.setNextFollowUpDate;
    } else if (input.followUpDate) {
      propertyPatch.nextFollowUpDate = input.followUpDate;
    }

    if (input.setOutreachStatusId && input.setOutreachStatusId !== property.outreachStatusId) {
      propertyPatch.outreachStatusId = input.setOutreachStatusId;
      statusChanged = true;
    }

    if (Object.keys(propertyPatch).length > 2 || statusChanged) {
      // version is bumped without an optimistic check here: appending activity is
      // additive and must not fail because someone else edited a different field.
      await tx.update(properties)
        .set({ ...propertyPatch, version: raw`${properties.version} + 1` })
        .where(eq(properties.id, input.propertyId));
    }

    if (statusChanged) {
      const [[from], [to]] = await Promise.all([
        property.outreachStatusId
          ? tx.select({ label: outreachStatuses.label }).from(outreachStatuses).where(eq(outreachStatuses.id, property.outreachStatusId)).limit(1)
          : Promise.resolve([undefined]),
        tx.select({ label: outreachStatuses.label }).from(outreachStatuses).where(eq(outreachStatuses.id, input.setOutreachStatusId!)).limit(1),
      ]);

      // An APPEND. Existing call history is never rewritten by a status change.
      await tx.insert(activities).values({
        propertyId: input.propertyId,
        type: 'status_change',
        occurredAt: new Date(),
        subject: `Outreach status changed to ${to?.label ?? 'unknown'}`,
        metadata: { from: from?.label ?? null, to: to?.label ?? null, viaActivityId: activity!.id },
        authorUserId: actor.id,
        authorLabel: actor.name,
      });
    }

    await recordAudit({
      entityType: 'activity', entityId: activity!.id, action: 'create',
      summary: `Logged ${input.type ?? 'call'}${input.outcome ? ` (${input.outcome.replace(/_/g, ' ')})` : ''}`,
      actor,
    }, tx as unknown as typeof db);

    return activity!;
  });
}

/**
 * Corrects a logged call/note - a typo, a wrong outcome, a date entered
 * wrong. `editedAt` is stamped so the timeline can show it was corrected,
 * without hiding what the original entry said (nothing here overwrites
 * `createdAt` or `authorLabel` - the record still shows who actually logged it).
 */
export async function updateActivity(
  id: string,
  patch: Record<string, unknown>,
  actor: Actor,
) {
  const [existing] = await db.select().from(activities).where(eq(activities.id, id)).limit(1);
  if (!existing) throw new NotFoundError('Activity');
  if (!EDITABLE_ACTIVITY_TYPES.has(existing.type)) {
    throw new ValidationError('This entry was generated automatically and cannot be edited.');
  }

  const values: Record<string, unknown> = { ...patch };
  if ('occurredAt' in patch) values.occurredAt = new Date(patch.occurredAt as string);

  const [updated] = await db.update(activities)
    .set({ ...values, editedAt: new Date(), updatedAt: new Date() })
    .where(eq(activities.id, id))
    .returning();

  await recordAudit({
    entityType: 'activity', entityId: id, action: 'update',
    summary: `Edited a logged ${existing.type}`,
    actor,
  });

  return updated!;
}

/** Removes a mis-logged entry entirely. Never touches status_change/system rows. */
export async function deleteActivity(id: string, actor: Actor) {
  const [existing] = await db.select().from(activities).where(eq(activities.id, id)).limit(1);
  if (!existing) throw new NotFoundError('Activity');
  if (!EDITABLE_ACTIVITY_TYPES.has(existing.type)) {
    throw new ValidationError('This entry was generated automatically and cannot be deleted.');
  }

  await db.delete(activities).where(eq(activities.id, id));

  await recordAudit({
    entityType: 'activity', entityId: id, action: 'delete',
    summary: `Deleted a logged ${existing.type}`,
    actor,
  });
}

/** Changes outreach status on its own, still appending rather than overwriting. */
export async function changeOutreachStatus(
  propertyId: string, statusId: string, note: string | null, actor: Actor,
) {
  const [property] = await db.select().from(properties).where(eq(properties.id, propertyId)).limit(1);
  if (!property) throw new NotFoundError('Property');
  if (property.outreachStatusId === statusId) return;

  const [[from], [to]] = await Promise.all([
    property.outreachStatusId
      ? db.select({ label: outreachStatuses.label }).from(outreachStatuses).where(eq(outreachStatuses.id, property.outreachStatusId)).limit(1)
      : Promise.resolve([undefined]),
    db.select({ label: outreachStatuses.label }).from(outreachStatuses).where(eq(outreachStatuses.id, statusId)).limit(1),
  ]);

  await db.transaction(async (tx) => {
    await tx.update(properties)
      .set({ outreachStatusId: statusId, updatedBy: actor.id, updatedAt: new Date(), version: raw`${properties.version} + 1` })
      .where(eq(properties.id, propertyId));

    await tx.insert(activities).values({
      propertyId, type: 'status_change', occurredAt: new Date(),
      subject: `Outreach status changed to ${to?.label ?? 'unknown'}`,
      notes: note,
      metadata: { from: from?.label ?? null, to: to?.label ?? null },
      authorUserId: actor.id, authorLabel: actor.name,
    });
  });

  await recordAudit({
    entityType: 'property', entityId: propertyId, action: 'status_change',
    summary: `Outreach status: ${from?.label ?? 'none'} -> ${to?.label ?? 'unknown'}`,
    actor,
  });
}

export async function setFollowUp(propertyId: string, date: string | null, actor: Actor) {
  const [updated] = await db.update(properties)
    .set({ nextFollowUpDate: date, updatedBy: actor.id, updatedAt: new Date(), version: raw`${properties.version} + 1` })
    .where(eq(properties.id, propertyId))
    .returning();
  if (!updated) throw new NotFoundError('Property');

  await recordAudit({
    entityType: 'property', entityId: propertyId, action: 'follow_up',
    summary: date ? `Follow-up set for ${date}` : 'Follow-up cleared',
    actor,
  });
  return updated;
}

/* -------------------------------------------------------------------------- */
/* Follow-up queues                                                           */
/* -------------------------------------------------------------------------- */

export type FollowUpBucket = 'overdue' | 'today' | 'upcoming' | 'unscheduled';

const selectFollowUpRow = {
  id: properties.id,
  name: properties.name,
  addressLine1: properties.addressLine1,
  city: properties.city,
  state: properties.state,
  latitude: properties.latitude,
  longitude: properties.longitude,
  marketId: properties.marketId,
  nextFollowUpDate: properties.nextFollowUpDate,
  outreachStatusLabel: outreachStatuses.label,
  outreachStatusColor: outreachStatuses.color,
  isSample: properties.isSample,
  lastActivityAt: raw<string | null>`(select max(a.occurred_at)::text from activities a
    where a.property_id = properties.id and a.type <> 'status_change')`,
};

/**
 * Work queues for the follow-ups screen.
 *
 * 'unscheduled' is deliberately restricted to properties whose outreach status is
 * flagged as active pursuit. Without that, the queue would list every untouched
 * record in the database and be useless.
 */
export async function getFollowUps(
  bucket: FollowUpBucket,
  opts: { marketId?: string; includeSample?: boolean; limit?: number } = {},
) {
  const today = new Date().toISOString().slice(0, 10);
  const conds = [isNull(properties.archivedAt)];
  if (!opts.includeSample) conds.push(eq(properties.isSample, false));
  if (opts.marketId) conds.push(eq(properties.marketId, opts.marketId));

  switch (bucket) {
    case 'overdue':
      conds.push(isNotNull(properties.nextFollowUpDate), lt(properties.nextFollowUpDate, today));
      break;
    case 'today':
      conds.push(eq(properties.nextFollowUpDate, today));
      break;
    case 'upcoming':
      conds.push(raw`${properties.nextFollowUpDate} > ${today}`);
      break;
    case 'unscheduled':
      conds.push(
        isNull(properties.nextFollowUpDate),
        eq(outreachStatuses.countsAsActivePursuit, true),
      );
      break;
  }

  return db
    .select(selectFollowUpRow)
    .from(properties)
    .leftJoin(outreachStatuses, eq(outreachStatuses.id, properties.outreachStatusId))
    .where(and(...conds))
    .orderBy(bucket === 'unscheduled' ? desc(properties.updatedAt) : asc(properties.nextFollowUpDate))
    .limit(opts.limit ?? 200);
}

export async function getFollowUpCounts(opts: { includeSample?: boolean } = {}) {
  // Counts and lists must agree about sample data, so both take the same flag.
  const buckets: FollowUpBucket[] = ['overdue', 'today', 'upcoming', 'unscheduled'];
  const results = await Promise.all(
    buckets.map((b) => getFollowUps(b, { includeSample: opts.includeSample, limit: 1000 })),
  );
  return Object.fromEntries(buckets.map((b, i) => [b, results[i]!.length])) as Record<FollowUpBucket, number>;
}

/** Portfolio-wide recent activity for the dashboard. */
export async function getRecentActivity(limit = 12, includeSample = false) {
  const conds = [raw`activities.type <> 'system'`];
  if (!includeSample) conds.push(eq(properties.isSample, false));

  return db
    .select({
      id: activities.id,
      propertyId: activities.propertyId,
      propertyName: properties.name,
      propertyAddress: properties.addressLine1,
      type: activities.type,
      outcome: activities.outcome,
      subject: activities.subject,
      notes: activities.notes,
      occurredAt: activities.occurredAt,
      authorLabel: activities.authorLabel,
      contactName: contacts.name,
    })
    .from(activities)
    .innerJoin(properties, eq(properties.id, activities.propertyId))
    .leftJoin(contacts, eq(contacts.id, activities.contactId))
    .where(and(...conds))
    .orderBy(desc(activities.occurredAt))
    .limit(limit);
}

/**
 * Proof-of-behaviour helper used by the tests: properties that have had outreach
 * activity but are deliberately NOT in the transaction pipeline.
 */
export async function getContactedButNotPromoted(limit = 50) {
  return db
    .select({ id: properties.id, name: properties.name })
    .from(properties)
    .where(and(
      isNull(properties.archivedAt),
      raw`exists (select 1 from activities a
        where a.property_id = properties.id and a.type = 'call')`,
      raw`not exists (select 1 from opportunity_properties op
        join opportunities o on o.id = op.opportunity_id
        where op.property_id = properties.id and o.state = 'active')`,
    ))
    .limit(limit);
}
