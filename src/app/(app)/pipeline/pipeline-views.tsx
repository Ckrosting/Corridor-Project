'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Columns3, Table2 } from 'lucide-react';
import { formatDate, formatMoney, relativeDays } from '@/lib/format';
import { SampleBadge, StatusChip, Value } from '@/components/ui/primitives';

interface Opportunity {
  id: string;
  name: string;
  state: string;
  stageId: string;
  stageLabel: string | null;
  stageColor: string | null;
  stageSort: number | null;
  stageCategory: string | null;
  marketName: string | null;
  targetPrice: string | null;
  offerPrice: string | null;
  contractPrice: string | null;
  expectedCloseDate: string | null;
  nextStep: string | null;
  nextStepDate: string | null;
  promotedAt: string | Date;
  promotionReason: string;
  promotedByLabel: string | null;
  propertyCount: number;
  isSample: boolean;
}

interface Stage {
  id: string; label: string; color: string;
  sortOrder: number; isTerminal: boolean; category: string;
}

/** Table and board views over the same explicitly-promoted opportunities. */
export function PipelineViews({
  opportunities, stages, markets,
}: {
  opportunities: Opportunity[];
  stages: Stage[];
  markets: Array<{ id: string; name: string }>;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [view, setView] = useState<'board' | 'table'>('board');

  const apply = (mutate: (p: URLSearchParams) => void) => {
    const next = new URLSearchParams(params.toString());
    mutate(next);
    router.push(`${pathname}?${next.toString()}`);
  };

  const byStage = useMemo(() => {
    const map = new Map<string, Opportunity[]>();
    for (const s of stages) map.set(s.id, []);
    for (const o of opportunities) {
      if (!map.has(o.stageId)) map.set(o.stageId, []);
      map.get(o.stageId)!.push(o);
    }
    return map;
  }, [opportunities, stages]);

  const visibleStages = stages.filter(
    (s) => !s.isTerminal || params.get('includeTerminal') === 'true' || (byStage.get(s.id)?.length ?? 0) > 0,
  );

  return (
    <>
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-ink-200 bg-white px-6 py-2.5">
        <div className="flex rounded-md border border-ink-300">
          <button
            type="button"
            onClick={() => setView('board')}
            className={`flex items-center gap-1 px-2.5 py-1 text-xs font-medium ${
              view === 'board' ? 'bg-accent-600 text-white' : 'text-ink-600 hover:bg-ink-50'
            }`}
          >
            <Columns3 size={13} /> Board
          </button>
          <button
            type="button"
            onClick={() => setView('table')}
            className={`flex items-center gap-1 px-2.5 py-1 text-xs font-medium ${
              view === 'table' ? 'bg-accent-600 text-white' : 'text-ink-600 hover:bg-ink-50'
            }`}
          >
            <Table2 size={13} /> Table
          </button>
        </div>

        <select
          className="input w-auto py-1 text-xs"
          value={params.get('marketId') ?? ''}
          onChange={(e) => apply((p) => { if (e.target.value) p.set('marketId', e.target.value); else p.delete('marketId'); })}
        >
          <option value="">All markets</option>
          {markets.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>

        <label className="flex items-center gap-1.5 text-xs text-ink-600">
          <input
            type="checkbox"
            checked={params.get('includeTerminal') === 'true'}
            onChange={(e) => apply((p) => { if (e.target.checked) p.set('includeTerminal', 'true'); else p.delete('includeTerminal'); })}
          />
          Show closed / dead / on hold
        </label>

        <label className="flex items-center gap-1.5 text-xs text-ink-600">
          <input
            type="checkbox"
            checked={params.get('includeRemoved') === 'true'}
            onChange={(e) => apply((p) => { if (e.target.checked) p.set('includeRemoved', 'true'); else p.delete('includeRemoved'); })}
          />
          Show removed from pipeline
        </label>
      </div>

      {view === 'board' ? (
        <div className="scroll-thin flex-1 overflow-x-auto p-4">
          <div className="flex h-full gap-3">
            {visibleStages.map((stage) => {
              const items = byStage.get(stage.id) ?? [];
              return (
                <div key={stage.id} className="flex w-72 shrink-0 flex-col rounded-lg border border-ink-200 bg-white">
                  <div className="flex items-center justify-between gap-2 border-b border-ink-200 px-3 py-2">
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: stage.color }} />
                      <span className="truncate text-xs font-semibold text-ink-800">{stage.label}</span>
                    </span>
                    <span className="shrink-0 text-[11px] text-ink-500 tnum">{items.length}</span>
                  </div>

                  <div className="scroll-thin flex-1 space-y-2 overflow-y-auto p-2">
                    {items.length === 0 ? (
                      <p className="px-1 py-3 text-center text-[11px] text-ink-400">No opportunities</p>
                    ) : (
                      items.map((o) => {
                        const rel = relativeDays(o.nextStepDate);
                        return (
                          <Link
                            key={o.id}
                            href={`/pipeline/${o.id}`}
                            className="block rounded-md border border-ink-200 p-2.5 transition-shadow hover:shadow-sm"
                          >
                            <div className="flex items-start gap-1.5">
                              <span className="min-w-0 flex-1 text-xs font-medium text-ink-900">{o.name}</span>
                              {o.isSample && <SampleBadge />}
                            </div>
                            <div className="mt-1 text-[11px] text-ink-500">
                              {o.marketName ?? 'No market'}
                              {o.propertyCount > 1 && ` · ${o.propertyCount} properties`}
                            </div>
                            <div className="mt-1 text-xs tnum">
                              <Value mono>{formatMoney(o.targetPrice)}</Value>
                            </div>
                            {o.nextStep && (
                              <div className="mt-1 truncate text-[11px] text-ink-600" title={o.nextStep}>
                                {o.nextStep}
                                {rel && <span className={rel.days < 0 ? ' text-red-700' : ' text-ink-400'}> ({rel.label})</span>}
                              </div>
                            )}
                            {o.state === 'removed' && (
                              <div className="mt-1 text-[10px] font-medium text-ink-500">Removed from pipeline</div>
                            )}
                          </Link>
                        );
                      })
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="scroll-thin flex-1 overflow-auto">
          <table className="table-dense">
            <thead>
              <tr>
                <th className="min-w-[260px]">Opportunity</th>
                <th className="w-44">Stage</th>
                <th className="w-32">Market</th>
                <th className="w-28 text-right">Target</th>
                <th className="w-28 text-right">Offer</th>
                <th className="w-32">Next step</th>
                <th className="w-28">Promoted</th>
              </tr>
            </thead>
            <tbody>
              {opportunities.map((o) => {
                const rel = relativeDays(o.nextStepDate);
                return (
                  <tr key={o.id}>
                    <td>
                      <Link href={`/pipeline/${o.id}`} className="flex items-center gap-1.5">
                        <span className="font-medium text-ink-900 hover:text-accent-700">{o.name}</span>
                        {o.isSample && <SampleBadge />}
                      </Link>
                      <div className="line-clamp-1 text-[11px] text-ink-500" title={o.promotionReason}>
                        {o.promotionReason}
                      </div>
                    </td>
                    <td>
                      <StatusChip label={o.stageLabel} color={o.stageColor} />
                      {o.state === 'removed' && (
                        <div className="mt-0.5 text-[10px] text-ink-500">Removed</div>
                      )}
                    </td>
                    <td className="text-xs"><Value>{o.marketName}</Value></td>
                    <td className="text-right text-xs tnum"><Value mono>{formatMoney(o.targetPrice)}</Value></td>
                    <td className="text-right text-xs tnum"><Value mono>{formatMoney(o.offerPrice)}</Value></td>
                    <td className="text-xs">
                      {o.nextStep ? (
                        <>
                          <div className="truncate" title={o.nextStep}>{o.nextStep}</div>
                          {rel && <div className={rel.days < 0 ? 'text-[11px] text-red-700' : 'text-[11px] text-ink-500'}>{rel.label}</div>}
                        </>
                      ) : <span className="unknown">Not set</span>}
                    </td>
                    <td className="text-xs text-ink-600">
                      {formatDate(o.promotedAt)}
                      <div className="text-[11px] text-ink-400">{o.promotedByLabel ?? ''}</div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
