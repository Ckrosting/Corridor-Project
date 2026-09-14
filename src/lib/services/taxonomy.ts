import '@/lib/server-guard';
import { and, asc, eq, isNull, sql as raw } from 'drizzle-orm';
import { db } from '@/db';
import {
  customFieldDefs, opportunities, outreachStatuses, properties, transactionStages,
} from '@/db/schema';
import type { Actor } from '@/lib/auth/guards';
import { InUseError, NotFoundError, ValidationError } from '@/lib/errors';
import { recordAudit } from './audit';

/**
 * Configurable vocabularies: outreach statuses, transaction stages and custom
 * field definitions.
 *
 * The rule that matters: a status or stage that is IN USE is never deleted. It is
 * archived, and archiving one that is still referenced requires naming a
 * replacement so no property or opportunity is left pointing at nothing.
 */

const slugify = (label: string) =>
  label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 50);

/* -------------------------------------------------------------------------- */
/* Outreach statuses                                                          */
/* -------------------------------------------------------------------------- */

export async function listStatusesWithUsage() {
  return db
    .select({
      s: outreachStatuses,
      inUse: raw<number>`(select count(*)::int from properties p
        where p.outreach_status_id = outreach_statuses.id)`,
    })
    .from(outreachStatuses)
    .where(isNull(outreachStatuses.archivedAt))
    .orderBy(asc(outreachStatuses.sortOrder));
}

export async function upsertStatus(input: {
  id?: string;
  label: string;
  color: string;
  sortOrder: number;
  countsAsActivePursuit?: boolean;
}, actor: Actor) {
  if (input.id) {
    const [updated] = await db.update(outreachStatuses).set({
      label: input.label,
      color: input.color,
      sortOrder: input.sortOrder,
      countsAsActivePursuit: input.countsAsActivePursuit ?? false,
      updatedAt: new Date(),
    }).where(eq(outreachStatuses.id, input.id)).returning();
    if (!updated) throw new NotFoundError('Outreach status');

    await recordAudit({
      entityType: 'outreach_status', entityId: input.id, action: 'update',
      summary: `Updated outreach status "${input.label}"`, actor,
    });
    return updated;
  }

  const [created] = await db.insert(outreachStatuses).values({
    // The key is stable and internal; only the label is user-facing, so renaming
    // a status never breaks anything that references it.
    key: `${slugify(input.label)}_${Date.now().toString(36)}`,
    label: input.label,
    color: input.color,
    sortOrder: input.sortOrder,
    countsAsActivePursuit: input.countsAsActivePursuit ?? false,
  }).returning();

  await recordAudit({
    entityType: 'outreach_status', entityId: created!.id, action: 'create',
    summary: `Created outreach status "${input.label}"`, actor,
  });
  return created!;
}

/**
 * Archives a status. If any property still uses it, a replacement must be named
 * and those properties are reassigned in the same transaction — so a status can
 * never disappear out from under live records.
 */
export async function archiveStatus(id: string, reassignToId: string | null, actor: Actor) {
  const [status] = await db.select().from(outreachStatuses).where(eq(outreachStatuses.id, id)).limit(1);
  if (!status) throw new NotFoundError('Outreach status');
  if (status.isDefault) {
    throw new ValidationError('The default status cannot be archived. Make another status the default first.');
  }

  const [usage] = await db
    .select({ n: raw<number>`count(*)::int` })
    .from(properties)
    .where(eq(properties.outreachStatusId, id));
  const inUse = usage?.n ?? 0;

  if (inUse > 0) {
    if (!reassignToId) {
      throw new InUseError(
        `${inUse} propert${inUse === 1 ? 'y is' : 'ies are'} still using "${status.label}". Choose a status to move them to first.`,
        { inUse },
      );
    }
    const [target] = await db.select().from(outreachStatuses)
      .where(and(eq(outreachStatuses.id, reassignToId), isNull(outreachStatuses.archivedAt))).limit(1);
    if (!target) throw new NotFoundError('Replacement status');

    await db.transaction(async (tx) => {
      await tx.update(properties)
        .set({ outreachStatusId: reassignToId, updatedAt: new Date() })
        .where(eq(properties.outreachStatusId, id));
      await tx.update(outreachStatuses)
        .set({ archivedAt: new Date() })
        .where(eq(outreachStatuses.id, id));
    });

    await recordAudit({
      entityType: 'outreach_status', entityId: id, action: 'archive',
      summary: `Archived "${status.label}" and moved ${inUse} propert${inUse === 1 ? 'y' : 'ies'} to "${target.label}"`,
      actor,
    });
    return { archived: true, reassigned: inUse };
  }

  await db.update(outreachStatuses).set({ archivedAt: new Date() }).where(eq(outreachStatuses.id, id));
  await recordAudit({
    entityType: 'outreach_status', entityId: id, action: 'archive',
    summary: `Archived unused outreach status "${status.label}"`, actor,
  });
  return { archived: true, reassigned: 0 };
}

/* -------------------------------------------------------------------------- */
/* Transaction stages                                                         */
/* -------------------------------------------------------------------------- */

export async function listStagesWithUsage() {
  return db
    .select({
      s: transactionStages,
      inUse: raw<number>`(select count(*)::int from opportunities o
        where o.stage_id = transaction_stages.id)`,
    })
    .from(transactionStages)
    .where(isNull(transactionStages.archivedAt))
    .orderBy(asc(transactionStages.sortOrder));
}

