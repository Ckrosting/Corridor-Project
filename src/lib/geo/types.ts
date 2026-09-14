/**
 * Minimal GeoJSON types used across the app.
 *
 * Coordinates are always [longitude, latitude] in WGS84, per RFC 7946. Leaflet
 * uses [lat, lng], so every conversion between the two goes through the helpers
 * in ./convert.ts rather than being done inline. Getting this backwards is the
 * single most common bug in Leaflet apps.
 */

export type Position = [number, number];

/** A linear ring: first and last positions are identical. */
export type LinearRing = Position[];

export interface Polygon {
  type: 'Polygon';
  /** [outer ring, ...holes] */
  coordinates: LinearRing[];
}

export interface MultiPolygon {
  type: 'MultiPolygon';
  coordinates: LinearRing[][];
}

export type AreaGeometry = Polygon | MultiPolygon;

export interface BBox {
  minLng: number;
  minLat: number;
  maxLng: number;
  maxLat: number;
}

export interface LatLng {
  lat: number;
  lng: number;
}
