import { sql } from 'drizzle-orm';
import {
  boolean, date, index, integer, numeric, pgTable, primaryKey, text,
  timestamp, uniqueIndex, uuid,
} from 'drizzle-orm/pg-core';
import { users } from './auth';
import { markets } from './geo';
import { properties } from './property';
import { opportunityStateEnum } from './enums';

/**
 * Configurable transaction stages. Like outreach statuses these are data, not
 * code: renameable, reorderable, recolourable, archivable.
 */
export const transactionStages = pgTable(
  'transaction_stages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    key: text('key').notNull(),
    label: text('label').notNull(),
    color: text('color').notNull().default('#64748b'),
    sortOrder: integer('sort_order').notNull().default(0),
    isDefault: boolean('is_default').notNull().default(false),
    /**
     * Terminal stages (Closed, Dead/Passed) drop out of the active board by
     * default but keep full history and can be reopened.
     */
    isTerminal: boolean('is_terminal').notNull().default(false),
    /** Groups stages on the board: 'open' | 'closed_won' | 'closed_lost' | 'on_hold'. */
    category: text('category').notNull().default('open'),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('transaction_stages_key_unq').on(t.key),
    uniqueIndex('transaction_stages_one_default')
      .on(t.isDefault).where(sql`${t.isDefault} = true`),
  ],
);

/**
 * An acquisition opportunity.
 *
 * CRITICAL RULE: nothing creates a row here automatically. Logging a call,
 * setting a follow-up, or changing outreach status never promotes a property
 * into the pipeline. A user must explicitly choose "Promote to Opportunity" and
 * supply a reason, which is captured below.
 *
 * Opportunities are separate records from properties so that a property can go
 * through several deals over the years without any of them overwriting the
 * others, and so one opportunity can span several properties or parcels.
 */
export const opportunities = pgTable(
  'opportunities',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    marketId: uuid('market_id').references(() => markets.id, { onDelete: 'set null' }),
    stageId: uuid('stage_id').notNull().references(() => transactionStages.id, { onDelete: 'restrict' }),

    /** active = on the board. removed = pulled from the board, history retained. */
    state: opportunityStateEnum('state').notNull().default('active'),

    /* ---- The explicit promotion decision ---- */
    promotionReason: text('promotion_reason').notNull(),
    promotedAt: timestamp('promoted_at', { withTimezone: true }).notNull().defaultNow(),
    promotedBy: uuid('promoted_by').references(() => users.id, { onDelete: 'set null' }),
    promotedByLabel: text('promoted_by_label'),

    targetPrice: numeric('target_price', { precision: 14, scale: 2 }),
    offerPrice: numeric('offer_price', { precision: 14, scale: 2 }),
    contractPrice: numeric('contract_price', { precision: 14, scale: 2 }),
    expectedCloseDate: date('expected_close_date'),
    nextStepDate: date('next_step_date'),
    nextStep: text('next_step'),
    notes: text('notes'),

    closedAt: timestamp('closed_at', { withTimezone: true }),
    removedAt: timestamp('removed_at', { withTimezone: true }),
    removedReason: text('removed_reason'),

    isSample: boolean('is_sample').notNull().default(false),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    version: integer('version').notNull().default(1),
  },
  (t) => [
    index('opportunities_stage_idx').on(t.stageId),
    index('opportunities_state_idx').on(t.state),
    index('opportunities_market_idx').on(t.marketId),
    index('opportunities_nextstep_idx').on(t.nextStepDate),
  ],
);

/** An opportunity may involve several properties. */
export const opportunityProperties = pgTable(
  'opportunity_properties',
  {
    opportunityId: uuid('opportunity_id').notNull().references(() => opportunities.id, { onDelete: 'cascade' }),
    propertyId: uuid('property_id').notNull().references(() => properties.id, { onDelete: 'cascade' }),
    /** The property the opportunity was originally promoted from. */
    isPrimary: boolean('is_primary').notNull().default(false),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.opportunityId, t.propertyId] }),
    index('opportunity_properties_property_idx').on(t.propertyId),
  ],
);

/** Full stage-movement history, including reopening a dead or on-hold deal. */
export const opportunityStageHistory = pgTable(
  'opportunity_stage_history',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    opportunityId: uuid('opportunity_id').notNull().references(() => opportunities.id, { onDelete: 'cascade' }),
    fromStageId: uuid('from_stage_id').references(() => transactionStages.id, { onDelete: 'set null' }),
    toStageId: uuid('to_stage_id').references(() => transactionStages.id, { onDelete: 'set null' }),
    fromStageLabel: text('from_stage_label'),
    toStageLabel: text('to_stage_label'),
    note: text('note'),
    changedBy: uuid('changed_by').references(() => users.id, { onDelete: 'set null' }),
    changedByLabel: text('changed_by_label'),
    changedAt: timestamp('changed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('opportunity_stage_history_idx').on(t.opportunityId, t.changedAt)],
);
