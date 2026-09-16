import { db } from '@/db';
import { requireUser } from '@/lib/auth/guards';
import { ok, readJson, route } from '@/lib/api';
import { propertyCreateSchema } from '@/lib/validation/schemas';
import { createProperty, listProperties, type PropertyFilters } from '@/lib/services/properties';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Map/table listing. All filters are applied server-side. */
export const GET = route(async (req: Request) => {
  await requireUser();
  const sp = new URL(req.url).searchParams;

  const list = (key: string) => {
    const v = sp.getAll(key).flatMap((s) => s.split(',')).map((s) => s.trim()).filter(Boolean);
    return v.length ? v : undefined;
  };

  const filters: PropertyFilters = {
    marketId: sp.get('marketId') ?? undefined,
    outreachStatusIds: list('outreachStatusId'),
    listingStatuses: list('listingStatus'),
    propertyTypes: list('propertyType'),
    tagIds: list('tagId'),
    pipeline: (sp.get('pipeline') as PropertyFilters['pipeline']) ?? undefined,
    search: sp.get('q') ?? undefined,
    includeSample: sp.get('includeSample') !== 'false',
    includeArchived: sp.get('includeArchived') === 'true',
    needsParcelOutline: sp.get('needsParcelOutline') === 'true' ? true : undefined,
    sort: (sp.get('sort') as PropertyFilters['sort']) ?? undefined,
    limit: sp.get('limit') ? Number(sp.get('limit')) : undefined,
  };

  const bboxParam = sp.get('bbox');
  if (bboxParam) {
    const [minLng, minLat, maxLng, maxLat] = bboxParam.split(',').map(Number);
    if ([minLng, minLat, maxLng, maxLat].every((n) => Number.isFinite(n))) {
      filters.bbox = { minLng: minLng!, minLat: minLat!, maxLng: maxLng!, maxLat: maxLat! };
    }
  }

  return ok({ properties: await listProperties(filters) });
});

export const POST = route(async (req: Request) => {
  const actor = await requireUser();
  const input = propertyCreateSchema.parse(await readJson(req));
  const property = await createProperty(input as never, actor);
  return ok({ property }, 201);
});
