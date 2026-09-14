'use client';

import { useState } from 'react';
import { MapPin, Search, X } from 'lucide-react';
import { Spinner } from '@/components/ui/primitives';

interface GeocodeHit {
  label: string;
  lat: number;
  lng: number;
  confidence: 'high' | 'medium' | 'low';
  provider: string;
}

/**
 * Adds a mall anchor by address or by explicit coordinates.
 *
 * Address lookup is a convenience, not a requirement: when the geocoder is
 * unconfigured, rate-limited or simply wrong, the anchor can still be saved with
 * coordinates typed in, or saved without them and flagged for map placement.
 */
export function AddAnchorDialog({
  marketId, onClose, onCreated,
}: {
  marketId: string;
  onClose(): void;
  onCreated(): void;
}) {
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [postalCode, setPostalCode] = useState('');
  const [lat, setLat] = useState('');
  const [lng, setLng] = useState('');

  const [hits, setHits] = useState<GeocodeHit[]>([]);
  const [geoNote, setGeoNote] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function lookup() {
    const query = [address, city, state, postalCode].filter(Boolean).join(', ').trim();
    if (!query) { setError('Enter an address to look up.'); return; }

    setSearching(true);
    setError(null);
    setGeoNote(null);
    try {
      const res = await fetch(`/api/geocode?q=${encodeURIComponent(query)}`);
      const body = (await res.json()) as { results: GeocodeHit[]; unavailableReason?: string };
      setHits(body.results ?? []);
      if (body.unavailableReason) setGeoNote(body.unavailableReason);
      else if ((body.results ?? []).length === 0) {
        setGeoNote('No matches. Enter coordinates by hand, or save without them and place the mall on the map later.');
      }
    } catch {
      setGeoNote('Address lookup failed. You can still enter coordinates by hand or save without them.');
    } finally {
      setSearching(false);
    }
  }

  async function submit() {
    if (!name.trim()) { setError('A mall name is required.'); return; }
    setBusy(true);
    setError(null);
    try {
      const latNum = lat.trim() ? Number(lat) : null;
      const lngNum = lng.trim() ? Number(lng) : null;
      if ((latNum !== null && !Number.isFinite(latNum)) || (lngNum !== null && !Number.isFinite(lngNum))) {
        throw new Error('Latitude and longitude must be numbers.');
      }

      const res = await fetch('/api/mall-anchors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          marketId, name: name.trim(),
          addressLine1: address || null, city: city || null,
          state: state || null, postalCode: postalCode || null,
          latitude: latNum, longitude: lngNum,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? 'Could not save the mall anchor.');
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the mall anchor.');
    } finally {
      setBusy(false);
    }
  }

  const hasCoords = lat.trim() !== '' && lng.trim() !== '';

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-ink-900/40 p-6" role="dialog" aria-modal="true">
      <div className="card w-full max-w-lg">
        <div className="card-header">
          <h2 className="card-title flex items-center gap-1.5"><MapPin size={15} /> Add mall anchor</h2>
          <button type="button" className="btn-ghost btn-sm" onClick={onClose} aria-label="Cancel"><X size={14} /></button>
        </div>

        <div className="scroll-thin max-h-[70vh] space-y-3 overflow-y-auto p-4">
          <div>
            <label className="label" htmlFor="a-name">Mall name <span className="text-red-600">*</span></label>
            <input id="a-name" className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} />
          </div>

          <div>
            <label className="label" htmlFor="a-addr">Street address</label>
            <input id="a-addr" className="input" value={address} onChange={(e) => setAddress(e.target.value)} />
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="label" htmlFor="a-city">City</label>
              <input id="a-city" className="input" value={city} onChange={(e) => setCity(e.target.value)} />
            </div>
            <div>
              <label className="label" htmlFor="a-state">State</label>
              <input id="a-state" className="input" maxLength={2} value={state} onChange={(e) => setState(e.target.value.toUpperCase())} />
            </div>
            <div>
              <label className="label" htmlFor="a-zip">ZIP</label>
              <input id="a-zip" className="input" value={postalCode} onChange={(e) => setPostalCode(e.target.value)} />
            </div>
          </div>

          <button type="button" className="btn-secondary btn-sm" onClick={() => void lookup()} disabled={searching}>
            {searching ? <Spinner /> : <Search size={13} />} Look up coordinates
          </button>

          {geoNote && <div className="banner-warn">{geoNote}</div>}

          {hits.length > 0 && (
            <ul className="divide-y divide-ink-100 rounded-md border border-ink-200">
              {hits.map((h, i) => (
                <li key={`${h.lat}-${h.lng}-${i}`}>
                  <button
                    type="button"
                    className="w-full px-2.5 py-2 text-left hover:bg-accent-50"
                    onClick={() => { setLat(String(h.lat)); setLng(String(h.lng)); }}
                  >
                    <span className="block text-xs text-ink-900">{h.label}</span>
                    <span className="block text-[11px] text-ink-500">
                      {h.lat.toFixed(5)}, {h.lng.toFixed(5)} · {h.confidence} confidence · {h.provider}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="label" htmlFor="a-lat">Latitude</label>
              <input id="a-lat" className="input" inputMode="decimal" placeholder="Optional" value={lat} onChange={(e) => setLat(e.target.value)} />
            </div>
            <div>
              <label className="label" htmlFor="a-lng">Longitude</label>
              <input id="a-lng" className="input" inputMode="decimal" placeholder="Optional" value={lng} onChange={(e) => setLng(e.target.value)} />
            </div>
          </div>

          {!hasCoords && (
            <div className="banner-info">
              <span>
                Without coordinates this mall will be saved and flagged as
                <strong> needs map placement</strong>, so it is never silently missing
                from the map.
              </span>
            </div>
          )}

          {error && <div className="banner-error" role="alert">{error}</div>}
        </div>

        <div className="flex justify-end gap-2 border-t border-ink-200 px-4 py-3">
          <button type="button" className="btn-secondary" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className="btn-primary" onClick={() => void submit()} disabled={busy}>
            {busy && <Spinner />} Add mall
          </button>
        </div>
      </div>
    </div>
  );
}
