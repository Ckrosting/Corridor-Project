'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Crosshair, Filter, Maximize2, PencilLine, Plus, Search, Squircle, X,
} from 'lucide-react';
import { Map, type DrawMode, type MapViewHandle } from '@/components/map';
import type { AreaGeometry, LatLng } from '@/lib/geo/types';
import {
  formatAcres, formatMoney, formatSqft, propertyTitle, relativeDays, LISTING_STATUS_LABELS,
} from '@/lib/format';
import {
  ApproximateBoundaryNote, EmptyState, SampleBadge, Spinner, StatusChip,
} from '@/components/ui/primitives';
import { PropertyPanel } from './property-panel';

export interface WorkspaceProperty {
  id: string;
  name: string | null;
  addressLine1: string | null;
  city: string | null;
  state: string | null;
  latitude: number | null;
  longitude: number | null;
  propertyType: string | null;
  listingStatus: string;
  askingPrice: string | null;
  buildingSqft: number | null;
  landAcreage: string | null;
  nextFollowUpDate: string | null;
  needsParcelOutline: boolean;
  isSample: boolean;
  outreachStatusId: string | null;
  outreachStatusLabel: string | null;
  outreachStatusColor: string | null;
  ownerEntityName: string | null;
  parcelCount: number;
  activityCount: number;
  opportunityId: string | null;
}

export interface WorkspaceCorridor {
  id: string;
  name: string;
  color: string;
  boundary: AreaGeometry | null;
  boundaryKind?: string;
  version?: number;
  propertyCount?: number;
}

interface Props {
  corridor: WorkspaceCorridor & { description?: string | null };
  market: { id: string; name: string };
  siblingCorridors: WorkspaceCorridor[];
  anchors: Array<{ id: string; name: string; latitude: number | null; longitude: number | null }>;
  statuses: Array<{ id: string; label: string; color: string }>;
  tags: Array<{ id: string; name: string; color: string }>;
  propertyTypes: string[];
  properties: WorkspaceProperty[];
  parcels: Array<{ id: string; propertyId: string; geometry: AreaGeometry | null; label: string | null }>;
}

const VIEW_STORAGE_KEY = 'hc.mapView';

/**
 * The corridor workspace: map as the primary surface, with a synchronised
 * property table and a side panel.
 *
 * Map position and filters are preserved across navigation (sessionStorage keyed
 * by corridor), so returning from a property detail view does not reset the
 * user's place.
 */
