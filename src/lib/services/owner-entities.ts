import '@/lib/server-guard';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { db } from '@/db';
import { ownerEntities } from '@/db/schema';
import type { Actor } from '@/lib/auth/guards';
import { NotFoundError } from '@/lib/errors';
import { recordAudit, updateWithVersion } from './audit';

/**
 * An owner entity is the legal owner of a property - an LLC, a trust, an
 * individual on a deed. It is deliberately not a `contact`: the people who
 * represent an entity (its manager, its broker) are contacts and have phone
 * numbers, an entity has a mailing address and a filing type. Properties point
 * at one entity, so editing the entity corrects every property it owns at once.
 */

export async function createOwnerEntity(
  input: Record<string, unknown>,
  actor: Actor,
) {
  const [row] = await db.insert(ownerEntities).values({
    ...input,
    createdBy: actor.id,
  } as typeof ownerEntities.$inferInsert).returning();

  await recordAudit({
    entityType: 'owner_entity', entityId: row!.id, action: 'create',
    summary: `Added owner entity "${row!.name}"`,
    actor,
  });

  return row!;
}

export async function updateOwnerEntity(
  id: string,
  input: Record<string, unknown> & { version: number; markVerified?: boolean },
  actor: Actor,
) {
  const { version, markVerified, ...patch } = input;

  const values: Record<string, unknown> = { ...patch };
  if (markVerified) values.verifiedAt = new Date();

  const entity = await updateWithVersion<typeof ownerEntities.$inferSelect>({
    table: ownerEntities, id, expectedVersion: version, values, entityLabel: 'owner entity',
  });

  await recordAudit({
    entityType: 'owner_entity', entityId: id, action: 'update',
    summary: `Updated owner entity "${entity.name}"`,
    actor,
  });

  return entity;
}

/** Archive rather than delete: properties reference the entity, and its history is evidence. */
export async function archiveOwnerEntity(id: string, actor: Actor) {
  const [entity] = await db.update(ownerEntities)
    .set({ archivedAt: new Date() })
    .where(eq(ownerEntities.id, id))
    .returning();
  if (!entity) throw new NotFoundError('Owner entity');

  await recordAudit({
    entityType: 'owner_entity', entityId: id, action: 'archive',
    summary: `Archived owner entity "${entity.name}"`,
    actor,
  });

  return entity;
}

export async function restoreOwnerEntity(id: string, version: number, actor: Actor) {
  const entity = await updateWithVersion<typeof ownerEntities.$inferSelect>({
    table: ownerEntities, id, expectedVersion: version, values: { archivedAt: null }, entityLabel: 'owner entity',
  });

  await recordAudit({
    entityType: 'owner_entity', entityId: id, action: 'restore',
    summary: `Restored owner entity "${entity.name}"`,
    actor,
  });

  return entity;
}

/** Name search for the property editor's picker. Archived entities stay out of the list. */
export async function listOwnerEntities(search?: string, limit = 20) {
  const term = search?.trim();
  const conds = [isNull(ownerEntities.archivedAt)];
  if (term) conds.push(sql`lower(${ownerEntities.name}) like ${`%${term.toLowerCase()}%`}`);

  return db.select({
    id: ownerEntities.id,
    name: ownerEntities.name,
    entityType: ownerEntities.entityType,
    mailingAddress: ownerEntities.mailingAddress,
    version: ownerEntities.version,
  })
    .from(ownerEntities)
    .where(and(...conds))
    .orderBy(asc(ownerEntities.name))
    .limit(limit);
}
