import { requireUser } from '@/lib/auth/guards';
import { ok, readJson, route } from '@/lib/api';
import { activityUpdateSchema } from '@/lib/validation/schemas';
import { deleteActivity, updateActivity } from '@/lib/services/activities';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

/** Corrects a logged call/note. Auto-generated entries (status changes) reject this. */
export const PATCH = route(async (req: Request, ctx: Ctx) => {
  const actor = await requireUser();
  const { id } = await ctx.params;
  const input = activityUpdateSchema.parse(await readJson(req));
  const activity = await updateActivity(id, input, actor);
  return ok({ activity });
});

export const DELETE = route(async (_req: Request, ctx: Ctx) => {
  const actor = await requireUser();
  const { id } = await ctx.params;
  await deleteActivity(id, actor);
  return ok({ deleted: true });
});
