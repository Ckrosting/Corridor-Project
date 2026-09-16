import '@/lib/server-guard';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { db } from '@/db';
import { mallAnchors, markets, outreachStatuses, propertyParcels, tags } from '@/db/schema';
import { NotFoundError } from '@/lib/errors';
import { listProperties, type PropertyFilters } from './properties';
import { getPropertyTypes, showSampleData } from './settings';

/**
 * Loads everything the market workspace needs in one round trip: the market, its
 * mall anchors, the properties in scope, their parcel geometry, and the filter
 * vocabularies.
 */
export async function getMarketWorkspace(marketId: string, filters: Partial<PropertyFilters> = {}) {
  const [market] = await db.select().from(markets).where(eq(markets.id, marketId)).limit(1);
  if (!market) throw new NotFoundError('Market');

  const includeSample = filters.includeSample ?? (await showSampleData());

  const [anchors, statuses, allTags, propertyTypes] = await Promise.all([
    db.select().from(mallAnchors)
      .where(and(eq(mallAnchors.marketId, marketId), isNull(mallAnchors.archivedAt)))
      .orderBy(asc(mallAnchors.name)),

    db.select().from(outreachStatuses).where(isNull(outreachStatuses.archivedAt))
      .orderBy(asc(outreachStatuses.sortOrder)),

    db.select().from(tags).where(isNull(tags.archivedAt)).orderBy(asc(tags.name)),

    getPropertyTypes(),
  ]);

  const properties = await listProperties({ ...filters, marketId, includeSample, limit: 2000 });

  // Parcel geometry only for the properties actually on screen.
  const parcels = properties.length
    ? await db.select({
        id: propertyParcels.id,
        propertyId: propertyParcels.propertyId,
        geometry: propertyParcels.geometry,
        label: propertyParcels.label,
        geometrySource: propertyParcels.geometrySource,
        parcelIdText: propertyParcels.parcelIdText,
        version: propertyParcels.version,
      })
        .from(propertyParcels)
        .where(inArray(propertyParcels.propertyId, properties.map((p) => p.id)))
    : [];

  return {
    market, anchors, statuses, tags: allTags, propertyTypes, properties, parcels, includeSample,
  };
}

export type MarketWorkspace = Awaited<ReturnType<typeof getMarketWorkspace>>;
