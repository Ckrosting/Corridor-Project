import Link from 'next/link';
import { asc, isNull } from 'drizzle-orm';
import { Building2, Plus } from 'lucide-react';
import { db } from '@/db';
import { markets, outreachStatuses, tags } from '@/db/schema';
import { requirePageUser } from '@/lib/auth/guards';
import { countProperties, listProperties, type PropertyFilters } from '@/lib/services/properties';
import { getPropertyTypes, showSampleData } from '@/lib/services/settings';
import { EmptyState } from '@/components/ui/primitives';
import { ExportPropertiesButton } from './export-button';
import { PropertyFiltersBar } from './filters-bar';
import { PropertiesTable } from './properties-table';

export const metadata = { title: 'Properties' };
export const dynamic = 'force-dynamic';

export default async function PropertiesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requirePageUser();
  const sp = await searchParams;

  const one = (k: string) => (Array.isArray(sp[k]) ? sp[k][0] : sp[k]) as string | undefined;
  const many = (k: string) => {
    const v = sp[k];
    if (!v) return undefined;
    const list = (Array.isArray(v) ? v : [v]).flatMap((s) => s.split(',')).filter(Boolean);
    return list.length ? list : undefined;
  };

  const includeSample = one('includeSample') === 'false' ? false : await showSampleData();

  const filters: PropertyFilters = {
    marketId: one('marketId'),
    outreachStatusIds: many('status'),
    listingStatuses: many('listing'),
    propertyTypes: many('type'),
    tagIds: many('tag'),
    hasContact: one('hasContact') === 'false' ? false : undefined,
    notContactedInDays: one('notContactedDays') ? Number(one('notContactedDays')) : undefined,
    missingAskingPrice: one('missingPrice') === 'true' ? true : undefined,
    overdueFollowUp: one('overdue') === 'true' ? true : undefined,
    pipeline: (one('pipeline') as PropertyFilters['pipeline']) ?? 'any',
    search: one('q'),
    needsParcelOutline: one('needsOutline') === 'true' ? true : undefined,
    includeArchived: one('includeArchived') === 'true',
    includeSample,
    sort: (one('sort') as PropertyFilters['sort']) ?? 'updated',
    limit: 500,
  };

  const [rows, total, marketList, statusList, propertyTypes, tagList] = await Promise.all([
    listProperties(filters),
    countProperties(filters),
    db.select({ id: markets.id, name: markets.name }).from(markets).where(isNull(markets.archivedAt)).orderBy(asc(markets.name)),
    db.select().from(outreachStatuses).where(isNull(outreachStatuses.archivedAt)).orderBy(asc(outreachStatuses.sortOrder)),
    getPropertyTypes(),
    db.select({ id: tags.id, name: tags.name }).from(tags).where(isNull(tags.archivedAt)).orderBy(asc(tags.name)),
  ]);

  return (
    <>
      <header className="flex shrink-0 items-center justify-between gap-4 border-b border-ink-200 bg-white px-6 py-3">
        <div>
          <h1 className="text-base font-semibold tracking-tight text-ink-900">Properties</h1>
          <p className="text-xs text-ink-500">
            {rows.length === total ? `${total} records` : `Showing ${rows.length} of ${total} records`}
          </p>
        </div>
        <div className="flex gap-2">
          <ExportPropertiesButton includeSample={includeSample} />
          <Link href="/properties/new" className="btn-primary btn-sm"><Plus size={14} /> New property</Link>
        </div>
      </header>

      <PropertyFiltersBar
        markets={marketList}
        statuses={statusList.map((s) => ({ id: s.id, label: s.label, color: s.color }))}
        propertyTypes={propertyTypes}
        tags={tagList.map((t) => ({ id: t.id, name: t.name }))}
      />

      <div className="scroll-thin flex-1 overflow-auto">
        {rows.length === 0 ? (
          <EmptyState
            icon={<Building2 size={26} />}
            title="No properties match"
            body="Adjust the filters above, or add a property from a market workspace where you can place it on the map."
            action={<Link href="/markets" className="btn-primary btn-sm">Open a market</Link>}
          />
        ) : (
          <PropertiesTable
            rows={rows}
            statuses={statusList.map((s) => ({ id: s.id, label: s.label, color: s.color }))}
            tags={tagList.map((t) => ({ id: t.id, label: t.name }))}
          />
        )}
      </div>
    </>
  );
}
