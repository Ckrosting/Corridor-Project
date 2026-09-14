import type { AreaGeometry, LatLng, LinearRing } from './types';

/**
 * Conversions between GeoJSON order ([lng, lat]) and Leaflet order ([lat, lng]).
 *
 * Every crossing between the two conventions goes through this file. Inline
 * conversions are the most reliable way to ship a map bug, so there are none.
 */

export type LeafletLatLngTuple = [number, number]; // [lat, lng]

/** GeoJSON geometry -> Leaflet positions, ready for L.polygon(). */
export function geometryToLeafletLatLngs(geometry: AreaGeometry): LeafletLatLngTuple[][][] {
  const ringToLeaflet = (ring: LinearRing): LeafletLatLngTuple[] =>
    // Leaflet does not want the repeated closing point; it closes polygons itself.
    ring.slice(0, -1).map(([lng, lat]) => [lat, lng] as LeafletLatLngTuple);

  return geometry.type === 'Polygon'
    ? [geometry.coordinates.map(ringToLeaflet)]
    : geometry.coordinates.map((poly) => poly.map(ringToLeaflet));
}

/**
 * Leaflet layer positions -> GeoJSON geometry.
 *
 * Leaflet's getLatLngs() returns LatLng[] for a simple polygon and LatLng[][]
 * when the polygon has holes, so both shapes are handled.
 */
export function leafletLatLngsToGeometry(
  latlngs: Array<LatLng | LatLng[]> | LatLng[][],
): AreaGeometry {
  const isFlat = latlngs.length > 0 && !Array.isArray(latlngs[0]);
  const rings = (isFlat ? [latlngs] : latlngs) as LatLng[][];

  const coordinates: LinearRing[] = rings.map((ring) => {
    const positions = ring.map(({ lat, lng }) => [lng, lat] as [number, number]);
    const first = positions[0];
    const last = positions[positions.length - 1];
    if (first && last && (first[0] !== last[0] || first[1] !== last[1])) {
      positions.push([first[0], first[1]]);
    }
    return positions;
  });

  return { type: 'Polygon', coordinates };
}

/** Leaflet bounds tuple for fitBounds(): [[southLat, westLng], [northLat, eastLng]]. */
export function bboxToLeafletBounds(box: {
  minLat: number; minLng: number; maxLat: number; maxLng: number;
}): [LeafletLatLngTuple, LeafletLatLngTuple] {
  return [
    [box.minLat, box.minLng],
    [box.maxLat, box.maxLng],
  ];
}
