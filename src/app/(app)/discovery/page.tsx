import { asc, isNull } from 'drizzle-orm';
import { Inbox } from 'lucide-react';
import { db } from '@/db';
import { markets } from '@/db/schema';
import { requirePageUser } from '@/lib/auth/guards';
import { listDiscoveryResults } from '@/lib/services/discovery';
import { listRecentScans } from '@/lib/services/jobs';
import { aiStatus } from '@/lib/ai/client';
import { monthToDateSpendUsd } from '@/lib/services/discovery';
import { getSetting, SETTING_KEYS } from '@/lib/services/settings';
import { env } from '@/lib/env';
import { DiscoveryInbox } from './discovery-inbox';

export const metadata = { title: 'Discovery Inbox' };
export const dynamic = 'force-dynamic';

export default async function DiscoveryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requirePageUser();
  const sp = await searchParams;
  const statusParam = (Array.isArray(sp.status) ? sp.status[0] : sp.status) ?? 'new';

  const [results, scans, marketList, spend, budget] = await Promise.all([
    listDiscoveryResults({
      status: statusParam === 'all' ? undefined : statusParam.split(','),
      limit: 300,
    }),
    listRecentScans(12),
    db.select({ id: markets.id, name: markets.name }).from(markets)
      .where(isNull(markets.archivedAt)).orderBy(asc(markets.name)),
    monthToDateSpendUsd(),
    getSetting<number>(SETTING_KEYS.aiMonthlyBudgetUsd).then((v) => v ?? env.ai.monthlyBudgetUsd),
  ]);

  const status = aiStatus();

  return (
    <>
      <header className="flex shrink-0 items-center justify-between gap-4 border-b border-ink-200 bg-white px-6 py-3">
        <div>
          <h1 className="flex items-center gap-1.5 text-base font-semibold tracking-tight text-ink-900">
            <Inbox size={16} /> Discovery inbox
          </h1>
          <p className="text-xs text-ink-500">
            Candidate listings awaiting review. Nothing here is a property record until you approve it.
          </p>
        </div>
      </header>

      <DiscoveryInbox
        results={results.map((r) => ({
          ...r.r,
          corridorName: r.corridorName,
          marketName: r.marketName,
          suggestedPropertyName: r.suggestedPropertyName,
        }))}
        scans={scans.map((s) => ({
          ...s.s,
          jobError: s.jobError,
          jobCancelRequested: s.jobCancelRequested,
        }))}
        markets={marketList}
        activeStatus={statusParam}
        ai={{ ...status, spendThisMonthUsd: spend, budgetUsd: budget }}
      />
    </>
  );
}
