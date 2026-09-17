import '@/lib/server-guard';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { markets } from '@/db/schema';
import type { Actor } from '@/lib/auth/guards';
import { NotFoundError } from '@/lib/errors';
import { recordAudit, updateWithVersion } from './audit';

export async function updateMarket(
  id: string,
  input: { version: number; name?: string; state?: string | null; notes?: string | null },
  actor: Actor,
) {
  const { version, ...values } = input;
  const market = await updateWithVersion<typeof markets.$inferSelect>({
    table: markets, id, expectedVersion: version, values, entityLabel: 'market',
  });
  await recordAudit({ entityType: 'market', entityId: id, action: 'update', summary: `Updated market "${market.name}"`, actor });
  return market;
}

/** Archive rather than delete, so properties and their history under this market survive and can be recovered. */
export async function archiveMarket(id: string, actor: Actor) {
  const [market] = await db.update(markets).set({ archivedAt: new Date() }).where(eq(markets.id, id)).returning();
  if (!market) throw new NotFoundError('Market');
  await recordAudit({ entityType: 'market', entityId: id, action: 'archive', summary: `Archived market "${market.name}"`, actor });
  return market;
}

export async function restoreMarket(id: string, version: number, actor: Actor) {
  const market = await updateWithVersion<typeof markets.$inferSelect>({
    table: markets, id, expectedVersion: version, values: { archivedAt: null }, entityLabel: 'market',
  });
  await recordAudit({ entityType: 'market', entityId: id, action: 'restore', summary: `Restored market "${market.name}"`, actor });
  return market;
}
