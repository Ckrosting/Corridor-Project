import { requireAdmin } from '@/lib/auth/guards';
import { ok, readJson, route } from '@/lib/api';
import { userUpdateSchema } from '@/lib/validation/schemas';
import { archiveUser, updateUser } from '@/lib/services/users';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = route(async (req: Request, ctx: Ctx) => {
  const actor = await requireAdmin();
  const { id } = await ctx.params;
  // Passwords are set through the dedicated password route, never alongside a role change.
  const input = userUpdateSchema.omit({ password: true }).parse(await readJson(req));
  return ok({ user: await updateUser(id, input, actor) });
});

/** Archiving is reversible and admin-only; nothing here hard-deletes an account. */
export const DELETE = route(async (_req: Request, ctx: Ctx) => {
  const actor = await requireAdmin();
  const { id } = await ctx.params;
  return ok({ user: await archiveUser(id, actor) });
});
