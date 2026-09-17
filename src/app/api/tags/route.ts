import { requireAdmin, requireUser } from '@/lib/auth/guards';
import { ok, readJson, route } from '@/lib/api';
import { createTag, listTagsWithUsage } from '@/lib/services/tags';
import { tagCreateSchema } from '@/lib/validation/schemas';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const GET = route(async () => {
  await requireUser();
  return ok({ tags: await listTagsWithUsage() });
});

export const POST = route(async (req: Request) => {
  const actor = await requireAdmin();
  const input = tagCreateSchema.parse(await readJson(req));
  return ok({ tag: await createTag(input, actor) }, 201);
});
