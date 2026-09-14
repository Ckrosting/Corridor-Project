'use client';

import { useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import L from 'leaflet';
import '@geoman-io/leaflet-geoman-free';
import { geometryToLeafletLatLngs, leafletLatLngsToGeometry } from '@/lib/geo/convert';
import type { AreaGeometry, LatLng } from '@/lib/geo/types';
import { DEFAULT_CENTER, DEFAULT_ZOOM, getBasemaps } from './basemaps';

export interface MapProperty {
  id: string;
  latitude: number | null;
  longitude: number | null;
  title: string;
  statusColor: string | null;
  statusLabel: string | null;
  needsParcelOutline: boolean;
  isSample: boolean;
}

export interface MapParcel {
  id: string;
  propertyId: string;
  geometry: AreaGeometry | null;
  label: string | null;
}

export interface MapCorridor {
  id: string;
  name: string;
  color: string;
  boundary: AreaGeometry | null;
}

export interface MapAnchor {
  id: string;
  name: string;
  latitude: number | null;
  longitude: number | null;
}

export type DrawMode = 'none' | 'corridor' | 'parcel' | 'point';

export interface MapViewHandle {
  fitTo(geometry: AreaGeometry): void;
  fitToBounds(bounds: [[number, number], [number, number]]): void;
  panTo(point: LatLng, zoom?: number): void;
  /** Current viewport, used to persist map position across navigation. */
  getView(): { center: LatLng; zoom: number } | null;
  /** Puts an existing corridor boundary into edit mode. */
  editCorridor(corridorId: string): void;
  cancelEditing(): void;
}

export interface MapViewProps {
  properties: MapProperty[];
  parcels: MapParcel[];
  corridors: MapCorridor[];
  anchors: MapAnchor[];
  selectedPropertyId: string | null;
  /** Corridor whose boundary is highlighted and editable. */
  activeCorridorId: string | null;
  drawMode: DrawMode;
  initialView?: { center: LatLng; zoom: number } | null;
  /**
   * Fitted once on mount when there is no remembered viewport, so opening a
   * corridor for the first time lands on the corridor rather than on a default
   * continental view. A remembered viewport always wins - returning to a
   * workspace must not throw away where the user was.
   */
  initialFit?: AreaGeometry | null;
  ref?: React.Ref<MapViewHandle>;

  onSelectProperty(id: string | null): void;
  onViewChange?(view: { center: LatLng; zoom: number }): void;
  /** Fires when the user finishes drawing a new shape. */
  onShapeDrawn(mode: 'corridor' | 'parcel', geometry: AreaGeometry): void;
  /** Fires when an existing corridor boundary is edited. */
  onCorridorEdited(corridorId: string, geometry: AreaGeometry): void;
  /** Fires when an existing parcel boundary is edited. */
  onParcelEdited(parcelId: string, geometry: AreaGeometry): void;
  /** Fires when the user clicks the map in 'point' mode (placing a property). */
  onPointPlaced?(point: LatLng): void;
}

/**
 * The Leaflet map surface.
 *
 * Deliberately uses the Leaflet API directly rather than react-leaflet: the map
 * holds hundreds of markers plus editable geometry, and rebuilding React
 * elements on every state change makes drawing interactions janky. Layers are
 * reconciled by id against Leaflet layer groups instead.
 *
 * This component must only ever render on the client — Leaflet touches `window`
 * at import time. It is loaded through a dynamic import with ssr:false.
 */
export function MapView({
  properties, parcels, corridors, anchors, selectedPropertyId, activeCorridorId,
  drawMode, initialView, initialFit, ref,
  onSelectProperty, onViewChange, onShapeDrawn, onCorridorEdited, onParcelEdited, onPointPlaced,
}: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);

  const propertyLayerRef = useRef<L.LayerGroup | null>(null);
  const parcelLayerRef = useRef<L.LayerGroup | null>(null);
  const corridorLayerRef = useRef<L.LayerGroup | null>(null);
  const anchorLayerRef = useRef<L.LayerGroup | null>(null);

  const markersRef = useRef(new Map<string, L.Marker>());
  const parcelShapesRef = useRef(new Map<string, L.Polygon>());
  const corridorShapesRef = useRef(new Map<string, L.Polygon>());

  const [basemaps] = useState(() => getBasemaps());
  const [ready, setReady] = useState(false);

  // Callbacks are held in a ref so the map is created exactly once; otherwise a
  // parent re-render would tear down and rebuild the whole map.
  const handlers = useRef({ onSelectProperty, onViewChange, onShapeDrawn, onCorridorEdited, onParcelEdited, onPointPlaced });
  handlers.current = { onSelectProperty, onViewChange, onShapeDrawn, onCorridorEdited, onParcelEdited, onPointPlaced };

  /* ------------------------------------------------------------- Map setup */

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, {
      center: initialView ? [initialView.center.lat, initialView.center.lng] : DEFAULT_CENTER,
      zoom: initialView?.zoom ?? DEFAULT_ZOOM,
      zoomControl: true,
      preferCanvas: false,
      attributionControl: true,
    });
    mapRef.current = map;

    // Base layers. Providers that are not configured are omitted from the
    // switcher; the reason is surfaced separately in the UI.
    const available = basemaps.filter((b) => !b.unavailableReason && b.url);
    const layers: Record<string, L.TileLayer> = {};
    available.forEach((b, i) => {
      const layer = L.tileLayer(b.url, { attribution: b.attribution, maxZoom: b.maxZoom });
      layers[b.label] = layer;
      if (i === 0) layer.addTo(map);
    });
    if (Object.keys(layers).length > 1) L.control.layers(layers, {}, { position: 'topright' }).addTo(map);

    corridorLayerRef.current = L.layerGroup().addTo(map);
    parcelLayerRef.current = L.layerGroup().addTo(map);
    anchorLayerRef.current = L.layerGroup().addTo(map);
    propertyLayerRef.current = L.layerGroup().addTo(map);

    // Geoman provides the drawing/editing tools. Its own toolbar stays hidden —
    // drawing is driven by the application's buttons so the map chrome stays clean.
    map.pm.setLang('en');
    map.pm.addControls({ position: 'topleft', drawCircle: false, drawMarker: false,
      drawCircleMarker: false, drawPolyline: false, drawText: false, drawRectangle: false,
      drawPolygon: false, editMode: false, dragMode: false, cutPolygon: false,
      removalMode: false, rotateMode: false });
    map.pm.removeControls();

    map.on('pm:create', (e) => {
      const layer = e.layer as L.Polygon;
      const mode = (layer.options as { pmDrawMode?: 'corridor' | 'parcel' }).pmDrawMode
        ?? (map as unknown as { __hcDrawMode?: 'corridor' | 'parcel' }).__hcDrawMode;

      try {
        const geometry = leafletLatLngsToGeometry(layer.getLatLngs() as never);
        // The drawn layer is discarded; the parent re-renders it from saved state
        // once the server has accepted it. This guarantees the map always shows
        // persisted geometry rather than an optimistic local shape.
        map.removeLayer(layer);
        if (mode) handlers.current.onShapeDrawn(mode, geometry);
      } catch (err) {
        map.removeLayer(layer);
        console.error('[map] could not convert drawn shape', err);
      }
    });

    const emitView = () => {
      const c = map.getCenter();
      handlers.current.onViewChange?.({ center: { lat: c.lat, lng: c.lng }, zoom: map.getZoom() });
    };
    map.on('moveend', emitView);
    map.on('zoomend', emitView);

    map.on('click', (e: L.LeafletMouseEvent) => {
      const dm = (map as unknown as { __hcDrawMode?: DrawMode }).__hcDrawMode;
      if (dm === 'point') {
        handlers.current.onPointPlaced?.({ lat: e.latlng.lat, lng: e.latlng.lng });
      }
    });

    if (!initialView && initialFit) {
      try {
        const layer = L.polygon(geometryToLeafletLatLngs(initialFit) as never);
        map.fitBounds(layer.getBounds(), { padding: [40, 40], maxZoom: 16 });
      } catch (err) {
        console.error('[map] could not fit to initial geometry', err);
      }
    }

    setReady(true);

    return () => {
      map.remove();
      mapRef.current = null;
      markersRef.current.clear();
      parcelShapesRef.current.clear();
      corridorShapesRef.current.clear();
    };
    // Intentionally one-time setup.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* --------------------------------------------------------- Drawing modes */

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;

    (map as unknown as { __hcDrawMode?: DrawMode }).__hcDrawMode = drawMode;
    map.pm.disableDraw();

    if (drawMode === 'corridor' || drawMode === 'parcel') {
      map.pm.enableDraw('Polygon', {
        snappable: true,
        snapDistance: 15,
        finishOn: 'dblclick',
        templineStyle: { color: drawMode === 'corridor' ? '#7c3aed' : '#2563eb', weight: 2 },
        hintlineStyle: { color: drawMode === 'corridor' ? '#7c3aed' : '#2563eb', weight: 2, dashArray: '4,4' },
        pathOptions: {
          color: drawMode === 'corridor' ? '#7c3aed' : '#2563eb',
          fillOpacity: 0.12,
          weight: 2,
        },
      });
    }

    map.getContainer().style.cursor = drawMode === 'point' ? 'crosshair' : '';
  }, [drawMode, ready]);

  /* ------------------------------------------------------------- Corridors */

  useEffect(() => {
    const group = corridorLayerRef.current;
    if (!group || !ready) return;

    const seen = new Set<string>();

    for (const corridor of corridors) {
      if (!corridor.boundary) continue;
      seen.add(corridor.id);

      const isActive = corridor.id === activeCorridorId;
      const style: L.PathOptions = {
        color: corridor.color,
        weight: isActive ? 3 : 2,
        opacity: isActive ? 1 : 0.65,
        fillColor: corridor.color,
        fillOpacity: isActive ? 0.08 : 0.04,
        dashArray: isActive ? undefined : '6,4',
        interactive: false,
      };

      const existing = corridorShapesRef.current.get(corridor.id);
      const latlngs = geometryToLeafletLatLngs(corridor.boundary);

      if (existing) {
        existing.setLatLngs(latlngs as never);
        existing.setStyle(style);
      } else {
        const poly = L.polygon(latlngs as never, style);
        poly.bindTooltip(corridor.name, { sticky: true, direction: 'top' });
        poly.on('pm:update', (e) => {
          try {
            const geometry = leafletLatLngsToGeometry((e.layer as L.Polygon).getLatLngs() as never);
            handlers.current.onCorridorEdited(corridor.id, geometry);
          } catch (err) {
            console.error('[map] invalid corridor edit', err);
          }
        });
        poly.addTo(group);
        corridorShapesRef.current.set(corridor.id, poly);
      }
    }

    for (const [id, layer] of corridorShapesRef.current) {
      if (!seen.has(id)) {
        group.removeLayer(layer);
        corridorShapesRef.current.delete(id);
      }
    }
  }, [corridors, activeCorridorId, ready]);

  /* --------------------------------------------------------------- Parcels */

  useEffect(() => {
    const group = parcelLayerRef.current;
    if (!group || !ready) return;

    const seen = new Set<string>();

    for (const parcel of parcels) {
      if (!parcel.geometry) continue;
      seen.add(parcel.id);

      const isSelected = parcel.propertyId === selectedPropertyId;
      const style: L.PathOptions = {
        color: isSelected ? '#1d4ed8' : '#475569',
        weight: isSelected ? 2.5 : 1.5,
        fillColor: isSelected ? '#3b82f6' : '#64748b',
        fillOpacity: isSelected ? 0.25 : 0.12,
      };

      const existing = parcelShapesRef.current.get(parcel.id);
      const latlngs = geometryToLeafletLatLngs(parcel.geometry);

      if (existing) {
        existing.setLatLngs(latlngs as never);
        existing.setStyle(style);
      } else {
        const poly = L.polygon(latlngs as never, style);
        poly.bindTooltip(
          `${parcel.label ?? 'Parcel'} — approximate research outline`,
          { sticky: true, direction: 'top' },
        );
        poly.on('click', (e) => {
          L.DomEvent.stopPropagation(e);
          handlers.current.onSelectProperty(parcel.propertyId);
        });
        poly.on('pm:update', (e) => {
          try {
            const geometry = leafletLatLngsToGeometry((e.layer as L.Polygon).getLatLngs() as never);
            handlers.current.onParcelEdited(parcel.id, geometry);
          } catch (err) {
            console.error('[map] invalid parcel edit', err);
          }
        });
        poly.addTo(group);
        parcelShapesRef.current.set(parcel.id, poly);
      }
    }

    for (const [id, layer] of parcelShapesRef.current) {
      if (!seen.has(id)) {
        group.removeLayer(layer);
        parcelShapesRef.current.delete(id);
      }
    }
  }, [parcels, selectedPropertyId, ready]);

  /* --------------------------------------------------------------- Anchors */

  useEffect(() => {
    const group = anchorLayerRef.current;
    if (!group || !ready) return;
    group.clearLayers();

    for (const anchor of anchors) {
      if (anchor.latitude == null || anchor.longitude == null) continue;
      L.marker([anchor.latitude, anchor.longitude], {
        icon: L.divIcon({
          className: '',
          html: '<div class="hc-anchor-marker"><svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M3 21V9l9-6 9 6v12h-6v-7H9v7z"/></svg></div>',
          iconSize: [20, 20],
          iconAnchor: [10, 10],
        }),
        zIndexOffset: -100,
      })
        .bindTooltip(anchor.name, { direction: 'top', offset: [0, -8] })
        .addTo(group);
    }
  }, [anchors, ready]);

  /* ------------------------------------------------------------ Properties */

  useEffect(() => {
    const group = propertyLayerRef.current;
    if (!group || !ready) return;

    const seen = new Set<string>();

    for (const property of properties) {
      if (property.latitude == null || property.longitude == null) continue;
      seen.add(property.id);

      const isSelected = property.id === selectedPropertyId;
      const color = property.statusColor ?? '#64748b';
      const classes = [
        'hc-marker',
        isSelected ? 'hc-marker-selected' : '',
        property.needsParcelOutline ? 'hc-marker-needs-outline' : '',
      ].filter(Boolean).join(' ');

      const icon = L.divIcon({
        className: '',
        html: `<div class="${classes}" style="background:${color}"></div>`,
        iconSize: [14, 14],
        iconAnchor: [7, 7],
      });

      const existing = markersRef.current.get(property.id);
      if (existing) {
        existing.setLatLng([property.latitude, property.longitude]);
        existing.setIcon(icon);
        existing.setZIndexOffset(isSelected ? 1000 : 0);
      } else {
        const marker = L.marker([property.latitude, property.longitude], { icon, riseOnHover: true });
        marker.bindTooltip(
          `${property.title}${property.statusLabel ? ` — ${property.statusLabel}` : ''}${property.isSample ? ' (sample)' : ''}`,
          { direction: 'top', offset: [0, -8] },
        );
        marker.on('click', (e) => {
          L.DomEvent.stopPropagation(e);
          // Selecting never moves the map: the user's current view is preserved
          // so they do not lose their place when opening the side panel.
          handlers.current.onSelectProperty(property.id);
        });
        marker.addTo(group);
        markersRef.current.set(property.id, marker);
      }
    }

    for (const [id, marker] of markersRef.current) {
      if (!seen.has(id)) {
        group.removeLayer(marker);
        markersRef.current.delete(id);
      }
    }
  }, [properties, selectedPropertyId, ready]);

  /* ------------------------------------------------------- Imperative API */

  const fitTo = useCallback((geometry: AreaGeometry) => {
    const map = mapRef.current;
    if (!map) return;
    const layer = L.polygon(geometryToLeafletLatLngs(geometry) as never);
    map.fitBounds(layer.getBounds(), { padding: [40, 40], maxZoom: 18 });
  }, []);

  useImperativeHandle(ref, () => ({
    fitTo,
    fitToBounds(bounds) {
      mapRef.current?.fitBounds(bounds, { padding: [40, 40], maxZoom: 18 });
    },
    panTo(point, zoom) {
      mapRef.current?.setView([point.lat, point.lng], zoom ?? mapRef.current.getZoom(), { animate: true });
    },
    getView() {
      const map = mapRef.current;
      if (!map) return null;
      const c = map.getCenter();
      return { center: { lat: c.lat, lng: c.lng }, zoom: map.getZoom() };
    },
    editCorridor(corridorId) {
      corridorShapesRef.current.forEach((layer, id) => {
        if (id === corridorId) {
          layer.options.interactive = true;
          layer.pm.enable({ allowSelfIntersection: false, snappable: true });
        } else {
          layer.pm.disable();
        }
      });
    },
    cancelEditing() {
      corridorShapesRef.current.forEach((l) => l.pm.disable());
      parcelShapesRef.current.forEach((l) => l.pm.disable());
      mapRef.current?.pm.disableDraw();
    },
  }), [fitTo]);

  const satellite = basemaps.find((b) => b.id === 'satellite');

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="h-full w-full" />

      {satellite?.unavailableReason && (
        <div className="pointer-events-none absolute right-2 bottom-6 z-[600] max-w-xs">
          <div className="banner-warn pointer-events-auto shadow-sm">
            <span>
              <strong>Street map only.</strong> {satellite.unavailableReason}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
