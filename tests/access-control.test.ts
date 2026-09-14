import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { users } from '@/db/schema';
import { cleanupTestData, ensureBaseline, TEST_PREFIX } from './helpers';

/**
 * Authorization is enforced server-side in route handlers and services, never in
 * middleware. These tests exercise the guards directly with a mocked session, so
 * they verify the actual decision function rather than a URL pattern.
 */

// `auth()` is the only thing mocked; everything downstream is real.
const session = vi.hoisted(() => ({ current: null as null | { user: { id: string; name: string; email: string; role: 'admin' | 'member' } } }));

vi.mock('@/auth', () => ({
  auth: async () => session.current,
}));

beforeAll(async () => {
  await ensureBaseline();
  await cleanupTestData();
});

afterAll(async () => {
  await cleanupTestData();
});

async function makeUser(role: 'admin' | 'member') {
  const email = `${TEST_PREFIX.toLowerCase()}-${role}@example.invalid`;
  await db.delete(users).where(eq(users.email, email));
  const [user] = await db.insert(users).values({
    email, name: `${TEST_PREFIX} ${role}`, role, passwordHash: null,
  }).returning();
  return user!;
}

describe('authentication guards', () => {
  it('rejects an unauthenticated caller', async () => {
    const { getActor, requireUser, AuthError } = await import('@/lib/auth/guards');
    session.current = null;

    expect(await getActor()).toBeNull();
    await expect(requireUser()).rejects.toThrow(AuthError);
    await expect(requireUser()).rejects.toMatchObject({ status: 401 });
  });

  it('accepts an authenticated member', async () => {
    const { requireUser } = await import('@/lib/auth/guards');
    const user = await makeUser('member');
    session.current = { user: { id: user.id, name: user.name, email: user.email, role: 'member' } };

    const actor = await requireUser();
    expect(actor.id).toBe(user.id);
    expect(actor.role).toBe('member');
    // The label is denormalised onto audit/activity rows so history survives
    // the user being removed.
    expect(actor.label).toContain(user.email);
  });
});

describe('role separation', () => {
  it('refuses admin-only work to a member, with a 403 rather than a 401', async () => {
    const { requireAdmin, AuthError } = await import('@/lib/auth/guards');
    const member = await makeUser('member');
    session.current = { user: { id: member.id, name: member.name, email: member.email, role: 'member' } };

    await expect(requireAdmin()).rejects.toThrow(AuthError);
    // 403, not 401: the caller IS authenticated, just not permitted.
    await expect(requireAdmin()).rejects.toMatchObject({ status: 403 });
  });

  it('allows admin-only work to an admin', async () => {
    const { requireAdmin } = await import('@/lib/auth/guards');
    const admin = await makeUser('admin');
    session.current = { user: { id: admin.id, name: admin.name, email: admin.email, role: 'admin' } };

    const actor = await requireAdmin();
    expect(actor.role).toBe('admin');
  });

  it('treats a member as the default when no role is present on the session', async () => {
    const { getActor } = await import('@/lib/auth/guards');
    const user = await makeUser('member');
    // A token missing its role must not be treated as an admin.
    session.current = { user: { id: user.id, name: user.name, email: user.email, role: undefined as never } };

    const actor = await getActor();
    expect(actor?.role).toBe('member');
  });
});

describe('development sign-in shortcut', () => {
  it('is computed from NODE_ENV, so no variable can enable it in production', async () => {
    // The guarantee is structural: env.devAuthBypass is `!isProd && bool(...)`,
    // so a production build cannot switch it on however the environment is set.
    const source = await import('node:fs').then((fs) =>
      fs.readFileSync('src/lib/env.ts', 'utf8'));

    expect(source).toMatch(/devAuthBypass:\s*!isProd\s*&&/);

    // And the provider itself is only added to the list when that flag is true.
    const authSource = await import('node:fs').then((fs) =>
      fs.readFileSync('src/auth.ts', 'utf8'));
    expect(authSource).toMatch(/env\.devAuthBypass\s*$/m);
    expect(authSource).toContain("if (env.isProd) return null");
  });
});
