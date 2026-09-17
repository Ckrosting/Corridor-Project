import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { ownerEntities } from '@/db/schema';
import { requireAdmin, requireUser } from '@/lib/auth/guards';
import { ok, readJson, route } from '@/lib/api';
import { ownerEntityUpdateSchema } from '@/lib/validation/schemas';
import { archiveOwnerEntity, updateOwnerEntity } from '@/lib/services/owner-entities';
import { NotFoundError } from '@/lib/errors';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

export const GET = route(async (_req: Request, ctx: Ctx) => {
  await requireUser();
  const { id } = await ctx.params;
  const [ownerEntity] = await db.select().from(ownerEntities).where(eq(ownerEntities.id, id)).limit(1);
  if (!ownerEntity) throw new NotFoundError('Owner entity');
  return ok({ ownerEntity });
});

export const PATCH = route(async (req: Request, ctx: Ctx) => {
  const actor = await requireUser();
  const { id } = await ctx.params;
  const input = ownerEntityUpdateSchema.parse(await readJson(req));
  return ok({ ownerEntity: await updateOwnerEntity(id, input, actor) });
});

/**
 * Archive rather than delete: properties point at this entity with ON DELETE
 * SET NULL, so a real delete would silently strip ownership from every property
 * it owns. Archiving keeps those links intact and is reversible.
 */
export const DELETE = route(async (_req: Request, ctx: Ctx) => {
  const actor = await requireAdmin();
  const { id } = await ctx.params;
  await archiveOwnerEntity(id, actor);
  return ok({ archived: true });
});
