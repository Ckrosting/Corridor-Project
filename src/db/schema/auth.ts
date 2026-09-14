import { sql } from 'drizzle-orm';
import {
  boolean, index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid,
} from 'drizzle-orm/pg-core';
import { userRoleEnum } from './enums';

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email').notNull(),
    name: text('name').notNull(),
    passwordHash: text('password_hash'),
    role: userRoleEnum('role').notNull().default('member'),
    isActive: boolean('is_active').notNull().default(true),
    /** Set when an admin archives a user. Archived users keep authoring history. */
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Case-insensitive uniqueness: nobody gets two accounts differing only by case.
    uniqueIndex('users_email_lower_unq').on(sql`lower(${t.email})`),
  ],
);

/**
 * Append-only audit trail for important edits. Written by the service layer, not
 * by triggers, so it can record a human-readable summary alongside the field diff.
 */
export const auditLog = pgTable(
  'audit_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    entityType: text('entity_type').notNull(),
    entityId: uuid('entity_id'),
    action: text('action').notNull(), // create | update | delete | archive | restore | promote | ...
    summary: text('summary'),
    /** { field: { from, to } } - only changed fields. */
    changes: jsonb('changes').$type<Record<string, { from: unknown; to: unknown }>>(),
    actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    actorLabel: text('actor_label'), // preserved even if the user row is later removed
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('audit_entity_idx').on(t.entityType, t.entityId, t.createdAt),
    index('audit_created_idx').on(t.createdAt),
  ],
);

/**
 * Single-row-per-key application settings, editable by admins at runtime
 * (AI budget, map provider choice, review buffer, etc). Secrets never live here -
 * API keys come from environment configuration only.
 */
export const appSettings = pgTable('app_settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
});
