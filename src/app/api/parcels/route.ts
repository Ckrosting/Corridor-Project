import { requireUser } from '@/lib/auth/guards';
import { ok, readJson, route } from '@/lib/api';
import { parcelCreateSchema } from '@/lib/validation/schemas';
import { createParcel } from '@/lib/services/properties';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const POST = route(async (req: Request) => {
  const actor = await requireUser();
  const input = parcelCreateSchema.parse(await readJson(req));
  return ok({ parcel: await createParcel(input, actor) }, 201);
});
