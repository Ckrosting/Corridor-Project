import NextAuth, { type DefaultSession } from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import { eq, sql as raw } from 'drizzle-orm';
import bcrypt from 'bcryptjs';
import { db } from '@/db';
import { users } from '@/db/schema';
import { env } from '@/lib/env';

declare module 'next-auth' {
  interface Session {
    user: { id: string; role: 'admin' | 'member' } & DefaultSession['user'];
  }
}

export type AppRole = 'admin' | 'member';

/**
 * Cost 12 is the practical sweet spot: ~250ms per hash on modern hardware, which
 * is a meaningful brute-force cost while staying invisible on a login form.
 */
export const BCRYPT_COST = 12;

export const hashPassword = (plain: string) => bcrypt.hash(plain, BCRYPT_COST);
export const verifyPassword = (plain: string, hash: string) => bcrypt.compare(plain, hash);

/** Looks a user up case-insensitively and rejects inactive or archived accounts. */
async function findLoginableUser(email: string) {
  const [row] = await db
    .select()
    .from(users)
    .where(raw`lower(${users.email}) = lower(${email})`)
    .limit(1);
  if (!row || !row.isActive || row.archivedAt) return null;
  return row;
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  secret: env.authSecret,
  // Required because Railway terminates TLS at its proxy.
  trustHost: true,
  session: { strategy: 'jwt', maxAge: 60 * 60 * 12 },
  pages: { signIn: '/signin' },

  providers: [
    Credentials({
      id: 'credentials',
      name: 'Email and password',
      credentials: { email: {}, password: {} },
      async authorize(raw) {
        const email = typeof raw?.email === 'string' ? raw.email.trim() : '';
        const password = typeof raw?.password === 'string' ? raw.password : '';
        if (!email || !password) return null;

        const user = await findLoginableUser(email);

        // Always spend the hashing time, even when the account does not exist, so
        // response timing does not reveal which emails are registered.
        const hash = user?.passwordHash ?? '$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidi';
        const ok = await verifyPassword(password, hash);
        if (!user || !ok) return null;

        await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));
        return { id: user.id, email: user.email, name: user.name, role: user.role };
      },
    }),

    /**
     * DEVELOPMENT ONLY one-click sign-in.
     *
     * This provider is not merely hidden in production — it is absent from the
     * provider list entirely, because `env.devAuthBypass` is computed as
     * `!isProd && ...`. There is no environment variable that can switch it on in
     * a production build.
     */
    ...(env.devAuthBypass
      ? [
          Credentials({
            id: 'dev-bypass',
            name: 'Development sign-in',
            credentials: {},
            async authorize() {
              if (env.isProd) return null; // belt and braces
              const user = await findLoginableUser(env.devAuthEmail);
              if (!user) return null;
              await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));
              return { id: user.id, email: user.email, name: user.name, role: user.role };
            },
          }),
        ]
      : []),
  ],

  callbacks: {
    async jwt({ token, user, trigger }) {
      if (user) {
        token.uid = user.id;
        token.role = (user as { role?: AppRole }).role ?? 'member';
      }
      // Re-read the role on session refresh so a demotion takes effect without
      // waiting for the token to expire.
      if (trigger === 'update' && token.uid) {
        const [row] = await db.select({ role: users.role, isActive: users.isActive })
          .from(users).where(eq(users.id, token.uid as string)).limit(1);
        if (!row || !row.isActive) return null;
        token.role = row.role;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.uid as string;
        session.user.role = (token.role as AppRole) ?? 'member';
      }
      return session;
    },
  },
});
