import '@/lib/server-guard';
import { and, asc, eq, inArray, isNull, sql as raw } from 'drizzle-orm';
import { db } from '@/db';
import {
  corridors, mallAnchors, markets, outreachStatuses, propertyParcels, tags,
} from '@/db/schema';
import { NotFoundError } from '@/lib/errors';
import { listProperties, type PropertyFilters } from './properties';
import { getPropertyTypes, showSampleData } from './settings';

/**
 * Loads everything a corridor workspace needs in one round trip: the corridor
 * and its siblings, the market's anchors, the properties in scope, their parcel
 * geometry, and the filter vocabularies.
 */
export async function getCorridorWorkspace(corridorId: string, filters: Partial<PropertyFilters> = {}) {
  const [corridor] = await db.select().from(corridors).where(eq(corridors.id, corridorId)).limit(1);
  if (!corridor) throw new NotFoundError('Corridor');

  const [market] = await db.select().from(markets).where(eq(markets.id, corridor.marketId)).limit(1);
  if (!market) throw new NotFoundError('Market');

  const includeSample = filters.includeSample ?? (await showSampleData());

  const [siblingCorridors, anchors, statuses, allTags, propertyTypes] = await Promise.all([
    db.select({
      id: corridors.id, name: corridors.name, color: corridors.color,
      boundary: corridors.boundary, boundaryKind: corridors.boundaryKind,
      minLatitude: corridors.minLatitude, maxLatitude: corridors.maxLatitude,
      minLongitude: corridors.minLongitude, maxLongitude: corridors.maxLongitude,
      centerLatitude: corridors.centerLatitude, centerLongitude: corridors.centerLongitude,
      radiusMeters: corridors.radiusMeters, version: corridors.version,
      propertyCount: raw<number>`(select count(*)::int from property_corridors pc
        where pc.corridor_id = corridors.id)`,
    })
      .from(corridors)
      .where(and(eq(corridors.marketId, corridor.marketId), isNull(corridors.archivedAt)))
      .orderBy(asc(corridors.sortOrder), asc(corridors.name)),

    db.select({
      id: mallAnchors.id, name: mallAnchors.name,
      latitude: mallAnchors.latitude, longitude: mallAnchors.longitude,
      needsMapPlacement: mallAnchors.needsMapPlacement,
    })
      .from(mallAnchors)
      .where(and(eq(mallAnchors.marketId, corridor.marketId), isNull(mallAnchors.archivedAt))),

    db.select().from(outreachStatuses).where(isNull(outreachStatuses.archivedAt))
      .orderBy(asc(outreachStatuses.sortOrder)),

    db.select().from(tags).where(isNull(tags.archivedAt)).orderBy(asc(tags.name)),

    getPropertyTypes(),
  ]);

  const properties = await listProperties({
    ...filters,
    corridorId,
    marketId: corridor.marketId,
    includeSample,
    limit: 2000,
  });

  // Parcel geometry only for the properties actually on screen.
  const parcels = properties.length
    ? await db.select({
        id: propertyParcels.id,
        propertyId: propertyParcels.propertyId,
        geometry: propertyParcels.geometry,
        label: propertyParcels.label,
        parcelIdText: propertyParcels.parcelIdText,
      })
        .from(propertyParcels)
        .where(inArray(propertyParcels.propertyId, properties.map((p) => p.id)))
    : [];

  return {
    corridor, market, siblingCorridors, anchors, statuses,
    tags: allTags, propertyTypes, properties, parcels, includeSample,
  };
}

export type CorridorWorkspace = Awaited<ReturnType<typeof getCorridorWorkspace>>;

/** Market-level view: all corridors and anchors, plus every property in the market. */
export async function getMarketWorkspace(marketId: string) {
  const [market] = await db.select().from(markets).where(eq(markets.id, marketId)).limit(1);
  if (!market) throw new NotFoundError('Market');

  const includeSample = await showSampleData();

  const [marketCorridors, anchors, statuses] = await Promise.all([
    db.select({
      id: corridors.id, name: corridors.name, description: corridors.description,
      color: corridors.color, boundary: corridors.boundary, boundaryKind: corridors.boundaryKind,
      radiusMeters: corridors.radiusMeters, version: corridors.version,
      minLatitude: corridors.minLatitude, maxLatitude: corridors.maxLatitude,
      minLongitude: corridors.minLongitude, maxLongitude: corridors.maxLongitude,
      propertyCount: raw<number>`(select count(*)::int from property_corridors pc
        where pc.corridor_id = corridors.id)`,
    })
      .from(corridors)
      .where(and(eq(corridors.marketId, marketId), isNull(corridors.archivedAt)))
      .orderBy(asc(corridors.sortOrder), asc(corridors.name)),

    db.select().from(mallAnchors)
      .where(and(eq(mallAnchors.marketId, marketId), isNull(mallAnchors.archivedAt)))
      .orderBy(asc(mallAnchors.name)),

    db.select().from(outreachStatuses).where(isNull(outreachStatuses.archivedAt))
      .orderBy(asc(outreachStatuses.sortOrder)),
  ]);

  const properties = await listProperties({ marketId, includeSample, limit: 2000 });

  const parcels = properties.length
    ? await db.select({
        id: propertyParcels.id,
        propertyId: propertyParcels.propertyId,
        geometry: propertyParcels.geometry,
        label: propertyParcels.label,
      })
        .from(propertyParcels)
        .where(inArray(propertyParcels.propertyId, properties.map((p) => p.id)))
    : [];

  return { market, corridors: marketCorridors, anchors, statuses, properties, parcels, includeSample };
}
