import '@/lib/server-guard';
import { and, asc, desc, eq, inArray, isNull, or, sql as raw, type SQL } from 'drizzle-orm';
import { db } from '@/db';
import {
  activities, attachments, contacts, customFieldDefs, customFieldValues,
  markets, opportunities, opportunityProperties, outreachStatuses, ownerEntities, properties,
  propertyContacts, propertyListingSources, propertyParcels,
  propertyPriceHistory, propertyTags, tags, transactionStages,
} from '@/db/schema';
import type { Actor } from '@/lib/auth/guards';
import { sqlIn } from '@/lib/db-helpers';
import { NotFoundError, ValidationError } from '@/lib/errors';
import { areaAcres, computeBBox, validateAreaGeometry } from '@/lib/geo/polygon';
import { lookupCountyParcel, type CountyParcelMatch } from '@/lib/geo/county-parcels';
import { traceParcelFromTiles, type TracedParcel } from '@/lib/geo/parcel-trace';
import { diffFields, recordAudit, updateWithVersion } from './audit';

export interface PropertyFilters {
  marketId?: string;
  outreachStatusIds?: string[];
  listingStatuses?: string[];
  propertyTypes?: string[];
  tagIds?: string[];
  /** 'any' | 'in_pipeline' | 'not_in_pipeline' */
  pipeline?: 'any' | 'in_pipeline' | 'not_in_pipeline';
  search?: string;
  includeSample?: boolean;
  includeArchived?: boolean;
  needsParcelOutline?: boolean;
  /** Map viewport, to avoid shipping the whole portfolio to the browser. */
  bbox?: { minLat: number; maxLat: number; minLng: number; maxLng: number };
  limit?: number;
  offset?: number;
  sort?: 'updated' | 'name' | 'followup' | 'price';
}

function buildWhere(f: PropertyFilters): SQL[] {
  const conds: SQL[] = [];

  if (!f.includeArchived) conds.push(isNull(properties.archivedAt));
  // Sample records are excluded from real work views unless explicitly asked for,
  // so demonstration data can never be mistaken for the portfolio.
  if (!f.includeSample) conds.push(eq(properties.isSample, false));

  if (f.marketId) conds.push(eq(properties.marketId, f.marketId));
  if (f.needsParcelOutline) conds.push(eq(properties.needsParcelOutline, true));

  if (f.outreachStatusIds?.length) conds.push(inArray(properties.outreachStatusId, f.outreachStatusIds));
  if (f.listingStatuses?.length) {
    conds.push(sqlIn(raw`properties.listing_status::text`, f.listingStatuses));
  }
  if (f.propertyTypes?.length) conds.push(inArray(properties.propertyType, f.propertyTypes));

  if (f.tagIds?.length) {
    conds.push(raw`exists (select 1 from property_tags pt
      where pt.property_id = properties.id and ${sqlIn('pt.tag_id', f.tagIds)})`);
  }

  if (f.pipeline === 'in_pipeline' || f.pipeline === 'not_in_pipeline') {
    const exists = raw`exists (select 1 from opportunity_properties op
      join opportunities o on o.id = op.opportunity_id
      where op.property_id = properties.id
        and o.state = 'active' and o.archived_at is null)`;
    conds.push(f.pipeline === 'in_pipeline' ? exists : raw`not ${exists}`);
  }

  if (f.bbox) {
    conds.push(raw`${properties.latitude} between ${f.bbox.minLat} and ${f.bbox.maxLat}`);
    conds.push(raw`${properties.longitude} between ${f.bbox.minLng} and ${f.bbox.maxLng}`);
  }

  if (f.search?.trim()) {
    const q = `%${f.search.trim().toLowerCase()}%`;
    conds.push(or(
      raw`lower(coalesce(${properties.name}, '')) like ${q}`,
      raw`lower(coalesce(${properties.addressLine1}, '')) like ${q}`,
      raw`lower(coalesce(${properties.city}, '')) like ${q}`,
      raw`lower(coalesce(${properties.researchNotes}, '')) like ${q}`,
      raw`exists (select 1 from property_parcels pp
            where pp.property_id = properties.id
              and lower(coalesce(pp.parcel_id_text, '')) like ${q})`,
      raw`exists (select 1 from owner_entities oe
            where oe.id = properties.owner_entity_id
              and lower(oe.name) like ${q})`,
    )!);
  }

  return conds;
}

