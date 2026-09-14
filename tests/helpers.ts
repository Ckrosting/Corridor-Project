import 'dotenv/config';
import { eq, inArray, like } from 'drizzle-orm';
import { db } from '@/db';
import {
  corridors, markets, opportunities, outreachStatuses, properties,
  transactionStages, users,
} from '@/db/schema';
import type { Actor } from '@/lib/auth/guards';
import { circleToPolygon, computeBBox } from '@/lib/geo/polygon';
import type { AreaGeometry } from '@/lib/geo/types';

/**
 * Integration tests run against the real local PostgreSQL instance, not a mock.
 * The point of these tests is that geometry, history and pipeline rules survive a
 * genuine round trip through Postgres, which an in-memory fake cannot prove.
 *
 * Every fixture name is prefixed so cleanup can delete exactly what the tests
 * created and nothing else.
 */
export const TEST_PREFIX = 'ZZTEST';

export async function testActor(): Promise<Actor> {
  const email = `${TEST_PREFIX.toLowerCase()}-runner@example.invalid`;
  const [existing] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  const user = existing ?? (
    await db.insert(users).values({
      email, name: `${TEST_PREFIX} Runner`, role: 'admin', passwordHash: null,
    }).returning()
  )[0]!;

  return { id: user.id, name: user.name, email: user.email, role: 'admin', label: user.name };
}

export async function ensureBaseline() {
  // Statuses and stages come from the seed. Tests depend on them existing.
  const [status] = await db.select().from(outreachStatuses).limit(1);
  const [stage] = await db.select().from(transactionStages).limit(1);
  if (!status || !stage) {
    throw new Error('Baseline data missing. Run `npm run db:seed` before the tests.');
  }
}

export async function statusByKey(key: string) {
  const [row] = await db.select().from(outreachStatuses).where(eq(outreachStatuses.key, key)).limit(1);
  if (!row) throw new Error(`Outreach status "${key}" not found. Run \`npm run db:seed\`.`);
  return row;
}

export async function stageByKey(key: string) {
  const [row] = await db.select().from(transactionStages).where(eq(transactionStages.key, key)).limit(1);
  if (!row) throw new Error(`Transaction stage "${key}" not found. Run \`npm run db:seed\`.`);
  return row;
}

export async function createTestMarket(name = 'Market') {
  const slug = `${TEST_PREFIX.toLowerCase()}-${name.toLowerCase().replace(/\W+/g, '-')}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const [market] = await db.insert(markets).values({
    name: `${TEST_PREFIX} ${name}`, slug, state: 'GA',
  }).returning();
  return market!;
}

/** A radius corridor centred on a point, materialised the same way the app does. */
export async function createRadiusCorridor(
  marketId: string, center: { lat: number; lng: number }, radiusMeters: number, name = 'Corridor',
) {
  const boundary = circleToPolygon(center, radiusMeters);
  const b = computeBBox(boundary);
  const [corridor] = await db.insert(corridors).values({
    marketId, name: `${TEST_PREFIX} ${name}`,
    boundaryKind: 'radius', boundarySource: 'radius',
    centerLatitude: center.lat, centerLongitude: center.lng, radiusMeters,
    boundary,
    minLatitude: b.minLat, maxLatitude: b.maxLat, minLongitude: b.minLng, maxLongitude: b.maxLng,
  }).returning();
  return corridor!;
}

/** An axis-aligned square polygon of roughly `halfSizeDeg` around a point. */
export function squareAround(center: { lat: number; lng: number }, halfSizeDeg = 0.001): AreaGeometry {
  const { lat, lng } = center;
  return {
    type: 'Polygon',
    coordinates: [[
      [lng - halfSizeDeg, lat - halfSizeDeg],
      [lng + halfSizeDeg, lat - halfSizeDeg],
      [lng + halfSizeDeg, lat + halfSizeDeg],
      [lng - halfSizeDeg, lat + halfSizeDeg],
      [lng - halfSizeDeg, lat - halfSizeDeg],
    ]],
  };
}

/**
 * Removes everything the tests created.
 *
 * Order matters: `properties.market_id` is ON DELETE RESTRICT on purpose, so that
 * a market holding real property records cannot be deleted by accident. Cleanup
 * therefore removes the dependants explicitly rather than relying on a cascade.
 * Parcels, activities, corridor links and opportunity links all cascade from
 * the property rows.
 */
export async function cleanupTestData() {
  const testMarkets = await db
    .select({ id: markets.id })
    .from(markets)
    .where(like(markets.slug, `${TEST_PREFIX.toLowerCase()}-%`));

  if (testMarkets.length > 0) {
    const ids = testMarkets.map((m) => m.id);
    // Opportunities reference the market with ON DELETE SET NULL, so they would
    // otherwise survive as orphans.
    await db.delete(opportunities).where(inArray(opportunities.marketId, ids));
    await db.delete(properties).where(inArray(properties.marketId, ids));
    await db.delete(corridors).where(inArray(corridors.marketId, ids));
    await db.delete(markets).where(inArray(markets.id, ids));
  }

  await db.delete(users).where(like(users.email, `${TEST_PREFIX.toLowerCase()}-%`));
}
