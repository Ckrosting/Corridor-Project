import Link from 'next/link';
import { asc, isNull, sql as raw } from 'drizzle-orm';
import { MapPin, Plus } from 'lucide-react';
import { db } from '@/db';
import { corridors, markets } from '@/db/schema';
import { requirePageUser } from '@/lib/auth/guards';
import { EmptyState } from '@/components/ui/primitives';

export const metadata = { title: 'Markets & Corridors' };
export const dynamic = 'force-dynamic';

export default async function MarketsPage() {
  await requirePageUser();

  const rows = await db
    .select({
      id: markets.id,
      name: markets.name,
      state: markets.state,
      notes: markets.notes,
      anchorCount: raw<number>`(select count(*)::int from mall_anchors ma
        where ma.market_id = markets.id and ma.archived_at is null)`,
      needsPlacement: raw<number>`(select count(*)::int from mall_anchors ma
        where ma.market_id = markets.id and ma.needs_map_placement = true and ma.archived_at is null)`,
      propertyCount: raw<number>`(select count(*)::int from properties p
        where p.market_id = markets.id and p.archived_at is null)`,
    })
    .from(markets)
    .where(isNull(markets.archivedAt))
    .orderBy(asc(markets.name));

  const allCorridors = await db
    .select({
      id: corridors.id, name: corridors.name, color: corridors.color,
      marketId: corridors.marketId, boundaryKind: corridors.boundaryKind,
      propertyCount: raw<number>`(select count(*)::int from property_corridors pc
        where pc.corridor_id = corridors.id)`,
    })
    .from(corridors)
    .where(isNull(corridors.archivedAt))
    .orderBy(asc(corridors.sortOrder), asc(corridors.name));

  const byMarket = new Map<string, typeof allCorridors>();
  for (const c of allCorridors) {
    if (!byMarket.has(c.marketId)) byMarket.set(c.marketId, []);
    byMarket.get(c.marketId)!.push(c);
  }

  return (
    <>
      <header className="flex shrink-0 items-center justify-between gap-4 border-b border-ink-200 bg-white px-6 py-3">
        <div>
          <h1 className="text-base font-semibold tracking-tight text-ink-900">Markets &amp; Corridors</h1>
          <p className="text-xs text-ink-500">{rows.length} markets · {allCorridors.length} corridors</p>
        </div>
        <div className="flex gap-2">
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
                body="A market is one of your malls and the commercial corridors around it. Create one by hand, or import your whole mall list from a spreadsheet."
                action={
                  <div className="flex gap-2">
                    <Link href="/markets/new" className="btn-primary btn-sm">Create a market</Link>
                    <Link href="/settings/imports" className="btn-secondary btn-sm">Import malls</Link>
                  </div>
                }
              />
            </div>
          ) : (
            rows.map((m) => {
              const list = byMarket.get(m.id) ?? [];
              return (
                <section key={m.id} className="card">
                  <div className="card-header">
                    <div className="min-w-0">
                      <Link href={`/markets/${m.id}`} className="card-title hover:text-accent-700">
                        {m.name}
                      </Link>
                      <p className="mt-0.5 text-xs text-ink-500">
                        {m.anchorCount} mall{m.anchorCount === 1 ? '' : 's'} ·
                        {' '}{list.length} corridor{list.length === 1 ? '' : 's'} ·
                        {' '}{m.propertyCount} propert{m.propertyCount === 1 ? 'y' : 'ies'}
                        {m.needsPlacement > 0 && (
                          <span className="ml-1.5 text-amber-700">
                            · {m.needsPlacement} mall{m.needsPlacement === 1 ? '' : 's'} need map placement
                          </span>
                        )}
                      </p>
                    </div>
                    <Link href={`/markets/${m.id}`} className="btn-secondary btn-sm">Open market</Link>
                  </div>

                  {list.length === 0 ? (
                    <div className="px-4 py-4 text-xs text-ink-500">
                      No corridors yet. Open the market to draw one around a mall anchor.
                    </div>
                  ) : (
                    <ul className="divide-y divide-ink-100">
                      {list.map((c) => (
                        <li key={c.id}>
                          <Link
                            href={`/corridors/${c.id}`}
                            className="flex items-center justify-between gap-3 px-4 py-2 hover:bg-accent-50"
                          >
                            <span className="flex min-w-0 items-center gap-2">
                              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: c.color }} />
                              <span className="truncate text-sm text-ink-900">{c.name}</span>
                              <span className="shrink-0 text-[11px] text-ink-400">
                                {c.boundaryKind === 'radius' ? 'radius' : 'drawn boundary'}
                              </span>
                            </span>
                            <span className="shrink-0 text-xs text-ink-500 tnum">
                              {c.propertyCount} propert{c.propertyCount === 1 ? 'y' : 'ies'}
                            </span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              );
            })
          )}
        </div>
      </div>
    </>
  );
}
