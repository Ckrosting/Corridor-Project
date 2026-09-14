'use client';

import { useState } from 'react';
import { Route, X } from 'lucide-react';
import { Spinner } from '@/components/ui/primitives';

const COLORS = ['#2563eb', '#7c3aed', '#059669', '#d97706', '#dc2626', '#0891b2', '#be185d', '#4d7c0f'];

/**
 * Creates a corridor as an adjustable radius around a mall anchor.
 *
 * Radius is the starting point, not the end state: the corridor workspace lets
 * the boundary be redrawn by hand afterwards, and the radius parameters are kept
 * so the user can go back to a clean circle.
 */
export function AddCorridorDialog({
  marketId, anchors, onClose, onCreated,
}: {
  marketId: string;
  anchors: Array<{ id: string; name: string; latitude: number | null; longitude: number | null }>;
  onClose(): void;
  onCreated(corridorId: string): void;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [anchorId, setAnchorId] = useState(anchors[0]?.id ?? '');
  const [radiusMiles, setRadiusMiles] = useState(1);
  const [color, setColor] = useState(COLORS[0]!);
  const [lat, setLat] = useState('');
  const [lng, setLng] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const anchor = anchors.find((a) => a.id === anchorId);
  const centerLat = anchor?.latitude ?? (lat.trim() ? Number(lat) : null);
  const centerLng = anchor?.longitude ?? (lng.trim() ? Number(lng) : null);
  const hasCenter = centerLat != null && centerLng != null && Number.isFinite(centerLat) && Number.isFinite(centerLng);

  async function submit() {
    if (!name.trim()) { setError('A corridor name is required.'); return; }
    if (!hasCenter) { setError('Pick a mall anchor, or enter centre coordinates.'); return; }

    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/corridors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          marketId,
          name: name.trim(),
          description: description || null,
          color,
          anchorId: anchorId || null,
          centerLatitude: centerLat,
          centerLongitude: centerLng,
          radiusMeters: Math.round(radiusMiles * 1609.34),
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string; corridor?: { id: string } };
      if (!res.ok || !body.corridor) throw new Error(body.error ?? 'Could not create the corridor.');
      onCreated(body.corridor.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the corridor.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-ink-900/40 p-6" role="dialog" aria-modal="true">
      <div className="card w-full max-w-md">
        <div className="card-header">
          <h2 className="card-title flex items-center gap-1.5"><Route size={15} /> New corridor</h2>
          <button type="button" className="btn-ghost btn-sm" onClick={onClose} aria-label="Cancel"><X size={14} /></button>
        </div>

        <div className="space-y-3 p-4">
          <div>
            <label className="label" htmlFor="c-name">Corridor name <span className="text-red-600">*</span></label>
            <input
              id="c-name" className="input" autoFocus
              placeholder="e.g. Washington Road retail strip"
              value={name} onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div>
            <label className="label" htmlFor="c-desc">Description</label>
            <input id="c-desc" className="input" value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>

          {anchors.length > 0 ? (
            <div>
              <label className="label" htmlFor="c-anchor">Centre on mall anchor</label>
              <select id="c-anchor" className="input" value={anchorId} onChange={(e) => setAnchorId(e.target.value)}>
                <option value="">Use coordinates instead</option>
                {anchors.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>
          ) : (
            <div className="banner-info">
              <span>No placed mall anchors in this market yet. Enter centre coordinates below, or add a mall anchor first.</span>
            </div>
          )}

          {!anchorId && (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="label" htmlFor="c-lat">Centre latitude</label>
                <input id="c-lat" className="input" inputMode="decimal" value={lat} onChange={(e) => setLat(e.target.value)} />
              </div>
              <div>
                <label className="label" htmlFor="c-lng">Centre longitude</label>
                <input id="c-lng" className="input" inputMode="decimal" value={lng} onChange={(e) => setLng(e.target.value)} />
              </div>
            </div>
          )}

          <div>
            <label className="label" htmlFor="c-radius">
              Starting radius: <span className="tnum">{radiusMiles.toFixed(2)}</span> miles
            </label>
            <input
              id="c-radius" type="range" min={0.1} max={10} step={0.05} className="w-full"
              value={radiusMiles} onChange={(e) => setRadiusMiles(Number(e.target.value))}
            />
            <p className="field-hint">
              You can redraw this boundary by hand afterwards. The radius is kept so you can
              return to a circle at any time.
            </p>
          </div>

          <div>
            <div className="label">Map colour</div>
            <div className="flex gap-1.5">
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

          {error && <div className="banner-error" role="alert">{error}</div>}
        </div>

        <div className="flex justify-end gap-2 border-t border-ink-200 px-4 py-3">
          <button type="button" className="btn-secondary" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className="btn-primary" onClick={() => void submit()} disabled={busy || !hasCenter}>
            {busy && <Spinner />} Create corridor
          </button>
        </div>
      </div>
    </div>
  );
}
