import { db } from '@/db';
import { mallAnchors } from '@/db/schema';
import { requireUser } from '@/lib/auth/guards';
import { ok, readJson, route } from '@/lib/api';
import { mallAnchorCreateSchema } from '@/lib/validation/schemas';
import { recordAudit } from '@/lib/services/audit';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const POST = route(async (req: Request) => {
  const actor = await requireUser();
  const input = mallAnchorCreateSchema.parse(await readJson(req));

  const hasCoords = input.latitude != null && input.longitude != null;
  const [anchor] = await db.insert(mallAnchors).values({
    marketId: input.marketId,
    name: input.name,
    addressLine1: input.addressLine1 ?? null,
    city: input.city ?? null,
    state: input.state ?? null,
    postalCode: input.postalCode ?? null,
    county: input.county ?? null,
    latitude: input.latitude ?? null,
    longitude: input.longitude ?? null,
    // Anchors without trustworthy coordinates are flagged rather than dropped.
    needsMapPlacement: !hasCoords,
    locationSource: hasCoords ? 'manual' : null,
    locationSetAt: hasCoords ? new Date() : null,
    notes: input.notes ?? null,
    createdBy: actor.id,
  }).returning();

  await recordAudit({
    entityType: 'mall_anchor', entityId: anchor!.id, action: 'create',
    summary: `Added mall anchor "${input.name}"${hasCoords ? '' : ' (needs map placement)'}`,
    actor,
  });
  return ok({ anchor }, 201);
});
