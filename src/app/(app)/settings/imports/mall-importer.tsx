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
  action: 'create' | 'update' | 'skip';
}

interface Preview {
  batch: { id: string; filename: string };
  headers: string[];
  mapping: Record<string, string>;
  rows: PreviewRow[];
  summary: { total: number; valid: number; duplicates: number; errors: number };
}

const FIELD_LABELS: Record<string, string> = {
  mallName: 'Mall name',
  marketName: 'Market name',
  streetAddress: 'Street address',
  city: 'City',
  state: 'State',
  zip: 'ZIP',
  county: 'County',
  notes: 'Notes',
  latitude: 'Latitude',
  longitude: 'Longitude',
};

/**
 * Upload → map → preview → confirm.
 *
 * Nothing is written until the user presses Commit, and each row's action can be
 * changed first. Duplicates default to skip so an accidental re-import cannot
 * double the data.
 */
export function MallImporter() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [actions, setActions] = useState<Record<number, 'create' | 'update' | 'skip'>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ created: number; updated: number; skipped: number } | null>(null);
  const [extraMapping, setExtraMapping] = useState<Record<string, string>>({});

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
      if (mapping) form.append('mapping', JSON.stringify(mapping));

      const res = await fetch('/api/imports', { method: 'POST', body: form });
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
    await upload(file, { ...preview.mapping, ...extraMapping });
  }

  async function commit() {
    if (!preview) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/imports/${preview.batch.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actions }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string; result?: { created: number; updated: number; skipped: number } };
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

  if (result) {
    return (
      <div className="space-y-3">
        <div className="banner-ok">
          <Check size={14} className="mt-px shrink-0" />
          <span>
            <strong>Import complete.</strong> {result.created} mall{result.created === 1 ? '' : 's'} created,
            {' '}{result.updated} updated, {result.skipped} skipped.
            {result.created > 0 && ' Any mall without coordinates is flagged for map placement on its market page.'}
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
        <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-ink-300 px-6 py-8 text-center transition-colors hover:border-accent-500 hover:bg-accent-50">
          <Upload size={22} className="text-ink-400" />
          <span className="text-sm font-medium text-ink-800">Choose a CSV file</span>
          <span className="text-xs text-ink-500">
            Mall name and market name are required. Everything else is optional.
          </span>
          <input
            type="file" accept=".csv,text/csv,text/plain" className="hidden" disabled={busy}
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

      {/* --------------------------------------------------- Column mapping */}
      <div>
        <h3 className="section-label mb-1.5">Column mapping</h3>
        <div className="flex flex-wrap gap-2">
          {Object.entries(FIELD_LABELS).map(([field, label]) => {
            const header = Object.entries(preview.mapping).find(([, f]) => f === field)?.[0];
            const required = field === 'mallName' || field === 'marketName';
            return (
              <span
                key={field}
                className={`chip ${
                  header ? 'border-green-200 bg-green-50 text-green-800'
                    : required ? 'border-red-200 bg-red-50 text-red-800'
                      : 'border-ink-200 bg-ink-50 text-ink-500'
                }`}
              >
                {label} {header ? `← ${header}` : required ? '← not found' : '— not mapped'}
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
                <select
                  className="input w-52 py-1 text-xs"
                  value={extraMapping[header] ?? ''}
                  onChange={(e) => setExtraMapping((m) => {
                    const next = { ...m };
                    if (e.target.value) next[header] = e.target.value; else delete next[header];
                    return next;
                  })}
                >
                  <option value="">Ignore this column</option>
                  {Object.entries(FIELD_LABELS)
                    .filter(([field]) => !usedFields.has(field) || extraMapping[header] === field)
                    .map(([field, label]) => <option key={field} value={field}>{label}</option>)}
                </select>
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

      {/* ------------------------------------------------------------ Rows */}
      <div className="scroll-thin max-h-[420px] overflow-auto rounded-md border border-ink-200">
        <table className="table-dense">
          <thead>
            <tr>
              <th className="w-12">Row</th>
              <th>Mall</th>
              <th className="w-40">Market</th>
              <th className="w-28">Coordinates</th>
              <th className="w-56">Notes</th>
              <th className="w-28">Action</th>
            </tr>
          </thead>
          <tbody>
            {preview.rows.map((row) => {
              const m = row.mapped as Record<string, string | number | null>;
              const hasCoords = m.latitude != null && m.longitude != null;
              return (
                <tr key={row.rowNumber} className="cursor-default">
                  <td className="text-[11px] tnum text-ink-400">{row.rowNumber}</td>
                  <td>
                    <span className={row.verdict === 'error' ? 'text-red-700' : 'text-ink-900'}>
                      {(m.mallName as string) || <span className="unknown">missing</span>}
                    </span>
                    <div className="text-[11px] text-ink-500">{(m.streetAddress as string) ?? ''}</div>
                  </td>
                  <td className="text-xs">{(m.marketName as string) || <span className="unknown">missing</span>}</td>
                  <td className="text-[11px] tnum">
                    {hasCoords
                      ? `${Number(m.latitude).toFixed(4)}, ${Number(m.longitude).toFixed(4)}`
                      : <span className="text-amber-700">needs placement</span>}
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
                      onChange={(e) => setActions({
                        ...actions,
                        [row.rowNumber]: e.target.value as 'create' | 'update' | 'skip',
                      })}
                    >
                      <option value="skip">Skip</option>
                      {row.verdict !== 'error' && <option value="create">Create</option>}
                      {row.verdict === 'duplicate' && <option value="update">Update existing</option>}
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