const SORTS = {
  updated: desc(properties.updatedAt),
  name: asc(raw`coalesce(${properties.name}, ${properties.addressLine1})`),
  followup: raw`${properties.nextFollowUpDate} asc nulls last`,
  price: raw`${properties.askingPrice} desc nulls last`,
} as const;

/** Summary rows for the map and the property table. */
export async function listProperties(f: PropertyFilters) {
  const conds = buildWhere(f);
  const limit = Math.min(f.limit ?? 500, 2000);

  const rows = await db
    .select({
      id: properties.id,
      name: properties.name,
      addressLine1: properties.addressLine1,
      city: properties.city,
      state: properties.state,
      postalCode: properties.postalCode,
      latitude: properties.latitude,
      longitude: properties.longitude,
      propertyType: properties.propertyType,
      listingStatus: properties.listingStatus,
      askingPrice: properties.askingPrice,
      targetPurchasePrice: properties.targetPurchasePrice,
      noi: properties.noi,
      buildingSqft: properties.buildingSqft,
      landAcreage: properties.landAcreage,
      nextFollowUpDate: properties.nextFollowUpDate,
      needsParcelOutline: properties.needsParcelOutline,
      needsMapPlacement: properties.needsMapPlacement,
      isSample: properties.isSample,
      archivedAt: properties.archivedAt,
      updatedAt: properties.updatedAt,
      version: properties.version,
      outreachStatusId: properties.outreachStatusId,
      outreachStatusLabel: outreachStatuses.label,
      outreachStatusColor: outreachStatuses.color,
      ownerEntityName: ownerEntities.name,
      parcelCount: raw<number>`(select count(*)::int from property_parcels pp
        where pp.property_id = properties.id)`,
      activityCount: raw<number>`(select count(*)::int from activities a
        where a.property_id = properties.id and a.type <> 'status_change')`,
      opportunityId: raw<string | null>`(select o.id from opportunity_properties op
        join opportunities o on o.id = op.opportunity_id
        where op.property_id = properties.id
          and o.state = 'active' and o.archived_at is null
        order by o.promoted_at desc limit 1)`,
    })
    .from(properties)
    .leftJoin(outreachStatuses, eq(outreachStatuses.id, properties.outreachStatusId))
    .leftJoin(ownerEntities, eq(ownerEntities.id, properties.ownerEntityId))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(SORTS[f.sort ?? 'updated'])
    .limit(limit)
    .offset(f.offset ?? 0);

  return rows;
}

export async function countProperties(f: PropertyFilters): Promise<number> {
  const conds = buildWhere(f);
  const [row] = await db
    .select({ n: raw<number>`count(*)::int` })
    .from(properties)
    .where(conds.length ? and(...conds) : undefined);
  return row?.n ?? 0;
}

export type PropertySummary = Awaited<ReturnType<typeof listProperties>>[number];

