'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Archive, Check, GripVertical, Plus, TriangleAlert } from 'lucide-react';
import { Spinner, StatusChip } from '@/components/ui/primitives';

interface Item {
  id: string;
  label: string;
  color: string;
  sortOrder: number;
  isDefault: boolean;
  flag: boolean;
  inUse: number;
  category?: string;
}

const COLORS = [
  '#94a3b8', '#0ea5e9', '#f59e0b', '#22c55e', '#8b5cf6', '#64748b',
  '#ef4444', '#6366f1', '#14b8a6', '#0891b2', '#16a34a', '#a16207', '#dc2626',
];

/**
 * Edits a configurable vocabulary.
 *
 * Archiving something still in use requires naming a replacement — the UI asks
 * for it and the server enforces it, so records are never left pointing at a
 * status or stage that no longer exists.
 */
export function TaxonomyEditor({
  kind, title, blurb, items, flagLabel, flagHint, usageNoun,
}: {
  kind: 'status' | 'stage';
  title: string;
  blurb: string;
  items: Item[];
  flagLabel: string;
  flagHint: string;
  usageNoun: string;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [archiving, setArchiving] = useState<Item | null>(null);
  const [reassignTo, setReassignTo] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const [draft, setDraft] = useState({ label: '', color: COLORS[0]!, sortOrder: 100, flag: false, category: 'open' });

  async function send(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/taxonomy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const payload = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(payload.error ?? 'That change could not be saved.');

      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
      setEditing(null);
      setAdding(false);
      setArchiving(null);
      setReassignTo('');
      router.refresh();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That change could not be saved.');
      return false;
    } finally {
      setBusy(false);
    }
  }

  const save = (item: Partial<Item> & { label: string; color: string; sortOrder: number }) =>
    send({
      kind,
      data: kind === 'status'
        ? { id: item.id, label: item.label, color: item.color, sortOrder: item.sortOrder, countsAsActivePursuit: item.flag ?? false }
        : { id: item.id, label: item.label, color: item.color, sortOrder: item.sortOrder, isTerminal: item.flag ?? false, category: item.category ?? 'open' },
    });

  return (
    <section className="card">
      <div className="card-header">
        <div>
          <h2 className="card-title">{title}</h2>
          <p className="mt-0.5 text-[11px] text-ink-500">{blurb}</p>
        </div>
        <div className="flex items-center gap-2">
          {saved && (
            <span className="flex items-center gap-1 text-[11px] font-medium text-green-700">
              <Check size={12} /> Saved
            </span>
          )}
          <button
            type="button" className="btn-secondary btn-sm"
            onClick={() => {
              setAdding(true);
              setDraft({ label: '', color: COLORS[items.length % COLORS.length]!, sortOrder: (items.at(-1)?.sortOrder ?? 0) + 10, flag: false, category: 'open' });
            }}
          >
            <Plus size={13} /> Add
          </button>
        </div>
      </div>

      {error && <div className="px-4 pt-3"><div className="banner-error" role="alert">{error}</div></div>}

      <ul className="divide-y divide-ink-100">
        {items.map((item) => (
          <li key={item.id} className="px-4 py-2.5">
            {editing === item.id ? (
              <EditRow
                item={item} flagLabel={flagLabel} kind={kind} busy={busy}
                onCancel={() => setEditing(null)}
                onSave={(next) => void save({ ...next, id: item.id })}
              />
            ) : (
              <div className="flex items-center gap-3">
                <GripVertical size={14} className="shrink-0 text-ink-300" />
                <StatusChip label={item.label} color={item.color} />
                <span className="flex-1 text-[11px] text-ink-500">
                  {item.isDefault && <span className="mr-2 font-medium text-accent-700">Default</span>}
                  {item.flag && <span className="mr-2">{flagLabel}</span>}
                  {item.inUse > 0
                    ? `${item.inUse} ${usageNoun}${item.inUse === 1 ? '' : usageNoun.endsWith('y') ? '' : 's'}`
                    : 'not in use'}
                </span>
                <button type="button" className="btn-ghost btn-sm" onClick={() => setEditing(item.id)}>Edit</button>
                {!item.isDefault && (
                  <button
                    type="button" className="btn-ghost btn-sm"
                    onClick={() => { setArchiving(item); setReassignTo(''); setError(null); }}
                  >
                    <Archive size={13} />
                  </button>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>

      {adding && (
        <div className="border-t border-ink-200 px-4 py-3">
          <EditRow
            item={{ ...draft, id: '', isDefault: false, inUse: 0 }}
            flagLabel={flagLabel} kind={kind} busy={busy}
            onCancel={() => setAdding(false)}
            onSave={(next) => void save(next)}
          />
        </div>
      )}

      <div className="border-t border-ink-100 px-4 py-2.5">
        <p className="text-[11px] leading-relaxed text-ink-500">{flagHint}</p>
      </div>

      {/* ------------------------------------------------- Archive with reassign */}
      {archiving && (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-ink-900/40 p-6" role="dialog" aria-modal="true">
          <div className="card w-full max-w-md">
            <div className="card-header">
              <h3 className="card-title">Archive &ldquo;{archiving.label}&rdquo;</h3>
            </div>
            <div className="space-y-3 p-4">
              {archiving.inUse > 0 ? (
                <>
                  <div className="banner-warn">
                    <TriangleAlert size={14} className="mt-px shrink-0" />
                    <span>
                      <strong>{archiving.inUse} {usageNoun}
                        {archiving.inUse === 1 ? '' : 's'} still use this.</strong>{' '}
                      Choose where to move them. Nothing is deleted, and no record is
                      left pointing at a missing {kind}.
                    </span>
                  </div>
                  <div>
                    <label className="label" htmlFor="reassign">Move them to</label>
                    <select id="reassign" className="input" value={reassignTo} onChange={(e) => setReassignTo(e.target.value)}>
                      <option value="">Choose…</option>
                      {items.filter((i) => i.id !== archiving.id).map((i) => (
                        <option key={i.id} value={i.id}>{i.label}</option>
                      ))}
                    </select>
                  </div>
                </>
              ) : (
                <p className="text-xs text-ink-600">
                  Nothing is using this {kind}, so it can be archived safely. Historical
                  references keep working.
                </p>
              )}
              {error && <div className="banner-error" role="alert">{error}</div>}
            </div>
            <div className="flex justify-end gap-2 border-t border-ink-200 px-4 py-3">
              <button type="button" className="btn-secondary" onClick={() => { setArchiving(null); setError(null); }} disabled={busy}>
                Cancel
              </button>
              <button
                type="button" className="btn-danger"
                disabled={busy || (archiving.inUse > 0 && !reassignTo)}
                onClick={() => void send({
                  kind: 'archive', target: kind, id: archiving.id,
                  reassignToId: reassignTo || null,
                })}
              >
                {busy && <Spinner />} Archive
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function EditRow({
  item, flagLabel, kind, busy, onCancel, onSave,
}: {
  item: Omit<Item, 'id'> & { id: string };
  flagLabel: string;
  kind: 'status' | 'stage';
  busy: boolean;
  onCancel(): void;
  onSave(next: { label: string; color: string; sortOrder: number; flag: boolean; category?: string }): void;
}) {
  const [label, setLabel] = useState(item.label);
  const [color, setColor] = useState(item.color);
  const [sortOrder, setSortOrder] = useState(item.sortOrder);
  const [flag, setFlag] = useState(item.flag);
  const [category, setCategory] = useState(item.category ?? 'open');

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-[180px] flex-1">
          <label className="label">Label</label>
          <input className="input" value={label} onChange={(e) => setLabel(e.target.value)} autoFocus />
        </div>
        <div className="w-20">
          <label className="label">Order</label>
          <input
            className="input" inputMode="numeric" value={sortOrder}
            onChange={(e) => setSortOrder(Number(e.target.value) || 0)}
          />
        </div>
        {kind === 'stage' && (
          <div className="w-40">
            <label className="label">Board group</label>
            <select className="input" value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="open">Open</option>
              <option value="closed_won">Closed — won</option>
              <option value="closed_lost">Closed — lost</option>
              <option value="on_hold">On hold</option>
            </select>
          </div>
        )}
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

      <label className="flex items-center gap-2 text-xs text-ink-700">
        <input type="checkbox" checked={flag} onChange={(e) => setFlag(e.target.checked)} />
        {flagLabel}
      </label>

      <div className="flex gap-2">
        <button
          type="button" className="btn-primary btn-sm" disabled={busy || !label.trim()}
          onClick={() => onSave({ label: label.trim(), color, sortOrder, flag, category })}
        >
          {busy && <Spinner />} Save
        </button>
        <button type="button" className="btn-secondary btn-sm" onClick={onCancel} disabled={busy}>Cancel</button>
      </div>
    </div>
  );
}
