import Link from 'next/link';
import { and, asc, eq, isNull, sql as raw } from 'drizzle-orm';
import {
  ArrowRight, Building2, CalendarClock, Inbox, MapPin, Plus, TrendingUp,
} from 'lucide-react';
import { db } from '@/db';
import {
  discoveryResults, mallAnchors, markets, opportunities, properties,
  transactionStages,
} from '@/db/schema';
import { requirePageUser } from '@/lib/auth/guards';
import { getFollowUpCounts, getRecentActivity } from '@/lib/services/activities';
import { listOpportunities } from '@/lib/services/opportunities';
import { showSampleData } from '@/lib/services/settings';
import {
  ACTIVITY_TYPE_LABELS, CALL_OUTCOME_LABELS, formatDate, formatDateTime, formatMoney,
  propertyTitle, relativeDays,
} from '@/lib/format';
import { EmptyState, StatusChip, Value } from '@/components/ui/primitives';
import { GlobalSearch } from '@/components/search/global-search';

export const metadata = { title: 'Dashboard' };
export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  await requirePageUser();

  // One decision, applied to every panel on this screen. Mixing "counts include
  // samples" with "lists exclude samples" makes the dashboard contradict itself.
  const includeSample = await showSampleData();

  const [marketRows, followUps, recent, pipeline, discoveryPending, totals, sampleCount] = await Promise.all([
    db
      .select({
        id: markets.id,
        name: markets.name,
        state: markets.state,
        anchorCount: raw<number>`(select count(*)::int from mall_anchors ma
          where ma.market_id = markets.id and ma.archived_at is null)`,
        propertyCount: raw<number>`(select count(*)::int from properties p
          where p.market_id = markets.id and p.archived_at is null)`,
        needsPlacement: raw<number>`(select count(*)::int from mall_anchors ma
          where ma.market_id = markets.id and ma.needs_map_placement = true
            and ma.archived_at is null)`,
      })
      .from(markets)
      .where(isNull(markets.archivedAt))
      .orderBy(asc(markets.name)),

    getFollowUpCounts({ includeSample }),
    getRecentActivity(8, includeSample),
    listOpportunities({ includeSample }),
    db.select({ id: discoveryResults.id }).from(discoveryResults).where(eq(discoveryResults.status, 'new')),

    db
      .select({
        total: raw<number>`count(*)::int`,
        needingOutline: raw<number>`count(*) filter (where properties.needs_parcel_outline)::int`,
        needingPlacement: raw<number>`count(*) filter (where properties.needs_map_placement)::int`,
      })
      .from(properties)
      .where(includeSample
        ? isNull(properties.archivedAt)
        : and(isNull(properties.archivedAt), eq(properties.isSample, false))),

    db.select({ n: raw<number>`count(*)::int` }).from(properties).where(eq(properties.isSample, true)),
  ]);

  const stats = totals[0] ?? { total: 0, needingOutline: 0, needingPlacement: 0 };
  const dueNow = followUps.overdue + followUps.today;
  const sampleRecords = sampleCount[0]?.n ?? 0;

  return (
    <>
      <header className="flex shrink-0 items-center justify-between gap-4 border-b border-ink-200 bg-white px-6 py-3">
        <div>
          <h1 className="text-base font-semibold tracking-tight text-ink-900">Portfolio</h1>
          <p className="text-xs text-ink-500">Markets, properties and current work</p>
        </div>
        <div className="flex items-center gap-2">
          <GlobalSearch />
          <Link href="/markets/new" className="btn-primary btn-sm">
            <Plus size={14} /> New market
          </Link>
        </div>
      </header>

      <div className="scroll-thin flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-[1500px] space-y-6">

          {includeSample && sampleRecords > 0 && (
            <div className="banner-warn">
              <span>
                <strong>Showing {sampleRecords} demonstration records.</strong> Every sample
                record is prefixed &ldquo;SAMPLE&rdquo; and badged in lists. Hide or delete them
                in{' '}
                <Link href="/settings" className="underline underline-offset-2">Settings</Link>{' '}
                once you have loaded real data.
              </span>
            </div>
          )}

          {/* ---------------------------------------------------- Stat row */}
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatCard
              icon={<Building2 size={16} />} label="Properties tracked"
              value={stats.total} href="/properties"
              note={stats.needingOutline > 0 ? `${stats.needingOutline} need a parcel outline` : undefined}
            />
            <StatCard
              icon={<CalendarClock size={16} />} label="Follow-ups due"
              value={dueNow} href="/follow-ups" tone={followUps.overdue > 0 ? 'danger' : 'default'}
              note={followUps.overdue > 0 ? `${followUps.overdue} overdue` : 'Nothing overdue'}
            />
            <StatCard
              icon={<TrendingUp size={16} />} label="Active opportunities"
              value={pipeline.length} href="/pipeline"
              note="Explicitly promoted only"
            />
            <StatCard
              icon={<Inbox size={16} />} label="Discovery to review"
              value={discoveryPending.length} href="/discovery"
              note={discoveryPending.length === 0 ? 'Inbox clear' : undefined}
            />
          </div>

          <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
            {/* ------------------------------------------------- Markets */}
            <section className="card xl:col-span-2">
              <div className="card-header">
                <h2 className="card-title">Markets</h2>
                <Link href="/markets" className="btn-ghost btn-sm">
                  View all <ArrowRight size={13} />
                </Link>
              </div>

              {marketRows.length === 0 ? (
                <EmptyState
                  icon={<MapPin size={24} />}
                  title="No markets yet"
                  body="A market holds your mall anchors and the properties around them. Create one, or import your mall list from a spreadsheet."
                  action={
                    <div className="flex gap-2">
                      <Link href="/markets/new" className="btn-primary btn-sm">Create a market</Link>
                      <Link href="/settings/imports" className="btn-secondary btn-sm">Import malls</Link>
                    </div>
                  }
                />
              ) : (
                <div className="scroll-thin max-h-[420px] overflow-y-auto">
                  <table className="table-dense">
                    <thead>
                      <tr>
                        <th>Market</th>
                        <th className="w-20 text-right">Malls</th>
                        <th className="w-24 text-right">Properties</th>
                      </tr>
                    </thead>
                    <tbody>
                      {marketRows.map((m) => (
                        <tr key={m.id}>
                          <td>
                            <Link href={`/markets/${m.id}`} className="font-medium text-ink-900 hover:text-accent-700">
                              {m.name}
                            </Link>
                            {m.state && <span className="ml-1.5 text-xs text-ink-500">{m.state}</span>}
                            {m.needsPlacement > 0 && (
                              <span className="ml-2 chip border-amber-300 bg-amber-50 text-amber-800">
                                {m.needsPlacement} need map placement
                              </span>
                            )}
                          </td>
                          <td className="text-right tnum text-ink-700">{m.anchorCount}</td>
                          <td className="text-right tnum text-ink-700">{m.propertyCount}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            {/* ------------------------------------------ Recent activity */}
            <section className="card">
              <div className="card-header">
                <h2 className="card-title">Recent activity</h2>
              </div>

              {recent.length === 0 ? (
                <EmptyState
                  title="No calls or notes yet"
                  body="Activity logged against any property appears here, newest first."
                />
              ) : (
                <ul className="divide-y divide-ink-100">
                  {recent.map((a) => (
                    <li key={a.id} className="px-4 py-2.5">
                      <Link href={`/properties/${a.propertyId}`} className="group block">
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="truncate text-sm font-medium text-ink-900 group-hover:text-accent-700">
                            {propertyTitle({ name: a.propertyName, addressLine1: a.propertyAddress })}
                          </span>
                          <span className="shrink-0 text-[11px] text-ink-400">
                            {formatDate(a.occurredAt)}
                          </span>
                        </div>
                        <div className="mt-0.5 text-xs text-ink-600">
                          {a.outcome
                            ? CALL_OUTCOME_LABELS[a.outcome] ?? a.outcome
                            : ACTIVITY_TYPE_LABELS[a.type] ?? a.type}
                          {a.contactName && <span className="text-ink-500"> · {a.contactName}</span>}
                        </div>
                        {a.notes && (
                          <p className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-ink-500">{a.notes}</p>
                        )}
                        <div className="mt-0.5 text-[11px] text-ink-400">{a.authorLabel}</div>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>

          {/* ------------------------------------------- Pipeline summary */}
          <section className="card">
            <div className="card-header">
              <div>
                <h2 className="card-title">Active transaction pipeline</h2>
                <p className="mt-0.5 text-[11px] text-ink-500">
                  Only properties explicitly promoted to an opportunity. Routine calls and
                  follow-ups stay out of this queue.
                </p>
              </div>
              <Link href="/pipeline" className="btn-ghost btn-sm">
                Open pipeline <ArrowRight size={13} />
              </Link>
            </div>

            {pipeline.length === 0 ? (
              <EmptyState
                icon={<TrendingUp size={24} />}
                title="Nothing in the pipeline"
                body="When a conversation turns into a real acquisition prospect, open the property and choose Promote to Opportunity."
              />
            ) : (
              <table className="table-dense">
                <thead>
                  <tr>
                    <th>Opportunity</th>
                    <th className="w-48">Stage</th>
                    <th className="w-32">Market</th>
                    <th className="w-32 text-right">Target price</th>
                    <th className="w-40">Next step</th>
                  </tr>
                </thead>
                <tbody>
                  {pipeline.slice(0, 8).map((o) => {
                    const rel = relativeDays(o.nextStepDate);
                    return (
                      <tr key={o.id}>
                        <td>
                          <Link href={`/pipeline/${o.id}`} className="font-medium text-ink-900 hover:text-accent-700">
                            {o.name}
                          </Link>
                          {o.isSample && <span className="ml-2 text-[11px] text-amber-700">Sample</span>}
                        </td>
                        <td><StatusChip label={o.stageLabel} color={o.stageColor} /></td>
                        <td className="text-ink-600"><Value>{o.marketName}</Value></td>
                        <td className="text-right tnum"><Value mono>{formatMoney(o.targetPrice)}</Value></td>
                        <td>
                          {o.nextStep ? (
                            <div className="truncate text-xs text-ink-700" title={o.nextStep}>
                              {o.nextStep}
                              {rel && (
                                <span className={rel.days < 0 ? 'ml-1 text-red-700' : 'ml-1 text-ink-500'}>
                                  ({rel.label})
                                </span>
                              )}
                            </div>
                          ) : (
                            <span className="unknown text-xs">No next step set</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </section>
        </div>
      </div>
    </>
  );
}

function StatCard({
  icon, label, value, href, note, tone = 'default',
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  href: string;
  note?: string;
  tone?: 'default' | 'danger';
}) {
  return (
    <Link href={href} className="card block p-4 transition-shadow hover:shadow-md">
      <div className="flex items-center gap-1.5 text-ink-500">
        {icon}
        <span className="stat-label">{label}</span>
      </div>
      <div className={`stat-value mt-1.5 ${tone === 'danger' && value > 0 ? 'text-red-700' : ''}`}>
        {value}
      </div>
      {note && <div className="mt-0.5 text-[11px] text-ink-500">{note}</div>}
    </Link>
  );
}
