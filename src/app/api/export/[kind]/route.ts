import { requireUser } from '@/lib/auth/guards';
import { route } from '@/lib/api';
import { AppError } from '@/lib/errors';
import {
  candidateImportTemplateCsv, exportActivitiesCsv, exportContactsCsv, exportMallsCsv,
  exportOpportunitiesCsv, exportPropertiesCsv, mallImportTemplateCsv, propertyImportTemplateCsv,
} from '@/lib/services/export';
import type { PropertyFilters } from '@/lib/services/properties';

/**
 * The same query-parameter vocabulary the properties page reads, so the Export
 * CSV button can hand its own URL straight through and get the rows on screen.
 */
function propertyFiltersFrom(sp: URLSearchParams): PropertyFilters {
  const many = (k: string) => {
    const list = sp.getAll(k).flatMap((s) => s.split(',')).filter(Boolean);
    return list.length ? list : undefined;
  };

  return {
    marketId: sp.get('marketId') ?? undefined,
    outreachStatusIds: many('status'),
    listingStatuses: many('listing'),
    propertyTypes: many('type'),
    tagIds: many('tag'),
    pipeline: (sp.get('pipeline') as PropertyFilters['pipeline']) ?? 'any',
    search: sp.get('q') ?? undefined,
    needsParcelOutline: sp.get('needsOutline') === 'true' ? true : undefined,
    includeArchived: sp.get('includeArchived') === 'true',
    includeSample: sp.get('includeSample') === 'true',
  };
}

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** CSV downloads. Every export leads with stable IDs for later reconciliation. */
export const GET = route(async (req: Request, ctx: { params: Promise<{ kind: string }> }) => {
  await requireUser();
  const { kind } = await ctx.params;
  const sp = new URL(req.url).searchParams;
  const includeSample = sp.get('includeSample') === 'true';

  const stamp = new Date().toISOString().slice(0, 10);
  let body: string;
  let filename: string;

  switch (kind) {
    case 'properties':
      body = await exportPropertiesCsv(propertyFiltersFrom(sp));
      filename = `hull-corridor-properties-${stamp}.csv`;
      break;
    case 'opportunities':
    case 'pipeline':
      body = await exportOpportunitiesCsv({ includeSample });
      filename = `hull-corridor-pipeline-${stamp}.csv`;
      break;
    case 'activities':
      body = await exportActivitiesCsv({ includeSample });
      filename = `hull-corridor-activities-${stamp}.csv`;
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
