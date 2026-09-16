'use client';

import { useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import L from 'leaflet';
import '@geoman-io/leaflet-geoman-free';
import { geometryToLeafletLatLngs, leafletLatLngsToGeometry } from '@/lib/geo/convert';
import type { AreaGeometry, LatLng } from '@/lib/geo/types';
import { streetViewUrl } from '@/lib/geo/street-view';
import { DEFAULT_CENTER, DEFAULT_ZOOM, getBasemaps, PARCEL_LINES_OVERLAY } from './basemaps';

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
  /** A county-sourced parcel is a real surveyed line, not an approximate hand-drawn outline. */
  geometrySource?: string | null;
  /** Shown on hover instead of the parcel's own label/source. */
  propertyTitle?: string | null;
}

export interface MapAnchor {
  id: string;
  name: string;
  latitude: number | null;
  longitude: number | null;
}

export type DrawMode = 'none' | 'parcel' | 'point';

export interface MapViewHandle {
  fitTo(geometry: AreaGeometry): void;
  fitToBounds(bounds: [[number, number], [number, number]]): void;
  panTo(point: LatLng, zoom?: number): void;
  /** Current viewport, used to persist map position across navigation. */
  getView(): { center: LatLng; zoom: number } | null;
  cancelEditing(): void;
}

export interface MapViewProps {
  properties: MapProperty[];
  parcels: MapParcel[];
  anchors: MapAnchor[];
  selectedPropertyId: string | null;
  drawMode: DrawMode;
  initialView?: { center: LatLng; zoom: number } | null;
  /**
   * Fitted once on mount when there is no remembered viewport, so opening a
   * market for the first time lands on its properties rather than on a default
   * continental view. A remembered viewport always wins - returning to a
   * workspace must not throw away where the user was.
   */
  initialFit?: AreaGeometry | null;
  /** Used instead of `initialFit` when there is no geometry to fit to - e.g. a market with no parcels yet, centred on its mall anchor. */
  initialCenter?: { point: LatLng; zoom: number } | null;
  ref?: React.Ref<MapViewHandle>;

