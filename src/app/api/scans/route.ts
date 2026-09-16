import { z } from 'zod';
import { requireUser } from '@/lib/auth/guards';
import { ok, readJson, route } from '@/lib/api';
import { queueScan } from '@/lib/services/scans';
import { listRecentScans } from '@/lib/services/jobs';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const schema = z.object({
  scope: z.enum(['market', 'markets', 'all']),
  marketId: z.string().uuid().optional(),
  marketIds: z.array(z.string().uuid()).max(200).optional(),
});

export const GET = route(async () => {
  await requireUser();
  return ok({ scans: await listRecentScans(30) });
});

/**
 * Queues a scan. Returns immediately — the work runs in the worker process, so
 * a long multi-market scan is never bounded by this request's lifetime.
 */
export const POST = route(async (req: Request) => {
  const actor = await requireUser();
  const input = schema.parse(await readJson(req));
  const { scan, marketCount } = await queueScan(input, actor);
  return ok({ scan, marketCount }, 202);
});
