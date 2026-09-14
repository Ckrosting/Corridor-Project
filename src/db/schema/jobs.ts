import { sql } from 'drizzle-orm';
import {
  index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid,
} from 'drizzle-orm/pg-core';
import { users } from './auth';
import { jobStatusEnum } from './enums';

/**
 * Postgres-backed job queue.
 *
 * Deliberately not Redis/BullMQ: one fewer service to run locally and one fewer
 * to pay for on Railway. Workers claim jobs with
 *   SELECT ... FOR UPDATE SKIP LOCKED
 * inside a transaction, which is the standard safe pattern for concurrent
 * consumers on Postgres.
 *
 * Jobs run in a SEPARATE process from the web app, so a long scan is unaffected
 * by HTTP request timeouts. Workers write `heartbeatAt` while running; a job that
 * goes silent past WORKER_HEARTBEAT_TIMEOUT_SECONDS is reclaimed and retried
 * rather than being stuck as "running" forever.
 */
export const jobs = pgTable(
  'jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    type: text('type').notNull(), // discovery_scan | url_extract | document_extract
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    status: jobStatusEnum('status').notNull().default('queued'),
    priority: integer('priority').notNull().default(0),

    /**
     * Guards against duplicate concurrent work. A partial unique index below
     * allows only ONE non-terminal job per key, so double-clicking "Find New
     * Listings" for a corridor cannot start two scans.
     */
    dedupeKey: text('dedupe_key'),

    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(3),

    runAt: timestamp('run_at', { withTimezone: true }).notNull().defaultNow(),
    lockedAt: timestamp('locked_at', { withTimezone: true }),
    lockedBy: text('locked_by'),
    heartbeatAt: timestamp('heartbeat_at', { withTimezone: true }),

    /** Cooperative cancellation: the worker checks this between units of work. */
    cancelRequested: timestamp('cancel_requested', { withTimezone: true }),
    cancelRequestedBy: uuid('cancel_requested_by').references(() => users.id, { onDelete: 'set null' }),

    lastError: text('last_error'),
    result: jsonb('result').$type<Record<string, unknown>>(),

    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (t) => [
    // The claim query's index: pending work, oldest and highest priority first.
    index('jobs_claim_idx').on(t.status, t.runAt, t.priority),
    uniqueIndex('jobs_dedupe_active_unq')
      .on(t.dedupeKey)
      .where(sql`${t.dedupeKey} is not null and ${t.status} in ('queued','running')`),
    index('jobs_heartbeat_idx').on(t.status, t.heartbeatAt),
  ],
);
