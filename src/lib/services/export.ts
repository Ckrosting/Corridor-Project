import '@/lib/server-guard';
import { asc, eq, isNull, sql as raw } from 'drizzle-orm';
import { db } from '@/db';
import { contacts, markets, outreachStatuses, ownerEntities, properties } from '@/db/schema';
import { toCsv } from '@/lib/csv';

/**
 * CSV export.
 *
 * Every export leads with the record's stable UUID so an exported sheet can be
 * edited and re-imported to UPDATE the same rows rather than creating duplicates.
 * That reconciliation key is the difference between an export you can work with
 * and one you can only look at.
 */

export async function exportPropertiesCsv(opts: { includeSample?: boolean } = {}) {
  const conds = [isNull(properties.archivedAt)];
  if (!opts.includeSample) conds.push(eq(properties.isSample, false));

  const rows = await db
    .select({
      id: properties.id,
      marketName: markets.name,
      name: properties.name,
      addressLine1: properties.addressLine1,
      city: properties.city,
      state: properties.state,
      postalCode: properties.postalCode,
      county: properties.county,
      latitude: properties.latitude,
      longitude: properties.longitude,
      propertyType: properties.propertyType,
      landAcreage: properties.landAcreage,
      buildingSqft: properties.buildingSqft,
      occupancyPercent: properties.occupancyPercent,
      askingPrice: properties.askingPrice,
      targetPurchasePrice: properties.targetPurchasePrice,
      sellerIndicatedPrice: properties.sellerIndicatedPrice,
      noi: properties.noi,
      capRateReported: properties.capRateReported,
      ownerEntityName: ownerEntities.name,
      listingStatus: properties.listingStatus,
      listingDate: properties.listingDate,
      outreachStatus: outreachStatuses.label,
      nextFollowUpDate: properties.nextFollowUpDate,
      researchNotes: properties.researchNotes,
      isSample: properties.isSample,
      createdAt: properties.createdAt,
      updatedAt: properties.updatedAt,
      parcelIds: raw<string | null>`(select string_agg(pp.parcel_id_text, ' | ')
        from property_parcels pp where pp.property_id = properties.id
          and pp.parcel_id_text is not null)`,
      corridorNames: raw<string | null>`(select string_agg(c.name, ' | ')
        from property_corridors pc join corridors c on c.id = pc.corridor_id
        where pc.property_id = properties.id)`,
    })
    .from(properties)
    .leftJoin(markets, eq(markets.id, properties.marketId))
    .leftJoin(ownerEntities, eq(ownerEntities.id, properties.ownerEntityId))
    .leftJoin(outreachStatuses, eq(outreachStatuses.id, properties.outreachStatusId))
    .where(conds.length === 1 ? conds[0] : raw`${conds[0]} and ${conds[1]}`)
    .orderBy(asc(markets.name), asc(properties.name));

  const headers = [
    'property_id', 'market', 'name', 'address', 'city', 'state', 'zip', 'county',
    'latitude', 'longitude', 'property_type', 'land_acreage', 'building_sqft',
    'occupancy_percent', 'asking_price', 'target_purchase_price', 'seller_indicated_price',
    'noi', 'cap_rate_reported', 'owner_entity', 'listing_status', 'listing_date',
    'outreach_status', 'next_follow_up_date', 'parcel_ids', 'corridors',
    'research_notes', 'is_sample', 'created_at', 'updated_at',
  ];

  return toCsv(headers, rows.map((r) => [
    r.id, r.marketName, r.name, r.addressLine1, r.city, r.state, r.postalCode, r.county,
    r.latitude, r.longitude, r.propertyType, r.landAcreage, r.buildingSqft,
    r.occupancyPercent, r.askingPrice, r.targetPurchasePrice, r.sellerIndicatedPrice,
    r.noi, r.capRateReported, r.ownerEntityName, r.listingStatus, r.listingDate,
    r.outreachStatus, r.nextFollowUpDate, r.parcelIds, r.corridorNames,
    r.researchNotes, r.isSample, r.createdAt, r.updatedAt,
  ]));
}

export async function exportContactsCsv() {
  const rows = await db
    .select({
      id: contacts.id,
      name: contacts.name,
      company: contacts.company,
      role: contacts.role,
      title: contacts.title,
      phone: contacts.phone,
      phoneAlt: contacts.phoneAlt,
      email: contacts.email,
      ownerEntity: ownerEntities.name,
      source: contacts.source,
      verifiedAt: contacts.verifiedAt,
      notes: contacts.notes,
      propertyCount: raw<number>`(select count(*)::int from property_contacts pc
        where pc.contact_id = contacts.id)`,
      createdAt: contacts.createdAt,
    })
    .from(contacts)
    .leftJoin(ownerEntities, eq(ownerEntities.id, contacts.ownerEntityId))
    .where(isNull(contacts.archivedAt))
    .orderBy(asc(raw`lower(contacts.name)`));

  const headers = [
    'contact_id', 'name', 'company', 'role', 'title', 'phone', 'phone_alt', 'email',
    'owner_entity', 'source', 'verified_at', 'notes', 'linked_properties', 'created_at',
  ];

  return toCsv(headers, rows.map((r) => [
    r.id, r.name, r.company, r.role, r.title, r.phone, r.phoneAlt, r.email,
    r.ownerEntity, r.source, r.verifiedAt, r.notes, r.propertyCount, r.createdAt,
  ]));
}

export async function exportMallsCsv() {
  const rows = await db
    .select({
      id: raw<string>`mall_anchors.id`,
      mallName: raw<string>`mall_anchors.name`,
      marketName: markets.name,
      address: raw<string | null>`mall_anchors.address_line1`,
      city: raw<string | null>`mall_anchors.city`,
      state: raw<string | null>`mall_anchors.state`,
      zip: raw<string | null>`mall_anchors.postal_code`,
      latitude: raw<number | null>`mall_anchors.latitude`,
      longitude: raw<number | null>`mall_anchors.longitude`,
      needsPlacement: raw<boolean>`mall_anchors.needs_map_placement`,
    })
    .from(raw`mall_anchors`)
    .leftJoin(markets, raw`markets.id = mall_anchors.market_id`)
    .where(raw`mall_anchors.archived_at is null`)
    .orderBy(asc(markets.name));

  const headers = [
    'mall_id', 'mall_name', 'market_name', 'street_address', 'city', 'state', 'zip',
    'latitude', 'longitude', 'needs_map_placement',
  ];

  return toCsv(headers, rows.map((r) => [
    r.id, r.mallName, r.marketName, r.address, r.city, r.state, r.zip,
    r.latitude, r.longitude, r.needsPlacement,
  ]));
}

/**
 * The blank mall import template. Column names here are exactly what the importer
 * recognises without any manual mapping.
 */
export function mallImportTemplateCsv(): string {
  const headers = ['mall_name', 'market_name', 'street_address', 'city', 'state', 'zip', 'latitude', 'longitude'];
  const examples = [
    ['Riverbend Mall', 'Augusta, GA', '3450 Wrightsboro Road', 'Augusta', 'GA', '30909', '33.4735', '-82.0812'],
    ['Example Mall (latitude/longitude optional)', 'Columbia, SC', '100 Main Street', 'Columbia', 'SC', '29201', '', ''],
  ];
  return toCsv(headers, examples);
}
