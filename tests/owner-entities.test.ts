import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  archiveOwnerEntity, createOwnerEntity, listOwnerEntities,
  restoreOwnerEntity, updateOwnerEntity,
} from '@/lib/services/owner-entities';
import { createProperty, getPropertyDetail, updateProperty } from '@/lib/services/properties';
import { ConflictError } from '@/lib/errors';
import type { Actor } from '@/lib/auth/guards';
import { cleanupTestData, createTestMarket, ensureBaseline, TEST_PREFIX, testActor } from './helpers';

/**
 * Integration tests against the real local PostgreSQL database.
 *
 * Run `npm run db:up && npm run db:migrate && npm run db:seed` first.
 */
describe('owner entities', () => {
  let actor: Actor;

  beforeAll(async () => {
    await ensureBaseline();
    await cleanupTestData();
    actor = await testActor();
  });

  afterAll(async () => {
    await cleanupTestData();
  });

  it('creates an entity and finds it by name search', async () => {
    const entity = await createOwnerEntity(
      { name: `${TEST_PREFIX} Peachtree Holdings LLC`, entityType: 'LLC', mailingAddress: '1 Main St' },
      actor,
    );

    expect(entity.version).toBe(1);
    expect(entity.entityType).toBe('LLC');

    const found = await listOwnerEntities('peachtree holdings');
    expect(found.map((e) => e.id)).toContain(entity.id);
  });

  it('rejects an update carrying a stale version', async () => {
    const entity = await createOwnerEntity({ name: `${TEST_PREFIX} Stale Trust` }, actor);

    const updated = await updateOwnerEntity(entity.id, { version: entity.version, notes: 'First edit' }, actor);
    expect(updated.notes).toBe('First edit');
    expect(updated.version).toBe(entity.version + 1);

    await expect(
      updateOwnerEntity(entity.id, { version: entity.version, notes: 'Second edit' }, actor),
    ).rejects.toBeInstanceOf(ConflictError);

    const still = await listOwnerEntities('Stale Trust');
    expect(still).toHaveLength(1);
  });

  it('archives an entity out of the picker and restores it', async () => {
    const entity = await createOwnerEntity({ name: `${TEST_PREFIX} Archivable Corp` }, actor);

    const archived = await archiveOwnerEntity(entity.id, actor);
    expect(archived.archivedAt).not.toBeNull();
    expect(await listOwnerEntities('Archivable Corp')).toHaveLength(0);

    const restored = await restoreOwnerEntity(entity.id, archived.version, actor);
    expect(restored.archivedAt).toBeNull();
    expect(await listOwnerEntities('Archivable Corp')).toHaveLength(1);
  });

  it('links a property to an entity and reads it back through the detail view', async () => {
    const market = await createTestMarket('Owner');
    const entity = await createOwnerEntity(
      { name: `${TEST_PREFIX} Linked Partners LP`, entityType: 'LP', mailingAddress: 'PO Box 9' },
      actor,
    );

    const property = await createProperty(
      { marketId: market.id, name: `${TEST_PREFIX} Linked Property`, skipParcelMatch: true },
      actor,
    );

    const linked = await updateProperty(property.id, { version: property.version, ownerEntityId: entity.id }, actor);

    const detail = await getPropertyDetail(property.id);
    expect(detail.ownerEntity).not.toBeNull();
    expect(detail.ownerEntity!.id).toBe(entity.id);
    expect(detail.ownerEntity!.name).toBe(entity.name);
    expect(detail.ownerEntity!.entityType).toBe('LP');
    expect(detail.ownerEntity!.version).toBe(entity.version);

    // Clearing the link must leave the entity itself untouched.
    await updateProperty(property.id, { version: linked.version, ownerEntityId: null }, actor);
    expect((await getPropertyDetail(property.id)).ownerEntity).toBeNull();
    expect(await listOwnerEntities('Linked Partners')).toHaveLength(1);
  });
});
