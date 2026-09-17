import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { appSettings, propertyTags, tags } from '@/db/schema';
import { archiveTag, createTag, listTagsWithUsage, updateTag } from '@/lib/services/tags';
import { createProperty } from '@/lib/services/properties';
import { getPropertyTypes, setSetting, SETTING_KEYS } from '@/lib/services/settings';
import { ValidationError } from '@/lib/errors';
import type { Actor } from '@/lib/auth/guards';
import {
  cleanupTestData, createTestMarket, ensureBaseline, TEST_PREFIX, testActor,
} from './helpers';

/**
 * Integration tests against the real local PostgreSQL database.
 *
 * Run `npm run db:up && npm run db:migrate && npm run db:seed` first.
 */

let actor: Actor;
const ANCHOR = { lat: 33.4735, lng: -82.0812 };

beforeAll(async () => {
  await ensureBaseline();
  await cleanupTestData();
  actor = await testActor();
});

afterAll(async () => {
  await cleanupTestData();
});

describe('tag vocabulary', () => {
  it('creates a tag and reports it as unused', async () => {
    const tag = await createTag({ name: `${TEST_PREFIX} Corner Lot`, color: '#0ea5e9' }, actor);
    expect(tag.id).toBeTruthy();
    expect(tag.archivedAt).toBeNull();

    const listed = (await listTagsWithUsage()).find((t) => t.id === tag.id);
    expect(listed?.color).toBe('#0ea5e9');
    expect(listed?.inUse).toBe(0);
  });

  it('rejects a duplicate name regardless of case, before the DB constraint fires', async () => {
    await createTag({ name: `${TEST_PREFIX} Dupe`, color: '#22c55e' }, actor);
    await expect(createTag({ name: `${TEST_PREFIX} dUpE`, color: '#ef4444' }, actor))
      .rejects.toBeInstanceOf(ValidationError);
  });

  it('renames and recolours a tag in place', async () => {
    const tag = await createTag({ name: `${TEST_PREFIX} Before`, color: '#94a3b8' }, actor);
    const renamed = await updateTag(tag.id, { name: `${TEST_PREFIX} After`, color: '#8b5cf6' }, actor);

    expect(renamed.name).toBe(`${TEST_PREFIX} After`);
    expect(renamed.color).toBe('#8b5cf6');

    const [reloaded] = await db.select().from(tags).where(eq(tags.id, tag.id));
    expect(reloaded!.name).toBe(`${TEST_PREFIX} After`);
  });

  it('refuses a rename that collides with another tag, case-insensitively', async () => {
    await createTag({ name: `${TEST_PREFIX} Taken`, color: '#f59e0b' }, actor);
    const other = await createTag({ name: `${TEST_PREFIX} Free`, color: '#f59e0b' }, actor);

    await expect(updateTag(other.id, { name: `${TEST_PREFIX} TAKEN` }, actor))
      .rejects.toBeInstanceOf(ValidationError);
  });

  it('recolours without touching the name', async () => {
    const tag = await createTag({ name: `${TEST_PREFIX} Recolour`, color: '#94a3b8' }, actor);
    const updated = await updateTag(tag.id, { color: '#14b8a6' }, actor);
    expect(updated.name).toBe(`${TEST_PREFIX} Recolour`);
    expect(updated.color).toBe('#14b8a6');
  });

  // The policy: archiving follows custom fields, not outreach statuses. A tag in
  // use is archived anyway and the property keeps it; only the pickers drop it.
  it('archives a tag that is in use and keeps the property link intact', async () => {
    const market = await createTestMarket('TagArchive');
    const tag = await createTag({ name: `${TEST_PREFIX} InUse`, color: '#6366f1' }, actor);
    const property = await createProperty({
      marketId: market.id, name: `${TEST_PREFIX} Tagged`, latitude: ANCHOR.lat, longitude: ANCHOR.lng,
      tagIds: [tag.id],
    }, actor);

    const beforeListed = (await listTagsWithUsage()).find((t) => t.id === tag.id);
    expect(beforeListed?.inUse).toBe(1);

    const result = await archiveTag(tag.id, actor);
    expect(result).toEqual({ archived: true, keptOn: 1 });

    const [reloaded] = await db.select().from(tags).where(eq(tags.id, tag.id));
    expect(reloaded!.archivedAt).toBeTruthy();

    // The link survives - archiving hides the tag from pickers, it does not unfile anything.
    const links = await db.select().from(propertyTags).where(eq(propertyTags.propertyId, property.id));
    expect(links.map((l) => l.tagId)).toContain(tag.id);

    // ...and the archived tag is gone from the active vocabulary.
    expect((await listTagsWithUsage()).some((t) => t.id === tag.id)).toBe(false);
  });

  it('archives an unused tag', async () => {
    const tag = await createTag({ name: `${TEST_PREFIX} Unused`, color: '#dc2626' }, actor);
    expect(await archiveTag(tag.id, actor)).toEqual({ archived: true, keptOn: 0 });
  });
});

describe('property type settings', () => {
  const original: string[] = [];

  beforeAll(async () => {
    original.push(...(await getPropertyTypes()));
  });

  afterAll(async () => {
    // Restore the seeded list rather than leaving the test's edits behind.
    await db.delete(appSettings).where(eq(appSettings.key, SETTING_KEYS.propertyTypes));
  });

  it('round-trips an added and then removed property type', async () => {
    const added = `${TEST_PREFIX} Self Storage`;
    await setSetting(SETTING_KEYS.propertyTypes, [...original, added], actor);
    expect(await getPropertyTypes()).toContain(added);

    const after = (await getPropertyTypes()).filter((t) => t !== added);
    await setSetting(SETTING_KEYS.propertyTypes, after, actor);

    const final = await getPropertyTypes();
    expect(final).not.toContain(added);
    expect(final).toEqual(original);
  });
});
