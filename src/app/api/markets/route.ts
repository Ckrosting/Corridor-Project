import { asc, isNull } from 'drizzle-orm';
import { db } from '@/db';
import { markets } from '@/db/schema';
import { requireUser } from '@/lib/auth/guards';
import { ok, readJson, route } from '@/lib/api';
import { marketCreateSchema } from '@/lib/validation/schemas';
import { recordAudit } from '@/lib/services/audit';
import { AppError } from '@/lib/errors';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const GET = route(async () => {
  await requireUser();
  return ok({
    markets: await db.select().from(markets).where(isNull(markets.archivedAt)).orderBy(asc(markets.name)),
  });
});

/** Slugs must be unique and stable; they appear in exports used for reconciliation. */
function slugify(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'market';
}

export const POST = route(async (req: Request) => {
  const actor = await requireUser();
  const input = marketCreateSchema.parse(await readJson(req));

  const base = slugify(input.name);
  const taken = new Set(
    (await db.select({ slug: markets.slug }).from(markets)).map((m) => m.slug),
  );

  let slug = base;
  for (let i = 2; taken.has(slug); i++) {
    if (i > 200) throw new AppError(409, 'Too many markets with a similar name.', 'slug_exhausted');
    slug = `${base}-${i}`;
  }

  const [market] = await db.insert(markets).values({
    name: input.name, slug, state: input.state ?? null, notes: input.notes ?? null, createdBy: actor.id,
  }).returning();

  await recordAudit({ entityType: 'market', entityId: market!.id, action: 'create', summary: `Created market "${input.name}"`, actor });
  return ok({ market }, 201);
});