/** The full record behind the side panel and detail view. */
export async function getPropertyDetail(id: string) {
  const [property] = await db
    .select({
      p: properties,
      outreachStatus: { id: outreachStatuses.id, label: outreachStatuses.label, color: outreachStatuses.color },
      market: { id: markets.id, name: markets.name },
      ownerEntity: { id: ownerEntities.id, name: ownerEntities.name, entityType: ownerEntities.entityType, mailingAddress: ownerEntities.mailingAddress, notes: ownerEntities.notes },
    })
    .from(properties)
    .leftJoin(outreachStatuses, eq(outreachStatuses.id, properties.outreachStatusId))
    .leftJoin(markets, eq(markets.id, properties.marketId))
    .leftJoin(ownerEntities, eq(ownerEntities.id, properties.ownerEntityId))
    .where(eq(properties.id, id))
    .limit(1);

  if (!property) throw new NotFoundError('Property');

  const [parcels, contactLinks, tagLinks, timeline, listingSources, files, priceHistory, opportunityLink, customValues, customDefs] =
    await Promise.all([
      db.select().from(propertyParcels).where(eq(propertyParcels.propertyId, id)).orderBy(asc(propertyParcels.createdAt)),

      db.select({
        contact: contacts,
        relationship: propertyContacts.relationship,
        isPrimary: propertyContacts.isPrimary,
        linkNotes: propertyContacts.notes,
      })
        .from(propertyContacts)
        .innerJoin(contacts, eq(contacts.id, propertyContacts.contactId))
        .where(eq(propertyContacts.propertyId, id))
        .orderBy(desc(propertyContacts.isPrimary), asc(contacts.name)),

      db.select({ id: tags.id, name: tags.name, color: tags.color })
        .from(propertyTags).innerJoin(tags, eq(tags.id, propertyTags.tagId))
        .where(eq(propertyTags.propertyId, id)).orderBy(asc(tags.name)),

      db.select({ a: activities, contactName: contacts.name })
        .from(activities)
        .leftJoin(contacts, eq(contacts.id, activities.contactId))
        .where(eq(activities.propertyId, id))
        .orderBy(desc(activities.occurredAt), desc(activities.createdAt)),

      db.select().from(propertyListingSources)
        .where(eq(propertyListingSources.propertyId, id))
        .orderBy(desc(propertyListingSources.lastSeenAt)),

      db.select().from(attachments)
        .where(and(eq(attachments.propertyId, id), isNull(attachments.archivedAt)))
        .orderBy(desc(attachments.createdAt)),

      db.select().from(propertyPriceHistory)
        .where(eq(propertyPriceHistory.propertyId, id))
        .orderBy(desc(propertyPriceHistory.observedAt)).limit(50),

      db.select({
        id: opportunities.id, name: opportunities.name, state: opportunities.state,
        promotedAt: opportunities.promotedAt, promotionReason: opportunities.promotionReason,
        stageLabel: transactionStages.label, stageColor: transactionStages.color,
      })
        .from(opportunityProperties)
        .innerJoin(opportunities, eq(opportunities.id, opportunityProperties.opportunityId))
        .leftJoin(transactionStages, eq(transactionStages.id, opportunities.stageId))
        .where(and(eq(opportunityProperties.propertyId, id), isNull(opportunities.archivedAt)))
        .orderBy(desc(opportunities.promotedAt)),

      db.select().from(customFieldValues).where(eq(customFieldValues.propertyId, id)),
      db.select().from(customFieldDefs)
        .where(and(eq(customFieldDefs.entity, 'property'), isNull(customFieldDefs.archivedAt)))
        .orderBy(asc(customFieldDefs.sortOrder)),
    ]);

  const customFields = customDefs.map((def) => ({
    def,
    value: customValues.find((v) => v.defId === def.id)?.value ?? null,
  }));

  return {
    ...property.p,
    outreachStatus: property.outreachStatus?.id ? property.outreachStatus : null,
    market: property.market?.id ? property.market : null,
    ownerEntity: property.ownerEntity?.id ? property.ownerEntity : null,
    parcels,
    contacts: contactLinks,
    tags: tagLinks,
    timeline: timeline.map((t) => ({ ...t.a, contactName: t.contactName })),
    listingSources,
    attachments: files,
    priceHistory,
    opportunities: opportunityLink,
    customFields,
  };
}

export type PropertyDetail = Awaited<ReturnType<typeof getPropertyDetail>>;

/* -------------------------------------------------------------------------- */
/* Writes                                                                     */
/* -------------------------------------------------------------------------- */