export async function upsertStage(input: {
  id?: string;
  label: string;
  color: string;
  sortOrder: number;
  isTerminal?: boolean;
  category?: 'open' | 'closed_won' | 'closed_lost' | 'on_hold';
}, actor: Actor) {
  if (input.id) {
    const [updated] = await db.update(transactionStages).set({
      label: input.label,
      color: input.color,
      sortOrder: input.sortOrder,
      isTerminal: input.isTerminal ?? false,
      category: input.category ?? 'open',
      updatedAt: new Date(),
    }).where(eq(transactionStages.id, input.id)).returning();
    if (!updated) throw new NotFoundError('Transaction stage');

    await recordAudit({
      entityType: 'transaction_stage', entityId: input.id, action: 'update',
      summary: `Updated stage "${input.label}"`, actor,
    });
    return updated;
  }

  const [created] = await db.insert(transactionStages).values({
    key: `${slugify(input.label)}_${Date.now().toString(36)}`,
    label: input.label,
    color: input.color,
    sortOrder: input.sortOrder,
    isTerminal: input.isTerminal ?? false,
    category: input.category ?? 'open',
  }).returning();

  await recordAudit({
    entityType: 'transaction_stage', entityId: created!.id, action: 'create',
    summary: `Created stage "${input.label}"`, actor,
  });
  return created!;
}

export async function archiveStage(id: string, reassignToId: string | null, actor: Actor) {
  const [stage] = await db.select().from(transactionStages).where(eq(transactionStages.id, id)).limit(1);
  if (!stage) throw new NotFoundError('Transaction stage');
  if (stage.isDefault) {
    throw new ValidationError('The default stage cannot be archived. Make another stage the default first.');
  }

  const [usage] = await db
    .select({ n: raw<number>`count(*)::int` })
    .from(opportunities)
    .where(eq(opportunities.stageId, id));
  const inUse = usage?.n ?? 0;

  if (inUse > 0) {
    if (!reassignToId) {
      throw new InUseError(
        `${inUse} opportunit${inUse === 1 ? 'y is' : 'ies are'} still at "${stage.label}". Choose a stage to move them to first.`,
        { inUse },
      );
    }
    const [target] = await db.select().from(transactionStages)
      .where(and(eq(transactionStages.id, reassignToId), isNull(transactionStages.archivedAt))).limit(1);
    if (!target) throw new NotFoundError('Replacement stage');

    await db.transaction(async (tx) => {
      await tx.update(opportunities)
        .set({ stageId: reassignToId, updatedAt: new Date() })
        .where(eq(opportunities.stageId, id));
      await tx.update(transactionStages)
        .set({ archivedAt: new Date() })
        .where(eq(transactionStages.id, id));
    });

    await recordAudit({
      entityType: 'transaction_stage', entityId: id, action: 'archive',
      summary: `Archived "${stage.label}" and moved ${inUse} opportunit${inUse === 1 ? 'y' : 'ies'} to "${target.label}"`,
      actor,
    });
    return { archived: true, reassigned: inUse };
  }

  await db.update(transactionStages).set({ archivedAt: new Date() }).where(eq(transactionStages.id, id));
  await recordAudit({
    entityType: 'transaction_stage', entityId: id, action: 'archive',
    summary: `Archived unused stage "${stage.label}"`, actor,
  });
  return { archived: true, reassigned: 0 };
}

/* -------------------------------------------------------------------------- */
/* Custom fields                                                              */
/* -------------------------------------------------------------------------- */

export async function listCustomFields() {
  return db
    .select({
      def: customFieldDefs,
      inUse: raw<number>`(select count(*)::int from custom_field_values v
        where v.def_id = custom_field_defs.id)`,
    })
    .from(customFieldDefs)
    .where(and(eq(customFieldDefs.entity, 'property'), isNull(customFieldDefs.archivedAt)))
    .orderBy(asc(customFieldDefs.sortOrder));
}

export async function createCustomField(input: {
  label: string;
  type: 'text' | 'number' | 'date' | 'checkbox' | 'select';
  options?: string[];
  helpText?: string | null;
  sortOrder?: number;
}, actor: Actor) {
  const [created] = await db.insert(customFieldDefs).values({
    entity: 'property',
    key: `${slugify(input.label)}_${Date.now().toString(36)}`,
    label: input.label,
    type: input.type,
    options: input.type === 'select' ? (input.options ?? []) : null,
    helpText: input.helpText ?? null,
    sortOrder: input.sortOrder ?? 100,
  }).returning();

  await recordAudit({
    entityType: 'custom_field', entityId: created!.id, action: 'create',
    summary: `Created custom ${input.type} field "${input.label}"`, actor,
  });
  return created!;
}

/** Archiving keeps recorded values intact; the field simply stops being offered. */
export async function archiveCustomField(id: string, actor: Actor) {
  const [def] = await db.select().from(customFieldDefs).where(eq(customFieldDefs.id, id)).limit(1);
  if (!def) throw new NotFoundError('Custom field');

  await db.update(customFieldDefs).set({ archivedAt: new Date() }).where(eq(customFieldDefs.id, id));
  await recordAudit({
    entityType: 'custom_field', entityId: id, action: 'archive',
    summary: `Archived custom field "${def.label}" (recorded values kept)`, actor,
  });
}
