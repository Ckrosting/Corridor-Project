/**
 * Applies pending SQL migrations. Run locally with `npm run db:migrate`, and in
 * production as the release step (`npm run release`) before the server starts.
 * Safe to run repeatedly - drizzle tracks what has already been applied.
 */
import 'dotenv/config';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('[migrate] DATABASE_URL is not set. Copy .env.example to .env and run `npm run db:up`.');
    process.exit(1);
  }

  // max: 1 - migrations must run serially on a single connection.
  const client = postgres(url, {
    max: 1,
    ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
    onnotice: () => {},
  });

  try {
    const redacted = url.replace(/:\/\/([^:]+):[^@]*@/, '://$1:***@');
    console.log(`[migrate] Applying migrations to ${redacted}`);
    await migrate(drizzle(client), { migrationsFolder: './drizzle' });
    console.log('[migrate] Up to date.');
  } catch (err) {
    console.error('[migrate] FAILED:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  } finally {
    await client.end({ timeout: 10 });
  }
}

void main();