async function defaultOutreachStatusId(): Promise<string | null> {
  const [row] = await db.select({ id: outreachStatuses.id })
    .from(outreachStatuses)
    .where(and(eq(outreachStatuses.isDefault, true), isNull(outreachStatuses.archivedAt)))
    .limit(1);
  return row?.id ?? null;
}

export async function createProperty(
  input: Record<string, unknown> & { marketId: string; tagIds?: string[]; skipParcelMatch?: boolean },
  actor: Actor,
) {
  const { tagIds, skipParcelMatch, ...rest } = input;
  const fields = rest as Record<string, unknown>;

  const values: Record<string, unknown> = {
    ...fields,
    outreachStatusId: (fields.outreachStatusId as string | null) ?? (await defaultOutreachStatusId()),
    // A property added as a bare point legitimately has no parcel outline yet.
    needsParcelOutline: true,
    needsMapPlacement: fields.latitude == null || fields.longitude == null,
    createdBy: actor.id,
    updatedBy: actor.id,
    // Anything a person typed in by hand counts as human-verified from the start.
    humanVerified: true,
    humanVerifiedAt: new Date(),
    humanVerifiedBy: actor.id,
  };

  const [row] = await db
    .insert(properties)
    .values(values as typeof properties.$inferInsert)
    .returning();

  if (tagIds?.length) {
    await db.insert(propertyTags).values(tagIds.map((tagId) => ({ propertyId: row!.id, tagId }))).onConflictDoNothing();
  }

  await recordAudit({
    entityType: 'property', entityId: row!.id, action: 'create',
    summary: `Created property "${row!.name ?? row!.addressLine1 ?? 'Untitled'}"`,
    actor,
  });

  // A bulk import skips this: matching is several seconds of county lookups and
  // tile tracing per property, which is fine for one property a person just
  // typed in and minutes of dead time for a few hundred rows of a broker
  // export. Those land with needsParcelOutline set and are filled in by the
  // parcel backfill instead.
  if (!skipParcelMatch) {
    await tryAutoMatchCountyParcel(row!.id, row!.marketId, row!.latitude, row!.longitude, actor);
  }

  return row!;
}

/**
 * When a property has coordinates and no parcel yet, tries to find one
 * automatically - first the real thing (a verified county GIS feed for the
 * market, see county-parcels.ts), and only if that comes back empty, an
 * auto-traced outline from Regrid's free tile imagery (see parcel-trace.ts).
 * Fires on both property creation and any edit that changes coordinates -
 * including dragging the pin on the map - so moving a point onto a real
 * parcel outlines it right away instead of only on the next import/backfill.
 * Never blocks or fails the write that triggered it: any lookup problem is
 * swallowed, since this is a bonus enrichment, not a requirement.
 */
async function tryAutoMatchCountyParcel(
  propertyId: string, marketId: string, latitude: number | null, longitude: number | null, actor: Actor,
): Promise<void> {
  if (latitude == null || longitude == null) return;
  const point = { lat: latitude, lng: longitude };

  const [market] = await db.select({ name: markets.name }).from(markets).where(eq(markets.id, marketId)).limit(1);
  if (market) {
    const match = await lookupCountyParcel(point, market.name);
    if (match) {
      await attachCountyParcelMatch(propertyId, match, actor);
      return;
    }
  }

  const traced = await traceParcelFromTiles(point);
  if (traced) await attachTracedParcel(propertyId, traced, actor);
}

/**
 * Saves a matched county-GIS parcel (from either a point or a PIN lookup) as
 * the property's parcel. Exported so other flows - e.g. the property
 * importer, which often already has a parcel PIN in its source data - can
 * reuse the exact same attach logic instead of duplicating it.
 */
