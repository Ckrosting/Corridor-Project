import { z } from 'zod';
import { requireUser } from '@/lib/auth/guards';
import { ok, readJson, route } from '@/lib/api';
import { changeOutreachStatus } from '@/lib/services/activities';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const schema = z.object({
  propertyId: z.string().uuid(),
  outreachStatusId: z.string().uuid(),
  note: z.string().trim().max(2000).nullish(),
});

/** Changing status appends a timeline entry; it never erases call history. */
export const POST = route(async (req: Request) => {
  const actor = await requireUser();
  const { propertyId, outreachStatusId, note } = schema.parse(await readJson(req));
  await changeOutreachStatus(propertyId, outreachStatusId, note ?? null, actor);
  return ok({ updated: true });
});
