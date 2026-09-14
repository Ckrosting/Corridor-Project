import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { mallAnchors } from '@/db/schema';
import { requireUser } from '@/lib/auth/guards';
import { ok, readJson, route } from '@/lib/api';
import { mallAnchorUpdateSchema } from '@/lib/validation/schemas';
import { recordAudit, updateWithVersion } from '@/lib/services/audit';
import { NotFoundError } from '@/lib/errors';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = route(async (req: Request, ctx: Ctx) => {
  const actor = await requireUser();
  const { id } = await ctx.params;
  const { version, ...patch } = mallAnchorUpdateSchema.parse(await readJson(req));

  const [before] = await db.select().from(mallAnchors).where(eq(mallAnchors.id, id)).limit(1);
  if (!before) throw new NotFoundError('Mall anchor');

  const values: Record<string, unknown> = { ...patch };
  if ('latitude' in patch || 'longitude' in patch) {
    const lat = patch.latitude ?? before.latitude;
    const lng = patch.longitude ?? before.longitude;
    values.needsMapPlacement = lat == null || lng == null;
    values.locationSource = 'manual';
    values.locationSetAt = new Date();
  }

  const anchor = await updateWithVersion<typeof mallAnchors.$inferSelect>({
    table: mallAnchors, id, expectedVersion: version, values, entityLabel: 'mall anchor',
  });
  await recordAudit({ entityType: 'mall_anchor', entityId: id, action: 'update', summary: `Updated "${before.name}"`, actor });
  return ok({ anchor });
});
