'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Plus, X } from 'lucide-react';
import { Spinner } from '@/components/ui/primitives';

/**
 * The selectable property types, stored as one settings list rather than a table
 * — they carry no state of their own beyond their name. Removing a type never
 * rewrites property records: an existing property keeps whatever type it has, so
 * the usage count here is a warning, not a blocker.
 */
export function PropertyTypeEditor({
  types, usage,
}: { types: string[]; usage: Record<string, number> }) {
  const router = useRouter();
  const [draft, setDraft] = useState('');
  const [removing, setRemoving] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function save(next: string[]) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'property_types', value: next }),
      });
      const payload = (await res.json().catch(() => ({}))) as {
        error?: string; details?: Array<{ message: string }>;
      };
      if (!res.ok) throw new Error(payload.details?.[0]?.message ?? payload.error ?? 'That change could not be saved.');

      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
      setDraft('');
      setRemoving(null);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That change could not be saved.');
    } finally {
      setBusy(false);
    }
  }

  const trimmed = draft.trim();
  const duplicate = types.some((t) => t.toLowerCase() === trimmed.toLowerCase());

  return (
    <section className="card">
      <div className="card-header">
        <h2 className="card-title">Property types</h2>
        {saved && (
          <span className="flex items-center gap-1 text-[11px] font-medium text-green-700">
            <Check size={12} /> Saved
          </span>
        )}
      </div>

      {error && <div className="px-4 pt-3"><div className="banner-error" role="alert">{error}</div></div>}

      <div className="space-y-3 p-4">
        <div className="flex flex-wrap gap-1.5">
          {types.map((t) => (
            <span key={t} className="chip border-ink-200 bg-ink-50 text-ink-700">
              {t}
              {usage[t] ? <span className="ml-1 text-ink-400">{usage[t]}</span> : null}
              <button
                type="button" className="ml-1 text-ink-400 hover:text-red-600 disabled:opacity-50"
                aria-label={`Remove ${t}`} disabled={busy}
                onClick={() => setRemoving(t)}
              >
                <X size={11} />
              </button>
            </span>
          ))}
          {types.length === 0 && <span className="text-xs text-ink-500">No property types configured.</span>}
        </div>

        {removing && (
          <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-red-200 bg-red-50 px-2 py-1">
            <span className="text-xs text-red-700">
              Remove &ldquo;{removing}&rdquo;?
              {usage[removing]
                ? ` ${usage[removing]} propert${usage[removing] === 1 ? 'y keeps' : 'ies keep'} this type; it just stops being offered.`
                : ' It is not used by any property.'}
            </span>
            <button
              type="button"
              className="rounded bg-red-600 px-2 py-0.5 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
              disabled={busy}
              onClick={() => void save(types.filter((t) => t !== removing))}
            >
              Confirm
            </button>
            <button
              type="button" className="rounded px-2 py-0.5 text-xs text-ink-600 hover:bg-ink-100"
              disabled={busy} onClick={() => setRemoving(null)}
            >
              Cancel
            </button>
          </div>
        )}

        <div className="flex items-end gap-2">
          <div className="max-w-xs flex-1">
            <label className="label" htmlFor="pt-new">Add a type</label>
            <input
              id="pt-new" className="input" maxLength={80} value={draft}
              placeholder="Self Storage"
              onChange={(e) => setDraft(e.target.value)}
            />
          </div>
          <button
            type="button" className="btn-primary btn-sm" disabled={busy || !trimmed || duplicate}
            onClick={() => void save([...types, trimmed])}
          >
            {busy && <Spinner />} <Plus size={13} /> Add
          </button>
        </div>
        {duplicate && <p className="text-[11px] text-amber-700">&ldquo;{trimmed}&rdquo; is already in the list.</p>}

        <p className="field-hint">
          The selectable property types. Any type is accepted on import, so an unfamiliar value
          from a spreadsheet is never silently dropped — and removing one here leaves existing
          property records untouched.
        </p>
      </div>
    </section>
  );
}
