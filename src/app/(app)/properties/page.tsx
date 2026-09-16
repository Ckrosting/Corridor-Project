import Link from 'next/link';
import { asc, isNull } from 'drizzle-orm';
import { Building2, Plus } from 'lucide-react';
import { db } from '@/db';
import { markets, outreachStatuses } from '@/db/schema';
import { requirePageUser } from '@/lib/auth/guards';
import { countProperties, listProperties, type PropertyFilters } from '@/lib/services/properties';
import { getPropertyTypes, showSampleData } from '@/lib/services/settings';
import {
  LISTING_STATUS_LABELS, formatAcres, formatAddress, formatMoney, formatSqft,
  propertyTitle, relativeDays,
} from '@/lib/format';
import { EmptyState, SampleBadge, StatusChip, Value } from '@/components/ui/primitives';
import { PropertyFiltersBar } from './filters-bar';
import { RestoreButton } from './restore-button';

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
    pipeline: (one('pipeline') as PropertyFilters['pipeline']) ?? 'any',
    search: one('q'),
    needsParcelOutline: one('needsOutline') === 'true' ? true : undefined,
    includeArchived: one('includeArchived') === 'true',
    includeSample,
    sort: (one('sort') as PropertyFilters['sort']) ?? 'updated',
    limit: 500,
  };

  const [rows, total, marketList, statusList, propertyTypes] = await Promise.all([
    listProperties(filters),
    countProperties(filters),
    db.select({ id: markets.id, name: markets.name }).from(markets).where(isNull(markets.archivedAt)).orderBy(asc(markets.name)),
    db.select().from(outreachStatuses).where(isNull(outreachStatuses.archivedAt)).orderBy(asc(outreachStatuses.sortOrder)),
    getPropertyTypes(),
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
          <Link href="/api/export/properties" className="btn-secondary btn-sm" prefetch={false}>Export CSV</Link>
          <Link href="/properties/new" className="btn-primary btn-sm"><Plus size={14} /> New property</Link>
        </div>
      </header>

      <PropertyFiltersBar
        markets={marketList}
        statuses={statusList.map((s) => ({ id: s.id, label: s.label, color: s.color }))}
        propertyTypes={propertyTypes}
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
          <table className="table-dense">
            <thead>
              <tr>
                <th className="min-w-[280px]">Property</th>
                <th className="w-36">Outreach</th>
                <th className="w-28">Listing</th>
                <th className="w-32">Type</th>
                <th className="w-28 text-right">Asking</th>
                <th className="w-24 text-right">Size</th>
                <th className="w-32">Owner</th>
                <th className="w-28">Follow-up</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => {
                const rel = relativeDays(p.nextFollowUpDate);
                return (
                  <tr key={p.id}>
                    <td>
                      <Link href={`/properties/${p.id}`} className="flex items-center gap-1.5">
                        <span className={`font-medium hover:text-accent-700 ${p.archivedAt ? 'text-ink-400 line-through' : 'text-ink-900'}`}>
                          {propertyTitle(p)}
                        </span>
                        {p.isSample && <SampleBadge />}
                        {p.archivedAt && <span className="chip border-red-200 bg-red-50 text-red-700">Deleted</span>}
                      </Link>
                      {p.archivedAt && (
                        <div className="mt-0.5">
                          <RestoreButton propertyId={p.id} version={p.version} />
                        </div>
                      )}
                      <div className="text-[11px] text-ink-500">
                        {formatAddress(p)}
                        {p.parcelCount > 0 && ` · ${p.parcelCount} parcel${p.parcelCount > 1 ? 's' : ''}`}
                        {p.needsParcelOutline && ' · needs outline'}
                        {p.activityCount > 0 && ` · ${p.activityCount} call${p.activityCount > 1 ? 's' : ''}`}
                      </div>
                    </td>
                    <td>
                      <StatusChip label={p.outreachStatusLabel} color={p.outreachStatusColor} />
                      {p.opportunityId && (
                        <div className="mt-0.5 text-[10px] font-medium text-accent-700">In pipeline</div>
                      )}
                    </td>
                    <td className="text-xs text-ink-700">
                      {LISTING_STATUS_LABELS[p.listingStatus] ?? p.listingStatus}
                    </td>
                    <td className="text-xs"><Value>{p.propertyType}</Value></td>
                    <td className="text-right text-xs tnum"><Value mono>{formatMoney(p.askingPrice)}</Value></td>
                    <td className="text-right text-xs tnum">
                      {p.buildingSqft
                        ? formatSqft(p.buildingSqft)
                        : <Value mono>{formatAcres(p.landAcreage)}</Value>}
                    </td>
                    <td className="text-xs"><Value>{p.ownerEntityName}</Value></td>
                    <td className="text-xs">
                      {rel
                        ? <span className={rel.days < 0 ? 'font-medium text-red-700' : 'text-ink-700'}>{rel.label}</span>
                        : <span className="unknown">None</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
