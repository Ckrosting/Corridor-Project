import {
  boolean, doublePrecision, index, integer, jsonb, pgTable, text, timestamp,
  uniqueIndex, uuid,
} from 'drizzle-orm/pg-core';
import type { AreaGeometry } from '@/lib/geo/types';
import { corridorBoundaryKindEnum, geometrySourceEnum } from './enums';
import { users } from './auth';

/**
 * GEOMETRY STORAGE NOTE
 * ---------------------
 * Boundaries are stored as validated GeoJSON in `jsonb`, with the bounding box
 * denormalised into four indexed float columns. Viewport and "which corridors
 * might contain this point" queries use the bbox index; exact point-in-polygon is
 * then done in TypeScript (src/lib/geo/polygon.ts).
 *
 * This deliberately avoids a PostGIS dependency, which would be difficult to run
 * locally without admin rights and adds deployment friction. At this project's
 * scale (tens of thousands of parcels) the bbox-then-exact approach is fast. If
 * the data ever outgrows it, these columns can be replaced by a `geography`
 * column without changing the API surface.
 */

export const markets = pgTable(
  'markets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    state: text('state'),
    notes: text('notes'),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    version: integer('version').notNull().default(1),
  },
  (t) => [uniqueIndex('markets_slug_unq').on(t.slug)],
);

/** A mall we own. Anchors a market and seeds corridor radii. */
export const mallAnchors = pgTable(
  'mall_anchors',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    marketId: uuid('market_id').notNull().references(() => markets.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    addressLine1: text('address_line1'),
    city: text('city'),
    state: text('state'),
    postalCode: text('postal_code'),
    county: text('county'),
    latitude: doublePrecision('latitude'),
    longitude: doublePrecision('longitude'),
    /**
     * True when the anchor has no trustworthy coordinates - e.g. imported from a
     * spreadsheet without lat/lng, or geocoded with low confidence. Surfaced in the
     * UI as "needs map placement" rather than being silently dropped on the map.
     */
    needsMapPlacement: boolean('needs_map_placement').notNull().default(true),
    locationSource: text('location_source'), // geocoded:<provider> | manual | imported
    locationSetAt: timestamp('location_set_at', { withTimezone: true }),
    notes: text('notes'),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    version: integer('version').notNull().default(1),
  },
  (t) => [
    index('mall_anchors_market_idx').on(t.marketId),
    index('mall_anchors_placement_idx').on(t.needsMapPlacement),
  ],
);

export const corridors = pgTable(
  'corridors',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    marketId: uuid('market_id').notNull().references(() => markets.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),

    /** Which control the user is currently driving the boundary with. */
    boundaryKind: corridorBoundaryKindEnum('boundary_kind').notNull().default('radius'),

    /** Radius mode: centre + radius. Retained after switching to custom so the user can go back. */
    anchorId: uuid('anchor_id').references(() => mallAnchors.id, { onDelete: 'set null' }),
    centerLatitude: doublePrecision('center_latitude'),
    centerLongitude: doublePrecision('center_longitude'),
    radiusMeters: doublePrecision('radius_meters'),

    /**
     * The authoritative saved boundary, always materialised as a polygon - even in
     * radius mode - so that containment logic has exactly one code path.
     * APPROXIMATE RESEARCH OUTLINE. Not a surveyed or official tax parcel boundary.
     */
    boundary: jsonb('boundary').$type<AreaGeometry>(),
    boundarySource: geometrySourceEnum('boundary_source').notNull().default('radius'),

    minLatitude: doublePrecision('min_latitude'),
    maxLatitude: doublePrecision('max_latitude'),
    minLongitude: doublePrecision('min_longitude'),
    maxLongitude: doublePrecision('max_longitude'),

    /** Hex colour used to distinguish overlapping corridors on the map. */
    color: text('color').notNull().default('#2563eb'),
    sortOrder: integer('sort_order').notNull().default(0),

    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    version: integer('version').notNull().default(1),
  },
  (t) => [
    index('corridors_market_idx').on(t.marketId),
    index('corridors_bbox_idx').on(t.minLatitude, t.maxLatitude, t.minLongitude, t.maxLongitude),
  ],
);
