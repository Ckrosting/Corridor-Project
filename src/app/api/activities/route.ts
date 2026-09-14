import { requireUser } from '@/lib/auth/guards';
import { ok, readJson, route } from '@/lib/api';
import { activityCreateSchema } from '@/lib/validation/schemas';
import { logActivity } from '@/lib/services/activities';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Logs a call/note. Optionally updates outreach status and follow-up date in the
 * same request, which is what makes one-click call logging possible from the map
 * panel. It never touches the transaction pipeline.
 */
export const POST = route(async (req: Request) => {
  const actor = await requireUser();
  const input = activityCreateSchema.parse(await readJson(req));
  return ok({ activity: await logActivity(input, actor) }, 201);
});
