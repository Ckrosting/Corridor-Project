import { requireAdmin, requireUser } from '@/lib/auth/guards';
import { ok, readJson, route } from '@/lib/api';
import { propertyUpdateSchema } from '@/lib/validation/schemas';
import { archiveProperty, getPropertyDetail, updateProperty } from '@/lib/services/properties';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

export const GET = route(async (_req: Request, ctx: Ctx) => {
  await requireUser();
  const { id } = await ctx.params;
  return ok({ property: await getPropertyDetail(id) });
});

export const PATCH = route(async (req: Request, ctx: Ctx) => {
  const actor = await requireUser();
  const { id } = await ctx.params;
  const input = propertyUpdateSchema.parse(await readJson(req));
  const property = await updateProperty(id, input as never, actor);
  return ok({ property });
});

/** Archiving is reversible and admin-only; nothing here hard-deletes a property. */
export const DELETE = route(async (req: Request, ctx: Ctx) => {
  const actor = await requireAdmin();
  const { id } = await ctx.params;
  const version = Number(new URL(req.url).searchParams.get('version'));
  if (!Number.isInteger(version)) {
    return ok({ error: 'A version is required to archive safely.' }, 400);
  }
  return ok({ property: await archiveProperty(id, version, actor) });
});
