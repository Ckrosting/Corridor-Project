import { sql } from 'drizzle-orm';
import {
  boolean, date, doublePrecision, index, integer, jsonb, numeric, pgTable,
  primaryKey, text, timestamp, uniqueIndex, uuid,
} from 'drizzle-orm/pg-core';
import type { AreaGeometry } from '@/lib/geo/types';
import { users } from './auth';
import { corridors, markets } from './geo';
import {
  contactRoleEnum, customFieldTypeEnum, geometrySourceEnum, listingStatusEnum,
} from './enums';

/* -------------------------------------------------------------------------- */
/* Configurable outreach statuses                                             */
/* -------------------------------------------------------------------------- */

/**
 * Outreach status = how far along we are researching and contacting people.
 * Entirely separate from listing status (is it for sale) and from transaction
 * stage (is there a real deal). Names, order and colours are admin-configurable.
 * A status in use can never be hard-deleted - it is archived, and the admin must
 * explicitly reassign the properties using it.
 */
export const outreachStatuses = pgTable(
  'outreach_statuses',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    key: text('key').notNull(),
    label: text('label').notNull(),
    color: text('color').notNull().default('#64748b'),
    sortOrder: integer('sort_order').notNull().default(0),
    /** The status new properties get. Exactly one row may have this set. */
    isDefault: boolean('is_default').notNull().default(false),
    /**
     * Whether properties in this status count as "actively pursued". Drives the
     * "no follow-up scheduled" work queue, which would otherwise be flooded by
     * every untouched property in the database.
     */
    countsAsActivePursuit: boolean('counts_as_active_pursuit').notNull().default(false),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('outreach_statuses_key_unq').on(t.key),
    uniqueIndex('outreach_statuses_one_default')
      .on(t.isDefault).where(sql`${t.isDefault} = true`),
  ],
);

/* -------------------------------------------------------------------------- */
/* Owner entities and contacts                                                */
/* -------------------------------------------------------------------------- */

/**
 * The legal entity that owns a property ("Maple Ridge Holdings LLC"). Kept
 * strictly separate from the people who represent it - an LLC is not a person and
 * does not have a mobile number.
 */
export const ownerEntities = pgTable(
  'owner_entities',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    entityType: text('entity_type'), // LLC | LP | Trust | Individual | Corporation | ...
    mailingAddress: text('mailing_address'),
    notes: text('notes'),
    source: text('source'),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    version: integer('version').notNull().default(1),
  },
  (t) => [index('owner_entities_name_idx').on(sql`lower(${t.name})`)],
);

/** A reusable person record. One contact may relate to many properties. */
export const contacts = pgTable(
  'contacts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    company: text('company'),
    role: contactRoleEnum('role').notNull().default('other'),
    title: text('title'),
    phone: text('phone'),
    phoneAlt: text('phone_alt'),
    email: text('email'),
    notes: text('notes'),
    /** Where this contact information came from, and when we last confirmed it. */
    source: text('source'),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    /** Optional link to the entity this person represents. */
    ownerEntityId: uuid('owner_entity_id').references(() => ownerEntities.id, { onDelete: 'set null' }),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    version: integer('version').notNull().default(1),
  },
  (t) => [
    index('contacts_name_idx').on(sql`lower(${t.name})`),
    index('contacts_company_idx').on(sql`lower(${t.company})`),
    index('contacts_email_idx').on(sql`lower(${t.email})`),
    index('contacts_phone_idx').on(t.phone),
  ],
);

/* -------------------------------------------------------------------------- */
/* Properties                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Money columns are `numeric` and NULLABLE by design. NULL means "we do not know".
 * Zero is a real value (a property really can have $0 NOI) and is never used as a
 * stand-in for unknown. The same rule applies to acreage, square footage and
 * occupancy.
 */
