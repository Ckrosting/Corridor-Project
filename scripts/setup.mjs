#!/usr/bin/env node
/**
 * One-shot local setup: check prerequisites, create .env, start PostgreSQL,
 * apply migrations, seed, and print what to do next.
 *
 * Safe to re-run. It never overwrites an existing .env and never destroys data.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import process from 'node:process';

const NODE_MIN = 20;

function step(n, total, message) {
  console.log(`\n[${n}/${total}] ${message}`);
}

function run(command, args, opts = {}) {
  const r = spawnSync(command, args, { stdio: 'inherit', ...opts });
  if (r.error) console.error(`  (${command} failed to launch: ${r.error.message})`);
  return r.status === 0;
}

/**
 * Runs a TypeScript script through tsx.
 *
 * Invokes tsx's JavaScript entry point with the current Node binary rather than
 * going through `npx`. On Windows those are `.cmd` shims, and Node 24 refuses to
 * spawn a `.cmd` without `shell: true` (EINVAL) — while `shell: true` with an
 * argument array raises a deprecation warning. This avoids both.
 */
function runTs(scriptPath, args = []) {
  return run(process.execPath, ['node_modules/tsx/dist/cli.mjs', scriptPath, ...args]);
}

/** npm itself is only needed for the install-script approval path. */
function runNpm(args) {
  return run('npm', args, { shell: process.platform === 'win32' });
}

function fail(message) {
  console.error(`\nSetup stopped: ${message}\n`);
  process.exit(1);
}

const TOTAL = 5;

/* ---------------------------------------------------------- 1. Prerequisites */

step(1, TOTAL, 'Checking prerequisites');

const major = Number(process.versions.node.split('.')[0]);
if (major < NODE_MIN) {
  fail(`Node ${NODE_MIN}+ is required; this is ${process.versions.node}.`);
}
console.log(`  Node ${process.versions.node} — OK`);

if (!existsSync('node_modules')) {
  fail('Dependencies are not installed. Run `npm install` first.');
}
console.log('  Dependencies installed — OK');

// The embedded PostgreSQL binaries arrive through an npm install script, which
// npm 11 gates behind an approval. Detect the common failure early and explain it.
const platformPkg = {
  'win32-x64': '@embedded-postgres/windows-x64',
  'darwin-arm64': '@embedded-postgres/darwin-arm64',
  'darwin-x64': '@embedded-postgres/darwin-x64',
  'linux-x64': '@embedded-postgres/linux-x64',
  'linux-arm64': '@embedded-postgres/linux-arm64',
}[`${process.platform}-${process.arch}`];

if (platformPkg && !existsSync(`node_modules/${platformPkg}/native/bin`)) {
  console.log(`  PostgreSQL binaries missing — approving the install script for ${platformPkg}`);
  runNpm(['approve-scripts', platformPkg]);
  runNpm(['rebuild', platformPkg]);
  if (!existsSync(`node_modules/${platformPkg}/native/bin`)) {
    fail(
      `Could not install the PostgreSQL binaries.\n` +
      `  Try:  npm approve-scripts ${platformPkg} && npm rebuild ${platformPkg}\n` +
      '  Or point DATABASE_URL at an external PostgreSQL 16+ server and skip `npm run db:up`.',
    );
  }
}
console.log('  PostgreSQL binaries — OK');

/* ------------------------------------------------------------------ 2. .env */

step(2, TOTAL, 'Preparing .env');

if (existsSync('.env')) {
  console.log('  .env already exists — left untouched');
  const env = readFileSync('.env', 'utf8');
  if (!/^AUTH_SECRET=.+$/m.test(env)) {
    console.log('  WARNING: AUTH_SECRET is empty. Generate one with:');
    console.log('    node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"');
  }
} else {
  if (!existsSync('.env.example')) fail('.env.example is missing.');
  const secret = randomBytes(32).toString('base64');
  const env = readFileSync('.env.example', 'utf8')
    .replace(/^AUTH_SECRET=$/m, `AUTH_SECRET=${secret}`)
    .replace(/^DEV_AUTH_BYPASS=false$/m, 'DEV_AUTH_BYPASS=true');
  writeFileSync('.env', env);
  console.log('  Created .env with a generated AUTH_SECRET');
  console.log('  Development sign-in shortcut enabled (never active in production builds)');
}

/* -------------------------------------------------------------- 3. Database */

step(3, TOTAL, 'Starting PostgreSQL');
if (!run('node', ['scripts/pg-local.mjs', 'start'])) {
  fail('PostgreSQL would not start. See the log path printed above.');
}

/* ------------------------------------------------------------ 4. Migrations */

step(4, TOTAL, 'Applying migrations');
if (!runTs('scripts/migrate.ts')) fail('Migrations failed.');

/* ------------------------------------------------------------------ 5. Seed */

step(5, TOTAL, 'Seeding baseline configuration and sample data');
if (!runTs('scripts/seed.ts', ['--demo'])) fail('Seeding failed.');

/* ------------------------------------------------------------------- Done */

console.log(`
──────────────────────────────────────────────────────────────
  Setup complete.

  Start the app:      npm run dev
  Start the worker:   npm run worker      (separate terminal)

  Then open:          http://localhost:3000

  Sample records are prefixed "SAMPLE" and can be hidden or
  removed from Settings once you load real data.

  Discovery scans need ANTHROPIC_API_KEY in .env. Everything
  else works without it.
──────────────────────────────────────────────────────────────
`);
