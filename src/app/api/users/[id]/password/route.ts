import { requireAdmin } from '@/lib/auth/guards';
import { ok, readJson, route } from '@/lib/api';
import { adminPasswordResetSchema } from '@/lib/validation/schemas';
import { resetUserPassword } from '@/lib/services/users';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

/**
 * An admin setting someone else's password in the same room. There is no
 * current-password check because the admin does not know it — the guard above
 * is the authorization, and the change is audited.
 */
export const POST = route(async (req: Request, ctx: Ctx) => {
  const actor = await requireAdmin();
  const { id } = await ctx.params;
  const { newPassword } = adminPasswordResetSchema.parse(await readJson(req));
  return ok({ user: await resetUserPassword(id, newPassword, actor) });
});
