'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  Archive, Check, ExternalLink, Link2, RotateCcw, Search, TriangleAlert, X,
} from 'lucide-react';
import { formatDate, formatDateTime, formatMoney, formatSqft } from '@/lib/format';
import { EmptyState, Field, SectionHeading, Spinner, StatusChip, Value } from '@/components/ui/primitives';

interface Result {
  id: string;
  status: string;
  origin: string;
  name: string | null;
  addressLine1: string | null;
  city: string | null;
  state: string | null;
  propertyType: string | null;
  askingPrice: string | null;
  buildingSqft: number | null;
  landAcreage: string | null;
  listingDate: string | null;
  ownerName: string | null;
  brokerName: string | null;
  brokerCompany: string | null;
  brokerPhone: string | null;
  brokerEmail: string | null;
  sources: Array<{ url: string; title?: string | null; sourceName?: string | null }> | null;
  evidenceExcerpt: string | null;
  needsVerification: string[] | null;
  geoNote: string | null;
  firstSeenAt: string | Date;
  lastSeenAt: string | Date;
  timesSeen: number;
  suggestedPropertyId: string | null;
  suggestedMatchReason: string | null;
  proposedChanges: Record<string, { from: unknown; to: unknown }> | null;
  marketName: string | null;
  suggestedPropertyName: string | null;
  reviewedByLabel: string | null;
  reviewedAt: string | Date | null;
}

interface Scan {
  id: string;
  scope: string;
  status: string;
  targetsTotal: number;
  targetsCompleted: number;
  resultsFound: number;
  resultsNew: number;
  coverageNotes: string[] | null;
  error: string | null;
  createdAt: string | Date;
  finishedAt: string | Date | null;
  requestedByLabel: string | null;
  jobError: string | null;
  jobCancelRequested: string | Date | null;
}

const STATUS_TABS = [
  { key: 'new', label: 'To review' },
  { key: 'needs_research', label: 'Needs research' },
  { key: 'approved,linked', label: 'Imported' },
  { key: 'rejected,archived', label: 'Dismissed' },
  { key: 'all', label: 'All' },
];

