'use client';

import { useCallback, useState, useTransition } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { CheckCheck, X } from 'lucide-react';
import { todayIso } from '@/lib/format';
import { Spinner } from '@/components/ui/primitives';

/**
 * The market filter lives in the URL rather than component state, so a filtered
 * queue can be bookmarked and shared, matching the properties list.
 */
export function FollowUpFiltersBar({ markets }: { markets: Array<{ id: string; name: string }> }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const apply = useCallback((value: string) => {
    const next = new URLSearchParams(params.toString());
    if (value) next.set('marketId', value); else next.delete('marketId');
    const qs = next.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }, [params, pathname, router]);

  return (
    <div className="flex items-center gap-2">
      <select
        className="input w-auto py-1 text-xs"
        aria-label="Market"
        value={params.get('marketId') ?? ''}
        onChange={(e) => apply(e.target.value)}
      >
        <option value="">All markets</option>
        {markets.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
      </select>
      {params.get('marketId') && (
        <button type="button" className="btn-ghost btn-sm" onClick={() => apply('')}>
          <X size={12} /> Clear
        </button>
      )}
    </div>
  );
}

const PRESETS = [
  { label: '+3d', days: 3 },
  { label: '+1w', days: 7 },
  { label: '+1m', days: 30 },
];

/**
 * Reschedule or clear a follow-up without leaving the queue. Both paths go
 * through the same endpoints the rest of the app uses: /api/properties/follow-up
 * for a new date, and /api/activities for "done", so that clearing a date leaves
 * a timeline entry rather than silently wiping the field.
 */
export function FollowUpRowActions({
  propertyId, currentDate,
}: {
  propertyId: string;
  currentDate: string | null;
}) {
  const router = useRouter();
  const [date, setDate] = useState(currentDate ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const run = async (fn: () => Promise<Response>) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fn();
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(typeof body?.error === 'string' ? body.error : 'Could not save that.');
      }
      startTransition(() => router.refresh());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save that.');
    } finally {
      setBusy(false);
    }
  };

  const reschedule = (next: string) => {
    if (!next) return;
    setDate(next);
    void run(() => fetch('/api/properties/follow-up', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ propertyId, date: next }),
    }));
  };

  const markDone = () => void run(() => fetch('/api/activities', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      propertyId,
      type: 'note',
      subject: 'Follow-up completed',
      setNextFollowUpDate: null,
    }),
  }));

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1">
        <input
          type="date"
          className="input w-[8.5rem] py-0.5 text-[11px]"
          aria-label="Reschedule follow-up"
          value={date}
          disabled={busy}
          onChange={(e) => reschedule(e.target.value)}
        />
        {PRESETS.map((p) => (
          <button
            key={p.label} type="button" className="btn-secondary btn-sm" disabled={busy}
            onClick={() => reschedule(todayIso(p.days))}
          >
            {p.label}
          </button>
        ))}
        <button
          type="button" className="btn-ghost btn-sm" disabled={busy}
          title="Clear the follow-up date and log that it was handled"
          onClick={markDone}
        >
          {busy ? <Spinner /> : <CheckCheck size={12} />} Done
        </button>
      </div>
      {error && <div className="text-[11px] text-red-700" role="alert">{error}</div>}
    </div>
  );
}
