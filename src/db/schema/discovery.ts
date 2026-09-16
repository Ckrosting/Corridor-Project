import {
  boolean, date, doublePrecision, index, integer, jsonb, numeric, pgTable,
  text, timestamp, uniqueIndex, uuid,
} from 'drizzle-orm/pg-core';
import { users } from './auth';
import { markets } from './geo';
import { properties } from './property';
import { jobs } from './jobs';
import {
  discoveryStatusEnum, importKindEnum, importStatusEnum,
  jobStatusEnum, scanScopeEnum,
} from './enums';

/** One user-initiated "Find New Listings" run, covering one or many markets. */
export const scans = pgTable(
  'scans',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    jobId: uuid('job_id').references(() => jobs.id, { onDelete: 'set null' }),
    scope: scanScopeEnum('scope').notNull(),
    /** Market ids resolved from the scope at queue time. */
    marketIds: jsonb('market_ids').$type<string[]>().notNull(),
    status: jobStatusEnum('status').notNull().default('queued'),

    model: text('model').notNull(),

    /* ---- Progress, so the UI can show real state rather than a spinner ---- */
    targetsTotal: integer('targets_total').notNull().default(0),
    targetsCompleted: integer('targets_completed').notNull().default(0),
    resultsFound: integer('results_found').notNull().default(0),
    resultsNew: integer('results_new').notNull().default(0),
    resultsDuplicate: integer('results_duplicate').notNull().default(0),

    /** Human-readable notes about what could not be searched, shown in the UI. */
    coverageNotes: jsonb('coverage_notes').$type<string[]>(),
    error: text('error'),

    requestedBy: uuid('requested_by').references(() => users.id, { onDelete: 'set null' }),
    requestedByLabel: text('requested_by_label'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (t) => [
    index('scans_status_idx').on(t.status, t.createdAt),
    index('scans_created_idx').on(t.createdAt),
  ],
);

/** Per-market progress within a scan, so a partial failure is visible and precise. */
export const scanTargets = pgTable(
  'scan_targets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    scanId: uuid('scan_id').notNull().references(() => scans.id, { onDelete: 'cascade' }),
    marketId: uuid('market_id').references(() => markets.id, { onDelete: 'set null' }),
    marketLabel: text('market_label'),
    status: jobStatusEnum('status').notNull().default('queued'),
    resultsFound: integer('results_found').notNull().default(0),
    /** Domains/queries actually reached, plus anything blocked or unavailable. */
    sourcesSearched: jsonb('sources_searched').$type<string[]>(),
    coverageNotes: jsonb('coverage_notes').$type<string[]>(),
    error: text('error'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (t) => [index('scan_targets_scan_idx').on(t.scanId)],
);

/**
 * A candidate property surfaced by a scan, a submitted URL, or an uploaded
 * document. Nothing here is trusted: it is staged for human review and only
 * becomes a property when a user approves it.
 *
 * Retrieved page content and uploaded documents are treated strictly as source
 * MATERIAL, never as instructions to the application.
 */
export const discoveryResults = pgTable(
  'discovery_results',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    scanId: uuid('scan_id').references(() => scans.id, { onDelete: 'set null' }),
    marketId: uuid('market_id').references(() => markets.id, { onDelete: 'set null' }),

    status: discoveryStatusEnum('status').notNull().default('new'),
    /** manual_url | manual_document | scan */
    origin: text('origin').notNull().default('scan'),

    /* ---- Extracted, unverified values ---- */
    name: text('name'),
    addressLine1: text('address_line1'),
    city: text('city'),
    state: text('state'),
    postalCode: text('postal_code'),
    county: text('county'),
    latitude: doublePrecision('latitude'),
    longitude: doublePrecision('longitude'),
    propertyType: text('property_type'),
    askingPrice: numeric('asking_price', { precision: 14, scale: 2 }),
    buildingSqft: integer('building_sqft'),
    landAcreage: numeric('land_acreage', { precision: 12, scale: 4 }),

    /**
     * Deal metrics, when the source states them. Types mirror `properties`
     * exactly so approving a candidate copies them across unchanged.
     */
    noi: numeric('noi', { precision: 14, scale: 2 }),
    /** A percentage as stated: 6.5 is 6.5%. Never a rate we computed ourselves. */
    capRateReported: numeric('cap_rate_reported', { precision: 6, scale: 3 }),
    yearBuilt: integer('year_built'),
    tenantInfo: text('tenant_info'),

    /** Only populated when a source states it. Never the scan date. */
    listingDate: date('listing_date'),
    ownerName: text('owner_name'),
    brokerName: text('broker_name'),
    brokerCompany: text('broker_company'),
    brokerPhone: text('broker_phone'),
    brokerEmail: text('broker_email'),

    /**
     * Field-level provenance: { fieldName: { value, sourceUrl, excerpt, confidence } }.
     * Kept so a reviewer can see exactly which page supported each number.
     */
    fieldSources: jsonb('field_sources').$type<Record<string, unknown>>(),
    /** Fields the extractor could not support with evidence - shown as "verify". */
    needsVerification: jsonb('needs_verification').$type<string[]>(),
    /** Nullable inner fields: an extracted source often has a URL but no title. */
    sources: jsonb('sources').$type<Array<{ url: string; title?: string | null; sourceName?: string | null }>>(),
    evidenceExcerpt: text('evidence_excerpt'),

    /** The source's own note about where this candidate is, kept for the reviewer. */
    geoNote: text('geo_note'),

    /* ---- Deduplication ---- */
    normalizedUrl: text('normalized_url'),
    /** Stable hash over normalised address + locality, for cross-source matching. */
    dedupeHash: text('dedupe_hash'),
    /** Set when this candidate is a probable match for an existing property. */
    suggestedPropertyId: uuid('suggested_property_id').references(() => properties.id, { onDelete: 'set null' }),
    suggestedMatchScore: numeric('suggested_match_score', { precision: 5, scale: 4 }),
    suggestedMatchReason: text('suggested_match_reason'),

    /**
     * For candidates matching an existing property: the proposed field changes,
     * shown to a reviewer before anything is applied. Human-verified values and
     * call notes are never silently overwritten.
     */
    proposedChanges: jsonb('proposed_changes').$type<Record<string, { from: unknown; to: unknown }>>(),

    /** Distinct from listing date: when WE first saw this candidate. */
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    timesSeen: integer('times_seen').notNull().default(1),

    linkedPropertyId: uuid('linked_property_id').references(() => properties.id, { onDelete: 'set null' }),
    reviewedBy: uuid('reviewed_by').references(() => users.id, { onDelete: 'set null' }),
    reviewedByLabel: text('reviewed_by_label'),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    reviewNote: text('review_note'),

    isSample: boolean('is_sample').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('discovery_status_idx').on(t.status, t.createdAt),
    index('discovery_market_idx').on(t.marketId),
    index('discovery_scan_idx').on(t.scanId),
    index('discovery_norm_url_idx').on(t.normalizedUrl),
    index('discovery_dedupe_idx').on(t.dedupeHash),
  ],
);

/**
 * Permanent record of candidates a human already dealt with, keyed by the same
 * dedupe keys. Consulted on every scan so a rejected or imported listing does not
 * keep reappearing as "new" run after run.
 */
export const discoverySuppressions = pgTable(
  'discovery_suppressions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** 'url' | 'hash' */
    keyType: text('key_type').notNull(),
    keyValue: text('key_value').notNull(),
    reason: text('reason').notNull(), // rejected | imported | archived | duplicate
    propertyId: uuid('property_id').references(() => properties.id, { onDelete: 'set null' }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('discovery_suppression_unq').on(t.keyType, t.keyValue)],
);

/**
 * Recorded Anthropic API usage, per scan. Drives the monthly budget ceiling.
 * Costs are computed from a configurable per-model rate table in app settings,
 * and are clearly labelled as estimates.
 */
export const aiUsage = pgTable(
  'ai_usage',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    scanId: uuid('scan_id').references(() => scans.id, { onDelete: 'set null' }),
    model: text('model').notNull(),
    operation: text('operation').notNull(), // scan_market | url_extract | document_extract
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    cacheReadTokens: integer('cache_read_tokens').notNull().default(0),
    cacheWriteTokens: integer('cache_write_tokens').notNull().default(0),
    webSearches: integer('web_searches').notNull().default(0),
    estimatedCostUsd: numeric('estimated_cost_usd', { precision: 10, scale: 4 }).notNull().default('0'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('ai_usage_created_idx').on(t.createdAt)],
);

/* -------------------------------------------------------------------------- */
/* Imports                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * A staged CSV/XLSX import. Rows are parsed, mapped, validated and previewed
 * first; nothing is written to the real tables until an explicit commit.
 */
export const importBatches = pgTable(
  'import_batches',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    kind: importKindEnum('kind').notNull(),
    status: importStatusEnum('status').notNull().default('draft'),
    filename: text('filename').notNull(),
    /** Source column -> canonical field name. */
    columnMapping: jsonb('column_mapping').$type<Record<string, string>>(),
    totalRows: integer('total_rows').notNull().default(0),
    validRows: integer('valid_rows').notNull().default(0),
    errorRows: integer('error_rows').notNull().default(0),
    duplicateRows: integer('duplicate_rows').notNull().default(0),
    createdRows: integer('created_rows').notNull().default(0),
    updatedRows: integer('updated_rows').notNull().default(0),
    skippedRows: integer('skipped_rows').notNull().default(0),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    committedAt: timestamp('committed_at', { withTimezone: true }),
  },
  (t) => [index('import_batches_created_idx').on(t.createdAt)],
);

/** One staged row, with its validation result and duplicate verdict. */
export const importRows = pgTable(
  'import_rows',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    batchId: uuid('batch_id').notNull().references(() => importBatches.id, { onDelete: 'cascade' }),
    rowNumber: integer('row_number').notNull(),
    raw: jsonb('raw').$type<Record<string, string>>().notNull(),
    mapped: jsonb('mapped').$type<Record<string, unknown>>(),
    errors: jsonb('errors').$type<string[]>(),
    warnings: jsonb('warnings').$type<string[]>(),
    /** new | duplicate | update | error */
    verdict: text('verdict').notNull().default('new'),
    duplicateOfId: uuid('duplicate_of_id'),
    /** create | update | skip - chosen by the user in the preview. */
    action: text('action').notNull().default('create'),
    committedEntityId: uuid('committed_entity_id'),
  },
  (t) => [index('import_rows_batch_idx').on(t.batchId, t.rowNumber)],
);
