import { requireAdmin } from '@/lib/auth/guards';
import { ok, readJson, route } from '@/lib/api';
import { archiveTag, updateTag } from '@/lib/services/tags';
import { tagUpdateSchema } from '@/lib/validation/schemas';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = route(async (req: Request, ctx: Ctx) => {
  const actor = await requireAdmin();
  const { id } = await ctx.params;
  const input = tagUpdateSchema.parse(await readJson(req));
  return ok({ tag: await updateTag(id, input, actor) });
});

/** Archive, never hard-delete: properties keep the tags already applied to them. */
export const DELETE = route(async (_req: Request, ctx: Ctx) => {
  const actor = await requireAdmin();
  const { id } = await ctx.params;
  return ok(await archiveTag(id, actor));
});