export const properties = pgTable(
  'properties',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    marketId: uuid('market_id').notNull().references(() => markets.id, { onDelete: 'restrict' }),

    name: text('name'),
    addressLine1: text('address_line1'),
    addressLine2: text('address_line2'),
    city: text('city'),
    state: text('state'),
    postalCode: text('postal_code'),
    county: text('county'),

    latitude: doublePrecision('latitude'),
    longitude: doublePrecision('longitude'),
    /** geocoded:<provider> | manual | imported | discovery */
    locationSource: text('location_source'),
    locationConfidence: text('location_confidence'), // high | medium | low
    needsMapPlacement: boolean('needs_map_placement').notNull().default(false),
    /** Set when a property exists as a point but has no drawn parcel outline yet. */
    needsParcelOutline: boolean('needs_parcel_outline').notNull().default(true),

    propertyType: text('property_type'),

    landAcreage: numeric('land_acreage', { precision: 12, scale: 4 }),
    buildingSqft: integer('building_sqft'),
    occupancyPercent: numeric('occupancy_percent', { precision: 5, scale: 2 }),
    tenantInfo: text('tenant_info'),
    yearBuilt: integer('year_built'),

    askingPrice: numeric('asking_price', { precision: 14, scale: 2 }),
    /** Our internal value opinion / what we would pay. */
    targetPurchasePrice: numeric('target_purchase_price', { precision: 14, scale: 2 }),
    /** What the seller has actually said out loud, which is often neither of the above. */
    sellerIndicatedPrice: numeric('seller_indicated_price', { precision: 14, scale: 2 }),
    noi: numeric('noi', { precision: 14, scale: 2 }),
    /**
     * Cap rate AS REPORTED by a broker/listing. The calculated cap rate
     * (NOI / price) is derived in the application and never written here, so the
     * two can always be shown side by side and disagree visibly.
     */
    capRateReported: numeric('cap_rate_reported', { precision: 6, scale: 3 }),
    capRateReportedSource: text('cap_rate_reported_source'),

    ownerEntityId: uuid('owner_entity_id').references(() => ownerEntities.id, { onDelete: 'set null' }),

    listingStatus: listingStatusEnum('listing_status').notNull().default('unknown'),
    /** Only set when a source actually supports it. Never inferred from a scan date. */
    listingDate: date('listing_date'),

    firstDiscoveredAt: timestamp('first_discovered_at', { withTimezone: true }).notNull().defaultNow(),
    lastVerifiedAt: timestamp('last_verified_at', { withTimezone: true }),

    outreachStatusId: uuid('outreach_status_id').references(() => outreachStatuses.id, { onDelete: 'restrict' }),
    nextFollowUpDate: date('next_follow_up_date'),

    researchNotes: text('research_notes'),

    /**
     * True once a human has reviewed/edited this record. AI-sourced updates must
     * never silently overwrite a property with this set - they become suggestions.
     */
    humanVerified: boolean('human_verified').notNull().default(false),
    humanVerifiedAt: timestamp('human_verified_at', { withTimezone: true }),
    humanVerifiedBy: uuid('human_verified_by').references(() => users.id, { onDelete: 'set null' }),

    /** Clearly-labelled demonstration data, excluded from real work views by default. */
    isSample: boolean('is_sample').notNull().default(false),

    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    /** Optimistic concurrency token. Bumped on every write; stale writes are rejected. */
    version: integer('version').notNull().default(1),
  },
  (t) => [
    index('properties_market_idx').on(t.marketId),
    index('properties_latlng_idx').on(t.latitude, t.longitude),
    index('properties_outreach_idx').on(t.outreachStatusId),
    index('properties_listing_idx').on(t.listingStatus),
    index('properties_followup_idx').on(t.nextFollowUpDate),
    index('properties_archived_idx').on(t.archivedAt),
    index('properties_sample_idx').on(t.isSample),
    index('properties_address_idx').on(sql`lower(${t.addressLine1})`),
  ],
);

/**
 * Membership of a property in a corridor. Many-to-many on purpose: a property
 * that sits inside three overlapping corridors is ONE row in `properties` with
 * three rows here. Its contacts, notes and call history are never duplicated.
 */
export const propertyCorridors = pgTable(
  'property_corridors',
  {
    propertyId: uuid('property_id').notNull().references(() => properties.id, { onDelete: 'cascade' }),
    corridorId: uuid('corridor_id').notNull().references(() => corridors.id, { onDelete: 'cascade' }),
    /** 'auto' when derived from geometry, 'manual' when a user pinned it. */
    assignedVia: text('assigned_via').notNull().default('auto'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.propertyId, t.corridorId] }),
    index('property_corridors_corridor_idx').on(t.corridorId),
  ],
);

/**
 * A parcel belonging to a property. Geometry is OPTIONAL: a parcel ID can be
 * recorded before anyone draws its outline, and a property can exist as a bare
 * map point with no parcels at all.
 *
 * Drawn geometry is an APPROXIMATE RESEARCH OUTLINE - not a surveyed or official
 * tax parcel boundary.
 */
