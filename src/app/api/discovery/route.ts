import { requireUser } from '@/lib/auth/guards';
import { ok, route } from '@/lib/api';
import { listDiscoveryResults } from '@/lib/services/discovery';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const GET = route(async (req: Request) => {
  await requireUser();
  const sp = new URL(req.url).searchParams;
  const status = sp.getAll('status').flatMap((s) => s.split(',')).filter(Boolean);

  return ok({
    results: await listDiscoveryResults({
      status: status.length ? status : undefined,
      marketId: sp.get('marketId') ?? undefined,
    }),
  });
});
