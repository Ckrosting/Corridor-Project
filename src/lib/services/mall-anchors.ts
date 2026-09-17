import '@/lib/server-guard';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { mallAnchors } from '@/db/schema';
import type { Actor } from '@/lib/auth/guards';
import { NotFoundError } from '@/lib/errors';
import { recordAudit, updateWithVersion } from './audit';

export async function updateMallAnchor(
  id: string,
  input: {
    version: number;
    name?: string; addressLine1?: string | null; city?: string | null; state?: string | null;
    postalCode?: string | null; county?: string | null; latitude?: number | null; longitude?: number | null;
    notes?: string | null;
  },
  actor: Actor,
) {
  const [before] = await db.select().from(mallAnchors).where(eq(mallAnchors.id, id)).limit(1);
  if (!before) throw new NotFoundError('Mall anchor');

  const { version, ...patch } = input;
  const values: Record<string, unknown> = { ...patch };
  if ('latitude' in patch || 'longitude' in patch) {
    // `??` would treat an explicit null (clearing a coordinate) the same as "not
    // provided" and fall back to the old value, so a cleared coordinate would
    // never actually flip needsMapPlacement back on.
    const lat = 'latitude' in patch ? patch.latitude : before.latitude;
    const lng = 'longitude' in patch ? patch.longitude : before.longitude;
    values.needsMapPlacement = lat == null || lng == null;
    values.locationSource = 'manual';
    values.locationSetAt = new Date();
  }

  const anchor = await updateWithVersion<typeof mallAnchors.$inferSelect>({
    table: mallAnchors, id, expectedVersion: version, values, entityLabel: 'mall anchor',
  });
  await recordAudit({ entityType: 'mall_anchor', entityId: id, action: 'update', summary: `Updated "${before.name}"`, actor });
  return anchor;
}

/** Archive rather than delete, so the properties around this mall are unaffected. */
export async function archiveMallAnchor(id: string, actor: Actor) {
  const [anchor] = await db.update(mallAnchors).set({ archivedAt: new Date() }).where(eq(mallAnchors.id, id)).returning();
  if (!anchor) throw new NotFoundError('Mall anchor');
  await recordAudit({
    entityType: 'mall_anchor', entityId: id, action: 'archive',
    summary: `Archived mall anchor "${anchor.name}"`, actor,
  });
  return anchor;
}

export async function restoreMallAnchor(id: string, version: number, actor: Actor) {
  const anchor = await updateWithVersion<typeof mallAnchors.$inferSelect>({
    table: mallAnchors, id, expectedVersion: version, values: { archivedAt: null }, entityLabel: 'mall anchor',
  });
  await recordAudit({ entityType: 'mall_anchor', entityId: id, action: 'restore', summary: `Restored mall anchor "${anchor.name}"`, actor });
  return anchor;
}
