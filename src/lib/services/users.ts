import '@/lib/server-guard';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { users } from '@/db/schema';
import type { Actor } from '@/lib/auth/guards';
import { hashPassword } from '@/lib/auth/password';
import { NotFoundError, ValidationError } from '@/lib/errors';
import { diffFields, recordAudit } from './audit';

/**
 * Account administration. Users are never hard-deleted: disabling blocks sign-in
 * and archiving removes the row from the active list, both while keeping the
 * person's name on every note and audit entry they authored.
 *
 * `users` carries no `version` column, so these writes are plain updates rather
 * than optimistic-concurrency ones — the fields here are single-value toggles
 * where a last-writer-wins outcome is the same as the one a conflict prompt
 * would produce.
 */

/** Shape returned to clients. The password hash is never selected. */
const publicColumns = {
  id: users.id,
  name: users.name,
  email: users.email,
  role: users.role,
  isActive: users.isActive,
  archivedAt: users.archivedAt,
  lastLoginAt: users.lastLoginAt,
};

export type PublicUser = {
  id: string; name: string; email: string; role: 'admin' | 'member';
  isActive: boolean; archivedAt: Date | null; lastLoginAt: Date | null;
};

async function loadUser(id: string) {
  const [row] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  if (!row) throw new NotFoundError('User');
  return row;
}

/**
 * An admin locking themselves out is unrecoverable from inside the app — there
 * may be no other admin left to undo it. Every self-targeting change that could
 * cause that is refused here, not only in the UI.
 */
function refuseSelfLockout(id: string, actor: Actor, what: string) {
  if (id === actor.id) {
    throw new ValidationError(`You cannot ${what} your own account. Ask another administrator.`);
  }
}

export async function updateUser(
  id: string,
  patch: { name?: string; role?: 'admin' | 'member'; isActive?: boolean },
  actor: Actor,
): Promise<PublicUser> {
  const before = await loadUser(id);

  if (patch.role !== undefined && patch.role !== before.role && before.role === 'admin') {
    refuseSelfLockout(id, actor, 'change the role of');
  }
  if (patch.isActive === false) refuseSelfLockout(id, actor, 'disable');

  const values: Record<string, unknown> = {};
  if (patch.name !== undefined) values.name = patch.name;
  if (patch.role !== undefined) values.role = patch.role;
  if (patch.isActive !== undefined) values.isActive = patch.isActive;

  const changes = diffFields(before as unknown as Record<string, unknown>, values);
  if (Object.keys(changes).length === 0) return toPublic(before);

  const [row] = await db
    .update(users)
    .set({ ...values, updatedAt: new Date() })
    .where(eq(users.id, id))
    .returning(publicColumns);

  await recordAudit({
    entityType: 'user',
    entityId: id,
    action: 'update',
    summary: summarise(before.email, changes),
    changes,
    actor,
  });

  return row as PublicUser;
}

function summarise(email: string, changes: Record<string, { from: unknown; to: unknown }>) {
  if ('isActive' in changes) {
    return `${changes.isActive!.to ? 'Re-enabled' : 'Disabled'} sign-in for ${email}`;
  }
  if ('role' in changes) return `Changed ${email} to ${String(changes.role!.to)}`;
  return `Updated ${email}`;
}

/** Soft-remove from the active list. Reversible via `restoreUser`. */
export async function archiveUser(id: string, actor: Actor): Promise<PublicUser> {
  refuseSelfLockout(id, actor, 'archive');
  const before = await loadUser(id);
  if (before.archivedAt) return toPublic(before);

  const [row] = await db
    .update(users)
    .set({ archivedAt: new Date(), isActive: false, updatedAt: new Date() })
    .where(eq(users.id, id))
    .returning(publicColumns);

  await recordAudit({
    entityType: 'user', entityId: id, action: 'archive',
    summary: `Archived ${before.email}`, actor,
  });

  return row as PublicUser;
}

export async function restoreUser(id: string, actor: Actor): Promise<PublicUser> {
  const before = await loadUser(id);

  // Restoring returns the row to the list but leaves sign-in disabled: an admin
  // re-enables it deliberately, so a restore never silently hands back access.
  const [row] = await db
    .update(users)
    .set({ archivedAt: null, updatedAt: new Date() })
    .where(eq(users.id, id))
    .returning(publicColumns);

  await recordAudit({
    entityType: 'user', entityId: id, action: 'restore',
    summary: `Restored ${before.email}`, actor,
  });

  return row as PublicUser;
}

/** Admin-set password. The hash is written but never returned or logged. */
export async function resetUserPassword(
  id: string,
  newPassword: string,
  actor: Actor,
): Promise<PublicUser> {
  const before = await loadUser(id);

  const [row] = await db
    .update(users)
    .set({ passwordHash: await hashPassword(newPassword), updatedAt: new Date() })
    .where(eq(users.id, id))
    .returning(publicColumns);

  await recordAudit({
    entityType: 'user', entityId: id, action: 'update',
    summary: `Reset the password for ${before.email}`, actor,
  });

  return row as PublicUser;
}

function toPublic(row: typeof users.$inferSelect): PublicUser {
  return {
    id: row.id, name: row.name, email: row.email, role: row.role,
    isActive: row.isActive, archivedAt: row.archivedAt, lastLoginAt: row.lastLoginAt,
  };
}
