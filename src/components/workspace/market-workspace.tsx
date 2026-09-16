'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Building2, MapPin, Plus, Route, Target, Trash2,
} from 'lucide-react';
import { Map, type MapViewHandle } from '@/components/map';
import type { AreaGeometry, LatLng } from '@/lib/geo/types';
import { propertyTitle } from '@/lib/format';
import {
  ApproximateBoundaryNote, EmptyState, Spinner, StatusChip,
} from '@/components/ui/primitives';
import { AddCorridorDialog } from './add-corridor-dialog';
import { AddAnchorDialog } from './add-anchor-dialog';
import { PropertyPanel } from './property-panel';

interface Corridor {
  id: string;
  name: string;
  description: string | null;
  color: string;
  boundary: AreaGeometry | null;
  boundaryKind: string;
  radiusMeters: number | null;
  propertyCount: number;
  version: number;
}

interface Anchor {
  id: string;
  name: string;
  addressLine1: string | null;
  city: string | null;
  state: string | null;
  latitude: number | null;
  longitude: number | null;
  needsMapPlacement: boolean;
}

/**
 * Market overview: every corridor and mall anchor on one map, as the zoom level
 * between the portfolio dashboard and an individual corridor workspace.
 */
export function MarketWorkspace({
  market, corridors, anchors, properties, parcels, statuses, isAdmin,
}: {
  market: { id: string; name: string; state: string | null; notes: string | null; version?: number };
  corridors: Corridor[];
  anchors: Anchor[];
  properties: Array<{
    id: string; name: string | null; addressLine1: string | null; city: string | null;
    latitude: number | null; longitude: number | null; needsParcelOutline: boolean;
    isSample: boolean; outreachStatusLabel: string | null; outreachStatusColor: string | null;
    version: number;
  }>;
  parcels: Array<{ id: string; propertyId: string; geometry: AreaGeometry | null; label: string | null; geometrySource?: string | null; version?: number }>;
  statuses: Array<{ id: string; label: string; color: string }>;
  isAdmin: boolean;
}) {
  const router = useRouter();
  const mapRef = useRef<MapViewHandle>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [addingCorridor, setAddingCorridor] = useState(false);
  const [addingAnchor, setAddingAnchor] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [moveError, setMoveError] = useState<string | null>(null);

  const deleteMarket = useCallback(async () => {
    setBusy('Deleting market…');
    setDeleteError(null);
    try {
      const res = await fetch(`/api/markets/${market.id}`, { method: 'DELETE' });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? 'Could not delete the market.');
      router.push('/markets');
      router.refresh();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Could not delete the market.');
      setBusy(null);
      setConfirmingDelete(false);
    }
  }, [market.id, router]);

  const placedAnchors = anchors.filter((a) => !a.needsMapPlacement && a.latitude != null);
  const unplacedAnchors = anchors.filter((a) => a.needsMapPlacement || a.latitude == null);

  // Fit to the first corridor with a boundary, else centre on the first placed anchor.
  const initialFit = useMemo(() => corridors.find((c) => c.boundary)?.boundary ?? null, [corridors]);
  const initialCenter = useMemo(() => {
    if (initialFit) return null;
    const anchor = placedAnchors[0];
    if (!anchor || anchor.latitude == null || anchor.longitude == null) return null;
    return { point: { lat: anchor.latitude, lng: anchor.longitude }, zoom: 15 };
  }, [initialFit, placedAnchors]);

  const mapProperties = useMemo(() => properties.map((p) => ({
    id: p.id,
    latitude: p.latitude,
    longitude: p.longitude,
    title: propertyTitle(p),
    statusColor: p.outreachStatusColor,
    statusLabel: p.outreachStatusLabel,
    needsParcelOutline: p.needsParcelOutline,
    isSample: p.isSample,
  })), [properties]);

  const mapParcels = useMemo(() => parcels.map((p) => {
    const property = properties.find((x) => x.id === p.propertyId);
    return { ...p, propertyTitle: property ? propertyTitle(property) : null };
  }), [parcels, properties]);

  const noop = useCallback(() => {}, []);

  const handleParcelEdited = useCallback(async (parcelId: string, geometry: AreaGeometry) => {
    try {
      // Re-read the parcel's version immediately before writing, so a
      // concurrent edit is detected by the server rather than silently
      // overwritten.
      const current = parcels.find((p) => p.id === parcelId);
      const res = await fetch(`/api/parcels/${parcelId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ geometry, version: current?.version ?? 1 }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? 'Could not save the parcel edit.');
      router.refresh();
    } catch (err) {
      setMoveError(err instanceof Error ? err.message : 'Could not save the parcel edit.');
      router.refresh();
    }
  }, [parcels, router]);

  const handlePropertyMoved = useCallback(async (propertyId: string, point: LatLng) => {
    setMoveError(null);
    try {
      const current = properties.find((p) => p.id === propertyId);
      const res = await fetch(`/api/properties/${propertyId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          latitude: point.lat, longitude: point.lng, locationSource: 'manual',
          version: current?.version ?? 1,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? 'Could not save the new location.');
      router.refresh();
    } catch (err) {
      setMoveError(err instanceof Error ? err.message : 'Could not save the new location.');
      router.refresh();
    }
  }, [properties, router]);

  return (
    <>
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-ink-200 bg-white px-6 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Link href="/markets" className="text-xs text-ink-500 hover:text-accent-700">Markets</Link>
            <span className="text-ink-300">/</span>
            <h1 className="truncate text-base font-semibold tracking-tight text-ink-900">{market.name}</h1>
            {market.state && <span className="text-xs text-ink-500">{market.state}</span>}
          </div>
          <p className="text-xs text-ink-500">
            {anchors.length} mall{anchors.length === 1 ? '' : 's'} · {corridors.length} corridor
            {corridors.length === 1 ? '' : 's'} · {properties.length} propert{properties.length === 1 ? 'y' : 'ies'}
          </p>
        </div>
        <div className="flex gap-2">
          <button type="button" className="btn-secondary btn-sm" onClick={() => setAddingAnchor(true)}>
            <Target size={13} /> Add mall anchor
          </button>
          <button
            type="button" className="btn-primary btn-sm"
            onClick={() => setAddingCorridor(true)}
            title={anchors.length === 0 ? 'You can still create a corridor without an anchor' : undefined}
          >
            <Plus size={13} /> New corridor
          </button>

          {isAdmin && (
            confirmingDelete ? (
              <div className="flex items-center gap-1.5 rounded-md border border-red-200 bg-red-50 px-2 py-1">
                <span className="text-xs text-red-700">
                  Delete this market{corridors.length > 0 ? ` and its ${corridors.length} corridor${corridors.length === 1 ? '' : 's'}` : ''}?
                </span>
                <button
                  type="button"
                  className="rounded bg-red-600 px-2 py-0.5 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
                  onClick={deleteMarket}
                  disabled={busy !== null}
                >
                  Confirm
                </button>
                <button
                  type="button"
                  className="rounded px-2 py-0.5 text-xs text-ink-600 hover:bg-ink-100"
                  onClick={() => setConfirmingDelete(false)}
                  disabled={busy !== null}
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                type="button"
                className="btn-secondary btn-sm text-red-600 hover:bg-red-50"
                onClick={() => setConfirmingDelete(true)}
                title="Delete this market (corridors and properties are kept and can be recovered)"
              >
                <Trash2 size={13} /> Delete market
              </button>
            )
          )}
        </div>
      </header>
      {deleteError && (
        <div className="border-b border-red-200 bg-red-50 px-6 py-2 text-xs text-red-700">{deleteError}</div>
      )}
      {moveError && (
        <div className="border-b border-red-200 bg-red-50 px-6 py-2 text-xs text-red-700">{moveError}</div>
      )}

      <div className="flex min-h-0 flex-1">
        <div className="relative min-w-0 flex-1">
          <Map
            ref={mapRef}
            properties={mapProperties}
            parcels={mapParcels}
            corridors={corridors.map((c) => ({ id: c.id, name: c.name, color: c.color, boundary: c.boundary }))}
            anchors={placedAnchors}
            selectedPropertyId={selectedId}
            activeCorridorId={null}
            drawMode="none"
            initialFit={initialFit}
            initialCenter={initialCenter}
            onSelectProperty={setSelectedId}
            onShapeDrawn={noop}
            onCorridorEdited={noop}
            onParcelEdited={(id, geometry) => void handleParcelEdited(id, geometry)}
            onPropertyMoved={(id, point) => void handlePropertyMoved(id, point)}
          />
          {busy && (
            <div className="absolute top-2 right-2 z-[600]">
              <div className="banner-info shadow-md"><Spinner /> {busy}</div>
            </div>
          )}
        </div>

        <aside className="scroll-thin flex w-[380px] shrink-0 flex-col overflow-y-auto border-l border-ink-200 bg-white">
          {unplacedAnchors.length > 0 && (
            <div className="border-b border-ink-200 p-3">
              <div className="banner-warn">
                <span>
                  <strong>{unplacedAnchors.length} mall{unplacedAnchors.length === 1 ? '' : 's'} need map placement.</strong>{' '}
                  Imported without reliable coordinates. Open each one and set its location before
                  seeding a corridor from it.
                </span>
              </div>
              <ul className="mt-2 space-y-1">
                {unplacedAnchors.map((a) => (
                  <li key={a.id} className="text-xs text-ink-700">
                    {a.name}
                    <span className="ml-1 text-ink-400">{a.addressLine1 ?? 'no address'}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <section className="border-b border-ink-200 p-3">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="section-label">Corridors</h2>
              <span className="text-[11px] text-ink-400">{corridors.length}</span>
            </div>

            {corridors.length === 0 ? (
              <EmptyState
                icon={<Route size={22} />}
                title="No corridors yet"
                body="Start with an adjustable radius around a mall anchor, then redraw the boundary by hand to match the real commercial strip."
                action={
                  <button type="button" className="btn-primary btn-sm" onClick={() => setAddingCorridor(true)}>
                    <Plus size={13} /> New corridor
                  </button>
                }
              />
            ) : (
              <ul className="space-y-1">
                {corridors.map((c) => (
                  <li key={c.id}>
                    <div className="flex items-center gap-1">
                      <Link
                        href={`/corridors/${c.id}`}
                        className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 hover:bg-accent-50"
                      >
                        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: c.color }} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm text-ink-900">{c.name}</span>
                          <span className="block text-[11px] text-ink-500">
                            {c.boundaryKind === 'radius'
                              ? `${((c.radiusMeters ?? 0) / 1609.34).toFixed(2)} mi radius`
                              : 'Drawn boundary'}
                            {' · '}{c.propertyCount} propert{c.propertyCount === 1 ? 'y' : 'ies'}
                          </span>
                        </span>
                      </Link>
                      <button
                        type="button"
                        className="btn-ghost btn-sm shrink-0"
                        onClick={() => c.boundary && mapRef.current?.fitTo(c.boundary)}
                        disabled={!c.boundary}
                        title="Fit the map to this corridor"
                      >
                        <MapPin size={13} />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="border-b border-ink-200 p-3">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="section-label">Mall anchors</h2>
              <span className="text-[11px] text-ink-400">{anchors.length}</span>
            </div>
            {anchors.length === 0 ? (
              <p className="text-xs text-ink-500">
                No mall anchors yet. Add one by address to anchor this market on the map.
              </p>
            ) : (
              <ul className="space-y-1.5">
                {anchors.map((a) => (
                  <li key={a.id} className="rounded-md border border-ink-200 px-2 py-1.5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate text-sm text-ink-900">{a.name}</div>
                        <div className="truncate text-[11px] text-ink-500">
                          {[a.addressLine1, a.city, a.state].filter(Boolean).join(', ') || 'No address recorded'}
                        </div>
                      </div>
                      {a.needsMapPlacement
                        ? <span className="chip shrink-0 border-amber-300 bg-amber-50 text-amber-800">Needs placement</span>
                        : (
                          <button
                            type="button"
                            className="btn-ghost btn-sm shrink-0"
                            onClick={() => a.latitude != null && a.longitude != null
                              && mapRef.current?.panTo({ lat: a.latitude, lng: a.longitude }, 15)}
                          >
                            <MapPin size={13} />
                          </button>
                        )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="p-3">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="section-label">Properties in this market</h2>
              <Link href={`/properties?marketId=${market.id}`} className="text-[11px] text-accent-600 hover:underline">
                View all
              </Link>
            </div>
            {properties.length === 0 ? (
              <EmptyState
                icon={<Building2 size={20} />}
                title="No properties yet"
                body="Open a corridor to add properties as map points and outline their parcels."
              />
            ) : (
              <ul className="space-y-1">
                {properties.slice(0, 20).map((p) => (
                  <li key={p.id}>
                    <Link
                      href={`/properties/${p.id}`}
                      className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 hover:bg-accent-50"
                    >
                      <span className="min-w-0 flex-1 truncate text-sm text-ink-900">{propertyTitle(p)}</span>
                      <StatusChip label={p.outreachStatusLabel} color={p.outreachStatusColor} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-3">
              <ApproximateBoundaryNote />
            </div>
          </section>
        </aside>

        {selectedId && (
          <PropertyPanel
            key={selectedId}
            propertyId={selectedId}
            statuses={statuses}
            onClose={() => setSelectedId(null)}
            onChanged={() => router.refresh()}
            onZoomToProperty={() => {
              const p = properties.find((x) => x.id === selectedId);
              if (p?.latitude != null && p.longitude != null) {
                mapRef.current?.panTo({ lat: p.latitude, lng: p.longitude }, 17);
              }
            }}
          />
        )}
      </div>

      {addingCorridor && (
        <AddCorridorDialog
          marketId={market.id}
          anchors={anchors.filter((a) => a.latitude != null && a.longitude != null)}
          onClose={() => setAddingCorridor(false)}
          onCreated={(id) => { setAddingCorridor(false); router.push(`/corridors/${id}`); }}
        />
      )}

      {addingAnchor && (
        <AddAnchorDialog
          marketId={market.id}
          onClose={() => setAddingAnchor(false)}
          onCreated={() => { setAddingAnchor(false); router.refresh(); }}
        />
      )}
    </>
  );
}
