'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Filter, MapPin, Pencil, Plus, RotateCcw, Search, Squircle, Target, Trash2, X,
} from 'lucide-react';
import { Map, type DrawMode, type MapViewHandle } from '@/components/map';
import type { AreaGeometry, LatLng } from '@/lib/geo/types';
import {
  formatAcres, formatMoney, formatSqft, propertyTitle, relativeDays, LISTING_STATUS_LABELS,
} from '@/lib/format';
import {
  ApproximateBoundaryNote, EmptyState, SampleBadge, Spinner, StatusChip,
} from '@/components/ui/primitives';
import { AddAnchorDialog } from './add-anchor-dialog';
import { PropertyPanel } from './property-panel';
import { DiscoveryAction } from './discovery-action';

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
  version: number;
}

interface Anchor {
  id: string;
  name: string;
  addressLine1: string | null;
  city: string | null;
  state: string | null;
  postalCode?: string | null;
  county?: string | null;
  notes?: string | null;
  latitude: number | null;
  longitude: number | null;
  needsMapPlacement: boolean;
  version?: number;
}

interface Props {
  market: { id: string; name: string; state: string | null; notes: string | null; version: number };
  anchors: Anchor[];
  statuses: Array<{ id: string; label: string; color: string }>;
  tags: Array<{ id: string; name: string; color: string }>;
  propertyTypes: string[];
  properties: WorkspaceProperty[];
  parcels: Array<{ id: string; propertyId: string; geometry: AreaGeometry | null; label: string | null; geometrySource?: string | null; version?: number }>;
  /** Presence flag only — the API key itself never reaches the browser. */
  aiConfigured: boolean;
  isAdmin: boolean;
}

const VIEW_STORAGE_KEY = 'hc.mapView';

/**
 * The market workspace: map as the primary surface, with a synchronised property
 * table and a side panel. Parcel outlines are drawn and edited here.
 *
 * Map position and filters are preserved across navigation (sessionStorage keyed
 * by market), so returning from a property detail view does not reset the user's
 * place.
 */
