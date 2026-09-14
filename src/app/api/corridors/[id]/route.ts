import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { corridors } from '@/db/schema';
import { requireAdmin, requireUser } from '@/lib/auth/guards';
import { ok, readJson, route } from '@/lib/api';
import { corridorUpdateSchema } from '@/lib/validation/schemas';
import { recomputeCorridorMembership, updateCorridor } from '@/lib/services/corridors';
import { recordAudit } from '@/lib/services/audit';
import { NotFoundError } from '@/lib/errors';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

export const GET = route(async (_req: Request, ctx: Ctx) => {
  await requireUser();
  const { id } = await ctx.params;
  const [corridor] = await db.select().from(corridors).where(eq(corridors.id, id)).limit(1);
  if (!corridor) throw new NotFoundError('Corridor');
  return ok({ corridor });
});

export const PATCH = route(async (req: Request, ctx: Ctx) => {
  const actor = await requireUser();
  const { id } = await ctx.params;
  const input = corridorUpdateSchema.parse(await readJson(req));
  const corridor = await updateCorridor(id, input, actor);
  const membership = await recomputeCorridorMembership(id);
  return ok({ corridor, membership });
});

/** Archive rather than delete, so property links and history survive. */
export const DELETE = route(async (_req: Request, ctx: Ctx) => {
  const actor = await requireAdmin();
  const { id } = await ctx.params;
  const [corridor] = await db.update(corridors)
    .set({ archivedAt: new Date() }).where(eq(corridors.id, id)).returning();
  if (!corridor) throw new NotFoundError('Corridor');
  await recordAudit({
    entityType: 'corridor', entityId: id, action: 'archive',
    summary: `Archived corridor "${corridor.name}"`, actor,
  });
  return ok({ archived: true });
});
