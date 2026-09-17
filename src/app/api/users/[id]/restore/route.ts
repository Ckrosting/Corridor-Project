import { requireAdmin } from '@/lib/auth/guards';
import { ok, route } from '@/lib/api';
import { restoreUser } from '@/lib/services/users';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

/** Undoes an archive. Admin-only, to match the DELETE that archived it. */
export const POST = route(async (_req: Request, ctx: Ctx) => {
  const actor = await requireAdmin();
  const { id } = await ctx.params;
  return ok({ user: await restoreUser(id, actor) });
});
