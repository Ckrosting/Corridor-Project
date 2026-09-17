'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Building2, Pencil, Plus, TriangleAlert, X } from 'lucide-react';
import { Spinner } from '@/components/ui/primitives';

/** Filing types we see on deeds. Free text is still accepted by the API. */
const ENTITY_TYPES = ['LLC', 'LP', 'Trust', 'Corporation', 'Individual', 'Partnership', 'Other'];

export interface OwnerEntityRef {
  id: string;
  name: string;
  entityType: string | null;
  mailingAddress: string | null;
  notes?: string | null;
  version: number;
}

interface Match {
  id: string;
  name: string;
  entityType: string | null;
  mailingAddress: string | null;
  version: number;
}

/**
 * Picks the legal entity that owns a property: searches existing entities by
 * name, or creates one inline when the search finds nothing. The selection is
 * held by the parent form and saved with the rest of the property, so the link
 * is written by the property's own version-checked PATCH.
 */
export function OwnerEntityPicker({
  value, label, onChange,
}: {
  value: string | null;
  label: string | null;
  onChange(next: { id: string; name: string } | null): void;
}) {
  const [query, setQuery] = useState('');
  const [matches, setMatches] = useState<Match[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newType, setNewType] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    const term = query.trim();
    if (value || term.length < 2) {
      setMatches(null);
      return;
    }
    // A stale slower response must not overwrite a newer one's results.
    const mine = ++seq.current;
    setSearching(true);
    const timer = setTimeout(() => {
      fetch(`/api/owner-entities?q=${encodeURIComponent(term)}`)
        .then((r) => r.json() as Promise<{ ownerEntities?: Match[] }>)
        .then((body) => { if (mine === seq.current) setMatches(body.ownerEntities ?? []); })
        .catch(() => { if (mine === seq.current) setMatches([]); })
        .finally(() => { if (mine === seq.current) setSearching(false); });
    }, 250);
    return () => clearTimeout(timer);
  }, [query, value]);

  async function createInline() {
    const name = query.trim();
    if (!name) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/owner-entities', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, entityType: newType || null }),
      });
      const body = (await res.json().catch(() => ({}))) as { ownerEntity?: Match; error?: string };
      if (!res.ok || !body.ownerEntity) throw new Error(body.error ?? 'Could not create that entity.');
      onChange({ id: body.ownerEntity.id, name: body.ownerEntity.name });
      setQuery('');
      setCreating(false);
      setNewType('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create that entity.');
    } finally {
      setBusy(false);
    }
  }

  if (value) {
    return (
      <div className="col-span-2 md:col-span-3">
        <div className="label">Owner entity</div>
        <div className="flex items-center gap-2 rounded-md border border-ink-200 bg-ink-50 px-2 py-1.5">
          <Building2 size={13} className="shrink-0 text-ink-400" />
          <span className="flex-1 truncate text-sm text-ink-900">{label ?? 'Linked entity'}</span>
          <button type="button" className="btn-ghost btn-sm" title="Clear this owner entity" onClick={() => onChange(null)}>
            <X size={12} /> Clear
          </button>
        </div>
        <p className="field-hint">The legal owner on the deed, not the person who answers the phone.</p>
      </div>
    );
  }

  return (
    <div className="col-span-2 md:col-span-3">
      <label className="label" htmlFor="owner-entity-search">Owner entity</label>
      <input
        id="owner-entity-search"
        className="input"
        value={query}
        placeholder="Search by entity name…"
        onChange={(e) => { setQuery(e.target.value); setCreating(false); setError(null); }}
      />
      <p className="field-hint">The legal owner on the deed, not the person who answers the phone.</p>

      {error && <div className="banner-error mt-2" role="alert">{error}</div>}

      {searching && <p className="field-hint">Searching…</p>}

      {matches && matches.length > 0 && (
        <ul className="mt-1 divide-y divide-ink-100 rounded-md border border-ink-200">
          {matches.map((m) => (
            <li key={m.id}>
              <button
                type="button"
                className="w-full px-2 py-1.5 text-left hover:bg-ink-50"
                onClick={() => { onChange({ id: m.id, name: m.name }); setQuery(''); setMatches(null); }}
              >
                <span className="block truncate text-sm text-ink-900">{m.name}</span>
                {m.entityType && <span className="block text-[11px] text-ink-500">{m.entityType}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}

      {matches && query.trim().length >= 2 && !creating && (
        <button type="button" className="btn-secondary btn-sm mt-2" onClick={() => setCreating(true)}>
          <Plus size={13} /> Create &ldquo;{query.trim()}&rdquo;
        </button>
      )}

      {creating && (
        <div className="mt-2 space-y-2 rounded-md border border-ink-200 p-2">
          <div>
            <label className="label" htmlFor="owner-entity-new-type">Entity type</label>
            <select id="owner-entity-new-type" className="input" value={newType} onChange={(e) => setNewType(e.target.value)}>
              <option value="">— not set —</option>
              {ENTITY_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-ghost btn-sm" onClick={() => setCreating(false)} disabled={busy}>Cancel</button>
            <button type="button" className="btn-primary btn-sm" onClick={() => void createInline()} disabled={busy}>
              {busy && <Spinner />} Create entity
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * The owner entity as shown beside a property's contacts, with an inline editor
 * for the entity's own fields. Editing here corrects the entity everywhere it is
 * used, so the save is version-checked like any other record.
 */
export function OwnerEntityCard({
  entity, onSaved,
}: {
  entity: OwnerEntityRef;
  onSaved?(): void;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [form, setForm] = useState(() => ({
    name: entity.name,
    entityType: entity.entityType ?? '',
    mailingAddress: entity.mailingAddress ?? '',
    notes: entity.notes ?? '',
  }));

  async function save() {
    setBusy(true);
    setError(null);
    setConflict(false);
    try {
      const blank = (v: string) => (v.trim() === '' ? null : v.trim());
      const res = await fetch(`/api/owner-entities/${entity.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          version: entity.version,
          name: form.name.trim(),
          entityType: blank(form.entityType),
          mailingAddress: blank(form.mailingAddress),
          notes: blank(form.notes),
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (res.status === 409) {
        setConflict(true);
        setError(body.error ?? 'Someone else changed this entity while you were editing.');
        return;
      }
      if (!res.ok) throw new Error(body.error ?? 'Could not save.');
      setEditing(false);
      router.refresh();
      onSaved?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save.');
    } finally {
      setBusy(false);
    }
  }

  if (!editing) {
    return (
      <div className="rounded-md border border-ink-200 bg-ink-50 p-2.5">
        <div className="flex items-start justify-between gap-2">
          <div className="section-label mb-1">Owner legal entity</div>
          <button type="button" className="btn-ghost btn-sm" title="Edit this owner entity" onClick={() => setEditing(true)}>
            <Pencil size={12} />
          </button>
        </div>
        <div className="text-sm font-medium text-ink-900">{entity.name}</div>
        {entity.entityType && <div className="text-xs text-ink-500">{entity.entityType}</div>}
        {entity.mailingAddress && <div className="mt-1 text-xs text-ink-600">{entity.mailingAddress}</div>}
        {entity.notes && <div className="mt-1 whitespace-pre-wrap text-xs text-ink-600">{entity.notes}</div>}
        <p className="field-hint">An entity is not a person. The people who represent it are listed below.</p>
      </div>
    );
  }

  return (
    <div className="space-y-2 rounded-md border border-ink-200 bg-ink-50 p-2.5">
      <div className="section-label">Editing owner entity</div>

      {conflict && (
        <div className="banner-error">
          <TriangleAlert size={14} className="mt-px shrink-0" />
          <span>
            <strong>Someone else saved first.</strong> Your changes were not applied.{' '}
            <button type="button" className="underline underline-offset-2" onClick={() => router.refresh()}>
              Reload the current version
            </button>{' '}
            and reapply them.
          </span>
        </div>
      )}
      {error && !conflict && <div className="banner-error" role="alert">{error}</div>}

      <div>
        <label className="label" htmlFor="oe-name">Entity name</label>
        <input id="oe-name" className="input" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
      </div>
      <div>
        <label className="label" htmlFor="oe-type">Entity type</label>
        <select id="oe-type" className="input" value={form.entityType} onChange={(e) => setForm((f) => ({ ...f, entityType: e.target.value }))}>
          <option value="">— not set —</option>
          {ENTITY_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          {form.entityType && !ENTITY_TYPES.includes(form.entityType) && <option value={form.entityType}>{form.entityType}</option>}
        </select>
      </div>
      <div>
        <label className="label" htmlFor="oe-mail">Mailing address</label>
        <input id="oe-mail" className="input" value={form.mailingAddress} onChange={(e) => setForm((f) => ({ ...f, mailingAddress: e.target.value }))} />
      </div>
      <div>
        <label className="label" htmlFor="oe-notes">Notes</label>
        <textarea id="oe-notes" className="input" rows={2} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
      </div>

      <div className="flex justify-end gap-2">
        <button type="button" className="btn-ghost btn-sm" onClick={() => { setEditing(false); setError(null); setConflict(false); }} disabled={busy}>
          Cancel
        </button>
        <button type="button" className="btn-primary btn-sm" onClick={() => void save()} disabled={busy}>
          {busy && <Spinner />} Save entity
        </button>
      </div>
    </div>
  );
}
