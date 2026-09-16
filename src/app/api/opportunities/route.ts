import { requireUser } from '@/lib/auth/guards';
import { ok, route } from '@/lib/api';
import { listOpportunities } from '@/lib/services/opportunities';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const GET = route(async (req: Request) => {
  await requireUser();
  const sp = new URL(req.url).searchParams;
  return ok({
    opportunities: await listOpportunities({
      marketId: sp.get('marketId') ?? undefined,
      includeTerminal: sp.get('includeTerminal') === 'true',
      includeRemoved: sp.get('includeRemoved') === 'true',
      includeSample: sp.get('includeSample') !== 'false',
      search: sp.get('q') ?? undefined,
    }),
  });
});
