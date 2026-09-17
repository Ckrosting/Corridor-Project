import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { markets } from '@/db/schema';
import { requireAdmin, requireUser } from '@/lib/auth/guards';
import { ok, readJson, route } from '@/lib/api';
import { marketUpdateSchema } from '@/lib/validation/schemas';
import { archiveMarket, updateMarket } from '@/lib/services/markets';
import { NotFoundError } from '@/lib/errors';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

export const GET = route(async (_req: Request, ctx: Ctx) => {
  await requireUser();
  const { id } = await ctx.params;
  const [market] = await db.select().from(markets).where(eq(markets.id, id)).limit(1);
  if (!market) throw new NotFoundError('Market');
  return ok({ market });
});

export const PATCH = route(async (req: Request, ctx: Ctx) => {
  const actor = await requireUser();
  const { id } = await ctx.params;
  const input = marketUpdateSchema.parse(await readJson(req));
  return ok({ market: await updateMarket(id, input, actor) });
});

/**
 * Archive rather than delete, so properties and their history under
 * this market survive and can be recovered. Mall anchors under an
 * archived market are not separately archived - they simply become unreachable
 * through market navigation.
 */
export const DELETE = route(async (_req: Request, ctx: Ctx) => {
  const actor = await requireAdmin();
  const { id } = await ctx.params;
  await archiveMarket(id, actor);
  return ok({ archived: true });
});