export function CorridorWorkspace({
  corridor, market, siblingCorridors, anchors, statuses, tags, propertyTypes, properties, parcels,
}: Props) {
  const router = useRouter();
  const mapRef = useRef<MapViewHandle>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [drawMode, setDrawMode] = useState<DrawMode>('none');
  const [pendingParcelFor, setPendingParcelFor] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<{ kind: 'ok' | 'error'; message: string } | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [initialView, setInitialView] = useState<{ center: LatLng; zoom: number } | null>(null);
  const [viewRestored, setViewRestored] = useState(false);

  // Filters
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const [listingFilter, setListingFilter] = useState<string[]>([]);
  const [typeFilter, setTypeFilter] = useState<string[]>([]);
  const [tagFilter, setTagFilter] = useState<string[]>([]);
  const [pipelineFilter, setPipelineFilter] = useState<'any' | 'in_pipeline' | 'not_in_pipeline'>('any');

  /* ------------------------------------------- Restore map position + filters */

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(`${VIEW_STORAGE_KEY}.${corridor.id}`);
      if (raw) {
        const saved = JSON.parse(raw) as { view?: { center: LatLng; zoom: number }; filters?: Record<string, unknown> };
        if (saved.view) setInitialView(saved.view);
        if (saved.filters) {
          setSearch((saved.filters.search as string) ?? '');
          setStatusFilter((saved.filters.statusFilter as string[]) ?? []);
          setListingFilter((saved.filters.listingFilter as string[]) ?? []);
          setTypeFilter((saved.filters.typeFilter as string[]) ?? []);
          setTagFilter((saved.filters.tagFilter as string[]) ?? []);
          setPipelineFilter((saved.filters.pipelineFilter as typeof pipelineFilter) ?? 'any');
        }
      }
    } catch {
      // sessionStorage can be unavailable (private mode); the map simply starts fresh.
    }
    setViewRestored(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [corridor.id]);

  const persist = useCallback((view?: { center: LatLng; zoom: number }) => {
    try {
      sessionStorage.setItem(
        `${VIEW_STORAGE_KEY}.${corridor.id}`,
        JSON.stringify({
          view: view ?? mapRef.current?.getView() ?? undefined,
          filters: { search, statusFilter, listingFilter, typeFilter, tagFilter, pipelineFilter },
        }),
      );
    } catch { /* non-fatal */ }
  }, [corridor.id, search, statusFilter, listingFilter, typeFilter, tagFilter, pipelineFilter]);

  useEffect(() => { if (viewRestored) persist(); }, [persist, viewRestored]);

  /* ------------------------------------------------------- Client-side filter */

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return properties.filter((p) => {
      if (statusFilter.length && !statusFilter.includes(p.outreachStatusId ?? '')) return false;
      if (listingFilter.length && !listingFilter.includes(p.listingStatus)) return false;
      if (typeFilter.length && !typeFilter.includes(p.propertyType ?? '')) return false;
      if (pipelineFilter === 'in_pipeline' && !p.opportunityId) return false;
      if (pipelineFilter === 'not_in_pipeline' && p.opportunityId) return false;
      if (q) {
        const hay = [p.name, p.addressLine1, p.city, p.ownerEntityName].filter(Boolean).join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [properties, search, statusFilter, listingFilter, typeFilter, pipelineFilter]);

  const visibleIds = useMemo(() => new Set(visible.map((p) => p.id)), [visible]);
  const visibleParcels = useMemo(
    () => parcels.filter((p) => visibleIds.has(p.propertyId)),
    [parcels, visibleIds],
  );

  const activeFilterCount =
    statusFilter.length + listingFilter.length + typeFilter.length + tagFilter.length +
    (pipelineFilter === 'any' ? 0 : 1) + (search.trim() ? 1 : 0);

  function clearFilters() {
    setSearch(''); setStatusFilter([]); setListingFilter([]);
    setTypeFilter([]); setTagFilter([]); setPipelineFilter('any');
  }

  function flash(kind: 'ok' | 'error', message: string) {
    setToast({ kind, message });
    setTimeout(() => setToast(null), 4000);
  }

  /* --------------------------------------------------------------- Mutations */

  const saveCorridorBoundary = useCallback(async (geometry: AreaGeometry) => {
    setBusy('Saving corridor boundary…');
    try {
      const res = await fetch(`/api/corridors/${corridor.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ boundary: geometry, boundaryKind: 'custom', version: corridor.version ?? 1 }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string; membership?: { added: number; removed: number } };
      if (!res.ok) throw new Error(body.error ?? 'Could not save the boundary.');

      const m = body.membership;
      flash('ok', m
        ? `Boundary saved. ${m.added} property(ies) added, ${m.removed} removed from this corridor.`
        : 'Boundary saved.');
      router.refresh();
    } catch (err) {
      flash('error', err instanceof Error ? err.message : 'Could not save the boundary.');
    } finally {
      setBusy(null);
      setDrawMode('none');
    }
  }, [corridor.id, corridor.version, router]);

  const saveParcel = useCallback(async (propertyId: string, geometry: AreaGeometry) => {
    setBusy('Saving parcel…');
    try {
      const res = await fetch('/api/parcels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ propertyId, geometry, label: 'Parcel' }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? 'Could not save the parcel.');
      flash('ok', 'Parcel boundary saved.');
      router.refresh();
    } catch (err) {
      flash('error', err instanceof Error ? err.message : 'Could not save the parcel.');
    } finally {
      setBusy(null);
      setDrawMode('none');
      setPendingParcelFor(null);
    }
  }, [router]);

  const handleShapeDrawn = useCallback((mode: 'corridor' | 'parcel', geometry: AreaGeometry) => {
    if (mode === 'corridor') return void saveCorridorBoundary(geometry);
    const target = pendingParcelFor ?? selectedId;
    if (!target) {
      flash('error', 'Select a property first, then draw its parcel.');
      setDrawMode('none');
      return;
    }
    void saveParcel(target, geometry);
  }, [pendingParcelFor, selectedId, saveCorridorBoundary, saveParcel]);

  const handleParcelEdited = useCallback(async (parcelId: string, geometry: AreaGeometry) => {
    setBusy('Saving parcel edit…');
    try {
      // Re-read the parcel's version immediately before writing, so a concurrent
      // edit is detected by the server rather than silently overwritten.
      const current = parcels.find((p) => p.id === parcelId);
      const res = await fetch(`/api/parcels/${parcelId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ geometry, version: (current as { version?: number } | undefined)?.version ?? 1 }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? 'Could not save the parcel edit.');
      flash('ok', 'Parcel boundary updated.');
      router.refresh();
    } catch (err) {
      flash('error', err instanceof Error ? err.message : 'Could not save the parcel edit.');
      router.refresh();
    } finally {
      setBusy(null);
    }
  }, [parcels, router]);

  /* ------------------------------------------------------------------ Render */

  const mapProperties = useMemo(() => visible.map((p) => ({
    id: p.id,
    latitude: p.latitude,
    longitude: p.longitude,
    title: propertyTitle(p),
    statusColor: p.outreachStatusColor,
    statusLabel: p.outreachStatusLabel,
    needsParcelOutline: p.needsParcelOutline,
    isSample: p.isSample,
  })), [visible]);

  const allCorridors = useMemo(
    () => siblingCorridors.map((c) => ({ id: c.id, name: c.name, color: c.color, boundary: c.boundary })),
    [siblingCorridors],
  );

  return (
    <>
      {/* ------------------------------------------------------------ Header */}
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-ink-200 bg-white px-4 py-2.5">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Link href={`/markets/${market.id}`} className="text-xs text-ink-500 hover:text-accent-700">
              {market.name}
            </Link>
            <span className="text-ink-300">/</span>
            <h1 className="truncate text-sm font-semibold text-ink-900">{corridor.name}</h1>
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: corridor.color }}
              aria-hidden="true"
            />
          </div>
          <p className="text-xs text-ink-500">
            {visible.length} of {properties.length} properties
            {activeFilterCount > 0 && ' (filtered)'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <div className="relative">
            <Search size={13} className="pointer-events-none absolute top-1/2 left-2 -translate-y-1/2 text-ink-400" />
            <input
              className="input w-48 py-1 pl-7 text-xs"
              placeholder="Filter properties…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <button
            type="button"
            className={activeFilterCount > 0 ? 'btn-primary btn-sm' : 'btn-secondary btn-sm'}
            onClick={() => setShowFilters((s) => !s)}
          >
            <Filter size={13} /> Filters{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}
          </button>

          <button
            type="button"
            className="btn-secondary btn-sm"
            onClick={() => corridor.boundary && mapRef.current?.fitTo(corridor.boundary)}
            disabled={!corridor.boundary}
            title="Fit the map to this corridor"
          >
            <Maximize2 size={13} /> Fit corridor
          </button>

          <button
            type="button"
            className={drawMode === 'corridor' ? 'btn-primary btn-sm' : 'btn-secondary btn-sm'}
            onClick={() => setDrawMode((m) => (m === 'corridor' ? 'none' : 'corridor'))}
            title="Draw a new boundary for this corridor"
          >
            <PencilLine size={13} /> {drawMode === 'corridor' ? 'Cancel draw' : 'Redraw corridor'}
          </button>

          <button
            type="button"
            className={drawMode === 'parcel' ? 'btn-primary btn-sm' : 'btn-secondary btn-sm'}
            onClick={() => {
              if (drawMode === 'parcel') { setDrawMode('none'); setPendingParcelFor(null); return; }
              if (!selectedId) { flash('error', 'Select a property first, then draw its parcel.'); return; }
              setPendingParcelFor(selectedId);
              setDrawMode('parcel');
            }}
            title="Draw a parcel boundary for the selected property"
          >
            <Squircle size={13} /> {drawMode === 'parcel' ? 'Cancel draw' : 'Draw parcel'}
          </button>

          <Link href={`/properties/new?corridorId=${corridor.id}&marketId=${market.id}`} className="btn-primary btn-sm">
            <Plus size={13} /> Property
          </Link>
        </div>
      </header>

      {/* ----------------------------------------------------------- Filters */}
      {showFilters && (
        <div className="shrink-0 border-b border-ink-200 bg-ink-50 px-4 py-3">
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <FilterGroup
              label="Outreach status"
              options={statuses.map((s) => ({ value: s.id, label: s.label, color: s.color }))}
              selected={statusFilter} onChange={setStatusFilter}
            />
            <FilterGroup
              label="Listing status"
              options={Object.entries(LISTING_STATUS_LABELS).map(([value, label]) => ({ value, label }))}
              selected={listingFilter} onChange={setListingFilter}
            />
            <FilterGroup
              label="Property type"
              options={propertyTypes.map((t) => ({ value: t, label: t }))}
              selected={typeFilter} onChange={setTypeFilter}
            />
            <div>
              <div className="section-label mb-1.5">Pipeline</div>
              <select
                className="input py-1 text-xs"
                value={pipelineFilter}
                onChange={(e) => setPipelineFilter(e.target.value as typeof pipelineFilter)}
              >
                <option value="any">All properties</option>
                <option value="in_pipeline">In the pipeline</option>
                <option value="not_in_pipeline">Not in the pipeline</option>
              </select>
              {tags.length > 0 && (
                <div className="mt-3">
                  <FilterGroup
                    label="Tags"
                    options={tags.map((t) => ({ value: t.id, label: t.name, color: t.color }))}
                    selected={tagFilter} onChange={setTagFilter}
                  />
                </div>
              )}
            </div>
          </div>
          {activeFilterCount > 0 && (
            <button type="button" className="btn-ghost btn-sm mt-2" onClick={clearFilters}>
              <X size={12} /> Clear all filters
            </button>
          )}
        </div>
      )}

      {/* -------------------------------------------------------- Main split */}
      <div className="flex min-h-0 flex-1">
        <div className="relative min-w-0 flex-1">
          {viewRestored && (
            <Map
              ref={mapRef}
              properties={mapProperties}
              parcels={visibleParcels}
              corridors={allCorridors}
              anchors={anchors}
              selectedPropertyId={selectedId}
              activeCorridorId={corridor.id}
              drawMode={drawMode}
              initialView={initialView}
              initialFit={corridor.boundary}
              onSelectProperty={setSelectedId}
              onViewChange={persist}
              onShapeDrawn={handleShapeDrawn}
              onCorridorEdited={(_id, geometry) => void saveCorridorBoundary(geometry)}
              onParcelEdited={(id, geometry) => void handleParcelEdited(id, geometry)}
            />
          )}

          {drawMode !== 'none' && (
            <div className="pointer-events-none absolute top-2 left-1/2 z-[600] -translate-x-1/2">
              <div className="banner-info pointer-events-auto shadow-md">
                <span>
                  {drawMode === 'corridor'
                    ? 'Click to place points around the corridor. Double-click to finish.'
                    : 'Click to outline the parcel. Double-click to finish.'}
                </span>
              </div>
            </div>
          )}

          {busy && (
            <div className="absolute top-2 right-2 z-[600]">
              <div className="banner-info shadow-md"><Spinner /> {busy}</div>
            </div>
          )}

          {toast && (
            <div className="absolute bottom-6 left-1/2 z-[700] -translate-x-1/2">
              <div className={toast.kind === 'ok' ? 'banner-ok shadow-md' : 'banner-error shadow-md'} role="status">
                {toast.message}
              </div>
            </div>
          )}
        </div>

        {/* --------------------------------------------------- Property table */}
        <div className="flex w-[420px] shrink-0 flex-col border-l border-ink-200 bg-white">
          <div className="scroll-thin flex-1 overflow-auto">
            {visible.length === 0 ? (
              <EmptyState
                title={properties.length === 0 ? 'No properties in this corridor yet' : 'No properties match these filters'}
                body={properties.length === 0
                  ? 'Add a property as a map point, then draw its parcel boundary. Properties whose coordinates fall inside this corridor are linked automatically.'
                  : 'Try clearing a filter to see more.'}
                action={properties.length === 0
                  ? <Link href={`/properties/new?corridorId=${corridor.id}&marketId=${market.id}`} className="btn-primary btn-sm"><Plus size={13} /> Add property</Link>
                  : <button type="button" className="btn-secondary btn-sm" onClick={clearFilters}>Clear filters</button>}
              />
            ) : (
              <table className="table-dense">
                <thead>
                  <tr>
                    <th>Property</th>
                    <th className="w-28">Status</th>
                    <th className="w-24 text-right">Asking</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((p) => {
                    const rel = relativeDays(p.nextFollowUpDate);
                    return (
                      <tr
                        key={p.id}
                        data-selected={p.id === selectedId}
                        onClick={() => setSelectedId(p.id)}
                        onDoubleClick={() => p.latitude != null && p.longitude != null
                          && mapRef.current?.panTo({ lat: p.latitude, lng: p.longitude }, 17)}
                      >
                        <td>
                          <div className="flex items-center gap-1.5">
                            <span className="truncate font-medium text-ink-900">{propertyTitle(p)}</span>
                            {p.isSample && <SampleBadge />}
                          </div>
                          <div className="truncate text-[11px] text-ink-500">
                            {p.addressLine1 ?? 'No address'}
                            {p.parcelCount > 0 && ` · ${p.parcelCount} parcel${p.parcelCount > 1 ? 's' : ''}`}
                            {p.needsParcelOutline && ' · needs outline'}
                          </div>
                          {rel && (
                            <div className={`text-[11px] ${rel.days < 0 ? 'font-medium text-red-700' : 'text-ink-500'}`}>
                              Follow up {rel.label}
                            </div>
                          )}
                        </td>
                        <td>
                          <StatusChip label={p.outreachStatusLabel} color={p.outreachStatusColor} />
                          {p.opportunityId && (
                            <div className="mt-0.5 text-[10px] font-medium text-accent-700">In pipeline</div>
                          )}
                        </td>
                        <td className="text-right text-xs tnum">
                          <span className={p.askingPrice ? 'text-ink-900' : 'unknown'}>
                            {formatMoney(p.askingPrice)}
                          </span>
                          <div className="text-[11px] text-ink-500">
                            {p.buildingSqft ? formatSqft(p.buildingSqft) : formatAcres(p.landAcreage)}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
          <div className="shrink-0 border-t border-ink-200 px-3 py-2">
            <ApproximateBoundaryNote />
          </div>
        </div>

        {/* ---------------------------------------------------------- Panel */}
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
    </>
  );
}

function FilterGroup({
  label, options, selected, onChange,
}: {
  label: string;
  options: Array<{ value: string; label: string; color?: string }>;
  selected: string[];
  onChange(next: string[]): void;
}) {
  return (
    <div>
      <div className="section-label mb-1.5">{label}</div>
      <div className="flex flex-wrap gap-1">
        {options.map((o) => {
          const active = selected.includes(o.value);
          return (
            <button
              key={o.value}
              type="button"
              onClick={() => onChange(active ? selected.filter((v) => v !== o.value) : [...selected, o.value])}
              className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors ${
                active
                  ? 'border-accent-600 bg-accent-600 text-white'
                  : 'border-ink-300 bg-white text-ink-600 hover:bg-ink-100'
              }`}
            >
              {o.color && !active && (
                <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: o.color }} />
              )}
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