export async function attachCountyParcelMatch(
  propertyId: string, match: CountyParcelMatch, actor: Actor,
): Promise<void> {
  const noteLines = [`Source: ${match.sourceLabel} (public county GIS, unverified).`];
  if (match.ownerName) noteLines.push(`Owner per county records: ${match.ownerName}.`);
  if (match.situsAddress) noteLines.push(`Situs address per county records: ${match.situsAddress}.`);

  await createParcel({
    propertyId,
    parcelIdText: match.parcelId,
    label: 'County GIS parcel',
    geometry: match.geometry,
    acreage: match.acreage != null ? match.acreage.toFixed(4) : undefined,
    notes: noteLines.join(' '),
    geometrySource: 'county_gis',
  }, actor);

  // A property matched by PIN (e.g. from an import with no coordinates of its
  // own) can now be placed on the map from the real parcel we just found -
  // the bbox centre, a simple and honest stand-in for a true centroid, rather
  // than leaving it stuck at "needs map placement" when we plainly know where
  // it is.
  const [property] = await db.select({
    id: properties.id, latitude: properties.latitude, longitude: properties.longitude, marketId: properties.marketId, version: properties.version,
  }).from(properties).where(eq(properties.id, propertyId)).limit(1);
  if (property && property.latitude == null && property.longitude == null) {
    const bbox = computeBBox(match.geometry);
    await updateProperty(propertyId, {
      version: property.version,
      latitude: (bbox.minLat + bbox.maxLat) / 2,
      longitude: (bbox.minLng + bbox.maxLng) / 2,
      locationSource: 'county_gis',
    }, actor);
  }
}

/**
 * Saves a parcel outline auto-traced from Regrid's free tile imagery (see
 * `traceParcelFromTiles`) - the fallback for a property with no PIN and no
 * county GIS feed to query at all. Unlike `attachCountyParcelMatch`, this
 * never claims a county record backs it, and it never invents coordinates -
 * a traced shape only exists because the property already had a point to
 * trace around.
 */
export async function attachTracedParcel(propertyId: string, traced: TracedParcel, actor: Actor): Promise<void> {
  await createParcel({
    propertyId,
    label: 'Traced from imagery (unverified)',
    geometry: traced.geometry,
    acreage: traced.acreage.toFixed(4),
    notes: `Source: ${traced.sourceLabel}. Auto-traced from parcel-line imagery, not a surveyed boundary - verify before relying on it.`,
    geometrySource: 'traced_tile',
  }, actor);
}

export async function updateProperty(
  id: string,
  input: Record<string, unknown> & { version: number; tagIds?: string[]; customFields?: Record<string, unknown> },
  actor: Actor,
) {
  const { version, tagIds, customFields, ...patch } = input;

  const [before] = await db.select().from(properties).where(eq(properties.id, id)).limit(1);
  if (!before) throw new NotFoundError('Property');

  const changes = diffFields(before as unknown as Record<string, unknown>, patch);

  // Record asking-price movement as evidence-backed history rather than only
  // overwriting the column.
  if ('askingPrice' in patch && changes.askingPrice) {
    await db.insert(propertyPriceHistory).values({
      propertyId: id, field: 'asking_price',
      oldValue: (changes.askingPrice.from as string) ?? null,
      newValue: (changes.askingPrice.to as string) ?? null,
      evidenceNote: 'Edited directly in the property record.',
      recordedBy: actor.id,
    });
  }

  const coordsTouched = 'latitude' in patch || 'longitude' in patch;
  const values: Record<string, unknown> = { ...patch, updatedBy: actor.id };
  if (coordsTouched) {
    values.needsMapPlacement =
      (patch.latitude ?? before.latitude) == null || (patch.longitude ?? before.longitude) == null;
    values.locationSource = patch.locationSource ?? 'manual';
  }
  // Any human edit marks the record verified, which protects it from silent
  // AI-sourced overwrites later.
  values.humanVerified = true;
  values.humanVerifiedAt = new Date();
  values.humanVerifiedBy = actor.id;

  const updated = await updateWithVersion<typeof properties.$inferSelect>({
    table: properties, id, expectedVersion: version, values, entityLabel: 'property',
  });

  if (tagIds) {
    await db.delete(propertyTags).where(eq(propertyTags.propertyId, id));
    if (tagIds.length) {
      await db.insert(propertyTags).values(tagIds.map((tagId) => ({ propertyId: id, tagId }))).onConflictDoNothing();
    }
  }

  if (customFields) await setCustomFieldValues(id, customFields, actor);

  // Only when the property had no parcel yet - never silently replace a
  // human-drawn or already-matched parcel just because coordinates changed.
  if (coordsTouched && before.needsParcelOutline && updated.latitude != null && updated.longitude != null) {
    await tryAutoMatchCountyParcel(id, updated.marketId, updated.latitude, updated.longitude, actor);
  }

  if (Object.keys(changes).length > 0) {
    await recordAudit({
      entityType: 'property', entityId: id, action: 'update',
      summary: `Updated ${Object.keys(changes).length} field(s)`,
      changes, actor,
    });
  }

  return updated;
}