  onSelectProperty(id: string | null): void;
  onViewChange?(view: { center: LatLng; zoom: number }): void;
  /** Fires when the user finishes drawing a new parcel outline. */
  onShapeDrawn(geometry: AreaGeometry): void;
  /** Fires when an existing parcel boundary is edited. */
  onParcelEdited(parcelId: string, geometry: AreaGeometry): void;
  /** Fires when the user clicks the map in 'point' mode (placing a property). */
  onPointPlaced?(point: LatLng): void;
  /** Fires when a property marker is dragged to a new spot. */
  onPropertyMoved?(propertyId: string, point: LatLng, staleParcelIds: string[]): void;
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
  properties, parcels, anchors, selectedPropertyId,
  drawMode, initialView, initialFit, initialCenter, ref,
  onSelectProperty, onViewChange, onShapeDrawn, onParcelEdited, onPointPlaced, onPropertyMoved,
}: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);

  const propertyLayerRef = useRef<L.LayerGroup | null>(null);
  const parcelLayerRef = useRef<L.LayerGroup | null>(null);
  const anchorLayerRef = useRef<L.LayerGroup | null>(null);
  const highlightLayerRef = useRef<L.LayerGroup | null>(null);

  const markersRef = useRef(new Map<string, L.Marker>());
  const parcelShapesRef = useRef(new Map<string, L.Polygon>());
  const highlightShapeRef = useRef<L.CircleMarker | null>(null);
  const selectedPropertyIdRef = useRef<string | null>(selectedPropertyId);
  selectedPropertyIdRef.current = selectedPropertyId;
  const parcelsRef = useRef(parcels);
  parcelsRef.current = parcels;
  // While a marker with its own (non-authoritative) parcel outline is being
  // dragged, this holds enough to move that outline's on-screen position live
  // (a cheap CSS transform, not a real geometry change - see the `drag`
  // handler below): the marker's position when the drag started, and each
  // affected parcel's shape. The shapes themselves are discarded at drop
  // rather than saved in their dragged position - see `dragend`.
  const parcelDragRef = useRef<{
    propertyId: string;
    markerStart: L.LatLng;
    parcels: Array<{ id: string; shape: L.Polygon }>;
  } | null>(null);

  const [basemaps] = useState(() => getBasemaps());
  const [ready, setReady] = useState(false);

  // Callbacks are held in a ref so the map is created exactly once; otherwise a
  // parent re-render would tear down and rebuild the whole map.
  const handlers = useRef({ onSelectProperty, onViewChange, onShapeDrawn, onParcelEdited, onPointPlaced, onPropertyMoved });
  handlers.current = { onSelectProperty, onViewChange, onShapeDrawn, onParcelEdited, onPointPlaced, onPropertyMoved };

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
    // Default to satellite when a provider is configured; otherwise street.
    const defaultId = available.some((b) => b.id === 'satellite') ? 'satellite' : 'street';
    const layers: Record<string, L.TileLayer> = {};
    available.forEach((b) => {
      const layer = L.tileLayer(b.url, {
        attribution: b.attribution, maxZoom: b.maxZoom, maxNativeZoom: b.maxNativeZoom,
      });
      layers[b.label] = layer;
      if (b.id === defaultId) layer.addTo(map);
    });
    if (Object.keys(layers).length > 1) L.control.layers(layers, {}, { position: 'topright' }).addTo(map);

    // Third-party tax parcel lines, always on top of the chosen basemap - not
    // part of the basemap switcher above, since it's an overlay, not a base.
    L.tileLayer(PARCEL_LINES_OVERLAY.url, {
      attribution: PARCEL_LINES_OVERLAY.attribution,
      minZoom: PARCEL_LINES_OVERLAY.minZoom,
      maxZoom: PARCEL_LINES_OVERLAY.maxZoom,
      maxNativeZoom: PARCEL_LINES_OVERLAY.maxNativeZoom,
      pane: 'overlayPane',
    }).addTo(map);

    parcelLayerRef.current = L.layerGroup().addTo(map);
    highlightLayerRef.current = L.layerGroup().addTo(map);
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
      try {
        const geometry = leafletLatLngsToGeometry(layer.getLatLngs() as never);
        // The drawn layer is discarded; the parent re-renders it from saved state
        // once the server has accepted it. This guarantees the map always shows
        // persisted geometry rather than an optimistic local shape.
        map.removeLayer(layer);
        handlers.current.onShapeDrawn(geometry);
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

    // Right-click anywhere on the map opens Google Street View at that point.
    // Leaflet already suppresses the browser's own context menu on the map
    // container, so this doesn't fight a native menu for the same click.
    map.on('contextmenu', (e: L.LeafletMouseEvent) => {
      window.open(streetViewUrl(e.latlng.lat, e.latlng.lng), '_blank', 'noopener,noreferrer');
    });

    if (!initialView && initialFit) {
      try {
        const layer = L.polygon(geometryToLeafletLatLngs(initialFit) as never);
        map.fitBounds(layer.getBounds(), { padding: [40, 40], maxZoom: 16 });
      } catch (err) {
        console.error('[map] could not fit to initial geometry', err);
      }
    } else if (!initialView && !initialFit && initialCenter) {
      map.setView([initialCenter.point.lat, initialCenter.point.lng], initialCenter.zoom);
    }

    setReady(true);

    return () => {
      map.remove();
      mapRef.current = null;
      markersRef.current.clear();
      parcelShapesRef.current.clear();
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

    if (drawMode === 'parcel') {
      map.pm.enableDraw('Polygon', {
        snappable: true,
        snapDistance: 15,
        finishOn: 'dblclick',
        templineStyle: { color: '#2563eb', weight: 2 },
        hintlineStyle: { color: '#2563eb', weight: 2, dashArray: '4,4' },
        pathOptions: { color: '#2563eb', fillOpacity: 0.12, weight: 2 },
      });
    }

    map.getContainer().style.cursor = drawMode === 'point' ? 'crosshair' : '';
  }, [drawMode, ready]);

  /* --------------------------------------------------------------- Parcels */

  useEffect(() => {
    const group = parcelLayerRef.current;
    if (!group || !ready) return;

    const seen = new Set<string>();

    for (const parcel of parcels) {
      if (!parcel.geometry) continue;
      seen.add(parcel.id);

      const isSelected = parcel.propertyId === selectedPropertyId;
      // Amber reads clearly against satellite imagery (green/gray/brown) in a
      // way the previous muted slate didn't - the old unselected style was
      // barely visible until you were already looking for it.
      const style: L.PathOptions = {
        color: isSelected ? '#1d4ed8' : '#f59e0b',
        weight: isSelected ? 3 : 2,
        fillColor: isSelected ? '#3b82f6' : '#fbbf24',
        fillOpacity: isSelected ? 0.3 : 0.2,
      };

      const existing = parcelShapesRef.current.get(parcel.id);
      const latlngs = geometryToLeafletLatLngs(parcel.geometry);

      if (existing) {
        existing.setLatLngs(latlngs as never);
        existing.setStyle(style);
      } else {
        const poly = L.polygon(latlngs as never, style);
        poly.bindTooltip(parcel.propertyTitle ?? parcel.label ?? 'Parcel', { sticky: true, direction: 'top' });
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

  /* ---------------------------------------------- Selection highlight ring */

  // A property with no real surveyed parcel has nothing to draw when
  // selected, which reads as broken - clicking every other pin outlines its
  // parcel, but this one just... doesn't react. This ring is an honest stand-
  // in: it never claims to be a boundary (no tooltip, no edit handles, a
  // fixed pixel size rather than a geographic shape), it just answers "yes,
  // this is the one you clicked" the same way a real parcel would.
  useEffect(() => {
    const group = highlightLayerRef.current;
    if (!group || !ready) return;

    const clear = () => {
      if (highlightShapeRef.current) {
        group.removeLayer(highlightShapeRef.current);
        highlightShapeRef.current = null;
      }
    };

    if (!selectedPropertyId) { clear(); return; }

    const hasRealParcel = parcels.some((p) => p.propertyId === selectedPropertyId && p.geometry);
    if (hasRealParcel) { clear(); return; }

    const property = properties.find((p) => p.id === selectedPropertyId);
    if (!property || property.latitude == null || property.longitude == null) { clear(); return; }

    // Reuse one persistent circle rather than clear-and-recreate: that way a
    // drag handler on the marker can move this same instance in real time
    // (see the property marker effect below), instead of the ring only
    // catching up once the drag is saved and the page re-renders.
    if (highlightShapeRef.current) {
      highlightShapeRef.current.setLatLng([property.latitude, property.longitude]);
    } else {
      highlightShapeRef.current = L.circleMarker([property.latitude, property.longitude], {
        radius: 22,
        color: '#1d4ed8',
        weight: 2,
        fillColor: '#3b82f6',
        fillOpacity: 0.2,
        interactive: false,
        className: 'hc-point-highlight',
      }).addTo(group);
    }
  }, [parcels, properties, selectedPropertyId, ready]);

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
        const marker = L.marker([property.latitude, property.longitude], { icon, riseOnHover: true, draggable: true, autoPan: true });
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
        marker.on('dragstart', () => {
          marker.closeTooltip();
          // Any outline this property already has - traced, hand-drawn, or
          // imported - describes a specific piece of ground the user is
          // choosing to move together with the pin. A county GIS match is
          // different: that shape is someone else's survey record, not ours
          // to shift because a pin got nudged, so it is deliberately excluded
          // and stays exactly where the county says it is.
          const movable = parcelsRef.current.filter((p) => (
            p.propertyId === property.id && p.geometry && p.geometrySource !== 'county_gis'
          ));
          const draggedParcels: Array<{ id: string; shape: L.Polygon }> = [];
          for (const p of movable) {
            const shape = parcelShapesRef.current.get(p.id);
            if (shape) draggedParcels.push({ id: p.id, shape });
          }
          parcelDragRef.current = { propertyId: property.id, markerStart: marker.getLatLng(), parcels: draggedParcels };
        });
        marker.on('drag', () => {
          // If this pin's highlight ring is showing (no real parcel to
          // outline), move it along with the pin live - otherwise it would
          // only catch up once the drag is saved and the page re-renders.
          if (property.id === selectedPropertyIdRef.current) {
            highlightShapeRef.current?.setLatLng(marker.getLatLng());
          }

          const drag = parcelDragRef.current;
          const map = mapRef.current;
          if (drag && drag.propertyId === property.id && map) {
            // A cheap CSS transform on the shape's own <path> element, not a
            // real geometry change - calling Leaflet's setLatLngs on every
            // mousemove during a drag fights with Geoman's own per-layer
            // bookkeeping (it patches every Polygon, not just ones in edit
            // mode) and throws mid-drag. The real geometry is only touched
            // once, at drop.
            const startPt = map.latLngToLayerPoint(drag.markerStart);
            const curPt = map.latLngToLayerPoint(marker.getLatLng());
            const dx = curPt.x - startPt.x;
            const dy = curPt.y - startPt.y;
            for (const p of drag.parcels) {
              const el = p.shape.getElement() as SVGGraphicsElement | null;
              if (el) el.style.transform = `translate(${dx}px, ${dy}px)`;
            }
          }
        });
        marker.on('dragend', () => {
          const { lat, lng } = marker.getLatLng();

          // The parcel this property had before the drag describes a specific
          // piece of ground - it was either right where the pin used to sit,
          // or (per the user's own report) already wrong. Either way, sliding
          // that same shape over by the drag distance cannot be correct at
          // the new spot, so it is discarded rather than translated; the
          // server re-traces or re-matches a fresh parcel at the new point,
          // the same auto-match a brand-new property gets.
          const drag = parcelDragRef.current;
          const staleParcelIds: string[] = [];
          if (drag && drag.propertyId === property.id) {
            for (const p of drag.parcels) {
              const el = p.shape.getElement() as SVGGraphicsElement | null;
              if (el) el.style.transform = '';
              staleParcelIds.push(p.id);
            }
          }
          parcelDragRef.current = null;

          handlers.current.onPropertyMoved?.(property.id, { lat, lng }, staleParcelIds);
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
    cancelEditing() {
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
