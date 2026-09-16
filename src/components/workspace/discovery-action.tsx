'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  FileSpreadsheet, Link2, Search, Upload, X,
} from 'lucide-react';
import { Spinner } from '@/components/ui/primitives';

/**
 * "Find New Listings" plus the manual routes into this market.
 *
 * A scan is queued and runs in the worker; a submitted URL or uploaded document
 * is extracted inline because the user is waiting. Those three are AI-produced
 * claims, so they land in the discovery inbox for review. A spreadsheet import
 * is not: a broker export is already real listings, so it writes properties
 * directly, keeping only the duplicate and dismissal checks.
 */
export function DiscoveryAction({
  marketId, marketName, aiConfigured,
}: {
  marketId: string;
  marketName: string;
  aiConfigured: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<'scan' | 'url' | 'file' | 'csv'>('scan');
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [notes, setNotes] = useState<string[]>([]);
  // A broker export covers a whole city, so the default is a trade-area radius
  // around the mall rather than everything in the file.
  const [radiusMiles, setRadiusMiles] = useState('5');
  const [limitRadius, setLimitRadius] = useState(true);

  async function startScan() {
    setBusy(true);
    setError(null);
    setNotes([]);
    try {
      const res = await fetch('/api/scans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scope: 'market', marketId }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string; marketCount?: number };
      if (!res.ok) throw new Error(body.error ?? 'The scan could not be started.');

      setMessage('Scan queued. It runs in the background — you can keep working, and results appear in the discovery inbox.');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The scan could not be started.');
    } finally {
      setBusy(false);
    }
  }

  async function submitUrl() {
    setBusy(true);
    setError(null);
    setNotes([]);
    try {
      const res = await fetch('/api/discovery/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, marketId }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string; notes?: string[]; staged?: { created: number; duplicates: number; suppressed: number };
      };
      if (!res.ok) throw new Error(body.error ?? 'That URL could not be read.');

      setNotes(body.notes ?? []);
      setMessage(describe(body.staged));
      setUrl('');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That URL could not be read.');
    } finally {
      setBusy(false);
    }
  }

  async function submitFile(file: File) {
    setBusy(true);
    setError(null);
    setNotes([]);
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('marketId', marketId);

      const res = await fetch('/api/discovery/submit', { method: 'POST', body: form });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string; notes?: string[]; staged?: { created: number; duplicates: number; suppressed: number };
      };
      if (!res.ok) throw new Error(body.error ?? 'That document could not be read.');

      setNotes(body.notes ?? []);
      setMessage(describe(body.staged));
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That document could not be read.');
    } finally {
      setBusy(false);
    }
  }

  async function submitCsv(file: File) {
    setBusy(true);
    setError(null);
    setNotes([]);
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('marketId', marketId);
      if (limitRadius) form.append('radiusMiles', radiusMiles);

      const res = await fetch('/api/discovery/import-csv', { method: 'POST', body: form });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        staged?: { created: number; duplicates: number; suppressed: number };
        errors?: Array<{ rowNumber: number; message: string }>;
        notes?: string[];
      };
      if (!res.ok) throw new Error(body.error ?? 'That file could not be read.');

      // Unrecognised-column notes come first: they apply to every row, so they
      // matter more than any single row's problem.
      setNotes([
        ...(body.notes ?? []),
        ...(body.errors ?? []).map((e) => `Row ${e.rowNumber}: ${e.message}`),
      ]);
      setMessage(describeImport(body.staged));
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That file could not be read.');
    } finally {
      setBusy(false);
    }
  }

  /** A spreadsheet import writes properties, so it reports what landed, not what is queued. */
  function describeImport(staged?: { created: number; duplicates: number; suppressed: number }): string {
    if (!staged) return 'Done.';
    const parts: string[] = [];
    if (staged.created > 0) {
      parts.push(`${staged.created} propert${staged.created === 1 ? 'y' : 'ies'} added to this market.`);
    }
    if (staged.duplicates > 0) parts.push(`${staged.duplicates} already here.`);
    if (staged.suppressed > 0) parts.push(`${staged.suppressed} previously dismissed.`);
    return parts.length ? parts.join(' ') : 'Nothing new to add — every row was already here.';
  }

  function describe(staged?: { created: number; duplicates: number; suppressed: number }): string {
    if (!staged) return 'Done.';
    if (staged.created > 0) {
      return `${staged.created} candidate${staged.created === 1 ? '' : 's'} added to the discovery inbox for review.`;
    }
    if (staged.duplicates > 0) return 'That listing is already in the inbox — its last-seen date was updated.';
    if (staged.suppressed > 0) return 'That listing was already reviewed previously, so it was not added again.';
    return 'Nothing could be extracted from that source.';
  }

  if (!open) {
    return (
      <button type="button" className="btn-secondary btn-sm" onClick={() => setOpen(true)}>
        <Search size={13} /> Find listings
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-ink-900/40 p-6" role="dialog" aria-modal="true">
      <div className="card w-full max-w-lg">
        <div className="card-header">
          <h2 className="card-title flex items-center gap-1.5">
            <Search size={15} /> Find listings in {marketName}
          </h2>
          <button
            type="button" className="btn-ghost btn-sm" aria-label="Close"
            onClick={() => { setOpen(false); setMessage(null); setError(null); setNotes([]); }}
          >
            <X size={14} />
          </button>
        </div>

        <div className="flex gap-0.5 border-b border-ink-200 px-3">
          {([
            ['scan', 'Search the web'],
            ['url', 'Add a listing URL'],
            ['file', 'Upload a flyer / OM'],
            ['csv', 'Import a listings export'],
          ] as const).map(([key, label]) => (
            <button
              key={key} type="button" onClick={() => { setTab(key); setError(null); setMessage(null); }}
              className={`-mb-px border-b-2 px-2.5 py-2 text-xs font-medium transition-colors ${
                tab === key ? 'border-accent-600 text-accent-700' : 'border-transparent text-ink-500 hover:text-ink-800'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="space-y-3 p-4">
          {!aiConfigured && tab !== 'csv' && (
            <div className="banner-warn">
              <span>
                <strong>Discovery is not configured.</strong> An administrator needs to set
                {' '}<code className="rounded bg-amber-100 px-1">ANTHROPIC_API_KEY</code> on the
                server. You can still add properties by hand from the map, or use the
                {' '}<strong>Import a listings export</strong> tab, which needs no API key.
              </span>
            </div>
          )}

          {tab === 'scan' && (
            <>
              <p className="text-xs leading-relaxed text-ink-600">
                Searches publicly accessible listing sources for any property type offered for sale
                in this market, with no price restriction. Results are staged in the discovery
                inbox for your review — nothing is added to the map automatically.
              </p>
              <div className="banner-info">
                <span>
                  Sources that are blocked, paywalled or behind a login are reported as coverage
                  limitations rather than skipped silently. This is not a complete market survey.
                </span>
              </div>
              <button type="button" className="btn-primary w-full" onClick={() => void startScan()} disabled={busy || !aiConfigured}>
                {busy && <Spinner />} Start scan
              </button>
            </>
          )}

          {tab === 'url' && (
            <>
              <p className="text-xs leading-relaxed text-ink-600">
                Paste a listing page URL. It is read and extracted through the same review pipeline
                as a scan.
              </p>
              <input
                className="input" placeholder="https://…" value={url}
                onChange={(e) => setUrl(e.target.value)} disabled={busy}
              />
              <button
                type="button" className="btn-primary w-full"
                onClick={() => void submitUrl()} disabled={busy || !url.trim() || !aiConfigured}
              >
                {busy ? <Spinner /> : <Link2 size={13} />} Extract from URL
              </button>
            </>
          )}

          {tab === 'file' && (
            <>
              <p className="text-xs leading-relaxed text-ink-600">
                Upload a broker flyer or offering memorandum as a PDF or image. Word and Excel files
                need exporting to PDF first.
              </p>
              <label className="flex cursor-pointer flex-col items-center gap-1.5 rounded-lg border-2 border-dashed border-ink-300 px-4 py-6 text-center hover:border-accent-500 hover:bg-accent-50">
                <Upload size={20} className="text-ink-400" />
                <span className="text-xs font-medium text-ink-800">Choose a PDF or image</span>
                <input
                  type="file" accept="application/pdf,image/*" className="hidden" disabled={busy || !aiConfigured}
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) void submitFile(f); e.target.value = ''; }}
                />
              </label>
              {busy && <div className="banner-info"><Spinner /> Reading the document…</div>}
            </>
          )}

          {tab === 'csv' && (
            <>
              <p className="text-xs leading-relaxed text-ink-600">
                For listings found outside the app - a broker inventory export (Crexi and similar,
                as downloaded), or rows assembled by hand. This calls no AI model and costs nothing.
                Rows become properties in this market straight away; anything already here, or
                already dismissed, is skipped rather than duplicated.
              </p>

              <div className="space-y-1.5 rounded-lg border border-ink-200 p-2.5">
                <label className="flex items-center gap-2 text-xs font-medium text-ink-800">
                  <input
                    type="checkbox" checked={limitRadius} disabled={busy}
                    onChange={(e) => setLimitRadius(e.target.checked)}
                  />
                  Only import listings within
                  <input
                    className="input w-16 py-0.5 text-xs" inputMode="decimal" value={radiusMiles}
                    disabled={busy || !limitRadius} onChange={(e) => setRadiusMiles(e.target.value)}
                  />
                  miles of the mall
                </label>
                <p className="field-hint">
                  {limitRadius
                    ? 'A city-wide export is mostly listings nowhere near this market. Rows with no coordinates are imported anyway rather than dropped, and the count skipped is reported.'
                    : 'Every row in the file will be imported, however far from the mall it is.'}
                </p>
              </div>
              <a
                href="/api/export/candidate-template"
                className="btn-secondary btn-sm w-full justify-center"
              >
                Download the column template
              </a>
              <label className="flex cursor-pointer flex-col items-center gap-1.5 rounded-lg border-2 border-dashed border-ink-300 px-4 py-6 text-center hover:border-accent-500 hover:bg-accent-50">
                <FileSpreadsheet size={20} className="text-ink-400" />
                <span className="text-xs font-medium text-ink-800">Choose a CSV or Excel file</span>
                <input
                  type="file" accept=".csv,.xlsx,.xlsm,text/csv" className="hidden" disabled={busy}
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) void submitCsv(f); e.target.value = ''; }}
                />
              </label>
              {busy && <div className="banner-info"><Spinner /> Reading the file…</div>}
            </>
          )}

          {message && (
            <div className="banner-ok">
              <span>
                {message}{' '}
                <Link href="/discovery" className="underline underline-offset-2">Open the inbox</Link>
              </span>
            </div>
          )}

          {notes.length > 0 && (
            <div className="banner-warn">
              <span>
                <strong>Notes:</strong>
                <ul className="mt-1 space-y-0.5">
                  {notes.slice(0, 6).map((n, i) => <li key={i}>• {n}</li>)}
                </ul>
              </span>
            </div>
          )}

          {error && <div className="banner-error" role="alert">{error}</div>}

          <p className="field-hint">
            A CoStar subscription does not grant automated access, so CoStar is not searched. Export
            from CoStar and use the import tools, or paste an individual public listing URL here.
          </p>
        </div>
      </div>
    </div>
  );
}
