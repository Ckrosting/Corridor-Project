import { requireUser } from '@/lib/auth/guards';
import { AppError } from '@/lib/errors';
import { ok, readJson, route } from '@/lib/api';
import { propertyContactLinkUpdateSchema } from '@/lib/validation/schemas';
import { unlinkContactFromProperty, updatePropertyContactLink } from '@/lib/services/contacts';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string; contactId: string }> };

/**
 * Relationship is part of this link's identity (a property_contacts row is
 * keyed by property + contact + relationship), so both routes need to know
 * which relationship row is being changed - passed as a query param since
 * PATCH also uses the body to carry the NEW relationship, if it's changing.
 */
function currentRelationship(req: Request): string {
  const value = new URL(req.url).searchParams.get('relationship');
  if (!value) throw new AppError(400, 'The current relationship is required.', 'missing_relationship');
  return value;
}

export const PATCH = route(async (req: Request, ctx: Ctx) => {
  const actor = await requireUser();
  const { id, contactId } = await ctx.params;
  const relationship = currentRelationship(req);
  const input = propertyContactLinkUpdateSchema.parse(await readJson(req));

  await updatePropertyContactLink({
    propertyId: id, contactId, currentRelationship: relationship,
    relationship: input.relationship, isPrimary: input.isPrimary, notes: input.notes,
    actor,
  });

  return ok({ updated: true });
});

export const DELETE = route(async (req: Request, ctx: Ctx) => {
  const actor = await requireUser();
  const { id, contactId } = await ctx.params;
  const relationship = currentRelationship(req);

  await unlinkContactFromProperty({ propertyId: id, contactId, relationship, actor });

  return ok({ deleted: true });
});
