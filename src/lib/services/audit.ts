import '@/lib/server-guard';
import { and, eq } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';
import { db } from '@/db';
import { auditLog } from '@/db/schema';
import type { Actor } from '@/lib/auth/guards';
import { ConflictError } from '@/lib/errors';

type Changes = Record<string, { from: unknown; to: unknown }>;

/**
 * Computes the field-level difference between a stored row and an incoming
 * patch. Only fields actually present in the patch and actually different are
 * recorded, so the audit trail stays readable.
 */
export function diffFields<T extends Record<string, unknown>>(
  before: T,
  patch: Partial<T>,
  ignore: string[] = ['updatedAt', 'version', 'updatedBy'],
): Changes {
  const changes: Changes = {};
  for (const [key, next] of Object.entries(patch)) {
    if (ignore.includes(key)) continue;
    const prev = before[key];
    if (sameValue(prev, next)) continue;
    changes[key] = { from: prev ?? null, to: next ?? null };
  }
  return changes;
}

function sameValue(a: unknown, b: unknown): boolean {
  // Postgres `numeric` columns come back as strings ("1234.00"), while the
  // validation layer produces canonical strings ("1234"). Compare those
  // numerically so an unchanged price is not logged as an edit.
  const na = asFiniteNumber(a);
  const nb = asFiniteNumber(b);
  if (na !== null && nb !== null) return na === nb;

  return normalise(a) === normalise(b);
}

function asFiniteNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * Renders a value into a comparable string. Each result is prefixed with a type
 * tag so that unrelated values can never compare equal - without it the string
 * "null" and an actual null would look like the same value, and "1" and 1 would
 * produce a phantom "no change".
 */
function normalise(v: unknown): string {
  if (v === null || v === undefined) return 'nul:';
  if (v instanceof Date) return `dat:${v.toISOString()}`;
  if (typeof v === 'object') return `obj:${JSON.stringify(v)}`;
  if (typeof v === 'number') return `num:${v}`;
  if (typeof v === 'boolean') return `bol:${v}`;
  return `str:${String(v)}`;
}

export interface AuditInput {
  entityType: string;
  entityId?: string | null;
  action: string;
  summary?: string;
  changes?: Changes;
  actor: Actor;
}

/** Appends an audit row. Never throws into the caller's path — auditing must not break a save. */
export async function recordAudit(input: AuditInput, tx = db): Promise<void> {
  try {
    await tx.insert(auditLog).values({
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      action: input.action,
      summary: input.summary ?? null,
      changes: input.changes && Object.keys(input.changes).length > 0 ? input.changes : null,
      actorUserId: input.actor.id,
      actorLabel: input.actor.label,
    });
  } catch (err) {
    console.error('[audit] Failed to write audit entry:', err);
  }
}

/* -------------------------------------------------------------------------- */
/* Optimistic concurrency                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Guards against one user silently overwriting another's edits.
 *
 * Every editable table carries an integer `version`. The client sends the version
 * it loaded; the UPDATE matches on (id, version) and bumps it. If no row matched,
 * somebody else saved first and we raise a ConflictError rather than clobbering
 * their work.
 *
 * This is checked in a single atomic statement, so two simultaneous saves cannot
 * both succeed — unlike a read-then-compare, which has a race between the two.
 */
export async function updateWithVersion<T extends Record<string, unknown>>(params: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  table: PgTable & { id: any; version: any };
  id: string;
  expectedVersion: number;
  values: Record<string, unknown>;
  tx?: typeof db;
  entityLabel?: string;
}): Promise<T> {
  const { table, id, expectedVersion, values, tx = db, entityLabel = 'record' } = params;

  const rows = await tx
    .update(table)
    .set({ ...values, version: expectedVersion + 1, updatedAt: new Date() })
    .where(and(eq(table.id, id), eq(table.version, expectedVersion)))
    .returning();

  if (rows.length === 0) {
    // Distinguish "gone" from "changed underneath you" - they need different fixes.
    const [current] = await tx
      .select({ version: table.version })
      .from(table)
      .where(eq(table.id, id))
      .limit(1);

    if (!current) throw new ConflictError(`This ${entityLabel} no longer exists. It may have been deleted.`);
    throw new ConflictError(
      `This ${entityLabel} was changed by someone else while you were editing it. Reload to see their changes, then reapply yours.`,
      current.version as number,
    );
  }

  return rows[0] as T;
}
