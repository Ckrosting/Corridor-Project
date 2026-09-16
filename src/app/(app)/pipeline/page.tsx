import Link from 'next/link';
import { asc, isNull } from 'drizzle-orm';
import { TrendingUp } from 'lucide-react';
import { db } from '@/db';
import { markets, transactionStages } from '@/db/schema';
import { requirePageUser } from '@/lib/auth/guards';
import { listOpportunities } from '@/lib/services/opportunities';
import { showSampleData } from '@/lib/services/settings';
import { EmptyState } from '@/components/ui/primitives';
import { PipelineViews } from './pipeline-views';

export const metadata = { title: 'Pipeline' };
export const dynamic = 'force-dynamic';

export default async function PipelinePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requirePageUser();
  const sp = await searchParams;
  const one = (k: string) => (Array.isArray(sp[k]) ? sp[k][0] : sp[k]) as string | undefined;

  const includeSample = await showSampleData();
  const includeTerminal = one('includeTerminal') === 'true';
  const includeRemoved = one('includeRemoved') === 'true';

  const [rows, stages, marketList] = await Promise.all([
    listOpportunities({
      marketId: one('marketId'),
      includeTerminal,
      includeRemoved,
      includeSample,
      search: one('q'),
    }),
    db.select().from(transactionStages).where(isNull(transactionStages.archivedAt)).orderBy(asc(transactionStages.sortOrder)),
    db.select({ id: markets.id, name: markets.name }).from(markets).where(isNull(markets.archivedAt)).orderBy(asc(markets.name)),
  ]);

  return (
    <>
      <header className="flex shrink-0 items-center justify-between gap-4 border-b border-ink-200 bg-white px-6 py-3">
        <div>
          <h1 className="text-base font-semibold tracking-tight text-ink-900">Transaction pipeline</h1>
          <p className="text-xs text-ink-500">
            {rows.length} opportunit{rows.length === 1 ? 'y' : 'ies'} · only properties explicitly promoted
          </p>
        </div>
      </header>

      {rows.length === 0 && !includeTerminal && !includeRemoved ? (
        <div className="flex-1 p-6">
          <div className="card mx-auto max-w-2xl">
            <EmptyState
              icon={<TrendingUp size={28} />}
              title="Nothing in the pipeline"
              body="An opportunity is created only when someone opens a property and chooses Promote to Opportunity, giving a reason. Calls, follow-ups and status changes deliberately never put a property here — that keeps this queue about real deals rather than routine outreach."
              action={<Link href="/properties" className="btn-primary btn-sm">Browse properties</Link>}
            />
          </div>
        </div>
      ) : (
        <PipelineViews
          opportunities={rows}
          stages={stages.map((s) => ({
            id: s.id, label: s.label, color: s.color,
            sortOrder: s.sortOrder, isTerminal: s.isTerminal, category: s.category,
          }))}
          markets={marketList}
        />
      )}
    </>
  );
}
