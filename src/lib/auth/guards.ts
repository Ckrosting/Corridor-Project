import 'server-only';
import { redirect } from 'next/navigation';
import { auth, type AppRole } from '@/auth';

export interface Actor {
  id: string;
  name: string;
  email: string;
  role: AppRole;
  /** Human label stored alongside audit/activity rows so history survives user deletion. */
  label: string;
}

/**
 * Authorization is enforced server-side in every route handler and server action,
 * not in middleware. Middleware only sees the request path; these helpers run
 * where the actual data access happens, which is the only place that can be
 * trusted.
 */

export class AuthError extends Error {
  constructor(readonly status: 401 | 403, message: string) {
    super(message);
    this.name = 'AuthError';
  }
}

export async function getActor(): Promise<Actor | null> {
  const session = await auth();
  const u = session?.user;
  if (!u?.id) return null;
  const name = u.name ?? u.email ?? 'Unknown user';
  return {
    id: u.id,
    name,
    email: u.email ?? '',
    role: u.role ?? 'member',
    label: u.email ? `${name} <${u.email}>` : name,
  };
}

/** For API routes and server actions. Throws; callers convert to a response. */
export async function requireUser(): Promise<Actor> {
  const actor = await getActor();
  if (!actor) throw new AuthError(401, 'You must be signed in.');
  return actor;
}

/** Admin-only: user management, settings, imports, destructive bulk actions. */
export async function requireAdmin(): Promise<Actor> {
  const actor = await requireUser();
  if (actor.role !== 'admin') {
    throw new AuthError(403, 'This action requires an administrator account.');
  }
  return actor;
}

/** For pages: sends the browser to sign-in instead of throwing. */
export async function requirePageUser(returnTo?: string): Promise<Actor> {
  const actor = await getActor();
  if (!actor) {
    redirect(returnTo ? `/signin?next=${encodeURIComponent(returnTo)}` : '/signin');
  }
  return actor;
}

export async function requirePageAdmin(returnTo?: string): Promise<Actor> {
  const actor = await requirePageUser(returnTo);
  if (actor.role !== 'admin') redirect('/?error=admin-required');
  return actor;
}
