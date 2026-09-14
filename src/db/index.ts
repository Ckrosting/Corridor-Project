import '@/lib/server-guard';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

/**
 * A single pooled connection shared across the app. In development Next.js
 * re-evaluates modules on every hot reload, so the client is cached on
 * globalThis to avoid exhausting Postgres connections.
 */
declare global {
  // eslint-disable-next-line no-var
  var __hullCorridorSql: ReturnType<typeof postgres> | undefined;
}

function createClient() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      'DATABASE_URL is not set. Copy .env.example to .env, then run `npm run db:up`.',
    );
  }
  return postgres(url, {
    max: Number(process.env.DATABASE_POOL_MAX ?? 10),
    idle_timeout: 20,
    connect_timeout: 15,
    // Railway's Postgres presents a certificate that will not validate against
    // the public CA set; TLS is still used, just without CA verification.
    ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
    onnotice: () => {},
  });
}

export const sql = globalThis.__hullCorridorSql ?? createClient();
if (process.env.NODE_ENV !== 'production') globalThis.__hullCorridorSql = sql;

export const db = drizzle(sql, { schema });
export { schema };
export type Database = typeof db;
