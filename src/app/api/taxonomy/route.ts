import { z } from 'zod';
import { requireAdmin } from '@/lib/auth/guards';
import { ok, readJson, route } from '@/lib/api';
import {
  archiveCustomField, archiveStage, archiveStatus, createCustomField,
  upsertStage, upsertStatus,
} from '@/lib/services/taxonomy';
import { customFieldDefSchema, stageUpsertSchema, statusUpsertSchema } from '@/lib/validation/schemas';
import { AppError } from '@/lib/errors';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const body = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('status'), data: statusUpsertSchema }),
  z.object({ kind: z.literal('stage'), data: stageUpsertSchema }),
  z.object({ kind: z.literal('custom_field'), data: customFieldDefSchema }),
  z.object({
    kind: z.literal('archive'),
    target: z.enum(['status', 'stage', 'custom_field']),
    id: z.string().uuid(),
    // Required when the status or stage is still referenced by live records.
    reassignToId: z.string().uuid().nullish(),
  }),
]);

export const POST = route(async (req: Request) => {
  const actor = await requireAdmin();
  const input = body.parse(await readJson(req));

  switch (input.kind) {
    case 'status':
      return ok({ status: await upsertStatus(input.data, actor) });
    case 'stage':
      return ok({ stage: await upsertStage(input.data, actor) });
    case 'custom_field':
      return ok({ field: await createCustomField(input.data, actor) }, 201);
    case 'archive': {
      if (input.target === 'status') {
        return ok(await archiveStatus(input.id, input.reassignToId ?? null, actor));
      }
      if (input.target === 'stage') {
        return ok(await archiveStage(input.id, input.reassignToId ?? null, actor));
      }
      await archiveCustomField(input.id, actor);
      return ok({ archived: true });
    }
    default:
      throw new AppError(400, 'Unknown taxonomy action.', 'bad_action');
  }
});
