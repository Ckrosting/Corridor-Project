import '@/lib/server-guard';
import { and, asc, desc, eq, isNull, ne, sql as raw } from 'drizzle-orm';
import { db } from '@/db';
import {
  activities, contacts, markets, opportunities, opportunityProperties, outreachStatuses,
  ownerEntities, properties, transactionStages,
} from '@/db/schema';
import { toCsv } from '@/lib/csv';
import { buildPropertyWhere, type PropertyFilters } from './properties';

/**
 * CSV export.
 *
 * Every export leads with the record's stable UUID so an exported sheet can be
 * edited and re-imported to UPDATE the same rows rather than creating duplicates.
 * That reconciliation key is the difference between an export you can work with
 * and one you can only look at.
 */

/**
 * The export honours exactly the filters the property list is showing, through
 * the same `buildPropertyWhere` the list and count use. An export that quietly
 * ignored the filters would hand back the whole portfolio under a filtered name.
 */
export async function exportPropertiesCsv(filters: PropertyFilters = {}) {
  const conds = buildPropertyWhere(filters);

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
    })
    .from(properties)
    .leftJoin(markets, eq(markets.id, properties.marketId))
    .leftJoin(ownerEntities, eq(ownerEntities.id, properties.ownerEntityId))
    .leftJoin(outreachStatuses, eq(outreachStatuses.id, properties.outreachStatusId))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(asc(markets.name), asc(properties.name));

  const headers = [
    'property_id', 'market', 'name', 'address', 'city', 'state', 'zip', 'county',
    'latitude', 'longitude', 'property_type', 'land_acreage', 'building_sqft',
    'occupancy_percent', 'asking_price', 'target_purchase_price', 'seller_indicated_price',
    'noi', 'cap_rate_reported', 'owner_entity', 'listing_status', 'listing_date',
    'outreach_status', 'next_follow_up_date', 'parcel_ids',
    'research_notes', 'is_sample', 'created_at', 'updated_at',
  ];

  return toCsv(headers, rows.map((r) => [
    r.id, r.marketName, r.name, r.addressLine1, r.city, r.state, r.postalCode, r.county,
    r.latitude, r.longitude, r.propertyType, r.landAcreage, r.buildingSqft,
    r.occupancyPercent, r.askingPrice, r.targetPurchasePrice, r.sellerIndicatedPrice,
    r.noi, r.capRateReported, r.ownerEntityName, r.listingStatus, r.listingDate,
    r.outreachStatus, r.nextFollowUpDate, r.parcelIds,
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
 * One row per opportunity, with the property it was promoted from.
 *
 * Removed and closed deals are included: a pipeline export that only showed the
 * live board could not answer "what did we pass on last year, and why".
 */
export async function exportOpportunitiesCsv(opts: { includeSample?: boolean } = {}) {
  const conds = [isNull(opportunities.archivedAt)];
  if (!opts.includeSample) conds.push(eq(opportunities.isSample, false));

  const primary = raw`(select op.property_id from opportunity_properties op
    where op.opportunity_id = opportunities.id
    order by op.is_primary desc, op.created_at asc limit 1)`;

  const rows = await db
    .select({
      id: opportunities.id,
      name: opportunities.name,
      propertyName: properties.name,
      propertyAddress: properties.addressLine1,
      propertyCity: properties.city,
      propertyState: properties.state,
      marketName: markets.name,
      stage: transactionStages.label,
      stageCategory: transactionStages.category,
      state: opportunities.state,
      targetPrice: opportunities.targetPrice,
      offerPrice: opportunities.offerPrice,
      contractPrice: opportunities.contractPrice,
      promotionReason: opportunities.promotionReason,
      promotedAt: opportunities.promotedAt,
      promotedBy: opportunities.promotedByLabel,
      expectedCloseDate: opportunities.expectedCloseDate,
      nextStep: opportunities.nextStep,
      nextStepDate: opportunities.nextStepDate,
      closedAt: opportunities.closedAt,
      removedAt: opportunities.removedAt,
      removedReason: opportunities.removedReason,
      lostReason: opportunities.lostReason,
      lostReasonNote: opportunities.lostReasonNote,
      notes: opportunities.notes,
      propertyCount: raw<number>`(select count(*)::int from opportunity_properties op
        where op.opportunity_id = opportunities.id)`,
      createdAt: opportunities.createdAt,
      updatedAt: opportunities.updatedAt,
    })
    .from(opportunities)
    .leftJoin(transactionStages, eq(transactionStages.id, opportunities.stageId))
    .leftJoin(markets, eq(markets.id, opportunities.marketId))
    .leftJoin(properties, raw`properties.id = ${primary}`)
    .where(and(...conds))
    .orderBy(asc(markets.name), asc(transactionStages.sortOrder), asc(opportunities.name));

  const headers = [
    'opportunity_id', 'opportunity_name', 'property_name', 'property_address',
    'property_city', 'property_state', 'market', 'stage', 'stage_category', 'state',
    'target_price', 'offer_price', 'contract_price', 'promotion_reason', 'promoted_at',
    'promoted_by', 'expected_close_date', 'next_step', 'next_step_date', 'closed_at',
    'removed_at', 'removed_reason', 'lost_reason', 'lost_reason_note',
    'notes', 'property_count', 'created_at', 'updated_at',
  ];

  return toCsv(headers, rows.map((r) => [
    r.id, r.name, r.propertyName, r.propertyAddress,
    r.propertyCity, r.propertyState, r.marketName, r.stage, r.stageCategory, r.state,
    r.targetPrice, r.offerPrice, r.contractPrice, r.promotionReason, r.promotedAt,
    r.promotedBy, r.expectedCloseDate, r.nextStep, r.nextStepDate, r.closedAt,
    r.removedAt, r.removedReason, r.lostReason, r.lostReasonNote,
    r.notes, r.propertyCount, r.createdAt, r.updatedAt,
  ]));
}

/**
 * One row per logged activity.
 *
 * `type = 'system'` rows are internal bookkeeping ("Promoted to opportunity" and
 * the like) written by the app, not by a person, so they are left out. Outreach
 * `status_change` rows stay: they are the real record of how a conversation
 * moved, and a user reading the export would miss the story without them.
 */
export async function exportActivitiesCsv(opts: { includeSample?: boolean } = {}) {
  const conds = [ne(activities.type, 'system'), isNull(properties.archivedAt)];
  if (!opts.includeSample) conds.push(eq(properties.isSample, false));

  const rows = await db
    .select({
      id: activities.id,
      propertyId: activities.propertyId,
      propertyName: properties.name,
      propertyAddress: properties.addressLine1,
      propertyCity: properties.city,
      propertyState: properties.state,
      marketName: markets.name,
      type: activities.type,
      occurredAt: activities.occurredAt,
      outcome: activities.outcome,
      contactName: raw<string | null>`coalesce(contacts.name, activities.contact_name_free_text)`,
      subject: activities.subject,
      notes: activities.notes,
      sellerMotivation: activities.sellerMotivation,
      pricingExpectation: activities.pricingExpectation,
      timingNotes: activities.timingNotes,
      priceMentioned: activities.priceMentioned,
      followUpDate: activities.followUpDate,
      author: activities.authorLabel,
      createdAt: activities.createdAt,
    })
    .from(activities)
    .innerJoin(properties, eq(properties.id, activities.propertyId))
    .leftJoin(markets, eq(markets.id, properties.marketId))
    .leftJoin(contacts, eq(contacts.id, activities.contactId))
    .where(and(...conds))
    .orderBy(desc(activities.occurredAt));

  const headers = [
    'activity_id', 'property_id', 'property_name', 'property_address', 'property_city',
    'property_state', 'market', 'type', 'occurred_at', 'outcome', 'contact_name',
    'subject', 'notes', 'seller_motivation', 'pricing_expectation', 'timing_notes',
    'price_mentioned', 'follow_up_date', 'author', 'created_at',
  ];

  return toCsv(headers, rows.map((r) => [
    r.id, r.propertyId, r.propertyName, r.propertyAddress, r.propertyCity,
    r.propertyState, r.marketName, r.type, r.occurredAt, r.outcome, r.contactName,
    r.subject, r.notes, r.sellerMotivation, r.pricingExpectation, r.timingNotes,
    r.priceMentioned, r.followUpDate, r.author, r.createdAt,
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

/**
 * Template for the property importer (see `src/lib/services/property-import.ts`).
 * Unlike the discovery-candidate template, this is for property research the
 * team already has - existing owner/contact info, not for-sale listings.
 */
export function propertyImportTemplateCsv(): string {
  const headers = [
    'name', 'address_line1', 'city', 'state', 'postal_code', 'property_type',
    'last_sale_date', 'sale_price', 'owner', 'contact',
  ];
  const examples = [
    [
      'Example Retail Plaza', '123 Main St', 'Statesboro', 'GA', '30458', 'Retail',
      '2020-06-15', '1200000', 'Jane Doe', '(912) 555-1234',
    ],
  ];
  return toCsv(headers, examples);
}

/**
 * Template for bulk-staging discovery candidates found outside the app (by
 * hand, or by a research task that does its own web searching instead of
 * calling the Anthropic API). See `src/lib/services/candidate-csv.ts` for how
 * a filled-in copy is parsed and staged into the discovery inbox.
 */
export function candidateImportTemplateCsv(): string {
  const headers = [
    'name', 'address_line1', 'city', 'state', 'postal_code', 'county',
    'latitude', 'longitude', 'property_type', 'asking_price', 'building_sqft',
    'land_acreage', 'listing_date', 'owner_name', 'broker_name', 'broker_company',
    'broker_phone', 'broker_email', 'source_url', 'source_title', 'source_name',
    'evidence_excerpt', 'location_note', 'needs_verification',
  ];
  const examples = [
    [
      'Example Retail Plaza', '123 Main St', 'Tampa', 'FL', '33625', '',
      '', '', 'Retail - Strip Center', '2500000', '15000', '1.2',
      '', '', 'Jane Doe', 'ABC Realty', '813-555-1234', '',
      'https://www.loopnet.com/Listing/example', 'Example Retail Plaza for Sale', 'LoopNet',
      'Offered at $2,500,000, 15,000 SF on 1.2 acres.', '', 'postalCode;latitude;longitude',
    ],
  ];
  return toCsv(headers, examples);
}
