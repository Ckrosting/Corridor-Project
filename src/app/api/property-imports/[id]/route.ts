import { z } from 'zod';
import { requireAdmin } from '@/lib/auth/guards';
import { ok, readJson, route } from '@/lib/api';
import { commitPropertyImport, getPropertyImportBatch } from '@/lib/services/property-import';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

const schema = z.object({
  actions: z.record(z.string(), z.enum(['create', 'skip'])).default({}),
});

export const GET = route(async (_req: Request, ctx: Ctx) => {
  await requireAdmin();
  const { id } = await ctx.params;
  return ok(await getPropertyImportBatch(id));
});

/** Stage 2: the explicit confirmation that actually creates the properties. */
export const POST = route(async (req: Request, ctx: Ctx) => {
  const actor = await requireAdmin();
  const { id } = await ctx.params;
  const { actions } = schema.parse(await readJson(req));

  const numeric: Record<number, 'create' | 'skip'> = {};
  for (const [key, value] of Object.entries(actions)) numeric[Number(key)] = value;

  return ok({ result: await commitPropertyImport(id, numeric, actor) });
});
