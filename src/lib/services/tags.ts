import '@/lib/server-guard';
import { and, asc, eq, isNull, ne, sql as raw } from 'drizzle-orm';
import { db } from '@/db';
import { propertyTags, tags } from '@/db/schema';
import type { Actor } from '@/lib/auth/guards';
import { NotFoundError, ValidationError } from '@/lib/errors';
import { recordAudit } from './audit';

/**
 * Tags are a shared, global vocabulary applied to properties.
 *
 * Archiving follows the custom-field rule, not the outreach-status rule: the
 * links already recorded on properties are kept, and the tag simply stops being
 * offered in the pickers (every picker filters on archivedAt). Nothing is left
 * pointing at nothing, so no reassignment is needed.
 */

export async function listTagsWithUsage() {
  return db
    .select({
      id: tags.id,
      name: tags.name,
      color: tags.color,
      inUse: raw<number>`(select count(*)::int from property_tags pt where pt.tag_id = tags.id)`,
    })
    .from(tags)
    .where(isNull(tags.archivedAt))
    .orderBy(asc(tags.name));
}

/** The DB has a case-insensitive unique index; check first for a readable message. */
async function assertNameFree(name: string, exceptId?: string) {
  const clash = and(
    raw`lower(${tags.name}) = lower(${name})`,
    exceptId ? ne(tags.id, exceptId) : undefined,
  );
  const [existing] = await db.select({ id: tags.id, archivedAt: tags.archivedAt })
    .from(tags).where(clash).limit(1);
  if (existing) {
    throw new ValidationError(
      existing.archivedAt
        ? `An archived tag is already named "${name}". Rename it or pick another name.`
        : `A tag named "${name}" already exists.`,
    );
  }
}

export async function createTag(input: { name: string; color: string }, actor: Actor) {
  await assertNameFree(input.name);

  const [created] = await db.insert(tags)
    .values({ name: input.name, color: input.color }).returning();

  await recordAudit({
    entityType: 'tag', entityId: created!.id, action: 'create',
    summary: `Created tag "${input.name}"`, actor,
  });
  return created!;
}

export async function updateTag(
  id: string, input: { name?: string; color?: string }, actor: Actor,
) {
  const [existing] = await db.select().from(tags).where(eq(tags.id, id)).limit(1);
  if (!existing) throw new NotFoundError('Tag');

  if (input.name && input.name !== existing.name) await assertNameFree(input.name, id);

  const [updated] = await db.update(tags).set({
    name: input.name ?? existing.name,
    color: input.color ?? existing.color,
  }).where(eq(tags.id, id)).returning();

  await recordAudit({
    entityType: 'tag', entityId: id, action: 'update',
    summary: input.name && input.name !== existing.name
      ? `Renamed tag "${existing.name}" to "${input.name}"`
      : `Updated tag "${existing.name}"`,
    changes: {
      ...(input.name && input.name !== existing.name ? { name: { from: existing.name, to: input.name } } : {}),
      ...(input.color && input.color !== existing.color ? { color: { from: existing.color, to: input.color } } : {}),
    },
    actor,
  });
  return updated!;
}

/** Archiving keeps every property's existing tag link; the tag stops being offered. */
export async function archiveTag(id: string, actor: Actor) {
  const [tag] = await db.select().from(tags).where(eq(tags.id, id)).limit(1);
  if (!tag) throw new NotFoundError('Tag');

  const [usage] = await db
    .select({ n: raw<number>`count(*)::int` })
    .from(propertyTags)
    .where(eq(propertyTags.tagId, id));
  const inUse = usage?.n ?? 0;

  await db.update(tags).set({ archivedAt: new Date() }).where(eq(tags.id, id));
  await recordAudit({
    entityType: 'tag', entityId: id, action: 'archive',
    summary: inUse > 0
      ? `Archived tag "${tag.name}" (kept on ${inUse} propert${inUse === 1 ? 'y' : 'ies'})`
      : `Archived unused tag "${tag.name}"`,
    actor,
  });
  return { archived: true, keptOn: inUse };
}
