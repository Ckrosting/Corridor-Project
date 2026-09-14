#!/usr/bin/env node
/**
 * Local PostgreSQL control for Hull Corridor.
 *
 * Runs a real PostgreSQL server from the `@embedded-postgres/*` binaries that npm
 * installed into node_modules. No Docker, no system install, no admin rights.
 *
 * The data directory intentionally lives OUTSIDE the project folder. This project
 * sits in a OneDrive-synced path, and OneDrive will happily try to sync (and lock,
 * and corrupt) a running PostgreSQL data directory. Override with PGLOCAL_DIR.
 *
 * Usage: node scripts/pg-local.mjs <start|stop|status|nuke>
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

const PORT = Number(process.env.PGLOCAL_PORT || 5433);
const USER = process.env.PGLOCAL_USER || 'hullcorridor';
const PASSWORD = process.env.PGLOCAL_PASSWORD || 'hullcorridor_local';
const DB = process.env.PGLOCAL_DB || 'hull_corridor';

const BASE =
  process.env.PGLOCAL_DIR ||
  path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), '.local', 'share'), 'hull-corridor');
const DATA_DIR = path.join(BASE, 'pgdata');
const LOG_FILE = path.join(BASE, 'postgres.log');

const PLATFORM_PKG = {
  'win32-x64': '@embedded-postgres/windows-x64',
  'darwin-arm64': '@embedded-postgres/darwin-arm64',
  'darwin-x64': '@embedded-postgres/darwin-x64',
  'linux-x64': '@embedded-postgres/linux-x64',
  'linux-arm64': '@embedded-postgres/linux-arm64',
}[`${process.platform}-${process.arch}`];

function binDir() {
  if (!PLATFORM_PKG) {
    fail(`No embedded PostgreSQL binaries for ${process.platform}-${process.arch}.
Set DATABASE_URL to an external PostgreSQL 16+ server instead and skip "npm run db:up".`);
  }
  const dir = path.join(process.cwd(), 'node_modules', PLATFORM_PKG, 'native', 'bin');
  if (!existsSync(dir)) {
    fail(`PostgreSQL binaries not found at ${dir}
Run:  npm install
      npm approve-scripts ${PLATFORM_PKG}
      npm rebuild ${PLATFORM_PKG}`);
  }
  return dir;
}

const exe = (name) => path.join(binDir(), process.platform === 'win32' ? `${name}.exe` : name);

function fail(msg) {
  console.error(`\n[db] ERROR: ${msg}\n`);
  process.exit(1);
}

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: 'inherit', ...opts });
  if (r.error) fail(`${path.basename(cmd)} failed to launch: ${r.error.message}`);
  return r.status ?? 1;
}

/**
 * `pg_ctl start` launches a postmaster that outlives this process. On Windows the
 * postmaster inherits our stdout/stderr handles, which keeps the parent shell's pipe
 * open forever and makes `npm run db:up` appear to hang. The server's own output goes
 * to the -l logfile, so discard the handles here.
 */
function runDetached(cmd, args) {
  return run(cmd, args, { stdio: 'ignore', windowsHide: true });
}

/** pg_ctl status: 0 = running, 3 = stopped, 4 = no/invalid data dir */
function ctlStatus() {
  if (!existsSync(path.join(DATA_DIR, 'PG_VERSION'))) return 4;
  const r = spawnSync(exe('pg_ctl'), ['status', '-D', DATA_DIR], { stdio: 'pipe' });
  return r.status ?? 4;
}

function initialise() {
  mkdirSync(BASE, { recursive: true });
  const pwFile = path.join(BASE, '.initpw');
  writeFileSync(pwFile, PASSWORD, { mode: 0o600 });
  console.log(`[db] Initialising a new PostgreSQL cluster at ${DATA_DIR}`);
  const code = run(exe('initdb'), [
    '-D', DATA_DIR,
    '-U', USER,
    '--pwfile', pwFile,
    '--auth-host=scram-sha-256',
    '--auth-local=trust',
    '--encoding=UTF8',
    '--locale=C',
  ]);
  rmSync(pwFile, { force: true });
  if (code !== 0) fail('initdb failed. See output above.');
}