export function DiscoveryInbox({
  results, scans, markets, activeStatus, ai,
}: {
  results: Result[];
  scans: Scan[];
  markets: Array<{ id: string; name: string }>;
  activeStatus: string;
  ai: {
    configured: boolean; model: string; monthlyBudgetUsd: number;
    maxWebSearchesPerScan: number; spendThisMonthUsd: number; budgetUsd: number;
  };
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const [selectedId, setSelectedId] = useState<string | null>(results[0]?.id ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [acceptedFields, setAcceptedFields] = useState<string[]>([]);

  const selected = results.find((r) => r.id === selectedId) ?? null;
  const activeScan = scans.find((s) => s.status === 'running' || s.status === 'queued');
  const budgetUsedPct = ai.budgetUsd > 0 ? Math.min(100, (ai.spendThisMonthUsd / ai.budgetUsd) * 100) : 100;

  function setStatus(status: string) {
    const next = new URLSearchParams(params.toString());
    next.set('status', status);
    router.push(`${pathname}?${next.toString()}`);
  }

  async function act(id: string, body: Record<string, unknown>, successMessage: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/discovery/${id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const payload = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(payload.error ?? 'That action could not be completed.');

      setToast(successMessage);
      setTimeout(() => setToast(null), 4000);
      setSelectedId(null);
      setAcceptedFields([]);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That action could not be completed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {/* ----------------------------------------------------- Status strip */}
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-ink-200 bg-white px-6 py-2.5">
        <div className="flex gap-1">
          {STATUS_TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setStatus(tab.key)}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                activeStatus === tab.key
                  ? 'bg-accent-600 text-white'
                  : 'text-ink-600 hover:bg-ink-100'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-3 text-[11px] text-ink-500">
          {ai.configured ? (
            <>
              <span>Model <span className="font-medium text-ink-700">{ai.model}</span></span>
              <span className="flex items-center gap-1.5">
                Budget
                <span className="h-1.5 w-20 overflow-hidden rounded-full bg-ink-200">
                  <span
                    className={`block h-full ${budgetUsedPct > 85 ? 'bg-red-600' : 'bg-accent-600'}`}
                    style={{ width: `${budgetUsedPct}%` }}
                  />
                </span>
                <span className="tnum">
                  ~${ai.spendThisMonthUsd.toFixed(2)} of ${ai.budgetUsd.toFixed(2)}
                </span>
              </span>
            </>
          ) : (
            <span className="text-amber-700">Discovery not configured</span>
          )}
          <Link href="/settings/ai" className="text-accent-600 hover:underline">Configure</Link>
        </div>
      </div>

      {!ai.configured && (
        <div className="shrink-0 px-6 pt-3">
          <div className="banner-warn">
            <TriangleAlert size={14} className="mt-px shrink-0" />
            <span>
              <strong>Discovery is not configured.</strong> An administrator needs to set{' '}
              <code className="rounded bg-amber-100 px-1">ANTHROPIC_API_KEY</code> in the server
              environment. Every other part of the application works without it, and you can still
              add listings manually.
            </span>
          </div>
        </div>
      )}

      {activeScan && (
        <div className="shrink-0 px-6 pt-3">
          <div className="banner-info">
            <Spinner className="mt-px shrink-0" />
            <span>
              A scan is {activeScan.status}
              {activeScan.targetsTotal > 0 && ` — ${activeScan.targetsCompleted} of ${activeScan.targetsTotal} markets done`}
              {activeScan.jobCancelRequested && ' (cancelling…)'}
              . It runs in the background; you can keep working.
            </span>
          </div>
        </div>
      )}

      {toast && (
        <div className="shrink-0 px-6 pt-3"><div className="banner-ok">{toast}</div></div>
      )}

      <div className="flex min-h-0 flex-1">
        {/* ----------------------------------------------------- Result list */}
        <div className="scroll-thin w-[420px] shrink-0 overflow-y-auto border-r border-ink-200 bg-white">
          {results.length === 0 ? (
            <EmptyState
              icon={<Search size={24} />}
              title={activeStatus === 'new' ? 'Nothing to review' : 'No results here'}
              body={
                ai.configured
                  ? 'Run "Find New Listings" from a market to search for properties offered for sale. You can also submit a listing URL or upload a flyer.'
                  : 'Discovery scans need an API key, but you can still add properties by hand from any market workspace.'
              }
            />
          ) : (
            <ul className="divide-y divide-ink-100">
              {results.map((r) => (
                  <li key={r.id}>
                    <button
                      type="button"
                      onClick={() => { setSelectedId(r.id); setAcceptedFields([]); setError(null); }}
                      className={`w-full px-3 py-2.5 text-left transition-colors ${
                        r.id === selectedId ? 'bg-accent-50' : 'hover:bg-ink-50'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink-900">
                          {r.name ?? r.addressLine1 ?? 'Unnamed candidate'}
                        </span>
                        <span className="shrink-0 text-xs tnum text-ink-600">{formatMoney(r.askingPrice)}</span>
                      </div>
                      <div className="truncate text-[11px] text-ink-500">
                        {[r.addressLine1, r.city, r.state].filter(Boolean).join(', ') || 'No address extracted'}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-1">
                                      {r.suggestedPropertyId && (
                          <span className="chip border-accent-200 bg-accent-50 text-accent-700">Possible match</span>
                        )}
                        {r.timesSeen > 1 && (
                          <span className="chip border-ink-200 bg-ink-50 text-ink-600">Seen {r.timesSeen}×</span>
                        )}
                        {r.origin !== 'scan' && (
                          <span className="chip border-ink-200 bg-ink-50 text-ink-600">
                            {r.origin === 'manual_url'
                              ? 'Submitted URL'
                              : r.origin === 'manual_import'
                                ? 'Imported from CSV'
                                : 'Uploaded document'}
                          </span>
                        )}
                      </div>
                      <div className="mt-0.5 text-[11px] text-ink-400">
                        {r.marketName ?? 'No market'} · first seen {formatDate(r.firstSeenAt)}
                      </div>
                    </button>
                  </li>
              ))}
            </ul>
          )}
        </div>

        {/* -------------------------------------------------- Review panel */}
        <div className="scroll-thin min-w-0 flex-1 overflow-y-auto p-6">
          {!selected ? (
            <div className="mx-auto max-w-lg">
              <div className="card">
                <EmptyState
                  title="Select a candidate"
                  body="Review the extracted details and the sources behind them, then approve, link to an existing property, or dismiss."
                />
              </div>
              {scans.length > 0 && <ScanHistory scans={scans} />}
            </div>
          ) : (
            <div className="mx-auto max-w-3xl space-y-5">
              <ReviewCard
                result={selected}
                markets={markets}
                acceptedFields={acceptedFields}
                setAcceptedFields={setAcceptedFields}
                busy={busy}
                error={error}
                onAct={act}
              />
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function ReviewCard({
  result, markets, acceptedFields, setAcceptedFields, busy, error, onAct,
}: {
  result: Result;
  markets: Array<{ id: string; name: string }>;
  acceptedFields: string[];
  setAcceptedFields(v: string[]): void;
  busy: boolean;
  error: string | null;
  onAct(id: string, body: Record<string, unknown>, message: string): Promise<void>;
}) {
  const [marketId, setMarketId] = useState('');
  const [note, setNote] = useState('');
  const reviewed = ['approved', 'linked', 'rejected', 'archived'].includes(result.status);
  const proposed = Object.entries(result.proposedChanges ?? {});

  return (
    <>
      <section className="card">
        <div className="card-header">
          <div className="min-w-0">
            <h2 className="card-title truncate">{result.name ?? result.addressLine1 ?? 'Unnamed candidate'}</h2>
            <p className="text-[11px] text-ink-500">
              {[result.addressLine1, result.city, result.state].filter(Boolean).join(', ') || 'No address extracted'}
            </p>
          </div>
        </div>

        <div className="space-y-4 p-4">
          {result.geoNote && (
            <div className="banner-warn">
              <TriangleAlert size={14} className="mt-px shrink-0" />
              <span>{result.geoNote}</span>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Field label="Asking price"><Value mono>{formatMoney(result.askingPrice)}</Value></Field>
            <Field label="Building"><Value mono>{formatSqft(result.buildingSqft)}</Value></Field>
            <Field label="Land"><Value mono>{result.landAcreage ? `${result.landAcreage} ac` : undefined}</Value></Field>
            <Field label="Type"><Value>{result.propertyType}</Value></Field>
          </div>

          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Field label="Listing date" hint="Only when a source stated it">
              <Value>{formatDate(result.listingDate)}</Value>
            </Field>
            <Field label="First seen by us"><Value>{formatDate(result.firstSeenAt)}</Value></Field>
            <Field label="Last seen"><Value>{formatDate(result.lastSeenAt)}</Value></Field>
            <Field label="Times seen"><Value mono>{result.timesSeen}</Value></Field>
          </div>

          <div>
            <SectionHeading>People</SectionHeading>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Owner (as reported)" hint="A broker marketing a property is not its owner.">
                <Value>{result.ownerName}</Value>
              </Field>
              <Field label="Listing broker">
                <Value>{result.brokerName}</Value>
                {result.brokerCompany && <div className="text-[11px] text-ink-500">{result.brokerCompany}</div>}
              </Field>
              <Field label="Broker phone"><Value>{result.brokerPhone}</Value></Field>
              <Field label="Broker email"><Value>{result.brokerEmail}</Value></Field>
            </div>
          </div>

          {result.needsVerification && result.needsVerification.length > 0 && (
            <div className="banner-warn">
              <span>
                <strong>Needs verification:</strong> {result.needsVerification.join(', ')}. These
                values were not supported by a named source.
              </span>
            </div>
          )}

          {result.evidenceExcerpt && (
            <div>
              <SectionHeading>Supporting evidence</SectionHeading>
              <blockquote className="border-l-2 border-ink-300 pl-3 text-xs leading-relaxed text-ink-700 italic">
                {result.evidenceExcerpt}
              </blockquote>
            </div>
          )}

          <div>
            <SectionHeading>Sources</SectionHeading>
            {!result.sources?.length ? (
              <p className="text-xs text-ink-500">No sources were recorded — treat everything above as unverified.</p>
            ) : (
              <ul className="space-y-1">
                {result.sources.map((s, i) => (
                  <li key={`${s.url}-${i}`}>
                    <a
                      href={s.url} target="_blank" rel="noopener noreferrer nofollow"
                      className="flex items-center gap-1 text-xs text-accent-600 hover:underline"
                    >
                      <ExternalLink size={11} className="shrink-0" />
                      <span className="truncate">{s.sourceName ?? s.title ?? s.url}</span>
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </section>

      {/* -------------------------------------------- Possible match / changes */}
      {result.suggestedPropertyId && (
        <section className="card">
          <div className="card-header">
            <h2 className="card-title">Possible match with an existing property</h2>
            <span className="text-[11px] text-ink-500">{result.suggestedMatchReason}</span>
          </div>
          <div className="space-y-3 p-4">
            <p className="text-sm">
              <Link href={`/properties/${result.suggestedPropertyId}`} className="font-medium text-accent-700 hover:underline">
                {result.suggestedPropertyName ?? 'Existing property'}
              </Link>
            </p>

            {proposed.length === 0 ? (
              <p className="text-xs text-ink-500">
                Nothing new to apply. Existing values were entered or verified by a person and are
                left alone.
              </p>
            ) : (
              <>
                <SectionHeading>Proposed changes — tick what to apply</SectionHeading>
                <ul className="space-y-1.5">
                  {proposed.map(([field, change]) => (
                    <li key={field}>
                      <label className="flex items-start gap-2 rounded-md border border-ink-200 p-2 text-xs hover:bg-ink-50">
                        <input
                          type="checkbox"
                          className="mt-0.5"
                          checked={acceptedFields.includes(field)}
                          onChange={(e) => setAcceptedFields(
                            e.target.checked
                              ? [...acceptedFields, field]
                              : acceptedFields.filter((f) => f !== field),
                          )}
                        />
                        <span className="min-w-0">
                          <span className="block font-medium text-ink-800">{field}</span>
                          <span className="block text-ink-600">
                            <span className="unknown">{String(change.from ?? '— empty —')}</span>
                            {' → '}
                            <span className="font-medium text-ink-900">{String(change.to)}</span>
                          </span>
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
                <p className="field-hint">
                  Nothing is applied unless you tick it. Call history and notes are never touched.
                </p>
              </>
            )}

            <button
              type="button"
              className="btn-primary btn-sm"
              disabled={busy}
              onClick={() => void onAct(
                result.id,
                { action: 'link', propertyId: result.suggestedPropertyId, acceptedFields },
                `Linked to the existing property${acceptedFields.length ? ` and applied ${acceptedFields.length} change(s)` : ''}.`,
              )}
            >
              {busy && <Spinner />} <Link2 size={13} /> Link to this property
            </button>
          </div>
        </section>
      )}

      {/* ------------------------------------------------------------ Actions */}
      {!reviewed ? (
        <section className="card">
          <div className="card-header"><h2 className="card-title">Decision</h2></div>
          <div className="space-y-3 p-4">
            {markets.length > 1 && (
              <div>
                <label className="label" htmlFor="d-market">Market for the new property</label>
                <select id="d-market" className="input" value={marketId} onChange={(e) => setMarketId(e.target.value)}>
                  <option value="">{result.marketName ? `Use ${result.marketName}` : 'Choose a market…'}</option>
                  {markets.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
              </div>
            )}

            <div>
              <label className="label" htmlFor="d-note">Review note (optional)</label>
              <input id="d-note" className="input" value={note} onChange={(e) => setNote(e.target.value)} />
            </div>

            {error && <div className="banner-error" role="alert">{error}</div>}

            <div className="flex flex-wrap gap-2">
              <button
                type="button" className="btn-primary btn-sm" disabled={busy}
                onClick={() => void onAct(
                  result.id,
                  { action: 'approve', overrides: marketId ? { marketId } : {} },
                  'Approved as a new property. It appears on the map with "needs parcel outline".',
                )}
              >
                {busy && <Spinner />} <Check size={13} /> Approve as new property
              </button>

              <button
                type="button" className="btn-secondary btn-sm" disabled={busy}
                onClick={() => void onAct(result.id, { action: 'needs_research', note: note || null }, 'Marked as needing more research.')}
              >
                <Search size={13} /> Needs more research
              </button>

              <button
                type="button" className="btn-secondary btn-sm" disabled={busy}
                onClick={() => void onAct(result.id, { action: 'archive', note: note || null }, 'Archived.')}
              >
                <Archive size={13} /> Archive
              </button>

              <button
                type="button" className="btn-secondary btn-sm" disabled={busy}
                onClick={() => void onAct(result.id, { action: 'reject', note: note || null }, 'Rejected. It will not reappear in future scans.')}
              >
                <X size={13} /> Reject
              </button>
            </div>

            <p className="field-hint">
              Approving creates a map point flagged &ldquo;needs parcel outline&rdquo;, so you can
              draw its boundary now or later. Rejecting stops this listing reappearing on future scans.
            </p>
          </div>
        </section>
      ) : (
        <div className="banner-ok flex flex-wrap items-center justify-between gap-2">
          <span>
            Reviewed {result.reviewedAt ? formatDateTime(result.reviewedAt) : ''}
            {result.reviewedByLabel ? ` by ${result.reviewedByLabel}` : ''} — status: {result.status}.
          </span>
          {(result.status === 'rejected' || result.status === 'archived') && (
            <button
              type="button"
              className="btn-secondary btn-sm shrink-0"
              disabled={busy}
              onClick={() => void onAct(
                result.id,
                { action: 'reopen' },
                'Moved back to review. It can be found again by a future scan or import.',
              )}
            >
              {busy && <Spinner />} <RotateCcw size={13} /> Move back to review
            </button>
          )}
        </div>
      )}
    </>
  );
}

function ScanHistory({ scans }: { scans: Scan[] }) {
  return (
    <section className="card mt-5">
      <div className="card-header"><h2 className="card-title">Recent scans</h2></div>
      <ul className="divide-y divide-ink-100">
        {scans.map((s) => (
          <li key={s.id} className="px-4 py-2.5">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-xs font-medium text-ink-800">
                {s.scope === 'all' ? 'All markets' : s.scope === 'market' ? 'One market' : `${s.targetsTotal} markets`}
              </span>
              <StatusChip
                label={s.status}
                color={
                  s.status === 'completed' ? '#15803d'
                    : s.status === 'partial' ? '#b45309'
                      : s.status === 'failed' ? '#b91c1c'
                        : s.status === 'cancelled' ? '#64748b' : '#2563eb'
                }
              />
            </div>
            <div className="text-[11px] text-ink-500">
              {s.targetsCompleted}/{s.targetsTotal} markets · {s.resultsNew} new of {s.resultsFound} found ·{' '}
              {formatDateTime(s.createdAt)}
              {s.requestedByLabel ? ` · ${s.requestedByLabel}` : ''}
            </div>
            {(s.error || s.jobError) && (
              <div className="mt-1 text-[11px] text-red-700">{s.error ?? s.jobError}</div>
            )}
            {s.coverageNotes && s.coverageNotes.length > 0 && (
              <details className="mt-1">
                <summary className="cursor-pointer text-[11px] text-ink-500">
                  Coverage limitations ({s.coverageNotes.length})
                </summary>
                <ul className="mt-1 space-y-0.5 pl-3">
                  {s.coverageNotes.map((n, i) => (
                    <li key={i} className="text-[11px] text-ink-600">• {n}</li>
                  ))}
                </ul>
              </details>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
