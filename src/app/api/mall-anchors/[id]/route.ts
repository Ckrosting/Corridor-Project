import { requireAdmin, requireUser } from '@/lib/auth/guards';
import { ok, readJson, route } from '@/lib/api';
import { mallAnchorUpdateSchema } from '@/lib/validation/schemas';
import { archiveMallAnchor, updateMallAnchor } from '@/lib/services/mall-anchors';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = route(async (req: Request, ctx: Ctx) => {
  const actor = await requireUser();
  const { id } = await ctx.params;
  const input = mallAnchorUpdateSchema.parse(await readJson(req));
  return ok({ anchor: await updateMallAnchor(id, input, actor) });
});

/** Archive rather than delete, so the properties around this mall are unaffected. */
export const DELETE = route(async (_req: Request, ctx: Ctx) => {
  const actor = await requireAdmin();
  const { id } = await ctx.params;
  await archiveMallAnchor(id, actor);
  return ok({ archived: true });
});
