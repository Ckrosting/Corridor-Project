'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Archive, Check, Pencil, Plus } from 'lucide-react';
import { Spinner, StatusChip } from '@/components/ui/primitives';

interface Tag {
  id: string;
  name: string;
  color: string;
  inUse: number;
}

const COLORS = [
  '#94a3b8', '#0ea5e9', '#f59e0b', '#22c55e', '#8b5cf6', '#64748b',
  '#ef4444', '#6366f1', '#14b8a6', '#0891b2', '#16a34a', '#a16207', '#dc2626',
];

/**
 * The shared tag vocabulary. Tags are global rather than per-market, so this is
 * the one place they are created, renamed and retired.
 */
export function TagEditor({ tags }: { tags: Tag[] }) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [archivingId, setArchivingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [draft, setDraft] = useState({ name: '', color: COLORS[0]! });

  async function send(url: string, method: 'POST' | 'PATCH' | 'DELETE', body?: unknown) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(url, {
        method,
        ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
      });
      const payload = (await res.json().catch(() => ({}))) as {
        error?: string; details?: Array<{ message: string }>;
      };
      if (!res.ok) throw new Error(payload.details?.[0]?.message ?? payload.error ?? 'That change could not be saved.');

      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
      setAdding(false);
      setEditingId(null);
      setArchivingId(null);
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
          <h2 className="card-title">Tags</h2>
          <p className="mt-0.5 text-[11px] text-ink-500">
            A shared vocabulary applied to properties across the whole portfolio.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {saved && (
            <span className="flex items-center gap-1 text-[11px] font-medium text-green-700">
              <Check size={12} /> Saved
            </span>
          )}
          <span className="text-[11px] text-ink-500">{tags.length}</span>
          <button
            type="button" className="btn-secondary btn-sm"
            onClick={() => {
              setAdding(true);
              setEditingId(null);
              setDraft({ name: '', color: COLORS[tags.length % COLORS.length]! });
            }}
          >
            <Plus size={13} /> Add tag
          </button>
        </div>
      </div>

      {error && <div className="px-4 pt-3"><div className="banner-error" role="alert">{error}</div></div>}

      {tags.length === 0 && !adding ? (
        <p className="p-4 text-xs text-ink-500">
          No tags yet. Add one here, then apply it from any property record.
        </p>
      ) : (
        <ul className="divide-y divide-ink-100">
          {tags.map((t) => (
            <li key={t.id} className="px-4 py-2">
              {editingId === t.id ? (
                <TagForm
                  initial={{ name: t.name, color: t.color }}
                  busy={busy}
                  submitLabel="Save tag"
                  onCancel={() => { setEditingId(null); setError(null); }}
                  onSave={(next) => void send(`/api/tags/${t.id}`, 'PATCH', next)}
                />
              ) : (
                <div className="flex items-center justify-between gap-3">
                  <StatusChip label={t.name} color={t.color} />
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] text-ink-500">
                      {t.inUse > 0 ? `${t.inUse} propert${t.inUse === 1 ? 'y' : 'ies'}` : 'not in use'}
                    </span>

                    {archivingId === t.id ? (
                      <div className="flex items-center gap-1.5 rounded-md border border-red-200 bg-red-50 px-2 py-1">
                        <span className="text-xs text-red-700">
                          {t.inUse > 0 ? `Archive? It stays on ${t.inUse} propert${t.inUse === 1 ? 'y' : 'ies'}.` : 'Archive this tag?'}
                        </span>
                        <button
                          type="button"
                          className="rounded bg-red-600 px-2 py-0.5 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
                          disabled={busy}
                          onClick={() => void send(`/api/tags/${t.id}`, 'DELETE')}
                        >
                          Confirm
                        </button>
                        <button
                          type="button" className="rounded px-2 py-0.5 text-xs text-ink-600 hover:bg-ink-100"
                          disabled={busy} onClick={() => setArchivingId(null)}
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <>
                        <button
                          type="button" className="btn-ghost btn-sm" disabled={busy} title="Rename or recolour"
                          onClick={() => { setEditingId(t.id); setAdding(false); setError(null); }}
                        >
                          <Pencil size={13} />
                        </button>
                        <button
                          type="button" className="btn-ghost btn-sm" disabled={busy}
                          title="Archive — properties keep the tag"
                          onClick={() => setArchivingId(t.id)}
                        >
                          <Archive size={13} />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {adding && (
        <div className="border-t border-ink-200 p-4">
          <TagForm
            initial={draft}
            busy={busy}
            submitLabel="Create tag"
            onCancel={() => { setAdding(false); setError(null); }}
            onSave={(next) => void send('/api/tags', 'POST', next)}
          />
        </div>
      )}

      <div className="border-t border-ink-100 px-4 py-2.5">
        <p className="text-[11px] leading-relaxed text-ink-500">
          Archiving a tag keeps it on the properties already tagged; it simply stops being offered
          on new edits. Renaming one updates it everywhere at once.
        </p>
      </div>
    </section>
  );
}

function TagForm({
  initial, busy, submitLabel, onSave, onCancel,
}: {
  initial: { name: string; color: string };
  busy: boolean;
  submitLabel: string;
  onSave: (next: { name: string; color: string }) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial.name);
  const [color, setColor] = useState(initial.color);

  return (
    <div className="space-y-3">
      <div>
        <label className="label" htmlFor="tag-name">Name</label>
        <input
          id="tag-name" className="input" autoFocus maxLength={60}
          value={name} onChange={(e) => setName(e.target.value)}
        />
      </div>

      <div>
        <div className="label">Colour</div>
        <div className="flex flex-wrap gap-1.5">
          {COLORS.map((c) => (
            <button
              key={c} type="button" onClick={() => setColor(c)}
              aria-label={`Colour ${c}`}
              className={`h-6 w-6 rounded-full border-2 ${color === c ? 'border-ink-900' : 'border-transparent'}`}
              style={{ backgroundColor: c }}
            />
          ))}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button" className="btn-primary btn-sm" disabled={busy || !name.trim()}
          onClick={() => onSave({ name: name.trim(), color })}
        >
          {busy && <Spinner />} {submitLabel}
        </button>
        <button type="button" className="btn-secondary btn-sm" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <StatusChip label={name.trim() || 'Preview'} color={color} />
      </div>
    </div>
  );
}
