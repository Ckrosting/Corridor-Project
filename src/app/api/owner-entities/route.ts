import { requireUser } from '@/lib/auth/guards';
import { ok, readJson, route } from '@/lib/api';
import { ownerEntityCreateSchema } from '@/lib/validation/schemas';
import { createOwnerEntity, listOwnerEntities } from '@/lib/services/owner-entities';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Name search behind the property editor's owner-entity picker. */
export const GET = route(async (req: Request) => {
  await requireUser();
  const search = new URL(req.url).searchParams.get('q') ?? undefined;
  return ok({ ownerEntities: await listOwnerEntities(search) });
});

export const POST = route(async (req: Request) => {
  const actor = await requireUser();
  const input = ownerEntityCreateSchema.parse(await readJson(req));
  return ok({ ownerEntity: await createOwnerEntity(input, actor) }, 201);
});
