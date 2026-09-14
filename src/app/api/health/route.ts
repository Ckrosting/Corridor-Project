import { NextResponse } from 'next/server';
import { sql } from '@/db';
import { env } from '@/lib/env';

/**
 * Health endpoint for Railway (and any uptime check).
 *
 * Reports database reachability and whether optional integrations are
 * configured. It deliberately never reveals secret VALUES, only whether each is
 * present, so it is safe to expose without authentication.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const startedAt = Date.now();
  let database: 'ok' | 'unreachable' = 'unreachable';
  let databaseError: string | undefined;

  try {
    await sql`select 1`;
    database = 'ok';
  } catch (err) {
    databaseError = err instanceof Error ? err.message : 'unknown error';
    console.error('[health] database check failed:', err);
  }

  const body = {
    status: database === 'ok' ? 'ok' : 'degraded',
    version: process.env.npm_package_version ?? '0.1.0',
    environment: env.nodeEnv,
    uptimeSeconds: Math.round(process.uptime()),
    checks: {
      database,
      // Presence flags only - never the values themselves.
      aiConfigured: Boolean(env.ai.apiKey),
      storageDriver: env.storage.driver,
      authSecretConfigured: Boolean(env.authSecret),
    },
    latencyMs: Date.now() - startedAt,
    ...(databaseError && env.isDev ? { databaseError } : {}),
  };

  return NextResponse.json(body, { status: database === 'ok' ? 200 : 503 });
}
