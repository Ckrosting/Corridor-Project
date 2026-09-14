import '@/lib/server-guard';
import { and, eq, isNull, sql as raw } from 'drizzle-orm';
import { db } from '@/db';
import { corridors, properties, propertyCorridors } from '@/db/schema';
import type { Actor } from '@/lib/auth/guards';
import { sqlIn } from '@/lib/db-helpers';
import { NotFoundError } from '@/lib/errors';
import {
  circleToPolygon, classifyRelevance, computeBBox, validateAreaGeometry,
} from '@/lib/geo/polygon';
import type { AreaGeometry } from '@/lib/geo/types';
import { recordAudit, updateWithVersion } from './audit';

/**
 * Materialises the authoritative boundary for a corridor.
 *
 * Both radius and hand-drawn corridors end up stored as a polygon, so every
 * containment query has exactly one code path. The radius parameters are kept
 * alongside so a user can switch back to radius mode without losing them.
 */
export function materialiseBoundary(input: {
  boundaryKind: 'radius' | 'custom';
  boundary?: unknown;
  centerLatitude?: number | null;
  centerLongitude?: number | null;
  radiusMeters?: number | null;
}): { boundary: AreaGeometry; source: 'radius' | 'manual_draw' } {
  if (input.boundaryKind === 'custom') {
    if (!input.boundary) {
      throw new NotFoundError('Corridor boundary');
    }
    return { boundary: validateAreaGeometry(input.boundary), source: 'manual_draw' };
  }

  const { centerLatitude: lat, centerLongitude: lng, radiusMeters } = input;
  if (lat == null || lng == null || radiusMeters == null) {
    throw new NotFoundError('Corridor centre point and radius');
  }
  return { boundary: circleToPolygon({ lat, lng }, radiusMeters), source: 'radius' };
}

export function boundaryColumns(boundary: AreaGeometry) {
  const b = computeBBox(boundary);
  return {
    boundary,
    minLatitude: b.minLat, maxLatitude: b.maxLat,
    minLongitude: b.minLng, maxLongitude: b.maxLng,
  };
}

/* -------------------------------------------------------------------------- */
/* Membership                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Recomputes which properties fall inside a corridor.
 *
 * Manual links (`assignedVia = 'manual'`) are preserved: if a user deliberately
 * attached a property to a corridor, moving the boundary must not silently
 * detach it. Only auto-assigned links are recalculated.
 *
 * Candidates are narrowed by the corridor's bounding box in SQL first, then
 * tested exactly with point-in-polygon in TypeScript.
 */
export async function recomputeCorridorMembership(corridorId: string): Promise<{ added: number; removed: number; kept: number }> {
  const [corridor] = await db.select().from(corridors).where(eq(corridors.id, corridorId)).limit(1);
  if (!corridor) throw new NotFoundError('Corridor');
  if (!corridor.boundary) return { added: 0, removed: 0, kept: 0 };

  const { minLatitude: minLat, maxLatitude: maxLat, minLongitude: minLng, maxLongitude: maxLng } = corridor;

  const candidates = await db
    .select({ id: properties.id, latitude: properties.latitude, longitude: properties.longitude })
    .from(properties)
    .where(and(
      eq(properties.marketId, corridor.marketId),
      isNull(properties.archivedAt),
      raw`${properties.latitude} is not null and ${properties.longitude} is not null`,
      raw`${properties.latitude} between ${minLat ?? -90} and ${maxLat ?? 90}`,
      raw`${properties.longitude} between ${minLng ?? -180} and ${maxLng ?? 180}`,
    ));

  const shouldContain = new Set(
    candidates
      .filter((p) => classifyRelevance(corridor.boundary, { lat: p.latitude, lng: p.longitude }, 0) === 'inside')
      .map((p) => p.id),
  );

  const existing = await db
    .select({ propertyId: propertyCorridors.propertyId, assignedVia: propertyCorridors.assignedVia })
    .from(propertyCorridors)
    .where(eq(propertyCorridors.corridorId, corridorId));

  const existingAuto = new Set(existing.filter((e) => e.assignedVia === 'auto').map((e) => e.propertyId));
  const existingManual = new Set(existing.filter((e) => e.assignedVia === 'manual').map((e) => e.propertyId));

  const toAdd = [...shouldContain].filter((id) => !existingAuto.has(id) && !existingManual.has(id));
  const toRemove = [...existingAuto].filter((id) => !shouldContain.has(id));

  if (toAdd.length > 0) {
    await db.insert(propertyCorridors)
      .values(toAdd.map((propertyId) => ({ propertyId, corridorId, assignedVia: 'auto' })))
      .onConflictDoNothing();
  }
  if (toRemove.length > 0) {
    await db.delete(propertyCorridors).where(and(
      eq(propertyCorridors.corridorId, corridorId),
      eq(propertyCorridors.assignedVia, 'auto'),
      sqlIn('property_corridors.property_id', toRemove),
    ));
  }

  return { added: toAdd.length, removed: toRemove.length, kept: existingManual.size };
}

/**
 * Recomputes corridor membership for ONE property after its coordinates change.
 *
 * This is what makes "one property, many overlapping corridors" work: the
 * property is linked to every corridor whose boundary contains it, and the
 * property record itself is never duplicated.
 */
