import '@/lib/server-guard';

/**
 * Typed, validated access to environment configuration.
 *
 * Rules enforced here:
 *  - Secrets (ANTHROPIC_API_KEY, S3 credentials, AUTH_SECRET) are read ONLY in
 *    this module and only on the server. Nothing exported from here that contains
 *    a secret is ever returned to a client component or an API response.
 *  - Missing optional configuration degrades gracefully with an explanation,
 *    rather than crashing. The app must stay fully usable with no AI key and no
 *    map provider keys.
 *  - Development-only shortcuts are hard-disabled when NODE_ENV=production,
 *    regardless of what the environment says.
 */

const isProd = process.env.NODE_ENV === 'production';

function str(name: string, fallback = ''): string {
  return (process.env[name] ?? fallback).trim();
}

function num(name: string, fallback: number): number {
  const raw = str(name);
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function bool(name: string, fallback = false): boolean {
  const raw = str(name).toLowerCase();
  if (!raw) return fallback;
  return raw === 'true' || raw === '1' || raw === 'yes';
}

/* -------------------------------------------------------------------------- */
/* Required                                                                   */
/* -------------------------------------------------------------------------- */

export const env = {
  isProd,
  isDev: !isProd,
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: num('PORT', 3000),

  databaseUrl: str('DATABASE_URL'),
  databaseSsl: bool('DATABASE_SSL', false),

  authSecret: str('AUTH_SECRET'),
  authUrl: str('AUTH_URL', 'http://localhost:3000'),

  /**
   * Development sign-in shortcut. Forced off in production no matter what the
   * environment variable says — this is the "explicitly limited to development"
   * requirement, enforced in code rather than by convention.
   */
  devAuthBypass: !isProd && bool('DEV_AUTH_BYPASS', false),
  devAuthEmail: str('DEV_AUTH_EMAIL', 'dev@localhost'),

  storage: {
    driver: (str('STORAGE_DRIVER', 'local') === 's3' ? 's3' : 'local') as 'local' | 's3',
    localDir: str('STORAGE_LOCAL_DIR', './storage/uploads'),
    bucket: str('S3_BUCKET'),
    region: str('S3_REGION', 'auto'),
    endpoint: str('S3_ENDPOINT'),
    accessKeyId: str('S3_ACCESS_KEY_ID'),
    secretAccessKey: str('S3_SECRET_ACCESS_KEY'),
    forcePathStyle: bool('S3_FORCE_PATH_STYLE', true),
    maxUploadBytes: num('UPLOAD_MAX_MB', 25) * 1024 * 1024,
  },

  ai: {
    apiKey: str('ANTHROPIC_API_KEY'),
    model: str('ANTHROPIC_MODEL', 'claude-sonnet-5'),
    maxWebSearchesPerScan: num('AI_MAX_WEB_SEARCHES_PER_SCAN', 12),
    maxOutputTokens: num('AI_MAX_OUTPUT_TOKENS', 8000),
    monthlyBudgetUsd: num('AI_MONTHLY_BUDGET_USD', 25),
  },

  worker: {
    concurrency: Math.max(1, num('WORKER_CONCURRENCY', 2)),
    heartbeatTimeoutSeconds: num('WORKER_HEARTBEAT_TIMEOUT_SECONDS', 900),
    pollIntervalMs: num('WORKER_POLL_INTERVAL_MS', 3000),
  },

  geocoder: {
    provider: str('GEOCODER_PROVIDER', 'nominatim'),
    apiKey: str('GEOCODER_API_KEY'),
    nominatimContact: str('NOMINATIM_CONTACT_EMAIL'),
  },
} as const;

/* -------------------------------------------------------------------------- */
/* Startup validation                                                         */
/* -------------------------------------------------------------------------- */

export interface EnvProblem {
  key: string;
  severity: 'error' | 'warning';
  message: string;
}

/** Checks configuration without ever including a secret in the output. */
export function checkEnv(): EnvProblem[] {
  const problems: EnvProblem[] = [];

  if (!env.databaseUrl) {
    problems.push({ key: 'DATABASE_URL', severity: 'error', message: 'Not set. Copy .env.example to .env and run `npm run db:up`.' });
  }

  if (!env.authSecret) {
    problems.push({
      key: 'AUTH_SECRET',
      severity: isProd ? 'error' : 'warning',
      message: 'Not set. Generate with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"',
    });
  } else if (env.authSecret.length < 32) {
    problems.push({ key: 'AUTH_SECRET', severity: 'error', message: 'Too short; use at least 32 bytes of randomness.' });
  }

  if (isProd && env.storage.driver === 'local') {
    problems.push({
      key: 'STORAGE_DRIVER',
      severity: 'error',
      message: 'Local disk storage cannot be used in production — Railway\'s application filesystem is ephemeral and uploads would be lost on every redeploy. Set STORAGE_DRIVER=s3.',
    });
  }

  if (env.storage.driver === 's3') {
    for (const [key, value] of [
      ['S3_BUCKET', env.storage.bucket],
      ['S3_ACCESS_KEY_ID', env.storage.accessKeyId],
      ['S3_SECRET_ACCESS_KEY', env.storage.secretAccessKey],
    ] as const) {
      if (!value) problems.push({ key, severity: 'error', message: 'Required when STORAGE_DRIVER=s3.' });
    }
  }

  if (isProd && env.devAuthBypass) {
    // Unreachable by construction; kept as a tripwire in case the guard is ever weakened.
    problems.push({ key: 'DEV_AUTH_BYPASS', severity: 'error', message: 'Development sign-in shortcut must never be enabled in production.' });
  }

  if (!env.ai.apiKey) {
    problems.push({ key: 'ANTHROPIC_API_KEY', severity: 'warning', message: 'Not set. Discovery scans are disabled; every other feature works normally.' });
  }

  if (env.geocoder.provider === 'nominatim' && !env.geocoder.nominatimContact) {
    problems.push({ key: 'NOMINATIM_CONTACT_EMAIL', severity: 'warning', message: 'Nominatim\'s usage policy asks for a contact address in the User-Agent. Address search still works but please set this.' });
  }

  if (env.geocoder.provider !== 'nominatim' && !env.geocoder.apiKey) {
    problems.push({ key: 'GEOCODER_API_KEY', severity: 'warning', message: `Provider "${env.geocoder.provider}" needs an API key. Address search will fall back to manual map placement.` });
  }

  return problems;
}

/**
 * Safe-to-display configuration status. Reports whether each secret is PRESENT,
 * never its value. Used by the Settings screen.
 */
export function configStatus() {
  return {
    nodeEnv: env.nodeEnv,
    database: { configured: Boolean(env.databaseUrl), ssl: env.databaseSsl },
    auth: { secretConfigured: Boolean(env.authSecret), devBypassActive: env.devAuthBypass },
    storage: {
      driver: env.storage.driver,
      configured: env.storage.driver === 'local' || Boolean(env.storage.bucket && env.storage.accessKeyId),
      bucket: env.storage.driver === 's3' ? env.storage.bucket : env.storage.localDir,
      maxUploadMb: Math.round(env.storage.maxUploadBytes / 1024 / 1024),
    },
    ai: {
      // Presence only. The key itself never leaves the server.
      apiKeyConfigured: Boolean(env.ai.apiKey),
      model: env.ai.model,
      monthlyBudgetUsd: env.ai.monthlyBudgetUsd,
      maxWebSearchesPerScan: env.ai.maxWebSearchesPerScan,
    },
    geocoder: {
      provider: env.geocoder.provider,
      apiKeyConfigured: env.geocoder.provider === 'nominatim' ? true : Boolean(env.geocoder.apiKey),
    },
    problems: checkEnv(),
  };
}

export type ConfigStatus = ReturnType<typeof configStatus>;
