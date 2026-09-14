import { z } from 'zod';
import { requireUser } from '@/lib/auth/guards';
import { ok, readJson, route } from '@/lib/api';
import { setFollowUp } from '@/lib/services/activities';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const schema = z.object({
  propertyId: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
});

export const POST = route(async (req: Request) => {
  const actor = await requireUser();
  const { propertyId, date } = schema.parse(await readJson(req));
  return ok({ property: await setFollowUp(propertyId, date, actor) });
});
