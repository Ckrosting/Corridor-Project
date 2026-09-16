import '@/lib/server-guard';
import { and, desc, eq, inArray, isNull, lt, or, sql as raw } from 'drizzle-orm';
import { db } from '@/db';
import { jobs, scanTargets, scans } from '@/db/schema';
import type { Actor } from '@/lib/auth/guards';
import { NotFoundError, ValidationError } from '@/lib/errors';

/**
 * Postgres-backed job queue.
 *
 * Workers claim jobs with `FOR UPDATE SKIP LOCKED`, which is the standard safe
 * pattern for concurrent consumers: two workers polling simultaneously cannot
 * claim the same row, and neither blocks the other.
 */

export interface ClaimedJob {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  attempts: number;
  maxAttempts: number;
}

export async function enqueue(input: {
  type: string;
  payload: Record<string, unknown>;
  dedupeKey?: string;
  maxAttempts?: number;
  actor?: Actor;
}): Promise<{ job: typeof jobs.$inferSelect }> {
  try {
    const [job] = await db.insert(jobs).values({
      type: input.type,
      payload: input.payload,
      dedupeKey: input.dedupeKey ?? null,
      maxAttempts: input.maxAttempts ?? 3,
      createdBy: input.actor?.id ?? null,
    }).returning();
    return { job: job! };
  } catch (err) {
    // A partial unique index allows only one queued/running job per dedupe key,
    // so double-clicking "Find New Listings" cannot start two scans.
    if (err instanceof Error && /jobs_dedupe_active_unq/.test(err.message)) {
      throw new ValidationError(
        'That work is already queued or running. Wait for it to finish, or cancel it first.',
      );
    }
    throw err;
  }
}

/**
 * Claims the next runnable job.
 *
 * Also reclaims jobs whose worker died: a running job whose heartbeat is older
 * than the timeout is treated as abandoned and retried, so a crashed worker
 * never leaves work stuck in "running" forever.
 */
export async function claimNextJob(
  workerId: string,
  heartbeatTimeoutSeconds: number,
): Promise<ClaimedJob | null> {
  const rows = await db.execute<{
    id: string; type: string; payload: Record<string, unknown>;
    attempts: number; max_attempts: number;
  }>(raw`
    with claimed as (
      select id from jobs
      where (
        (status = 'queued' and run_at <= now())
        or (
          status = 'running'
          and heartbeat_at is not null
          and heartbeat_at < now() - make_interval(secs => ${heartbeatTimeoutSeconds})
        )
      )
      order by priority desc, run_at asc
      for update skip locked
      limit 1
    )
    update jobs
    set status = 'running',
        locked_at = now(),
        locked_by = ${workerId},
        heartbeat_at = now(),
        started_at = coalesce(started_at, now()),
        attempts = jobs.attempts + 1
    from claimed
    where jobs.id = claimed.id
    returning jobs.id, jobs.type, jobs.payload, jobs.attempts, jobs.max_attempts;
  `);

  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id, type: row.type, payload: row.payload,
    attempts: row.attempts, maxAttempts: row.max_attempts,
  };
}

export async function heartbeat(jobId: string): Promise<void> {
  await db.update(jobs).set({ heartbeatAt: new Date() }).where(eq(jobs.id, jobId));
}

/** Cooperative cancellation: the worker checks this between units of work. */
export async function isCancelRequested(jobId: string): Promise<boolean> {
  const [row] = await db.select({ cancelRequested: jobs.cancelRequested })
    .from(jobs).where(eq(jobs.id, jobId)).limit(1);
  return Boolean(row?.cancelRequested);
}

export async function completeJob(
  jobId: string,
  status: 'completed' | 'partial' | 'cancelled',
  result: Record<string, unknown>,
): Promise<void> {
  await db.update(jobs)
    .set({ status, result, finishedAt: new Date(), lastError: null })
    .where(eq(jobs.id, jobId));
}

/**
 * Marks a job failed. Retries with exponential backoff until maxAttempts, then
 * gives up and records the error so it is visible rather than silently lost.
 */
export async function failJob(job: ClaimedJob, error: unknown): Promise<'retrying' | 'failed'> {
  const message = error instanceof Error ? error.message : String(error);
  const exhausted = job.attempts >= job.maxAttempts;

  if (exhausted) {
    await db.update(jobs)
      .set({ status: 'failed', lastError: message, finishedAt: new Date() })
      .where(eq(jobs.id, job.id));
    return 'failed';
  }

  const backoffSeconds = Math.min(600, 30 * 2 ** (job.attempts - 1));
  await db.update(jobs).set({
    status: 'queued',
    lastError: message,
    runAt: raw`now() + make_interval(secs => ${backoffSeconds})`,
    lockedAt: null,
    lockedBy: null,
    heartbeatAt: null,
  }).where(eq(jobs.id, job.id));

  return 'retrying';
}

export async function requestCancel(jobId: string, actor: Actor): Promise<void> {
  const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
  if (!job) throw new NotFoundError('Job');
  if (job.status !== 'queued' && job.status !== 'running') {
    throw new ValidationError('That job has already finished.');
  }

  await db.update(jobs)
    .set({ cancelRequested: new Date(), cancelRequestedBy: actor.id })
    .where(eq(jobs.id, jobId));

  // A queued job can be stopped immediately; a running one stops at its next
  // checkpoint, which keeps partial results intact.
  if (job.status === 'queued') {
    await db.update(jobs)
      .set({ status: 'cancelled', finishedAt: new Date() })
      .where(eq(jobs.id, jobId));
    await db.update(scans)
      .set({ status: 'cancelled', finishedAt: new Date() })
      .where(eq(scans.jobId, jobId));
  }
}

/** How many scan jobs are currently running, for the concurrency ceiling. */
export async function runningJobCount(type?: string): Promise<number> {
  const conds = [eq(jobs.status, 'running')];
  if (type) conds.push(eq(jobs.type, type));
  const [row] = await db.select({ n: raw<number>`count(*)::int` }).from(jobs).where(and(...conds));
  return row?.n ?? 0;
}

export async function listRecentScans(limit = 25) {
  return db
    .select({
      s: scans,
      jobStatus: jobs.status,
      jobCancelRequested: jobs.cancelRequested,
      jobError: jobs.lastError,
      jobAttempts: jobs.attempts,
      jobMaxAttempts: jobs.maxAttempts,
    })
    .from(scans)
    .leftJoin(jobs, eq(jobs.id, scans.jobId))
    .orderBy(desc(scans.createdAt))
    .limit(limit);
}

export async function getScanDetail(scanId: string) {
  const [scan] = await db.select().from(scans).where(eq(scans.id, scanId)).limit(1);
  if (!scan) throw new NotFoundError('Scan');
  const targets = await db.select().from(scanTargets)
    .where(eq(scanTargets.scanId, scanId))
    .orderBy(scanTargets.marketLabel);
  return { scan, targets };
}


