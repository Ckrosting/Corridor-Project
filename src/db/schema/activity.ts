import {
  bigint, date, index, jsonb, numeric, pgTable, text, timestamp, uuid,
} from 'drizzle-orm/pg-core';
import { users } from './auth';
import { activityTypeEnum, attachmentKindEnum, callOutcomeEnum } from './enums';
import { contacts, properties } from './property';

/**
 * The chronological activity timeline for a property: calls, notes, emails,
 * meetings, and automatic status-change entries.
 *
 * This table is APPEND-MOSTLY. Changing a property's outreach status writes a new
 * row here; it never rewrites or removes existing call history. Deleting a call
 * record is a deliberate, audited, admin-only action.
 */
export const activities = pgTable(
  'activities',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    propertyId: uuid('property_id').notNull().references(() => properties.id, { onDelete: 'cascade' }),
    type: activityTypeEnum('type').notNull().default('note'),

    /** When the thing actually happened - not when it was typed in. */
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),

    /** Who we spoke with, when that is a known contact record. */
    contactId: uuid('contact_id').references(() => contacts.id, { onDelete: 'set null' }),
    /** Free-text fallback for "spoke with the receptionist", preserved verbatim. */
    contactNameFreeText: text('contact_name_free_text'),

    /** Only meaningful for type='call'. */
    outcome: callOutcomeEnum('outcome'),

    subject: text('subject'),
    notes: text('notes'),

    /* ---- Cold-call intelligence, all optional ---- */
    sellerMotivation: text('seller_motivation'),
    pricingExpectation: text('pricing_expectation'),
    /** Free text on purpose: "spring, after the anchor lease renews" is a real answer. */
    timingNotes: text('timing_notes'),
    priceMentioned: numeric('price_mentioned', { precision: 14, scale: 2 }),

    /** The follow-up this activity set, kept for history even after it is superseded. */
    followUpDate: date('follow_up_date'),

    /** For type='status_change': { from, to } labels, so the timeline reads plainly. */
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),

    authorUserId: uuid('author_user_id').references(() => users.id, { onDelete: 'set null' }),
    /** Author name captured at write time, so history survives user removal. */
    authorLabel: text('author_label'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    editedAt: timestamp('edited_at', { withTimezone: true }),
  },
  (t) => [
    index('activities_property_idx').on(t.propertyId, t.occurredAt),
    index('activities_author_idx').on(t.authorUserId),
    index('activities_type_idx').on(t.type),
    index('activities_followup_idx').on(t.followUpDate),
  ],
);

/**
 * Uploaded files. Bytes live in the storage driver (local disk in development,
 * S3-compatible object storage in production) and are addressed by `storageKey`;
 * only metadata is in the database. Nothing ever depends on the application's
 * own disk in production.
 */
export const attachments = pgTable(
  'attachments',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    /** Exactly one owner is set. Enforced in the service layer. */
    propertyId: uuid('property_id').references(() => properties.id, { onDelete: 'cascade' }),
    opportunityId: uuid('opportunity_id'),
    discoveryResultId: uuid('discovery_result_id'),

    kind: attachmentKindEnum('kind').notNull().default('document'),
    filename: text('filename').notNull(),
    /** Sanitised, non-guessable key within the storage bucket. */
    storageKey: text('storage_key').notNull(),
    contentType: text('content_type').notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    /** SHA-256 of the bytes, used to spot re-uploads of the same file. */
    checksum: text('checksum'),
    description: text('description'),

    uploadedBy: uuid('uploaded_by').references(() => users.id, { onDelete: 'set null' }),
    uploadedByLabel: text('uploaded_by_label'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
  },
  (t) => [
    index('attachments_property_idx').on(t.propertyId),
    index('attachments_opportunity_idx').on(t.opportunityId),
    index('attachments_discovery_idx').on(t.discoveryResultId),
    index('attachments_checksum_idx').on(t.checksum),
  ],
);

/** Per-user saved filter sets for the market workspace and pipeline. */
export const savedViews = pgTable(
  'saved_views',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    scope: text('scope').notNull(), // market | portfolio | pipeline
    filters: jsonb('filters').$type<Record<string, unknown>>().notNull(),
    marketId: uuid('market_id'),
    ownerUserId: uuid('owner_user_id').references(() => users.id, { onDelete: 'cascade' }),
    /** Shared views are visible to the whole team; otherwise private to the owner. */
    isShared: jsonb('is_shared').$type<boolean>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('saved_views_owner_idx').on(t.ownerUserId, t.scope)],
);