async function ensureDatabase() {
  const { default: postgres } = await import('postgres');
  const admin = postgres({
    host: '127.0.0.1', port: PORT, username: USER, password: PASSWORD,
    database: 'postgres', max: 1, onnotice: () => {},
  });
  try {
    const rows = await admin`SELECT 1 FROM pg_database WHERE datname = ${DB}`;
    if (rows.length === 0) {
      await admin.unsafe(`CREATE DATABASE "${DB}"`);
      console.log(`[db] Created database "${DB}"`);
    }
  } finally {
    await admin.end({ timeout: 5 });
  }
}

async function waitReady(timeoutMs = 30_000) {
  const { default: postgres } = await import('postgres');
  const deadline = Date.now() + timeoutMs;
  let lastErr;
  while (Date.now() < deadline) {
    const sql = postgres({
      host: '127.0.0.1', port: PORT, username: USER, password: PASSWORD,
      database: 'postgres', max: 1, connect_timeout: 3, onnotice: () => {},
    });
    try {
      await sql`SELECT 1`;
      await sql.end({ timeout: 5 });
      return;
    } catch (err) {
      lastErr = err;
      await sql.end({ timeout: 1 }).catch(() => {});
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  const log = existsSync(LOG_FILE) ? readFileSync(LOG_FILE, 'utf8').split('\n').slice(-25).join('\n') : '(no log)';
  fail(`PostgreSQL did not become ready in ${timeoutMs / 1000}s.\nLast error: ${lastErr?.message}\n\nTail of ${LOG_FILE}:\n${log}`);
}

const connectionString = () =>
  `postgresql://${USER}:${encodeURIComponent(PASSWORD)}@127.0.0.1:${PORT}/${DB}`;

async function start() {
  const status = ctlStatus();
  if (status === 0) {
    console.log(`[db] Already running on port ${PORT}`);
  } else {
    if (status === 4) initialise();
    mkdirSync(BASE, { recursive: true });
    console.log(`[db] Starting PostgreSQL on 127.0.0.1:${PORT} (log: ${LOG_FILE})`);
    const code = runDetached(exe('pg_ctl'), [
      'start', '-D', DATA_DIR, '-l', LOG_FILE, '-w', '-t', '30',
      '-o', `-p ${PORT} -h 127.0.0.1`,
    ]);
    if (code !== 0) {
      const log = existsSync(LOG_FILE) ? readFileSync(LOG_FILE, 'utf8').split('\n').slice(-25).join('\n') : '(no log)';
      fail(`pg_ctl start failed.\n\nTail of ${LOG_FILE}:\n${log}`);
    }
  }
  await waitReady();
  await ensureDatabase();
  console.log(`\n[db] Ready.\n[db] DATABASE_URL=${connectionString()}\n`);
}

function stop() {
  if (ctlStatus() !== 0) return console.log('[db] Not running.');
  run(exe('pg_ctl'), ['stop', '-D', DATA_DIR, '-m', 'fast', '-w']);
  console.log('[db] Stopped.');
}

function status() {
  const s = ctlStatus();
  const label = { 0: 'running', 3: 'stopped', 4: 'not initialised' }[s] ?? `unknown (${s})`;
  console.log(`[db] ${label}  dir=${DATA_DIR}  port=${PORT}`);
  if (s === 0) console.log(`[db] DATABASE_URL=${connectionString()}`);
  process.exit(s === 0 ? 0 : 1);
}

function nuke() {
  if (process.env.CONFIRM_NUKE !== 'yes') {
    fail(`Refusing to delete the local database.
This permanently destroys ALL local data at ${DATA_DIR}.
Re-run with:  CONFIRM_NUKE=yes npm run db:nuke`);
  }
  if (ctlStatus() === 0) stop();
  rmSync(DATA_DIR, { recursive: true, force: true });
  console.log(`[db] Deleted ${DATA_DIR}`);
}

const cmd = process.argv[2];
const actions = { start, stop, status, nuke };
if (!actions[cmd]) {
  console.error('Usage: node scripts/pg-local.mjs <start|stop|status|nuke>');
  process.exit(1);
}
await actions[cmd]();
