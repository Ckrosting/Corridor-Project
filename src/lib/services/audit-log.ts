import '@/lib/server-guard';
import { and, desc, eq, gte, lt, lte, or, sql as raw } from 'drizzle-orm';
import { db } from '@/db';
import { auditLog, users } from '@/db/schema';

/**
 * Read side of the audit trail. The write side lives in `audit.ts` and is kept
 * strictly separate - nothing here inserts.
 */

export const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

export interface AuditLogFilters {
  entityType?: string;
  action?: string;
  actorUserId?: string;
  /** Inclusive ISO date (YYYY-MM-DD) in server local time. */
  from?: string;
  to?: string;
  limit?: number;
  cursor?: string;
}

export interface AuditLogEntry {
  id: string;
  entityType: string;
  entityId: string | null;
  action: string;
  summary: string | null;
  changes: Record<string, { from: unknown; to: unknown }> | null;
  actorUserId: string | null;
  actorLabel: string | null;
  createdAt: Date;
}

export interface AuditLogPage {
  rows: AuditLogEntry[];
  /** Opaque token for the next page; null when the last page has been reached. */
  nextCursor: string | null;
}

/**
 * Cursor pagination on (createdAt, id) rather than OFFSET: the log is
 * append-only and read newest-first, so a row inserted mid-browse would shift
 * every offset by one and silently duplicate a row on the next page.
 */
function encodeCursor(row: { createdAt: Date; id: string }): string {
  return Buffer.from(`${row.createdAt.toISOString()}|${row.id}`, 'utf8').toString('base64url');
}

function decodeCursor(cursor: string): { createdAt: Date; id: string } | null {
  try {
    const [iso, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
    if (!iso || !id) return null;
    const createdAt = new Date(iso);
    if (Number.isNaN(createdAt.getTime())) return null;
    return { createdAt, id };
  } catch {
    return null;
  }
}

function dayStart(iso: string): Date | null {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function dayEnd(iso: string): Date | null {
  const d = dayStart(iso);
  if (!d) return null;
  d.setDate(d.getDate() + 1);
  return d;
}

export async function listAuditLog(filters: AuditLogFilters = {}): Promise<AuditLogPage> {
  const limit = Math.min(Math.max(filters.limit ?? DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE);

  const where = [];
  if (filters.entityType) where.push(eq(auditLog.entityType, filters.entityType));
  if (filters.action) where.push(eq(auditLog.action, filters.action));
  if (filters.actorUserId) where.push(eq(auditLog.actorUserId, filters.actorUserId));

  if (filters.from) {
    const start = dayStart(filters.from);
    if (start) where.push(gte(auditLog.createdAt, start));
  }
  if (filters.to) {
    const end = dayEnd(filters.to);
    if (end) where.push(lt(auditLog.createdAt, end));
  }

  const cursor = filters.cursor ? decodeCursor(filters.cursor) : null;
  if (cursor) {
    where.push(or(
      lt(auditLog.createdAt, cursor.createdAt),
      and(eq(auditLog.createdAt, cursor.createdAt), lt(auditLog.id, cursor.id)),
    )!);
  }

  // One extra row tells us whether a further page exists without a count query.
  const rows = await db
    .select()
    .from(auditLog)
    .where(where.length ? and(...where) : undefined)
    .orderBy(desc(auditLog.createdAt), desc(auditLog.id))
    .limit(limit + 1);

  const page = rows.slice(0, limit) as AuditLogEntry[];
  const last = page[page.length - 1];
  return {
    rows: page,
    nextCursor: rows.length > limit && last ? encodeCursor(last) : null,
  };
}

/** Entity types actually present, so the filter stays accurate as new ones appear. */
export async function listAuditEntityTypes(): Promise<string[]> {
  const rows = await db
    .selectDistinct({ entityType: auditLog.entityType })
    .from(auditLog)
    .orderBy(auditLog.entityType);
  return rows.map((r) => r.entityType);
}

export async function listAuditActions(): Promise<string[]> {
  const rows = await db
    .selectDistinct({ action: auditLog.action })
    .from(auditLog)
    .orderBy(auditLog.action);
  return rows.map((r) => r.action);
}

/** Users who have actually written audit rows, newest activity first is not needed - name order reads better. */
export async function listAuditActors(): Promise<Array<{ id: string; label: string }>> {
  const rows = await db
    .select({ id: users.id, name: users.name, email: users.email })
    .from(users)
    .where(raw`exists (select 1 from audit_log al where al.actor_user_id = ${users.id})`)
    .orderBy(users.name);
  return rows.map((r) => ({ id: r.id, label: r.name || r.email }));
}

// Label maps and helpers live in `@/lib/audit-labels` (no `db` import), so a
// client component can use them without pulling the Postgres driver into the
// browser bundle. Re-exported here so existing server-side callers of this
// file need no change.
export {
  AUDIT_ACTION_LABELS, AUDIT_ENTITY_LABELS, auditEntityHref, humanizeAuditTerm,
} from '@/lib/audit-labels';
