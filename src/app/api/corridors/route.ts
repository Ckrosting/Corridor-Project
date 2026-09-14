import { and, asc, eq, isNull } from 'drizzle-orm';
import { db } from '@/db';
import { corridors } from '@/db/schema';
import { requireUser } from '@/lib/auth/guards';
import { ok, readJson, route } from '@/lib/api';
import { corridorCreateSchema } from '@/lib/validation/schemas';
import { createCorridor } from '@/lib/services/corridors';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const GET = route(async (req: Request) => {
  await requireUser();
  const marketId = new URL(req.url).searchParams.get('marketId');
  const conds = [isNull(corridors.archivedAt)];
  if (marketId) conds.push(eq(corridors.marketId, marketId));

  return ok({
    corridors: await db.select().from(corridors).where(and(...conds))
      .orderBy(asc(corridors.sortOrder), asc(corridors.name)),
  });
});

export const POST = route(async (req: Request) => {
  const actor = await requireUser();
  const input = corridorCreateSchema.parse(await readJson(req));
  return ok({ corridor: await createCorridor(input, actor) }, 201);
});
