'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Search } from 'lucide-react';
import { LISTING_STATUS_LABELS } from '@/lib/format';
import { Spinner } from '@/components/ui/primitives';

interface GeocodeHit {
  label: string; lat: number; lng: number;
  confidence: 'high' | 'medium' | 'low'; provider: string;
}

/**
 * Creates a property.
 *
 * Coordinates are optional: a property can be recorded now and placed on the map
 * later, and a property placed as a point is flagged "needs parcel outline" so
 * the boundary can be drawn whenever it suits.
 */
export function NewPropertyForm({
  markets, statuses, propertyTypes, defaultMarketId, returnToMarketId,
}: {
  markets: Array<{ id: string; name: string }>;
  statuses: Array<{ id: string; label: string; color: string }>;
  propertyTypes: string[];
  defaultMarketId: string;
  returnToMarketId: string | null;
}) {
  const router = useRouter();
  const [form, setForm] = useState({
    marketId: defaultMarketId,
    name: '',
    addressLine1: '',
    city: '',
    state: '',
    postalCode: '',
    county: '',
    latitude: '',
    longitude: '',
    propertyType: '',
    listingStatus: 'unknown',
    askingPrice: '',
    buildingSqft: '',
    landAcreage: '',
    outreachStatusId: '',
    researchNotes: '',
  });

  const [hits, setHits] = useState<GeocodeHit[]>([]);
  const [geoNote, setGeoNote] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  async function lookup() {
    const query = [form.addressLine1, form.city, form.state, form.postalCode].filter(Boolean).join(', ').trim();
    if (!query) { setGeoNote('Enter an address first.'); return; }

    setSearching(true);
    setGeoNote(null);
    try {
      const res = await fetch(`/api/geocode?q=${encodeURIComponent(query)}`);
      const body = (await res.json()) as { results: GeocodeHit[]; unavailableReason?: string };
      setHits(body.results ?? []);
      if (body.unavailableReason) setGeoNote(body.unavailableReason);
      else if ((body.results ?? []).length === 0) {
        setGeoNote('No matches. Enter coordinates by hand, or save without them and place it on the map later.');
      }
    } catch {
      setGeoNote('Address lookup is unavailable. You can still enter coordinates or place it on the map later.');
    } finally {
      setSearching(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const blank = (v: string) => (v.trim() === '' ? null : v.trim());

      const res = await fetch('/api/properties', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          marketId: form.marketId,
          name: blank(form.name),
          addressLine1: blank(form.addressLine1),
          city: blank(form.city),
          state: blank(form.state),
          postalCode: blank(form.postalCode),
          county: blank(form.county),
          latitude: form.latitude.trim() ? Number(form.latitude) : null,
          longitude: form.longitude.trim() ? Number(form.longitude) : null,
          locationSource: form.latitude.trim() ? 'manual' : null,
          propertyType: blank(form.propertyType),
          listingStatus: form.listingStatus,
          askingPrice: blank(form.askingPrice),
          buildingSqft: blank(form.buildingSqft),
          landAcreage: blank(form.landAcreage),
          outreachStatusId: form.outreachStatusId || null,
          researchNotes: blank(form.researchNotes),
        }),
      });

      const body = (await res.json().catch(() => ({}))) as {
        error?: string; details?: Array<{ path: string; message: string }>; property?: { id: string };
      };
      if (!res.ok || !body.property) {
        throw new Error(body.details?.[0]
          ? `${body.details[0].path}: ${body.details[0].message}`
          : body.error ?? 'Could not create the property.');
      }

      router.push(returnToMarketId ? `/markets/${returnToMarketId}` : `/properties/${body.property.id}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the property.');
      setBusy(false);
    }
  }

  return (
    <form className="card" onSubmit={submit}>
      <div className="space-y-4 p-5">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label" htmlFor="p-market">Market <span className="text-red-600">*</span></label>
            <select id="p-market" className="input" required value={form.marketId} onChange={set('marketId')}>
              {markets.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="p-type">Property type</label>
            <select id="p-type" className="input" value={form.propertyType} onChange={set('propertyType')}>
              <option value="">Not known yet</option>
              {propertyTypes.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
        </div>

        <div>
          <label className="label" htmlFor="p-name">Property name</label>
          <input
            id="p-name" className="input" autoFocus
            placeholder="Optional — the address is used if left blank"
            value={form.name} onChange={set('name')}
          />
        </div>

        <div>
          <label className="label" htmlFor="p-addr">Street address</label>
          <input id="p-addr" className="input" value={form.addressLine1} onChange={set('addressLine1')} />
        </div>

        <div className="grid grid-cols-4 gap-2">
          <div className="col-span-2">
            <label className="label" htmlFor="p-city">City</label>
            <input id="p-city" className="input" value={form.city} onChange={set('city')} />
          </div>
          <div>
            <label className="label" htmlFor="p-state">State</label>
            <input id="p-state" className="input" maxLength={2} value={form.state} onChange={(e) => setForm((f) => ({ ...f, state: e.target.value.toUpperCase() }))} />
          </div>
          <div>
            <label className="label" htmlFor="p-zip">ZIP</label>
            <input id="p-zip" className="input" value={form.postalCode} onChange={set('postalCode')} />
          </div>
        </div>

        <div>
          <button type="button" className="btn-secondary btn-sm" onClick={() => void lookup()} disabled={searching}>
            {searching ? <Spinner /> : <Search size={13} />} Look up coordinates
          </button>
        </div>

        {geoNote && <div className="banner-warn">{geoNote}</div>}

        {hits.length > 0 && (
          <ul className="divide-y divide-ink-100 rounded-md border border-ink-200">
            {hits.map((h, i) => (
              <li key={`${h.lat}-${i}`}>
                <button
                  type="button"
                  className="w-full px-2.5 py-2 text-left hover:bg-accent-50"
                  onClick={() => setForm((f) => ({ ...f, latitude: String(h.lat), longitude: String(h.lng) }))}
                >
                  <span className="block text-xs text-ink-900">{h.label}</span>
                  <span className="block text-[11px] text-ink-500">
                    {h.lat.toFixed(5)}, {h.lng.toFixed(5)} · {h.confidence} confidence
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label" htmlFor="p-lat">Latitude</label>
            <input id="p-lat" className="input" inputMode="decimal" value={form.latitude} onChange={set('latitude')} />
          </div>
          <div>
            <label className="label" htmlFor="p-lng">Longitude</label>
            <input id="p-lng" className="input" inputMode="decimal" value={form.longitude} onChange={set('longitude')} />
          </div>
        </div>

        {!form.latitude.trim() && (
          <p className="field-hint">
            Without coordinates this property is saved but will not appear on the map until you
            place it. It is flagged so it is never silently missing.
          </p>
        )}

        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="label" htmlFor="p-listing">Listing status</label>
            <select id="p-listing" className="input" value={form.listingStatus} onChange={set('listingStatus')}>
              {Object.entries(LISTING_STATUS_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="p-asking">Asking price</label>
            <input id="p-asking" className="input" inputMode="decimal" placeholder="If known" value={form.askingPrice} onChange={set('askingPrice')} />
          </div>
          <div>
            <label className="label" htmlFor="p-outreach">Outreach status</label>
            <select id="p-outreach" className="input" value={form.outreachStatusId} onChange={set('outreachStatusId')}>
              <option value="">Use the default</option>
              {statuses.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label" htmlFor="p-sqft">Building sq ft</label>
            <input id="p-sqft" className="input" inputMode="numeric" placeholder="If known" value={form.buildingSqft} onChange={set('buildingSqft')} />
          </div>
          <div>
            <label className="label" htmlFor="p-acres">Land acreage</label>
            <input id="p-acres" className="input" inputMode="decimal" placeholder="If known" value={form.landAcreage} onChange={set('landAcreage')} />
          </div>
        </div>

        <div>
          <label className="label" htmlFor="p-notes">Research notes</label>
          <textarea id="p-notes" className="input" rows={4} value={form.researchNotes} onChange={set('researchNotes')} />
        </div>

        {error && <div className="banner-error" role="alert">{error}</div>}
      </div>

      <div className="flex justify-end gap-2 border-t border-ink-200 px-5 py-3">
        <Link href={returnToMarketId ? `/markets/${returnToMarketId}` : '/properties'} className="btn-secondary">Cancel</Link>
        <button type="submit" className="btn-primary" disabled={busy || !form.marketId}>
          {busy && <Spinner />} Create property
        </button>
      </div>
    </form>
  );
}
