'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { CalendarClock, Check, Tag, X } from 'lucide-react';
import {
  LISTING_STATUS_LABELS, formatAcres, formatAddress, formatMoney, formatSqft,
  propertyTitle, relativeDays, todayIso,
} from '@/lib/format';
import { SampleBadge, Spinner, StatusChip, Value } from '@/components/ui/primitives';
import { RestoreButton } from './restore-button';

export interface PropertyRow {
  id: string;
  name: string | null;
  addressLine1: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  propertyType: string | null;
  listingStatus: string;
  askingPrice: string | null;
  buildingSqft: number | null;
  landAcreage: string | null;
  nextFollowUpDate: string | null;
  needsParcelOutline: boolean;
  isSample: boolean;
  archivedAt: Date | null;
  version: number;
  outreachStatusLabel: string | null;
  outreachStatusColor: string | null;
  ownerEntityName: string | null;
  parcelCount: number;
  activityCount: number;
  opportunityId: string | null;
}

interface Option { id: string; label: string; color?: string }

type BulkAction =
  | { action: 'set_status'; outreachStatusId: string }
  | { action: 'set_follow_up'; nextFollowUpDate: string | null }
  | { action: 'add_tags'; tagIds: string[] };

/**
 * The list page is a server component; selection is per-browser state, so the
 * table body lives here. Everything below the checkbox column renders exactly as
 * it did before the bulk actions were added.
 */
export function PropertiesTable({
  rows, statuses, tags,
}: {
  rows: PropertyRow[];
  statuses: Option[];
  tags: Option[];
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const filterKey = params.toString();
  // A selection carried across a filter change would silently act on rows the
  // user can no longer see.
  useEffect(() => { setSelected(new Set()); }, [filterKey]);

  const ids = useMemo(() => rows.map((r) => r.id), [rows]);
  const allSelected = ids.length > 0 && ids.every((id) => selected.has(id));

  const toggle = (id: string) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(ids));

  return (
    <>
      <table className="table-dense">
        <thead>
          <tr>
            <th className="w-8">
              <input
                type="checkbox"
                aria-label={allSelected ? 'Deselect all rows' : 'Select all rows'}
                checked={allSelected}
                onChange={toggleAll}
              />
            </th>
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
              <tr key={p.id} className={selected.has(p.id) ? 'bg-accent-50' : undefined}>
                <td>
                  <input
                    type="checkbox"
                    aria-label={`Select ${propertyTitle(p)}`}
                    checked={selected.has(p.id)}
                    onChange={() => toggle(p.id)}
                  />
                </td>
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
                  {LISTING_STATUS_LABELS[p.listingStatus as keyof typeof LISTING_STATUS_LABELS] ?? p.listingStatus}
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

      {selected.size > 0 && (
        <BulkActionBar
          count={selected.size}
          statuses={statuses}
          tags={tags}
          onClear={() => setSelected(new Set())}
          onApplied={() => { setSelected(new Set()); router.refresh(); }}
          selectedIds={() => [...selected]}
        />
      )}
    </>
  );
}

function BulkActionBar({
  count, statuses, tags, selectedIds, onClear, onApplied,
}: {
  count: number;
  statuses: Option[];
  tags: Option[];
  selectedIds(): string[];
  onClear(): void;
  onApplied(): void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [followUp, setFollowUp] = useState('');
  const [tagIds, setTagIds] = useState<string[]>([]);

  async function apply(body: BulkAction, describe: (n: number) => string) {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const res = await fetch('/api/properties/bulk', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...body, propertyIds: selectedIds() }),
      });
      const payload = (await res.json().catch(() => ({}))) as { updated?: number; error?: string };
      if (!res.ok || payload.error) throw new Error(payload.error ?? 'Could not apply that to every property.');
      setDone(describe(payload.updated ?? 0));
      onApplied();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not apply that to every property.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="sticky bottom-0 z-10 flex flex-wrap items-center gap-3 border-t border-ink-200 bg-white px-6 py-2.5 shadow-[0_-2px_8px_rgba(0,0,0,0.06)]">
      <span className="text-xs font-semibold text-ink-900">{count} selected</span>

      <select
        className="input w-auto py-1 text-xs"
        value=""
        disabled={busy}
        onChange={(e) => {
          const id = e.target.value;
          if (id) void apply({ action: 'set_status', outreachStatusId: id }, (n) => `Status set on ${n}.`);
        }}
      >
        <option value="">Set outreach status…</option>
        {statuses.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
      </select>

      <div className="flex items-center gap-1.5">
        <CalendarClock size={13} className="text-ink-400" />
        <input
          type="date" className="input w-auto py-1 text-xs" aria-label="Bulk follow-up date"
          value={followUp} disabled={busy} onChange={(e) => setFollowUp(e.target.value)}
        />
        {[
          { label: '+3d', days: 3 },
          { label: '+1w', days: 7 },
          { label: '+1m', days: 30 },
        ].map((preset) => (
          <button
            key={preset.label} type="button" className="btn-secondary btn-sm" disabled={busy}
            onClick={() => setFollowUp(todayIso(preset.days))}
          >
            {preset.label}
          </button>
        ))}
        <button
          type="button" className="btn-secondary btn-sm" disabled={busy || !followUp}
          onClick={() => void apply(
            { action: 'set_follow_up', nextFollowUpDate: followUp },
            (n) => `Follow-up set on ${n}.`,
          )}
        >
          Set follow-up
        </button>
      </div>

      {tags.length > 0 && (
        <div className="flex flex-wrap items-center gap-1">
          <Tag size={13} className="text-ink-400" />
          {tags.map((t) => {
            const on = tagIds.includes(t.id);
            return (
              <button
                key={t.id} type="button" disabled={busy}
                onClick={() => setTagIds((prev) => (on ? prev.filter((id) => id !== t.id) : [...prev, t.id]))}
                className={`rounded-full border px-2 py-0.5 text-[11px] transition-colors ${
                  on ? 'border-accent-600 bg-accent-600 font-medium text-white' : 'border-ink-300 bg-white text-ink-600 hover:bg-ink-100'
                }`}
              >
                {t.label}
              </button>
            );
          })}
          <button
            type="button" className="btn-secondary btn-sm" disabled={busy || tagIds.length === 0}
            onClick={() => void apply({ action: 'add_tags', tagIds }, (n) => `Tags added to ${n}.`)}
          >
            Add tags
          </button>
        </div>
      )}

      <div className="ml-auto flex items-center gap-2">
        {busy && <Spinner />}
        {done && !error && (
          <span className="flex items-center gap-1 text-[11px] text-green-700"><Check size={12} /> {done}</span>
        )}
        {error && <span className="text-[11px] text-red-600" role="alert">{error}</span>}
        <button type="button" className="btn-ghost btn-sm" onClick={onClear}>
          <X size={12} /> Clear selection
        </button>
      </div>
    </div>
  );
}
