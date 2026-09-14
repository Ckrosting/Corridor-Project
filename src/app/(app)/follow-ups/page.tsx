import Link from 'next/link';
import { CalendarClock, CalendarX2 } from 'lucide-react';
import { requirePageUser } from '@/lib/auth/guards';
import { getFollowUps, type FollowUpBucket } from '@/lib/services/activities';
import { showSampleData } from '@/lib/services/settings';
import { formatAddress, formatDate, formatDateTime, propertyTitle, relativeDays } from '@/lib/format';
import { EmptyState, SampleBadge, StatusChip } from '@/components/ui/primitives';

export const metadata = { title: 'Follow-ups' };
export const dynamic = 'force-dynamic';

const BUCKETS: Array<{
  key: FollowUpBucket; label: string; blurb: string; tone: 'danger' | 'warn' | 'default';
}> = [
  { key: 'overdue', label: 'Overdue', blurb: 'Past their follow-up date.', tone: 'danger' },
  { key: 'today', label: 'Today', blurb: 'Due today.', tone: 'warn' },
  { key: 'upcoming', label: 'Upcoming', blurb: 'Scheduled ahead.', tone: 'default' },
  {
    key: 'unscheduled',
    label: 'No follow-up scheduled',
    // The restriction is the whole point of this queue, so it is stated in the UI.
    blurb: 'Actively pursued properties with no next date set.',
    tone: 'default',
  },
];

export default async function FollowUpsPage() {
  await requirePageUser();
  const includeSample = await showSampleData();

  const results = await Promise.all(
    BUCKETS.map((b) => getFollowUps(b.key, { includeSample, limit: 300 })),
  );

  const total = results.reduce((sum, r) => sum + r.length, 0);

  return (
    <>
      <header className="flex shrink-0 items-center justify-between gap-4 border-b border-ink-200 bg-white px-6 py-3">
        <div>
          <h1 className="text-base font-semibold tracking-tight text-ink-900">Follow-ups</h1>
          <p className="text-xs text-ink-500">{total} propert{total === 1 ? 'y' : 'ies'} in your queues</p>
        </div>
      </header>

      <div className="scroll-thin flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-[1200px] space-y-5">
          {BUCKETS.map((bucket, i) => {
            const rows = results[i]!;
            return (
              <section key={bucket.key} className="card">
                <div className="card-header">
                  <div>
                    <h2 className="card-title flex items-center gap-1.5">
                      {bucket.key === 'unscheduled' ? <CalendarX2 size={14} /> : <CalendarClock size={14} />}
                      {bucket.label}
                      <span
                        className={`ml-1 rounded-full px-1.5 py-px text-[10px] font-semibold tnum ${
                          rows.length === 0
                            ? 'bg-ink-100 text-ink-500'
                            : bucket.tone === 'danger'
                              ? 'bg-red-100 text-red-800'
                              : bucket.tone === 'warn'
                                ? 'bg-amber-100 text-amber-800'
                                : 'bg-ink-200 text-ink-700'
                        }`}
                      >
                        {rows.length}
                      </span>
                    </h2>
                    <p className="mt-0.5 text-[11px] text-ink-500">{bucket.blurb}</p>
                  </div>
                </div>

                {rows.length === 0 ? (
                  <EmptyState
                    title={
                      bucket.key === 'overdue' ? 'Nothing overdue'
                        : bucket.key === 'today' ? 'Nothing due today'
                          : bucket.key === 'upcoming' ? 'Nothing scheduled ahead'
                            : 'Every actively pursued property has a next date'
                    }
                    body={
                      bucket.key === 'unscheduled'
                        ? 'Properties still in Needs Research or Monitoring are deliberately excluded here, so this queue stays about work you have actually picked up.'
                        : undefined
                    }
                  />
                ) : (
                  <table className="table-dense">
                    <thead>
                      <tr>
                        <th>Property</th>
                        <th className="w-40">Outreach status</th>
                        <th className="w-36">Follow-up</th>
                        <th className="w-40">Last activity</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => {
                        const rel = relativeDays(r.nextFollowUpDate);
                        return (
                          <tr key={r.id}>
                            <td>
                              <Link href={`/properties/${r.id}`} className="flex items-center gap-1.5">
                                <span className="font-medium text-ink-900 hover:text-accent-700">
                                  {propertyTitle(r)}
                                </span>
                                {r.isSample && <SampleBadge />}
                              </Link>
                              <div className="text-[11px] text-ink-500">{formatAddress(r)}</div>
                            </td>
                            <td>
                              <StatusChip label={r.outreachStatusLabel} color={r.outreachStatusColor} />
                            </td>
                            <td className="text-xs">
                              {r.nextFollowUpDate ? (
                                <>
                                  <div className={rel && rel.days < 0 ? 'font-medium text-red-700' : 'text-ink-800'}>
                                    {formatDate(r.nextFollowUpDate)}
                                  </div>
                                  {rel && <div className="text-[11px] text-ink-500">{rel.label}</div>}
                                </>
                              ) : (
                                <span className="unknown">Not scheduled</span>
                              )}
                            </td>
                            <td className="text-xs text-ink-600">
                              {r.lastActivityAt
                                ? formatDateTime(r.lastActivityAt)
                                : <span className="unknown">No calls logged</span>}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </section>
            );
          })}
        </div>
      </div>
    </>
  );
}
