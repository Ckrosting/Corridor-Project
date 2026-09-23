'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, TriangleAlert, Upload, X } from 'lucide-react';
import { Spinner } from '@/components/ui/primitives';

interface PreviewRow {
  rowNumber: number;
  mapped: Record<string, unknown>;
  errors: string[];
  warnings: string[];
  verdict: 'new' | 'duplicate' | 'error';
  action: 'create' | 'skip';
}

interface Preview {
  batch: { id: string; filename: string };
  headers: string[];
  mapping: Record<string, string>;
  rows: PreviewRow[];
  summary: { total: number; valid: number; duplicates: number; errors: number };
}

const FIELD_LABELS: Record<string, string> = {
  name: 'Name / use',
  addressLine1: 'Address',
  city: 'City',
  state: 'State',
  postalCode: 'ZIP',
  county: 'County',
  propertyType: 'Property type',
  latitude: 'Latitude',
  longitude: 'Longitude',
  landAcreage: 'Land acreage',
  buildingSqft: 'Building sqft',
  occupancyPercent: 'Occupancy %',
  yearBuilt: 'Year built',
  tenantInfo: 'Tenant info',
  askingPrice: 'Asking price',
  noi: 'NOI',
  capRateReported: 'Cap rate',
  lastSaleDate: 'Last sale date',
  lastSalePrice: 'Sale price',
  ownerName: 'Owner',
  contactRaw: 'Contact',
  contactEmail: 'Contact email',
  parcelId: 'Parcel ID (PIN)',
};

const CUSTOM_FIELD_PREFIX = 'customField:';
const CUSTOM_FIELD_TYPES: Array<{ value: 'text' | 'number' | 'date' | 'checkbox'; label: string }> = [
  { value: 'text', label: 'Text' },
  { value: 'number', label: 'Number' },
  { value: 'date', label: 'Date' },
  { value: 'checkbox', label: 'Checkbox' },
];

/**
 * Upload → choose market → map → preview → confirm.
 *
 * Rows become real Property (+ owner Contact) records directly - this is for
 * research the team already has, not "for sale" candidates, so it never goes
 * through the discovery review inbox. Nothing is written until Commit, and
 * duplicates default to skip so a re-upload cannot double the data.
 */