export const propertyParcels = pgTable(
  'property_parcels',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    propertyId: uuid('property_id').notNull().references(() => properties.id, { onDelete: 'cascade' }),
    parcelIdText: text('parcel_id_text'),
    label: text('label'),
    geometry: jsonb('geometry').$type<AreaGeometry>(),
    geometrySource: geometrySourceEnum('geometry_source').notNull().default('manual_draw'),
    acreage: numeric('acreage', { precision: 12, scale: 4 }),
    notes: text('notes'),

    minLatitude: doublePrecision('min_latitude'),
    maxLatitude: doublePrecision('max_latitude'),
    minLongitude: doublePrecision('min_longitude'),
    maxLongitude: doublePrecision('max_longitude'),

    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    version: integer('version').notNull().default(1),
  },
  (t) => [
    index('parcels_property_idx').on(t.propertyId),
    index('parcels_bbox_idx').on(t.minLatitude, t.maxLatitude, t.minLongitude, t.maxLongitude),
    index('parcels_parcel_id_idx').on(sql`lower(${t.parcelIdText})`),
  ],
);

/** Which people are attached to a property, and in what capacity. */
export const propertyContacts = pgTable(
  'property_contacts',
  {
    propertyId: uuid('property_id').notNull().references(() => properties.id, { onDelete: 'cascade' }),
    contactId: uuid('contact_id').notNull().references(() => contacts.id, { onDelete: 'cascade' }),
    /** Their relationship to THIS property, which can differ from their global role. */
    relationship: contactRoleEnum('relationship').notNull().default('other'),
    isPrimary: boolean('is_primary').notNull().default(false),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.propertyId, t.contactId, t.relationship] }),
    index('property_contacts_contact_idx').on(t.contactId),
  ],
);

/**
 * Listing URLs and source names. A child table rather than a JSON blob because
 * the normalised URL is the primary deduplication key for discovery scans.
 */
export const propertyListingSources = pgTable(
  'property_listing_sources',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    propertyId: uuid('property_id').notNull().references(() => properties.id, { onDelete: 'cascade' }),
    url: text('url').notNull(),
    /** Lowercased, tracking params stripped, trailing slash removed. */
    normalizedUrl: text('normalized_url').notNull(),
    sourceName: text('source_name'),
    listedPrice: numeric('listed_price', { precision: 14, scale: 2 }),
    listingDate: date('listing_date'),
    isActive: boolean('is_active').notNull().default(true),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('listing_sources_prop_url_unq').on(t.propertyId, t.normalizedUrl),
    index('listing_sources_norm_url_idx').on(t.normalizedUrl),
  ],
);

/** Asking-price changes, recorded only when a source supports the change. */
export const propertyPriceHistory = pgTable(
  'property_price_history',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    propertyId: uuid('property_id').notNull().references(() => properties.id, { onDelete: 'cascade' }),
    field: text('field').notNull(), // asking_price | seller_indicated_price | target_purchase_price
    oldValue: numeric('old_value', { precision: 14, scale: 2 }),
    newValue: numeric('new_value', { precision: 14, scale: 2 }),
    evidenceUrl: text('evidence_url'),
    evidenceNote: text('evidence_note'),
    observedAt: timestamp('observed_at', { withTimezone: true }).notNull().defaultNow(),
    recordedBy: uuid('recorded_by').references(() => users.id, { onDelete: 'set null' }),
  },
  (t) => [index('price_history_property_idx').on(t.propertyId, t.observedAt)],
);

/* -------------------------------------------------------------------------- */
/* Tags                                                                       */
/* -------------------------------------------------------------------------- */

export const tags = pgTable(
  'tags',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    color: text('color').notNull().default('#64748b'),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('tags_name_unq').on(sql`lower(${t.name})`)],
);

export const propertyTags = pgTable(
  'property_tags',
  {
    propertyId: uuid('property_id').notNull().references(() => properties.id, { onDelete: 'cascade' }),
    tagId: uuid('tag_id').notNull().references(() => tags.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.propertyId, t.tagId] }),
    index('property_tags_tag_idx').on(t.tagId),
  ],
);

/* -------------------------------------------------------------------------- */
/* Admin-managed custom fields                                                */
/* -------------------------------------------------------------------------- */

export const customFieldDefs = pgTable(
  'custom_field_defs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    entity: text('entity').notNull().default('property'),
    key: text('key').notNull(),
    label: text('label').notNull(),
    type: customFieldTypeEnum('type').notNull(),
    /** For type='select': string[] of allowed options. */
    options: jsonb('options').$type<string[]>(),
    helpText: text('help_text'),
    sortOrder: integer('sort_order').notNull().default(0),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('custom_field_defs_entity_key_unq').on(t.entity, t.key)],
);

export const customFieldValues = pgTable(
  'custom_field_values',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    defId: uuid('def_id').notNull().references(() => customFieldDefs.id, { onDelete: 'cascade' }),
    propertyId: uuid('property_id').notNull().references(() => properties.id, { onDelete: 'cascade' }),
    /** Typed at the application boundary against the def's declared type. */
    value: jsonb('value'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
  },
  (t) => [uniqueIndex('custom_field_values_unq').on(t.defId, t.propertyId)],
);
