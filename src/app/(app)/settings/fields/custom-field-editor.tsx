'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Archive, Check, Plus } from 'lucide-react';
import { Spinner } from '@/components/ui/primitives';

interface FieldDef {
  id: string;
  label: string;
  type: string;
  options: string[] | null;
  helpText: string | null;
  sortOrder: number;
  inUse: number;
}

const TYPES = [
  { value: 'text', label: 'Text' },
  { value: 'number', label: 'Number' },
  { value: 'date', label: 'Date' },
  { value: 'checkbox', label: 'Checkbox' },
  { value: 'select', label: 'Select (choose from a list)' },
] as const;

/**
 * Admin-managed custom fields on properties.
 *
 * Deliberately limited to five simple types. This is a field definition tool, not
 * a generic workflow engine — that complexity is explicitly out of scope.
 */
export function CustomFieldEditor({ fields }: { fields: FieldDef[] }) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [form, setForm] = useState({ label: '', type: 'text', options: '', helpText: '' });

  async function send(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/taxonomy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const payload = (await res.json().catch(() => ({}))) as {
        error?: string; details?: Array<{ message: string }>;
      };
      if (!res.ok) throw new Error(payload.details?.[0]?.message ?? payload.error ?? 'That change could not be saved.');

      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
      setAdding(false);
      setForm({ label: '', type: 'text', options: '', helpText: '' });
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That change could not be saved.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card">
      <div className="card-header">
        <div>
          <h2 className="card-title">Custom property fields</h2>
          <p className="mt-0.5 text-[11px] text-ink-500">
            Extra fields shown on every property record.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {saved && (
            <span className="flex items-center gap-1 text-[11px] font-medium text-green-700">
              <Check size={12} /> Saved
            </span>
          )}
          <button type="button" className="btn-secondary btn-sm" onClick={() => setAdding(true)}>
            <Plus size={13} /> Add field
          </button>
        </div>
      </div>

      {error && <div className="px-4 pt-3"><div className="banner-error" role="alert">{error}</div></div>}

      {fields.length === 0 && !adding ? (
        <p className="p-4 text-xs text-ink-500">
          No custom fields yet. Add one to capture something the standard property record does not
          cover — for example a drive-by condition rating or an internal priority score.
        </p>
      ) : (
        <ul className="divide-y divide-ink-100">
          {fields.map((f) => (
            <li key={f.id} className="flex items-start justify-between gap-3 px-4 py-2.5">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-ink-900">{f.label}</span>
                  <span className="chip border-ink-200 bg-ink-50 text-ink-600">
                    {TYPES.find((t) => t.value === f.type)?.label ?? f.type}
                  </span>
                </div>
                {f.options && f.options.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {f.options.map((o) => (
                      <span key={o} className="rounded border border-ink-200 px-1.5 py-px text-[10px] text-ink-600">{o}</span>
                    ))}
                  </div>
                )}
                {f.helpText && <p className="mt-0.5 text-[11px] text-ink-500">{f.helpText}</p>}
                <p className="mt-0.5 text-[11px] text-ink-400">
                  {f.inUse > 0 ? `Recorded on ${f.inUse} propert${f.inUse === 1 ? 'y' : 'ies'}` : 'Not yet recorded anywhere'}
                </p>
              </div>
              <button
                type="button" className="btn-ghost btn-sm shrink-0" disabled={busy}
                title="Archive — recorded values are kept"
                onClick={() => void send({ kind: 'archive', target: 'custom_field', id: f.id })}
              >
                <Archive size={13} />
              </button>
            </li>
          ))}
        </ul>
      )}

      {adding && (
        <div className="space-y-3 border-t border-ink-200 p-4">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div>
              <label className="label" htmlFor="cf-label">Label</label>
              <input
                id="cf-label" className="input" autoFocus
                value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })}
              />
            </div>
            <div>
              <label className="label" htmlFor="cf-type">Type</label>
              <select
                id="cf-type" className="input"
                value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}
              >
                {TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
          </div>

          {form.type === 'select' && (
            <div>
              <label className="label" htmlFor="cf-options">Options (one per line)</label>
              <textarea
                id="cf-options" className="input" rows={4}
                placeholder={'Excellent\nGood\nFair\nPoor'}
                value={form.options} onChange={(e) => setForm({ ...form, options: e.target.value })}
              />
            </div>
          )}

          <div>
            <label className="label" htmlFor="cf-help">Help text (optional)</label>
            <input
              id="cf-help" className="input"
              value={form.helpText} onChange={(e) => setForm({ ...form, helpText: e.target.value })}
            />
          </div>

          <div className="flex gap-2">
            <button
              type="button" className="btn-primary btn-sm" disabled={busy || !form.label.trim()}
              onClick={() => void send({
                kind: 'custom_field',
                data: {
                  label: form.label.trim(),
                  type: form.type,
                  options: form.type === 'select'
                    ? form.options.split('\n').map((o) => o.trim()).filter(Boolean)
                    : undefined,
                  helpText: form.helpText.trim() || null,
                  sortOrder: (fields.at(-1)?.sortOrder ?? 0) + 10,
                },
              })}
            >
              {busy && <Spinner />} Create field
            </button>
            <button type="button" className="btn-secondary btn-sm" onClick={() => { setAdding(false); setError(null); }} disabled={busy}>
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="border-t border-ink-100 px-4 py-2.5">
        <p className="text-[11px] leading-relaxed text-ink-500">
          Archiving a field keeps every value already recorded against it; the field simply stops
          being offered on new edits.
        </p>
      </div>
    </section>
  );
}
