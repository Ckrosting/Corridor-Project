import { requireUser } from '@/lib/auth/guards';
import { ok, readJson, route } from '@/lib/api';
import { parcelUpdateSchema } from '@/lib/validation/schemas';
import { deleteParcel, updateParcel } from '@/lib/services/properties';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = route(async (req: Request, ctx: Ctx) => {
  const actor = await requireUser();
  const { id } = await ctx.params;
  const input = parcelUpdateSchema.parse(await readJson(req));
  return ok({ parcel: await updateParcel(id, input, actor) });
});

export const DELETE = route(async (_req: Request, ctx: Ctx) => {
  const actor = await requireUser();
  const { id } = await ctx.params;
  await deleteParcel(id, actor);
  return ok({ deleted: true });
});
