import { requireUser } from '@/lib/auth/guards';
import { ok, readJson, route } from '@/lib/api';
import { opportunityStateSchema, opportunityUpdateSchema } from '@/lib/validation/schemas';
import { getOpportunityDetail, setOpportunityState, updateOpportunity } from '@/lib/services/opportunities';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

export const GET = route(async (_req: Request, ctx: Ctx) => {
  await requireUser();
  const { id } = await ctx.params;
  return ok({ opportunity: await getOpportunityDetail(id) });
});

export const PATCH = route(async (req: Request, ctx: Ctx) => {
  const actor = await requireUser();
  const { id } = await ctx.params;
  const body = await readJson(req);

  // Removing from / returning to the active pipeline is a distinct operation from
  // editing fields, so history records it as such.
  if (body && typeof body === 'object' && 'state' in body) {
    const input = opportunityStateSchema.parse(body);
    return ok({ opportunity: await setOpportunityState(id, input, actor) });
  }

  const input = opportunityUpdateSchema.parse(body);
  return ok({ opportunity: await updateOpportunity(id, input, actor) });
});
