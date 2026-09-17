import { requireAdmin } from '@/lib/auth/guards';
import { ok, route } from '@/lib/api';
import { restoreOwnerEntity } from '@/lib/services/owner-entities';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

/** Undoes an archive. Admin-only, to match the DELETE that archived it. */
export const POST = route(async (req: Request, ctx: Ctx) => {
  const actor = await requireAdmin();
  const { id } = await ctx.params;
  const version = Number(new URL(req.url).searchParams.get('version'));
  if (!Number.isInteger(version)) {
    return ok({ error: 'A version is required to restore safely.' }, 400);
  }
  return ok({ ownerEntity: await restoreOwnerEntity(id, version, actor) });
});