async function setCustomFieldValues(propertyId: string, values: Record<string, unknown>, actor: Actor) {
  const defs = await db.select().from(customFieldDefs)
    .where(and(eq(customFieldDefs.entity, 'property'), isNull(customFieldDefs.archivedAt)));

  for (const [key, rawValue] of Object.entries(values)) {
    const def = defs.find((d) => d.key === key);
    if (!def) continue;

    const value = coerceCustomValue(def.type, def.options ?? [], rawValue, def.label);
    if (value === null) {
      await db.delete(customFieldValues).where(and(
        eq(customFieldValues.propertyId, propertyId), eq(customFieldValues.defId, def.id),
      ));
      continue;
    }
    await db.insert(customFieldValues)
      .values({ defId: def.id, propertyId, value, updatedBy: actor.id })
      .onConflictDoUpdate({
        target: [customFieldValues.defId, customFieldValues.propertyId],
        set: { value, updatedAt: new Date(), updatedBy: actor.id },
      });
  }
}

/** Validates a custom field value against its declared type. */
function coerceCustomValue(type: string, options: string[], value: unknown, label: string): unknown {
  if (value === null || value === undefined || value === '') return null;

  switch (type) {
    case 'number': {
      const n = typeof value === 'number' ? value : Number(String(value).replace(/[,\s$]/g, ''));
      if (!Number.isFinite(n)) throw new ValidationError(`"${label}" must be a number.`);
      return n;
    }
    case 'checkbox':
      return value === true || value === 'true' || value === 'on';
    case 'date': {
      const s = String(value).slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new ValidationError(`"${label}" must be a date (YYYY-MM-DD).`);
      return s;
    }
    case 'select': {
      const s = String(value);
      if (!options.includes(s)) {
        throw new ValidationError(`"${label}" must be one of: ${options.join(', ')}.`);
      }
      return s;
    }
    default:
      return String(value).slice(0, 8000);
  }
}

/* -------------------------------------------------------------------------- */
/* Parcels                                                                    */
/* -------------------------------------------------------------------------- */

/** Recalculates whether a property still needs a drawn outline. */
async function refreshParcelFlag(propertyId: string) {
  const [row] = await db
    .select({ n: raw<number>`count(*)::int` })
    .from(propertyParcels)
    .where(and(eq(propertyParcels.propertyId, propertyId), raw`property_parcels.geometry is not null`));
  await db.update(properties)
    .set({ needsParcelOutline: (row?.n ?? 0) === 0 })
    .where(eq(properties.id, propertyId));
}

