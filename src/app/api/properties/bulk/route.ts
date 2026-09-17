import { requireUser } from '@/lib/auth/guards';
import { ok, readJson, route } from '@/lib/api';
import { propertyBulkSchema } from '@/lib/validation/schemas';
import { bulkAddTags, bulkSetFollowUpDate, bulkUpdateOutreachStatus } from '@/lib/services/properties-bulk';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const POST = route(async (req: Request) => {
  const actor = await requireUser();
  const input = propertyBulkSchema.parse(await readJson(req));

  switch (input.action) {
    case 'set_status':
      return ok(await bulkUpdateOutreachStatus(input.propertyIds, input.outreachStatusId, actor));
    case 'set_follow_up':
      return ok(await bulkSetFollowUpDate(input.propertyIds, input.nextFollowUpDate, actor));
    case 'add_tags':
      return ok(await bulkAddTags(input.propertyIds, input.tagIds, actor));
  }
});
