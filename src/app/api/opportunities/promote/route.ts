import { requireUser } from '@/lib/auth/guards';
import { ok, readJson, route } from '@/lib/api';
import { promoteToOpportunitySchema } from '@/lib/validation/schemas';
import { promoteToOpportunity } from '@/lib/services/opportunities';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * The ONLY entry point that puts a property into the transaction pipeline.
 * Requires an explicit reason, recorded with the promotion date and author.
 */
export const POST = route(async (req: Request) => {
  const actor = await requireUser();
  const input = promoteToOpportunitySchema.parse(await readJson(req));
  return ok({ opportunity: await promoteToOpportunity(input, actor) }, 201);
});