export async function createParcel(input: {
  propertyId: string;
  parcelIdText?: string | null;
  label?: string | null;
  geometry?: unknown;
  acreage?: string | null;
  notes?: string | null;
  geometrySource?: 'manual_draw' | 'radius' | 'imported' | 'county_gis' | 'traced_tile';
}, actor: Actor) {
  const geometry = input.geometry ? validateAreaGeometry(input.geometry) : null;
  const bbox = geometry ? computeBBox(geometry) : null;

  const [row] = await db.insert(propertyParcels).values({
    propertyId: input.propertyId,
    parcelIdText: input.parcelIdText ?? null,
    label: input.label ?? null,
    geometry,
    geometrySource: input.geometrySource ?? 'manual_draw',
    // Derive acreage from the drawn shape when the user did not supply one.
    acreage: input.acreage ?? (geometry ? areaAcres(geometry).toFixed(4) : null),
    notes: input.notes ?? null,
    minLatitude: bbox?.minLat ?? null, maxLatitude: bbox?.maxLat ?? null,
    minLongitude: bbox?.minLng ?? null, maxLongitude: bbox?.maxLng ?? null,
    createdBy: actor.id,
  }).returning();

  await refreshParcelFlag(input.propertyId);
  await recordAudit({
    entityType: 'parcel', entityId: row!.id, action: 'create',
    summary: geometry ? 'Drew a parcel boundary' : 'Added a parcel ID without a boundary',
    actor,
  });
  return row!;
}

export async function updateParcel(id: string, input: {
  version: number;
  parcelIdText?: string | null;
  label?: string | null;
  geometry?: unknown;
  acreage?: string | null;
  notes?: string | null;
}, actor: Actor) {
  const [before] = await db.select().from(propertyParcels).where(eq(propertyParcels.id, id)).limit(1);
  if (!before) throw new NotFoundError('Parcel');

  const values: Record<string, unknown> = {};
  for (const key of ['parcelIdText', 'label', 'notes', 'acreage'] as const) {
    if (input[key] !== undefined) values[key] = input[key];
  }

  if (input.geometry !== undefined) {
    const geometry = input.geometry ? validateAreaGeometry(input.geometry) : null;
    const bbox = geometry ? computeBBox(geometry) : null;
    Object.assign(values, {
      geometry,
      minLatitude: bbox?.minLat ?? null, maxLatitude: bbox?.maxLat ?? null,
      minLongitude: bbox?.minLng ?? null, maxLongitude: bbox?.maxLng ?? null,
    });
    if (geometry && input.acreage === undefined) values.acreage = areaAcres(geometry).toFixed(4);
  }

  const updated = await updateWithVersion<typeof propertyParcels.$inferSelect>({
    table: propertyParcels, id, expectedVersion: input.version, values, entityLabel: 'parcel',
  });

  await refreshParcelFlag(before.propertyId);
  await recordAudit({
    entityType: 'parcel', entityId: id, action: 'update',
    summary: input.geometry !== undefined ? 'Edited a parcel boundary' : 'Updated parcel details',
    actor,
  });
  return updated;
}

export async function deleteParcel(id: string, actor: Actor) {
  const [before] = await db.select().from(propertyParcels).where(eq(propertyParcels.id, id)).limit(1);
  if (!before) throw new NotFoundError('Parcel');

  await db.delete(propertyParcels).where(eq(propertyParcels.id, id));
  await refreshParcelFlag(before.propertyId);
  await recordAudit({
    entityType: 'parcel', entityId: id, action: 'delete',
    summary: `Deleted parcel ${before.parcelIdText ?? before.label ?? ''}`.trim(),
    actor,
  });
}

/* -------------------------------------------------------------------------- */
/* Archive / restore                                                          */
/* -------------------------------------------------------------------------- */

export async function archiveProperty(id: string, version: number, actor: Actor) {
  const updated = await updateWithVersion<typeof properties.$inferSelect>({
    table: properties, id, expectedVersion: version,
    values: { archivedAt: new Date(), updatedBy: actor.id },
    entityLabel: 'property',
  });
  await recordAudit({ entityType: 'property', entityId: id, action: 'archive', summary: 'Archived property', actor });
  return updated;
}

export async function restoreProperty(id: string, version: number, actor: Actor) {
  const updated = await updateWithVersion<typeof properties.$inferSelect>({
    table: properties, id, expectedVersion: version,
    values: { archivedAt: null, updatedBy: actor.id },
    entityLabel: 'property',
  });
  await recordAudit({ entityType: 'property', entityId: id, action: 'restore', summary: 'Restored property', actor });
  return updated;
}
