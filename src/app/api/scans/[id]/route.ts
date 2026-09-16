import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { scans } from '@/db/schema';
import { requireUser } from '@/lib/auth/guards';
import { ok, route } from '@/lib/api';
import { getScanDetail, requestCancel } from '@/lib/services/jobs';
import { NotFoundError, ValidationError } from '@/lib/errors';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

export const GET = route(async (_req: Request, ctx: Ctx) => {
  await requireUser();
  const { id } = await ctx.params;
  return ok(await getScanDetail(id));
});

/** Requests cancellation. A running scan stops at its next market boundary. */
export const DELETE = route(async (_req: Request, ctx: Ctx) => {
  const actor = await requireUser();
  const { id } = await ctx.params;

  const [scan] = await db.select().from(scans).where(eq(scans.id, id)).limit(1);
  if (!scan) throw new NotFoundError('Scan');
  if (!scan.jobId) throw new ValidationError('That scan has no job attached and cannot be cancelled.');

  await requestCancel(scan.jobId, actor);
  return ok({ cancelRequested: true });
});
