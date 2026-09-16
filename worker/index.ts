/**
 * Background worker.
 *
 * Runs as a SEPARATE process from the web app, which is the point: a discovery
 * scan can take many minutes and must be unaffected by HTTP request timeouts,
 * serverless execution limits, or a user closing their browser tab.
 *
 *   Local:   npm run worker
 *   Railway: a second service on the same repo with start command `npm run worker:start`
 *
 * Multiple workers may run at once — jobs are claimed with FOR UPDATE SKIP
 * LOCKED, so they never collide.
 */
import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { sql } from '@/db';
import { env } from '@/lib/env';
import {
  claimNextJob, completeJob, failJob, heartbeat, runningJobCount, type ClaimedJob,
} from '@/lib/services/jobs';
import { runScan } from '@/lib/services/scans';

const WORKER_ID = `${process.env.RAILWAY_REPLICA_ID ?? 'local'}-${randomUUID().slice(0, 8)}`;

let shuttingDown = false;
let activeJobs = 0;

function log(level: 'info' | 'warn' | 'error', message: string, extra?: unknown) {
  const line = `[worker ${WORKER_ID}] ${message}`;
  if (level === 'error') console.error(line, extra ?? '');
  else if (level === 'warn') console.warn(line, extra ?? '');
  else console.log(line, extra ?? '');
}

/** Keeps the job's heartbeat fresh so it is not reclaimed as abandoned. */
function startHeartbeat(jobId: string): NodeJS.Timeout {
  return setInterval(() => {
    heartbeat(jobId).catch((err) => log('warn', `heartbeat failed for job ${jobId}`, err));
  }, 30_000);
}

async function handle(job: ClaimedJob): Promise<void> {
  const beat = startHeartbeat(job.id);
  try {
    switch (job.type) {
      case 'discovery_scan': {
        const scanId = job.payload.scanId as string;
        log('info', `running discovery scan ${scanId} (attempt ${job.attempts}/${job.maxAttempts})`);

        const summary = await runScan(scanId, job.id);

        // 'failed' from runScan means every market failed; surface it as a job
        // failure so the retry policy applies.
        if (summary.status === 'failed') {
          throw new Error(summary.coverageNotes[0] ?? 'Every market in this scan failed.');
        }

        await completeJob(job.id, summary.status === 'cancelled' ? 'cancelled' : summary.status, {
          targetsCompleted: summary.targetsCompleted,
          resultsFound: summary.resultsFound,
          resultsNew: summary.resultsNew,
        });

        log('info', `scan ${scanId} ${summary.status}: ${summary.resultsNew} new of ${summary.resultsFound} found`);
        break;
      }

      default:
        throw new Error(`Unknown job type "${job.type}"`);
    }
  } finally {
    clearInterval(beat);
  }
}

async function tick(): Promise<boolean> {
  // A global ceiling on concurrent scans, so a burst of queued work cannot run
  // up an unbounded API bill in parallel.
  if (activeJobs >= env.worker.concurrency) return false;

  const running = await runningJobCount('discovery_scan');
  if (running >= env.worker.concurrency) return false;

  const job = await claimNextJob(WORKER_ID, env.worker.heartbeatTimeoutSeconds);
  if (!job) return false;

  activeJobs++;
  void handle(job)
    .catch(async (err) => {
      const outcome = await failJob(job, err).catch(() => 'failed');
      log(outcome === 'retrying' ? 'warn' : 'error',
        `job ${job.id} (${job.type}) ${outcome}`,
        err instanceof Error ? err.message : err);
    })
    .finally(() => { activeJobs--; });

  return true;
}

async function main() {
  if (!env.databaseUrl) {
    log('error', 'DATABASE_URL is not set. Copy .env.example to .env and run `npm run db:up`.');
    process.exit(1);
  }

  log('info', `started · concurrency ${env.worker.concurrency} · poll ${env.worker.pollIntervalMs}ms`);
  log('info', env.ai.apiKey
    ? `discovery enabled · model ${env.ai.model}`
    : 'discovery DISABLED (ANTHROPIC_API_KEY not set). The worker will idle; every other feature works.');

  while (!shuttingDown) {
    try {
      // Drain greedily: keep claiming while there is capacity and work.
      let claimed = true;
      while (claimed && !shuttingDown) claimed = await tick();
    } catch (err) {
      log('error', 'poll loop error', err);
    }
    await new Promise((r) => setTimeout(r, env.worker.pollIntervalMs));
  }

  // Let in-flight jobs finish so a deploy does not abandon a running scan.
  const deadline = Date.now() + 60_000;
  while (activeJobs > 0 && Date.now() < deadline) {
    log('info', `waiting for ${activeJobs} in-flight job(s)…`);
    await new Promise((r) => setTimeout(r, 2000));
  }

  await sql.end({ timeout: 5 });
  log('info', 'stopped');
  process.exit(0);
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    if (shuttingDown) process.exit(1); // second signal: exit now
    log('info', `${signal} received, finishing in-flight work…`);
    shuttingDown = true;
  });
}

process.on('unhandledRejection', (err) => log('error', 'unhandled rejection', err));

void main();
