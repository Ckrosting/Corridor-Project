import Link from 'next/link';
import { asc, sql as raw } from 'drizzle-orm';
import { MapPin, Plus } from 'lucide-react';
import { db } from '@/db';
import { markets } from '@/db/schema';
import { requirePageUser } from '@/lib/auth/guards';
import { EmptyState } from '@/components/ui/primitives';
import { MarketRestoreButton, ShowArchivedMarketsToggle } from './market-restore-controls';

export const metadata = { title: 'Markets' };
export const dynamic = 'force-dynamic';

export default async function MarketsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requirePageUser();
  const sp = await searchParams;
  const includeArchived = sp.includeArchived === 'true';

  const all = await db
    .select({
      id: markets.id,
      name: markets.name,
      state: markets.state,
      notes: markets.notes,
      version: markets.version,
      archivedAt: markets.archivedAt,
      anchorCount: raw<number>`(select count(*)::int from mall_anchors ma
        where ma.market_id = markets.id and ma.archived_at is null)`,
      needsPlacement: raw<number>`(select count(*)::int from mall_anchors ma
        where ma.market_id = markets.id and ma.needs_map_placement = true and ma.archived_at is null)`,
      propertyCount: raw<number>`(select count(*)::int from properties p
        where p.market_id = markets.id and p.archived_at is null)`,
    })
    .from(markets)
    .orderBy(asc(markets.name));

  const rows = includeArchived ? all : all.filter((m) => !m.archivedAt);

  return (
    <>
      <header className="flex shrink-0 items-center justify-between gap-4 border-b border-ink-200 bg-white px-6 py-3">
        <div>
          <h1 className="text-base font-semibold tracking-tight text-ink-900">Markets</h1>
          <p className="text-xs text-ink-500">{rows.length} markets</p>
        </div>
        <div className="flex items-center gap-3">
          <ShowArchivedMarketsToggle checked={includeArchived} />
          <Link href="/settings/imports" className="btn-secondary btn-sm">Import malls</Link>
          <Link href="/markets/new" className="btn-primary btn-sm"><Plus size={14} /> New market</Link>
        </div>
      </header>

      <div className="scroll-thin flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-[1200px] space-y-4">
          {rows.length === 0 ? (
            <div className="card">
              <EmptyState
                icon={<MapPin size={26} />}
                title="No markets yet"
                body="A market is one of your malls and the properties you track around it. Create one by hand, or import your whole mall list from a spreadsheet."
                action={
                  <div className="flex gap-2">
                    <Link href="/markets/new" className="btn-primary btn-sm">Create a market</Link>
                    <Link href="/settings/imports" className="btn-secondary btn-sm">Import malls</Link>
                  </div>
                }
              />
            </div>
          ) : (
            rows.map((m) => (
              <section key={m.id} className="card">
                <div className="card-header">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      {m.archivedAt ? (
                        <span className="card-title text-ink-400 line-through">{m.name}</span>
                      ) : (
                        <Link href={`/markets/${m.id}`} className="card-title hover:text-accent-700">
                          {m.name}
                        </Link>
                      )}
                      {m.archivedAt && <span className="chip border-red-200 bg-red-50 text-red-700">Deleted</span>}
                    </div>
                    <p className="mt-0.5 text-xs text-ink-500">
                      {m.anchorCount} mall{m.anchorCount === 1 ? '' : 's'} ·
                      {' '}{m.propertyCount} propert{m.propertyCount === 1 ? 'y' : 'ies'}
                      {m.needsPlacement > 0 && (
                        <span className="ml-1.5 text-amber-700">
                          · {m.needsPlacement} mall{m.needsPlacement === 1 ? '' : 's'} need map placement
                        </span>
                      )}
                    </p>
                  </div>
                  {m.archivedAt ? (
                    <MarketRestoreButton marketId={m.id} version={m.version} />
                  ) : (
                    <Link href={`/markets/${m.id}`} className="btn-secondary btn-sm">Open market</Link>
                  )}
                </div>
              </section>
            ))
          )}
        </div>
      </div>
    </>
  );
}
