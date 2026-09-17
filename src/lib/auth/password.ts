import bcrypt from 'bcryptjs';

/**
 * Split out from `src/auth.ts` deliberately: that module calls `NextAuth(...)`
 * at import time, which pulls in `next-auth` -> `next/server` - unresolvable
 * outside Next's own build (any test or script that imports it fails to load).
 * These are pure bcrypt wrappers with no such dependency, so anything that only
 * needs to hash or verify a password (the user-admin service, a seed script)
 * can import this file instead of dragging in the whole auth stack.
 */

/**
 * Cost 12 is the practical sweet spot: ~250ms per hash on modern hardware, which
 * is a meaningful brute-force cost while staying invisible on a login form.
 */
export const BCRYPT_COST = 12;

export const hashPassword = (plain: string) => bcrypt.hash(plain, BCRYPT_COST);
export const verifyPassword = (plain: string, hash: string) => bcrypt.compare(plain, hash);
