import { requireUser } from '@/lib/auth/guards';
import { ok, readJson, route } from '@/lib/api';
import { contactUpdateSchema } from '@/lib/validation/schemas';
import { updateContact } from '@/lib/services/contacts';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

/**
 * Updates a contact's own fields (name, phone, email, ...), shared across
 * every property they are linked to. To change their relationship to one
 * particular property instead, use PATCH /api/properties/[id]/contacts/[contactId].
 */
export const PATCH = route(async (req: Request, ctx: Ctx) => {
  const actor = await requireUser();
  const { id } = await ctx.params;
  const input = contactUpdateSchema.parse(await readJson(req));
  const contact = await updateContact(id, input, actor);
  return ok({ contact });
});