export function PropertyImporter({
  markets, customFields: initialCustomFields,
}: {
  markets: Array<{ id: string; name: string }>;
  customFields: Array<{ key: string; label: string; type: string }>;
}) {
  const router = useRouter();
  const [marketId, setMarketId] = useState(markets[0]?.id ?? '');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [actions, setActions] = useState<Record<number, 'create' | 'skip'>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ created: number; skipped: number; parcelsMatched?: number } | null>(null);
  const [customFields, setCustomFields] = useState(initialCustomFields);
  const [extraMapping, setExtraMapping] = useState<Record<string, string>>({});
  const [creatingFieldFor, setCreatingFieldFor] = useState<string | null>(null);
  const [newFieldForm, setNewFieldForm] = useState({ label: '', type: 'text' as 'text' | 'number' | 'date' | 'checkbox' });

  const usedFields = useMemo(() => new Set(Object.values(preview?.mapping ?? {})), [preview]);
  const unmappedHeaders = useMemo(
    () => (preview ? preview.headers.filter((h) => !(h in preview.mapping)) : []),
    [preview],
  );

  async function upload(f: File, mapping?: Record<string, string>) {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const form = new FormData();
      form.append('file', f);
      form.append('marketId', marketId);
      if (mapping) form.append('mapping', JSON.stringify(mapping));

      const res = await fetch('/api/property-imports', { method: 'POST', body: form });
      const body = (await res.json().catch(() => ({}))) as Preview & { error?: string };
      if (!res.ok) throw new Error(body.error ?? 'That file could not be read.');

      setFile(f);
      setPreview(body);
      setActions(Object.fromEntries(body.rows.map((r) => [r.rowNumber, r.action])));
      setExtraMapping({});
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That file could not be read.');
    } finally {
      setBusy(false);
    }
  }

  async function applyMapping() {
    if (!file || !preview) return;
    const merged = { ...preview.mapping, ...extraMapping };
    await upload(file, merged);
  }

  async function createFieldAndMap(header: string) {
    if (!newFieldForm.label.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/taxonomy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'custom_field', data: { label: newFieldForm.label.trim(), type: newFieldForm.type } }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string; field?: { key: string; label: string; type: string } };
      if (!res.ok || !body.field) throw new Error(body.error ?? 'Could not create that field.');

      setCustomFields((prev) => [...prev, body.field!]);
      setExtraMapping((m) => ({ ...m, [header]: `${CUSTOM_FIELD_PREFIX}${body.field!.key}` }));
      setCreatingFieldFor(null);
      setNewFieldForm({ label: '', type: 'text' });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create that field.');
    } finally {
      setBusy(false);
    }
  }

  async function commit() {
    if (!preview) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/property-imports/${preview.batch.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actions }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string; result?: { created: number; skipped: number; parcelsMatched?: number } };
      if (!res.ok || !body.result) throw new Error(body.error ?? 'The import could not be committed.');

      setResult(body.result);
      setPreview(null);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The import could not be committed.');
    } finally {
      setBusy(false);
    }
  }

  const willImport = Object.values(actions).filter((a) => a !== 'skip').length;

  if (markets.length === 0) {
    return <p className="text-xs text-ink-500">Create a market first, then come back to import properties into it.</p>;
  }

  if (result) {
    return (
      <div className="space-y-3">
        <div className="banner-ok">
          <Check size={14} className="mt-px shrink-0" />
          <span>
            <strong>Import complete.</strong> {result.created} propert{result.created === 1 ? 'y' : 'ies'} created,
            {' '}{result.skipped} skipped.
            {!!result.parcelsMatched && (
              <> {result.parcelsMatched} matched to a real parcel boundary from the county&rsquo;s own GIS records.</>
            )}
            {' '}Any property without coordinates is flagged &ldquo;needs map placement&rdquo;, ready to place and
            work from a market.
          </span>
        </div>
        <button type="button" className="btn-secondary btn-sm" onClick={() => setResult(null)}>
          Import another file
        </button>
      </div>
    );
  }

  if (!preview) {
    return (
      <div className="space-y-3">
        <div>
          <label className="label" htmlFor="p-market">Market</label>
          <select id="p-market" className="input" value={marketId} onChange={(e) => setMarketId(e.target.value)}>
            {markets.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </div>
        <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-ink-300 px-6 py-8 text-center transition-colors hover:border-accent-500 hover:bg-accent-50">
          <Upload size={22} className="text-ink-400" />
          <span className="text-sm font-medium text-ink-800">Choose a CSV file</span>
          <span className="text-xs text-ink-500">
            A name/use or an address is required for each row. Everything else is optional.
          </span>
          <input
            type="file" accept=".csv,text/csv,text/plain" className="hidden" disabled={busy || !marketId}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = ''; }}
          />
        </label>
        {busy && <div className="banner-info"><Spinner /> Reading the file…</div>}
        {error && <div className="banner-error" role="alert">{error}</div>}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm font-medium text-ink-900">{preview.batch.filename}</span>
        <span className="text-xs text-ink-500 tnum">
          {preview.summary.total} rows · {preview.summary.valid} new · {preview.summary.duplicates} duplicate ·{' '}
          <span className={preview.summary.errors > 0 ? 'text-red-700' : ''}>{preview.summary.errors} with errors</span>
        </span>
        <button type="button" className="btn-ghost btn-sm" onClick={() => { setPreview(null); setError(null); }}>
          <X size={12} /> Start over
        </button>
      </div>

      <div>
        <h3 className="section-label mb-1.5">Column mapping</h3>
        <div className="flex flex-wrap gap-2">
          {Object.entries(FIELD_LABELS).map(([field, label]) => {
            const header = Object.entries(preview.mapping).find(([, f]) => f === field)?.[0];
            return (
              <span
                key={field}
                className={`chip ${header ? 'border-green-200 bg-green-50 text-green-800' : 'border-ink-200 bg-ink-50 text-ink-500'}`}
              >
                {label} {header ? `← ${header}` : '— not mapped'}
              </span>
            );
          })}
          {Object.entries(preview.mapping)
            .filter(([, f]) => f.startsWith(CUSTOM_FIELD_PREFIX))
            .map(([header, f]) => {
              const key = f.slice(CUSTOM_FIELD_PREFIX.length);
              const label = customFields.find((c) => c.key === key)?.label ?? key;
              return (
                <span key={header} className="chip border-green-200 bg-green-50 text-green-800">
                  {label} ← {header}
                </span>
              );
            })}
        </div>
      </div>

      {unmappedHeaders.length > 0 && (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3">
          <h3 className="mb-1 flex items-center gap-1.5 text-xs font-medium text-amber-900">
            <TriangleAlert size={13} /> {unmappedHeaders.length} column{unmappedHeaders.length === 1 ? '' : 's'} not recognized
          </h3>
          <p className="mb-2 text-[11px] text-amber-800">
            These columns will not be imported unless you map each one to a field, so nothing typed
            into your spreadsheet is lost.
          </p>
          <div className="space-y-1.5">
            {unmappedHeaders.map((header) => (
              <div key={header} className="flex flex-wrap items-center gap-2 rounded-md bg-white p-1.5">
                <span className="min-w-0 flex-1 truncate text-xs font-medium text-ink-800">{header}</span>
                {creatingFieldFor === header ? (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <input
                      className="input w-40 py-1 text-xs" placeholder="Field name" autoFocus
                      value={newFieldForm.label}
                      onChange={(e) => setNewFieldForm((f) => ({ ...f, label: e.target.value }))}
                    />
                    <select
                      className="input w-24 py-1 text-xs"
                      value={newFieldForm.type}
                      onChange={(e) => setNewFieldForm((f) => ({ ...f, type: e.target.value as typeof f.type }))}
                    >
                      {CUSTOM_FIELD_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                    </select>
                    <button
                      type="button" className="btn-primary btn-sm" disabled={busy || !newFieldForm.label.trim()}
                      onClick={() => void createFieldAndMap(header)}
                    >
                      Create
                    </button>
                    <button type="button" className="btn-ghost btn-sm" onClick={() => setCreatingFieldFor(null)}>Cancel</button>
                  </div>
                ) : (
                  <select
                    className="input w-52 py-1 text-xs"
                    value={extraMapping[header] ?? ''}
                    onChange={(e) => {
                      if (e.target.value === '__new__') { setCreatingFieldFor(header); return; }
                      setExtraMapping((m) => {
                        const next = { ...m };
                        if (e.target.value) next[header] = e.target.value; else delete next[header];
                        return next;
                      });
                    }}
                  >
                    <option value="">Ignore this column</option>
                    <optgroup label="Property fields">
                      {Object.entries(FIELD_LABELS)
                        .filter(([field]) => !usedFields.has(field) || extraMapping[header] === field)
                        .map(([field, label]) => <option key={field} value={field}>{label}</option>)}
                    </optgroup>
                    {customFields.length > 0 && (
                      <optgroup label="Custom fields">
                        {customFields.map((c) => (
                          <option key={c.key} value={`${CUSTOM_FIELD_PREFIX}${c.key}`}>{c.label}</option>
                        ))}
                      </optgroup>
                    )}
                    <option value="__new__">+ New custom field…</option>
                  </select>
                )}
              </div>
            ))}
          </div>
          {Object.keys(extraMapping).length > 0 && (
            <button type="button" className="btn-primary btn-sm mt-2" disabled={busy} onClick={() => void applyMapping()}>
              {busy && <Spinner />} Apply mapping
            </button>
          )}
        </div>
      )}

      {preview.summary.errors > 0 && (
        <div className="banner-warn">
          <TriangleAlert size={14} className="mt-px shrink-0" />
          <span>
            {preview.summary.errors} row{preview.summary.errors === 1 ? '' : 's'} could not be
            validated and will be skipped. The remaining rows still import normally.
          </span>
        </div>
      )}

      <div className="scroll-thin max-h-[420px] overflow-auto rounded-md border border-ink-200">
        <table className="table-dense">
          <thead>
            <tr>
              <th className="w-12">Row</th>
              <th>Name / address</th>
              <th className="w-32">Owner</th>
              <th className="w-32">Last sale</th>
              <th className="w-56">Notes</th>
              <th className="w-24">Action</th>
            </tr>
          </thead>
          <tbody>
            {preview.rows.map((row) => {
              const m = row.mapped as Record<string, string | number | null>;
              return (
                <tr key={row.rowNumber} className="cursor-default">
                  <td className="text-[11px] tnum text-ink-400">{row.rowNumber}</td>
                  <td>
                    <span className={row.verdict === 'error' ? 'text-red-700' : 'text-ink-900'}>
                      {(m.name as string) || <span className="unknown">missing</span>}
                    </span>
                    <div className="text-[11px] text-ink-500">{(m.addressLine1 as string) ?? ''}</div>
                  </td>
                  <td className="text-xs">{(m.ownerName as string) || <span className="unknown">—</span>}</td>
                  <td className="text-[11px] tnum">
                    {m.lastSalePrice ? `$${Number(m.lastSalePrice).toLocaleString()}` : <span className="unknown">—</span>}
                    {m.lastSaleDate ? <div className="text-ink-500">{m.lastSaleDate as string}</div> : null}
                  </td>
                  <td className="text-[11px]">
                    {row.errors.map((e, i) => <div key={i} className="text-red-700">{e}</div>)}
                    {row.warnings.map((w, i) => <div key={i} className="text-ink-500">{w}</div>)}
                  </td>
                  <td>
                    <select
                      className="input py-0.5 text-[11px]"
                      value={actions[row.rowNumber] ?? row.action}
                      disabled={row.verdict === 'error'}
                      onChange={(e) => setActions({ ...actions, [row.rowNumber]: e.target.value as 'create' | 'skip' })}
                    >
                      <option value="skip">Skip</option>
                      {row.verdict !== 'error' && <option value="create">Create</option>}
                    </select>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {error && <div className="banner-error" role="alert">{error}</div>}

      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-ink-600">
          <strong>{willImport}</strong> row{willImport === 1 ? '' : 's'} will be written.
          Nothing has been saved yet.
        </p>
        <button type="button" className="btn-primary" onClick={() => void commit()} disabled={busy || willImport === 0}>
          {busy && <Spinner />} Commit import
        </button>
      </div>
    </div>
  );
}
