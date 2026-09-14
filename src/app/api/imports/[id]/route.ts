import { z } from 'zod';
import { requireAdmin } from '@/lib/auth/guards';
import { ok, readJson, route } from '@/lib/api';
import { commitMallImport, getImportBatch } from '@/lib/services/import';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

const schema = z.object({
  /** Row number -> what to do with it, as chosen in the preview. */
  actions: z.record(z.string(), z.enum(['create', 'update', 'skip'])).default({}),
});

export const GET = route(async (_req: Request, ctx: Ctx) => {
  await requireAdmin();
  const { id } = await ctx.params;
  return ok(await getImportBatch(id));
});

/** Stage 2: the explicit confirmation that actually writes the rows. */
export const POST = route(async (req: Request, ctx: Ctx) => {
  const actor = await requireAdmin();
  const { id } = await ctx.params;
  const { actions } = schema.parse(await readJson(req));

  const numeric: Record<number, 'create' | 'update' | 'skip'> = {};
  for (const [key, value] of Object.entries(actions)) numeric[Number(key)] = value;

  return ok({ result: await commitMallImport(id, numeric, actor) });
});