export async function recomputeMembershipForProperty(propertyId: string): Promise<string[]> {
  const [property] = await db
    .select({ id: properties.id, marketId: properties.marketId, latitude: properties.latitude, longitude: properties.longitude })
    .from(properties)
    .where(eq(properties.id, propertyId))
    .limit(1);
  if (!property) throw new NotFoundError('Property');

  const manual = await db
    .select({ corridorId: propertyCorridors.corridorId })
    .from(propertyCorridors)
    .where(and(eq(propertyCorridors.propertyId, propertyId), eq(propertyCorridors.assignedVia, 'manual')));
  const manualIds = new Set(manual.map((m) => m.corridorId));

  // Remove stale auto links, then recompute from scratch.
  await db.delete(propertyCorridors).where(and(
    eq(propertyCorridors.propertyId, propertyId),
    eq(propertyCorridors.assignedVia, 'auto'),
  ));

  if (property.latitude == null || property.longitude == null) return [...manualIds];

  const marketCorridors = await db
    .select({ id: corridors.id, boundary: corridors.boundary })
    .from(corridors)
    .where(and(eq(corridors.marketId, property.marketId), isNull(corridors.archivedAt)));

  const matching = marketCorridors
    .filter((c) => c.boundary
      && !manualIds.has(c.id)
      && classifyRelevance(c.boundary, { lat: property.latitude, lng: property.longitude }, 0) === 'inside')
    .map((c) => c.id);

  if (matching.length > 0) {
    await db.insert(propertyCorridors)
      .values(matching.map((corridorId) => ({ propertyId, corridorId, assignedVia: 'auto' })))
      .onConflictDoNothing();
  }

  return [...new Set([...matching, ...manualIds])];
}

/* -------------------------------------------------------------------------- */
/* Writes                                                                     */
/* -------------------------------------------------------------------------- */

export async function createCorridor(input: {
  marketId: string;
  name: string;
  description?: string | null;
  color?: string;
  anchorId?: string | null;
  centerLatitude?: number | null;
  centerLongitude?: number | null;
  radiusMeters?: number | null;
  boundary?: unknown;
}, actor: Actor) {
  const kind = input.boundary ? 'custom' : 'radius';
  const { boundary, source } = materialiseBoundary({ ...input, boundaryKind: kind });

  const [row] = await db.insert(corridors).values({
    marketId: input.marketId,
    name: input.name,
    description: input.description ?? null,
    color: input.color ?? '#2563eb',
    boundaryKind: kind,
    boundarySource: source,
    anchorId: input.anchorId ?? null,
    centerLatitude: input.centerLatitude ?? null,
    centerLongitude: input.centerLongitude ?? null,
    radiusMeters: input.radiusMeters ?? null,
    ...boundaryColumns(boundary),
    createdBy: actor.id,
  }).returning();

  await recordAudit({
    entityType: 'corridor', entityId: row!.id, action: 'create',
    summary: `Created corridor "${input.name}" (${kind === 'radius' ? 'radius' : 'drawn boundary'})`,
    actor,
  });
  await recomputeCorridorMembership(row!.id);
  return row!;
}

export async function updateCorridor(id: string, input: {
  version: number;
  name?: string;
  description?: string | null;
  color?: string;
  anchorId?: string | null;
  centerLatitude?: number | null;
  centerLongitude?: number | null;
  radiusMeters?: number | null;
  boundary?: unknown;
  boundaryKind?: 'radius' | 'custom';
  sortOrder?: number;
}, actor: Actor) {
  const [before] = await db.select().from(corridors).where(eq(corridors.id, id)).limit(1);
  if (!before) throw new NotFoundError('Corridor');

  const values: Record<string, unknown> = {};
  for (const key of ['name', 'description', 'color', 'anchorId', 'sortOrder', 'centerLatitude', 'centerLongitude', 'radiusMeters'] as const) {
    if (input[key] !== undefined) values[key] = input[key];
  }

  // Re-materialise the boundary whenever the shape or the mode changed.
  const nextKind = input.boundaryKind ?? (input.boundary !== undefined ? 'custom' : before.boundaryKind);
  const geometryTouched =
    input.boundary !== undefined ||
    input.boundaryKind !== undefined ||
    input.centerLatitude !== undefined ||
    input.centerLongitude !== undefined ||
    input.radiusMeters !== undefined;

  if (geometryTouched) {
    const { boundary, source } = materialiseBoundary({
      boundaryKind: nextKind,
      boundary: input.boundary ?? before.boundary,
      centerLatitude: input.centerLatitude ?? before.centerLatitude,
      centerLongitude: input.centerLongitude ?? before.centerLongitude,
      radiusMeters: input.radiusMeters ?? before.radiusMeters,
    });
    Object.assign(values, boundaryColumns(boundary), { boundaryKind: nextKind, boundarySource: source });
  }

  const updated = await updateWithVersion<typeof corridors.$inferSelect>({
    table: corridors, id, expectedVersion: input.version, values, entityLabel: 'corridor',
  });

  await recordAudit({
    entityType: 'corridor', entityId: id, action: 'update',
    summary: geometryTouched ? `Updated corridor "${before.name}" boundary` : `Updated corridor "${before.name}"`,
    actor,
  });

  if (geometryTouched) await recomputeCorridorMembership(id);
  return updated;
}
