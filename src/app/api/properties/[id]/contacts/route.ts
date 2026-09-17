import { requireUser } from '@/lib/auth/guards';
import { ok, readJson, route } from '@/lib/api';
import { propertyContactAttachSchema } from '@/lib/validation/schemas';
import { linkContactToProperty } from '@/lib/services/contacts';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

export const POST = route(async (req: Request, ctx: Ctx) => {
  const actor = await requireUser();
  const { id } = await ctx.params;
  const input = propertyContactAttachSchema.parse(await readJson(req));

  const contact = await linkContactToProperty({
    propertyId: id,
    contactId: input.contactId,
    newContact: input.newContact,
    relationship: input.relationship,
    isPrimary: input.isPrimary,
    notes: input.notes,
    actor,
  });

  return ok({ contact }, 201);
});
