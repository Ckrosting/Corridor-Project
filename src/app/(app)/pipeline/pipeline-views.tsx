'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Columns3, Table2, TriangleAlert } from 'lucide-react';
import { formatDate, formatMoney, relativeDays } from '@/lib/format';
import { LOST_REASONS, lostReasonLabel } from '@/lib/lost-reasons';
import { dealValue, pipelineTotal } from '@/lib/pipeline-value';
import { SampleBadge, Spinner, StatusChip, Value } from '@/components/ui/primitives';

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
  lostReason: string | null;
  nextStep: string | null;
  nextStepDate: string | null;
  promotedAt: string | Date;
  promotionReason: string;
  promotedByLabel: string | null;
  propertyCount: number;
  isSample: boolean;
  version: number;
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

  // The board mutates stages in place, so it renders from local state and only
  // re-syncs when the server sends a fresh list.
  const [items, setItems] = useState(opportunities);
  useEffect(() => { setItems(opportunities); }, [opportunities]);

  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lostPrompt, setLostPrompt] = useState<{ opportunity: Opportunity; stage: Stage } | null>(null);

  const apply = (mutate: (p: URLSearchParams) => void) => {
    const next = new URLSearchParams(params.toString());
    mutate(next);
    router.push(`${pathname}?${next.toString()}`);
  };

  const byStage = useMemo(() => {
    const map = new Map<string, Opportunity[]>();
    for (const s of stages) map.set(s.id, []);
    for (const o of items) {
      if (!map.has(o.stageId)) map.set(o.stageId, []);
      map.get(o.stageId)!.push(o);
    }
    return map;
  }, [items, stages]);

  const visibleStages = stages.filter(
    (s) => !s.isTerminal || params.get('includeTerminal') === 'true' || (byStage.get(s.id)?.length ?? 0) > 0,
  );

  async function moveToStage(o: Opportunity, stage: Stage, lost?: { lostReason: string; lostReasonNote: string | null }) {
    if (o.stageId === stage.id) return;
    if (stage.category === 'closed_lost' && !lost) {
      setLostPrompt({ opportunity: o, stage });
      return;
    }

    const previous = items;
    setError(null);
    setBusyId(o.id);
    setItems((list) => list.map((x) => (x.id === o.id
      ? { ...x, stageId: stage.id, stageLabel: stage.label, stageColor: stage.color, stageCategory: stage.category, lostReason: lost?.lostReason ?? null }
      : x)));

    try {
      const res = await fetch(`/api/opportunities/${o.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stageId: stage.id, version: o.version, ...lost }),
      });
      const payload = (await res.json().catch(() => ({}))) as { error?: string; opportunity?: { version: number } };
      if (!res.ok) throw new Error(payload.error ?? 'Could not move this opportunity.');
      const version = payload.opportunity?.version;
      if (version) setItems((list) => list.map((x) => (x.id === o.id ? { ...x, version } : x)));
      router.refresh();
    } catch (err) {
      setItems(previous);
      setError(err instanceof Error ? err.message : 'Could not move this opportunity.');
    } finally {
      setBusyId(null);
    }
  }

  const boardTotal = pipelineTotal(items);

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

        <span className="ml-auto text-xs text-ink-600">
          Pipeline value <span className="font-semibold text-ink-900 tnum">{formatMoney(boardTotal)}</span>
        </span>
      </div>

      {error && (
        <div className="shrink-0 px-6 pt-2">
          <div className="banner-error" role="alert">
            <TriangleAlert size={14} className="mt-px shrink-0" />
            <span>{error}</span>
          </div>
        </div>
      )}

      {view === 'board' ? (
        <div className="scroll-thin flex-1 overflow-x-auto p-4">
          <div className="flex h-full gap-3">
            {visibleStages.map((stage) => {
              const items_ = byStage.get(stage.id) ?? [];
              const total = pipelineTotal(items_);
              return (
                <div
                  key={stage.id}
                  onDragOver={(e) => { if (draggingId) { e.preventDefault(); setDropTarget(stage.id); } }}
                  onDragLeave={() => setDropTarget((t) => (t === stage.id ? null : t))}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDropTarget(null);
                    const o = items.find((x) => x.id === draggingId);
                    setDraggingId(null);
                    if (o) void moveToStage(o, stage);
                  }}
                  className={`flex w-72 shrink-0 flex-col rounded-lg border bg-white ${
                    dropTarget === stage.id ? 'border-accent-500 ring-1 ring-accent-200' : 'border-ink-200'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 border-b border-ink-200 px-3 py-2">
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: stage.color }} />
                      <span className="truncate text-xs font-semibold text-ink-800">{stage.label}</span>
                    </span>
                    <span className="shrink-0 text-right text-[11px] text-ink-500 tnum">
                      {items_.length}
                      <span className="ml-1.5 font-medium text-ink-700">{total > 0 ? formatMoney(total) : ''}</span>
                    </span>
                  </div>

                  <div className="scroll-thin flex-1 space-y-2 overflow-y-auto p-2">
                    {items_.length === 0 ? (
                      <p className="px-1 py-3 text-center text-[11px] text-ink-400">No opportunities</p>
                    ) : (
                      items_.map((o) => {
                        const rel = relativeDays(o.nextStepDate);
                        return (
                          <div
                            key={o.id}
                            draggable
                            onDragStart={(e) => { setDraggingId(o.id); e.dataTransfer.effectAllowed = 'move'; }}
                            onDragEnd={() => { setDraggingId(null); setDropTarget(null); }}
                            className={`rounded-md border border-ink-200 p-2.5 transition-shadow hover:shadow-sm ${
                              draggingId === o.id ? 'opacity-50' : ''
                            } ${busyId === o.id ? 'pointer-events-none opacity-60' : ''}`}
                          >
                            <Link href={`/pipeline/${o.id}`} className="block">
                              <div className="flex items-start gap-1.5">
                                <span className="min-w-0 flex-1 text-xs font-medium text-ink-900">{o.name}</span>
                                {busyId === o.id && <Spinner />}
                                {o.isSample && <SampleBadge />}
                              </div>
                              <div className="mt-1 text-[11px] text-ink-500">
                                {o.marketName ?? 'No market'}
                                {o.propertyCount > 1 && ` · ${o.propertyCount} properties`}
                              </div>
                              <div className="mt-1 text-xs tnum">
                                <Value mono>{formatMoney(dealValue(o))}</Value>
                              </div>
                              {o.nextStep && (
                                <div className="mt-1 truncate text-[11px] text-ink-600" title={o.nextStep}>
                                  {o.nextStep}
                                  {rel && <span className={rel.days < 0 ? ' text-red-700' : ' text-ink-400'}> ({rel.label})</span>}
                                </div>
                              )}
                              {o.lostReason && (
                                <div className="mt-1 text-[10px] font-medium text-red-700">
                                  Lost — {lostReasonLabel(o.lostReason)}
                                </div>
                              )}
                              {o.state === 'removed' && (
                                <div className="mt-1 text-[10px] font-medium text-ink-500">Removed from pipeline</div>
                              )}
                            </Link>

                            <select
                              aria-label={`Move ${o.name} to another stage`}
                              className="input mt-2 w-full py-0.5 text-[11px]"
                              value={o.stageId}
                              disabled={busyId === o.id}
                              onChange={(e) => {
                                const target = stages.find((s) => s.id === e.target.value);
                                if (target) void moveToStage(o, target);
                              }}
                            >
                              {stages.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                            </select>
                          </div>
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
              {items.map((o) => {
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
                      {o.lostReason && (
                        <div className="mt-0.5 text-[10px] text-red-700">Lost — {lostReasonLabel(o.lostReason)}</div>
                      )}
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

      {lostPrompt && (
        <LostReasonDialog
          name={lostPrompt.opportunity.name}
          stageLabel={lostPrompt.stage.label}
          onCancel={() => setLostPrompt(null)}
          onConfirm={(lost) => {
            const { opportunity, stage } = lostPrompt;
            setLostPrompt(null);
            void moveToStage(opportunity, stage, lost);
          }}
        />
      )}
    </>
  );
}

function LostReasonDialog({
  name, stageLabel, onCancel, onConfirm,
}: {
  name: string;
  stageLabel: string;
  onCancel(): void;
  onConfirm(lost: { lostReason: string; lostReasonNote: string | null }): void;
}) {
  const [reason, setReason] = useState<string>(LOST_REASONS[0].value);
  const [note, setNote] = useState('');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/30 p-4">
      <div className="card w-full max-w-md" role="dialog" aria-label="Why was this deal lost?">
        <div className="card-header"><h2 className="card-title">Why was this deal lost?</h2></div>
        <div className="space-y-3 p-4">
          <p className="text-xs text-ink-600">
            Moving <strong>{name}</strong> to {stageLabel}. A reason is required so lost deals can be
            compared later.
          </p>
          <div>
            <label className="label" htmlFor="lost-reason">Reason</label>
            <select id="lost-reason" className="input" value={reason} onChange={(e) => setReason(e.target.value)}>
              {LOST_REASONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="lost-note">Details (optional)</label>
            <textarea id="lost-note" className="input" rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-ink-200 px-4 py-3">
          <button type="button" className="btn-ghost btn-sm" onClick={onCancel}>Cancel</button>
          <button
            type="button" className="btn-primary btn-sm"
            onClick={() => onConfirm({ lostReason: reason, lostReasonNote: note.trim() || null })}
          >
            Move to {stageLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
