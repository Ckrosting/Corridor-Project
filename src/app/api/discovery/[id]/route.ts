import { z } from 'zod';
import { requireUser } from '@/lib/auth/guards';
import { ok, readJson, route } from '@/lib/api';
import {
  approveAsNewProperty, linkToProperty, reopenResult, reviewResult,
} from '@/lib/services/discovery';
import { AppError } from '@/lib/errors';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

const schema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('approve'),
    // Corrections the reviewer made before approving.
    overrides: z.record(z.string(), z.unknown()).default({}),
  }),
  z.object({
    action: z.literal('link'),
    propertyId: z.string().uuid(),
    // Only the proposed changes the reviewer ticked are applied.
    acceptedFields: z.array(z.string()).default([]),
  }),
  z.object({
    action: z.enum(['reject', 'archive', 'needs_research']),
    note: z.string().trim().max(2000).nullish(),
  }),
  z.object({ action: z.literal('reopen') }),
]);

export const POST = route(async (req: Request, ctx: Ctx) => {
  const actor = await requireUser();
  const { id } = await ctx.params;
  const input = schema.parse(await readJson(req));

  switch (input.action) {
    case 'approve':
      return ok({ property: await approveAsNewProperty(id, input.overrides, actor) }, 201);
    case 'link':
      await linkToProperty(id, input.propertyId, input.acceptedFields, actor);
      return ok({ linked: true });
    case 'reject':
    case 'archive':
    case 'needs_research': {
      // The API verbs are imperative; the stored statuses are past tense.
      const status = ({
        reject: 'rejected', archive: 'archived', needs_research: 'needs_research',
      } as const)[input.action];
      await reviewResult(id, status, input.note ?? null, actor);
      return ok({ status });
    }
    case 'reopen':
      await reopenResult(id, actor);
      return ok({ status: 'new' });
    default:
      throw new AppError(400, 'Unknown review action.', 'bad_action');
  }
});