export function MarketWorkspace({
  market, anchors, statuses, tags, propertyTypes, properties, parcels, aiConfigured, isAdmin,
}: Props) {
  const router = useRouter();
  const mapRef = useRef<MapViewHandle>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [drawMode, setDrawMode] = useState<DrawMode>('none');
  const [pendingParcelFor, setPendingParcelFor] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [addingAnchor, setAddingAnchor] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [editingMarket, setEditingMarket] = useState(false);
  const [marketForm, setMarketForm] = useState({ name: market.name, state: market.state ?? '', notes: market.notes ?? '' });
  const [editingAnchorId, setEditingAnchorId] = useState<string | null>(null);
  const [anchorForm, setAnchorForm] = useState({ name: '', addressLine1: '', city: '', state: '', postalCode: '', county: '', notes: '' });
  const [undoAnchor, setUndoAnchor] = useState<{ id: string; version: number; name: string } | null>(null);
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
      const raw = sessionStorage.getItem(`${VIEW_STORAGE_KEY}.${market.id}`);
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
  }, [market.id]);

  const persist = useCallback((view?: { center: LatLng; zoom: number }) => {
    try {
      sessionStorage.setItem(
        `${VIEW_STORAGE_KEY}.${market.id}`,
        JSON.stringify({
          view: view ?? mapRef.current?.getView() ?? undefined,
          filters: { search, statusFilter, listingFilter, typeFilter, tagFilter, pipelineFilter },
        }),
      );
    } catch { /* non-fatal */ }
  }, [market.id, search, statusFilter, listingFilter, typeFilter, tagFilter, pipelineFilter]);

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
  const visibleParcels = useMemo(() => parcels
    .filter((p) => visibleIds.has(p.propertyId))
    .map((p) => {
      const property = properties.find((x) => x.id === p.propertyId);
      return { ...p, propertyTitle: property ? propertyTitle(property) : null };
    }), [parcels, visibleIds, properties]);

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

  const deleteMarket = useCallback(async () => {
    setBusy('Deleting market…');
    try {
      const res = await fetch(`/api/markets/${market.id}`, { method: 'DELETE' });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? 'Could not delete the market.');
      router.push('/markets');
      router.refresh();
    } catch (err) {
      flash('error', err instanceof Error ? err.message : 'Could not delete the market.');
      setBusy(null);
      setConfirmingDelete(false);
    }
  }, [market.id, router]);

  const saveMarketEdit = useCallback(async () => {
    setBusy('Saving market…');
    try {
      const res = await fetch(`/api/markets/${market.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          version: market.version,
          name: marketForm.name.trim(),
          state: marketForm.state.trim() || null,
          notes: marketForm.notes.trim() || null,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? 'Could not save the market.');
      setEditingMarket(false);
      router.refresh();
    } catch (err) {
      flash('error', err instanceof Error ? err.message : 'Could not save the market.');
    } finally {
      setBusy(null);
    }
  }, [market.id, market.version, marketForm, router]);

  function startEditingAnchor(a: Anchor) {
    setAnchorForm({
      name: a.name, addressLine1: a.addressLine1 ?? '', city: a.city ?? '', state: a.state ?? '',
      postalCode: a.postalCode ?? '', county: a.county ?? '', notes: a.notes ?? '',
    });
    setEditingAnchorId(a.id);
  }

  const saveAnchorEdit = useCallback(async (anchor: Anchor) => {
    setBusy('Saving mall…');
    try {
      const res = await fetch(`/api/mall-anchors/${anchor.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          version: anchor.version ?? 1,
          name: anchorForm.name.trim(),
          addressLine1: anchorForm.addressLine1.trim() || null,
          city: anchorForm.city.trim() || null,
          state: anchorForm.state.trim() || null,
          postalCode: anchorForm.postalCode.trim() || null,
          county: anchorForm.county.trim() || null,
          notes: anchorForm.notes.trim() || null,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? 'Could not save this mall.');
      setEditingAnchorId(null);
      router.refresh();
    } catch (err) {
      flash('error', err instanceof Error ? err.message : 'Could not save this mall.');
    } finally {
      setBusy(null);
    }
  }, [anchorForm, router]);

  const archiveAnchor = useCallback(async (anchor: Anchor) => {
    setBusy('Archiving mall…');
    try {
      const res = await fetch(`/api/mall-anchors/${anchor.id}`, { method: 'DELETE' });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? 'Could not archive this mall.');
      // The anchor row disappears once the page refetches, so the version needed to
      // undo it has to be captured now, before it becomes unreachable through the UI.
      setUndoAnchor({ id: anchor.id, version: (anchor.version ?? 1) + 1, name: anchor.name });
      setTimeout(() => setUndoAnchor((u) => (u?.id === anchor.id ? null : u)), 10_000);
      router.refresh();
    } catch (err) {
      flash('error', err instanceof Error ? err.message : 'Could not archive this mall.');
    } finally {
      setBusy(null);
    }
  }, [router]);

  const restoreAnchor = useCallback(async () => {
    if (!undoAnchor) return;
    setBusy('Restoring mall…');
    try {
      const res = await fetch(`/api/mall-anchors/${undoAnchor.id}/restore?version=${undoAnchor.version}`, { method: 'POST' });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? 'Could not restore this mall.');
      setUndoAnchor(null);
      router.refresh();
    } catch (err) {
      flash('error', err instanceof Error ? err.message : 'Could not restore this mall.');
    } finally {
      setBusy(null);
    }
  }, [undoAnchor, router]);

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

  const handleShapeDrawn = useCallback((geometry: AreaGeometry) => {
    const target = pendingParcelFor ?? selectedId;
    if (!target) {
      flash('error', 'Select a property first, then draw its parcel.');
      setDrawMode('none');
      return;
    }
    void saveParcel(target, geometry);
  }, [pendingParcelFor, selectedId, saveParcel]);

  const handleParcelEdited = useCallback(async (parcelId: string, geometry: AreaGeometry) => {
    setBusy('Saving parcel edit…');
    try {
      // Re-read the parcel's version immediately before writing, so a concurrent
      // edit is detected by the server rather than silently overwritten.
      const current = parcels.find((p) => p.id === parcelId);
      const res = await fetch(`/api/parcels/${parcelId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ geometry, version: current?.version ?? 1 }),
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

  const handlePropertyMoved = useCallback(async (propertyId: string, point: LatLng, staleParcelIds: string[]) => {
    setBusy('Saving location…');
    try {
      // The parcel(s) this property had before the drag describe ground the
      // pin is no longer on - dropped in favour of whatever the server
      // matches or traces fresh at the new point, the same auto-match a
      // brand-new property gets. Must happen before the coordinate PATCH
      // below: the server only re-matches when the property currently has
      // no parcel.
      for (const parcelId of staleParcelIds) {
        await fetch(`/api/parcels/${parcelId}`, { method: 'DELETE' });
      }

      // Re-read the property's version immediately before writing, so a
      // concurrent edit is detected by the server rather than silently
      // overwritten - the same pattern as a parcel edit.
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
      flash('ok', 'Location updated.');
      router.refresh();
    } catch (err) {
      flash('error', err instanceof Error ? err.message : 'Could not save the new location.');
      router.refresh();
    } finally {
      setBusy(null);
    }
  }, [properties, router]);

  /* ------------------------------------------------------------------ Render */

  const mapProperties = useMemo(() => visible.map((p) => ({
    id: p.id,
    latitude: p.latitude,
    longitude: p.longitude,
    title: propertyTitle(p),
    statusColor: p.outreachStatusColor,
    statusLabel: p.outreachStatusLabel,
    listingStatus: p.listingStatus,
    needsParcelOutline: p.needsParcelOutline,
    isSample: p.isSample,
  })), [visible]);

  const placedAnchors = useMemo(
    () => anchors.filter((a) => !a.needsMapPlacement && a.latitude != null && a.longitude != null),
    [anchors],
  );
  const unplacedAnchors = useMemo(
    () => anchors.filter((a) => a.needsMapPlacement || a.latitude == null),
    [anchors],
  );

  // Nothing in a market is a boundary any more, so the first fit is a point:
  // a placed mall anchor if there is one, otherwise the first located property.
  const initialCenter = useMemo(() => {
    const anchor = placedAnchors[0];
    if (anchor?.latitude != null && anchor.longitude != null) {
      return { point: { lat: anchor.latitude, lng: anchor.longitude }, zoom: 14 };
    }
    const property = properties.find((p) => p.latitude != null && p.longitude != null);
    if (property?.latitude != null && property.longitude != null) {
      return { point: { lat: property.latitude, lng: property.longitude }, zoom: 15 };
    }
    return null;
  }, [placedAnchors, properties]);

  return (
    <>
      {/* ------------------------------------------------------------ Header */}
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-ink-200 bg-white px-4 py-2.5">
        <div className="min-w-0">
          {editingMarket ? (
            <div className="flex flex-wrap items-center gap-1.5">
              <input
                className="input w-40 py-1 text-xs" placeholder="Market name"
                value={marketForm.name} onChange={(e) => setMarketForm((f) => ({ ...f, name: e.target.value }))}
              />
              <input
                className="input w-14 py-1 text-xs" placeholder="State" maxLength={2}
                value={marketForm.state} onChange={(e) => setMarketForm((f) => ({ ...f, state: e.target.value }))}
              />
              <input
                className="input w-48 py-1 text-xs" placeholder="Notes"
                value={marketForm.notes} onChange={(e) => setMarketForm((f) => ({ ...f, notes: e.target.value }))}
              />
              <button type="button" className="btn-primary btn-sm" onClick={() => void saveMarketEdit()} disabled={busy !== null}>
                Save
              </button>
              <button
                type="button" className="btn-ghost btn-sm"
                onClick={() => { setEditingMarket(false); setMarketForm({ name: market.name, state: market.state ?? '', notes: market.notes ?? '' }); }}
                disabled={busy !== null}
              >
                Cancel
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <Link href="/markets" className="text-xs text-ink-500 hover:text-accent-700">Markets</Link>
              <span className="text-ink-300">/</span>
              <h1 className="truncate text-sm font-semibold text-ink-900">{market.name}</h1>
              {market.state && <span className="text-xs text-ink-500">{market.state}</span>}
              <button
                type="button" className="btn-ghost btn-sm" title="Edit this market"
                onClick={() => { setMarketForm({ name: market.name, state: market.state ?? '', notes: market.notes ?? '' }); setEditingMarket(true); }}
              >
                <Pencil size={12} />
              </button>
            </div>
          )}
          <p className="text-xs text-ink-500">
            {anchors.length} mall{anchors.length === 1 ? '' : 's'} · {visible.length} of {properties.length} properties
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

          <button type="button" className="btn-secondary btn-sm" onClick={() => setAddingAnchor(true)}>
            <Target size={13} /> Add mall anchor
          </button>

          <DiscoveryAction marketId={market.id} marketName={market.name} aiConfigured={aiConfigured} />

          <Link href={`/properties/new?marketId=${market.id}`} className="btn-primary btn-sm">
            <Plus size={13} /> Property
          </Link>

          {isAdmin && (
            confirmingDelete ? (
              <div className="flex items-center gap-1.5 rounded-md border border-red-200 bg-red-50 px-2 py-1">
                <span className="text-xs text-red-700">Delete this market?</span>
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
                title="Delete this market (properties and their history are kept and can be recovered)"
              >
                <Trash2 size={13} /> Delete market
              </button>
            )
          )}
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
              anchors={placedAnchors}
              selectedPropertyId={selectedId}
              drawMode={drawMode}
              initialView={initialView}
              initialCenter={initialCenter}
              onSelectProperty={setSelectedId}
              onViewChange={persist}
              onShapeDrawn={handleShapeDrawn}
              onParcelEdited={(id, geometry) => void handleParcelEdited(id, geometry)}
              onPropertyMoved={(id, point, staleParcelIds) => void handlePropertyMoved(id, point, staleParcelIds)}
            />
          )}

          {drawMode === 'parcel' && (
            <div className="pointer-events-none absolute top-2 left-1/2 z-[600] -translate-x-1/2">
              <div className="banner-info pointer-events-auto shadow-md">
                <span>Click to outline the parcel. Double-click to finish.</span>
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

        {/* ------------------------------------- Anchors + property table */}
        <div className="flex w-[420px] shrink-0 flex-col border-l border-ink-200 bg-white">
          <div className="scroll-thin flex-1 overflow-auto">
            {unplacedAnchors.length > 0 && (
              <div className="border-b border-ink-200 p-3">
                <div className="banner-warn">
                  <span>
                    <strong>{unplacedAnchors.length} mall{unplacedAnchors.length === 1 ? '' : 's'} need map placement.</strong>{' '}
                    Imported without reliable coordinates. Open each one and set its location.
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

            {undoAnchor && (
              <div className="border-b border-ink-200 p-3">
                <div className="banner-info flex items-center justify-between gap-2">
                  <span>Archived &ldquo;{undoAnchor.name}&rdquo;.</span>
                  <button type="button" className="btn-secondary btn-sm shrink-0" onClick={() => void restoreAnchor()}>
                    <RotateCcw size={12} /> Undo
                  </button>
                </div>
              </div>
            )}

            {placedAnchors.length > 0 && (
              <section className="border-b border-ink-200 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <h2 className="section-label">Mall anchors</h2>
                  <span className="text-[11px] text-ink-400">{anchors.length}</span>
                </div>
                <ul className="space-y-1">
                  {placedAnchors.map((a) => (
                    editingAnchorId === a.id ? (
                      <li key={a.id} className="space-y-1.5 rounded-md border border-accent-300 bg-accent-50/40 p-2">
                        <input
                          className="input py-1 text-xs" placeholder="Name"
                          value={anchorForm.name} onChange={(e) => setAnchorForm((f) => ({ ...f, name: e.target.value }))}
                        />
                        <input
                          className="input py-1 text-xs" placeholder="Street address"
                          value={anchorForm.addressLine1} onChange={(e) => setAnchorForm((f) => ({ ...f, addressLine1: e.target.value }))}
                        />
                        <div className="grid grid-cols-3 gap-1.5">
                          <input
                            className="input py-1 text-xs" placeholder="City"
                            value={anchorForm.city} onChange={(e) => setAnchorForm((f) => ({ ...f, city: e.target.value }))}
                          />
                          <input
                            className="input py-1 text-xs" placeholder="State" maxLength={2}
                            value={anchorForm.state} onChange={(e) => setAnchorForm((f) => ({ ...f, state: e.target.value }))}
                          />
                          <input
                            className="input py-1 text-xs" placeholder="ZIP"
                            value={anchorForm.postalCode} onChange={(e) => setAnchorForm((f) => ({ ...f, postalCode: e.target.value }))}
                          />
                        </div>
                        <div className="flex justify-end gap-1.5">
                          <button type="button" className="btn-ghost btn-sm" onClick={() => setEditingAnchorId(null)} disabled={busy !== null}>
                            Cancel
                          </button>
                          <button type="button" className="btn-primary btn-sm" onClick={() => void saveAnchorEdit(a)} disabled={busy !== null}>
                            Save
                          </button>
                        </div>
                      </li>
                    ) : (
                      <li key={a.id} className="flex items-center justify-between gap-2 rounded-md border border-ink-200 px-2 py-1.5">
                        <div className="min-w-0">
                          <div className="truncate text-sm text-ink-900">{a.name}</div>
                          <div className="truncate text-[11px] text-ink-500">
                            {[a.addressLine1, a.city, a.state].filter(Boolean).join(', ') || 'No address recorded'}
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-0.5">
                          <button
                            type="button"
                            className="btn-ghost btn-sm"
                            onClick={() => a.latitude != null && a.longitude != null
                              && mapRef.current?.panTo({ lat: a.latitude, lng: a.longitude }, 15)}
                            title="Centre the map on this mall"
                          >
                            <MapPin size={13} />
                          </button>
                          <button
                            type="button" className="btn-ghost btn-sm" title="Edit this mall"
                            onClick={() => startEditingAnchor(a)}
                          >
                            <Pencil size={12} />
                          </button>
                          {isAdmin && (
                            <button
                              type="button" className="btn-ghost btn-sm text-red-600 hover:bg-red-50" title="Archive this mall"
                              onClick={() => void archiveAnchor(a)}
                            >
                              <Trash2 size={12} />
                            </button>
                          )}
                        </div>
                      </li>
                    )
                  ))}
                </ul>
              </section>
            )}

            {visible.length === 0 ? (
              <EmptyState
                title={properties.length === 0 ? 'No properties in this market yet' : 'No properties match these filters'}
                body={properties.length === 0
                  ? 'Add a property as a map point, then select it and use Draw parcel to outline its boundary.'
                  : 'Try clearing a filter to see more.'}
                action={properties.length === 0
                  ? <Link href={`/properties/new?marketId=${market.id}`} className="btn-primary btn-sm"><Plus size={13} /> Add property</Link>
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
            tags={tags}
            propertyTypes={propertyTypes}
            isAdmin={isAdmin}
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
