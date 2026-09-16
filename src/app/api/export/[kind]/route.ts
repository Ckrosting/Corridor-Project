import { requireUser } from '@/lib/auth/guards';
import { route } from '@/lib/api';
import { AppError } from '@/lib/errors';
import {
  candidateImportTemplateCsv, exportContactsCsv, exportMallsCsv, exportPropertiesCsv,
  mallImportTemplateCsv, propertyImportTemplateCsv,
} from '@/lib/services/export';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** CSV downloads. Every export leads with stable IDs for later reconciliation. */
export const GET = route(async (req: Request, ctx: { params: Promise<{ kind: string }> }) => {
  await requireUser();
  const { kind } = await ctx.params;
  const includeSample = new URL(req.url).searchParams.get('includeSample') === 'true';

  const stamp = new Date().toISOString().slice(0, 10);
  let body: string;
  let filename: string;

  switch (kind) {
    case 'properties':
      body = await exportPropertiesCsv({ includeSample });
      filename = `hull-corridor-properties-${stamp}.csv`;
      break;
    case 'contacts':
      body = await exportContactsCsv();
      filename = `hull-corridor-contacts-${stamp}.csv`;
      break;
    case 'malls':
      body = await exportMallsCsv();
      filename = `hull-corridor-malls-${stamp}.csv`;
      break;
    case 'mall-template':
      body = mallImportTemplateCsv();
      filename = 'hull-corridor-mall-import-template.csv';
      break;
    case 'candidate-template':
      body = candidateImportTemplateCsv();
      filename = 'hull-corridor-candidate-import-template.csv';
      break;
    case 'property-template':
      body = propertyImportTemplateCsv();
      filename = 'hull-corridor-property-import-template.csv';
      break;
    default:
      throw new AppError(404, `Unknown export "${kind}".`, 'unknown_export');
  }

  return new Response(body, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
});
