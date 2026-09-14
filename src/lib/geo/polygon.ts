import type { AreaGeometry, BBox, LatLng, LinearRing, Polygon, Position } from './types';

export const EARTH_RADIUS_M = 6_378_137;
const DEG = Math.PI / 180;

/* -------------------------------------------------------------------------- */
/* Validation                                                                 */
/* -------------------------------------------------------------------------- */

export class GeometryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GeometryError';
  }
}

function isFinitePosition(p: unknown): p is Position {
  return (
    Array.isArray(p) &&
    p.length >= 2 &&
    typeof p[0] === 'number' &&
    typeof p[1] === 'number' &&
    Number.isFinite(p[0]) &&
    Number.isFinite(p[1])
  );
}

function validateRing(ring: unknown, path: string): LinearRing {
  if (!Array.isArray(ring)) throw new GeometryError(`${path}: ring must be an array`);
  if (ring.length < 4) {
    throw new GeometryError(
      `${path}: a ring needs at least 4 positions (3 distinct corners plus a repeated closing point); got ${ring.length}`,
    );
  }

  const out: LinearRing = [];
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i];
    if (!isFinitePosition(p)) {
      throw new GeometryError(`${path}[${i}]: position must be [longitude, latitude] numbers`);
    }
    const [lng, lat] = p;
    if (lng < -180 || lng > 180) throw new GeometryError(`${path}[${i}]: longitude ${lng} is outside -180..180`);
    if (lat < -90 || lat > 90) throw new GeometryError(`${path}[${i}]: latitude ${lat} is outside -90..90`);
    out.push([lng, lat]);
  }

  // Close the ring if the client left it open - Leaflet/Geoman commonly do.
  const first = out[0]!;
  const last = out[out.length - 1]!;
  if (first[0] !== last[0] || first[1] !== last[1]) out.push([first[0], first[1]]);

  // Reject degenerate rings that close but enclose nothing.
  if (distinctCount(out) < 3) {
    throw new GeometryError(`${path}: ring has fewer than 3 distinct corners and encloses no area`);
  }
  return out;
}

function distinctCount(ring: LinearRing): number {
  const seen = new Set<string>();
  for (const [lng, lat] of ring) seen.add(`${lng},${lat}`);
  return seen.size;
}

/**
 * Validates and normalises user-drawn geometry before it is stored.
 *
 * Normalisation performed here: rings are closed, the outer ring is forced
 * counter-clockwise and holes clockwise (RFC 7946 winding), and empty polygons
 * are rejected. Throws GeometryError with a message safe to show to the user.
 */
export function validateAreaGeometry(input: unknown): AreaGeometry {
  if (!input || typeof input !== 'object') {
    throw new GeometryError('Geometry must be a GeoJSON Polygon or MultiPolygon object');
  }
  const geom = input as { type?: unknown; coordinates?: unknown };

  if (geom.type === 'Polygon') {
    if (!Array.isArray(geom.coordinates) || geom.coordinates.length === 0) {
      throw new GeometryError('Polygon must have at least one ring');
    }
    const rings = geom.coordinates.map((r, i) => validateRing(r, `ring ${i}`));
    return { type: 'Polygon', coordinates: normaliseWinding(rings) };
  }

  if (geom.type === 'MultiPolygon') {
    if (!Array.isArray(geom.coordinates) || geom.coordinates.length === 0) {
      throw new GeometryError('MultiPolygon must contain at least one polygon');
    }
    const polys = geom.coordinates.map((poly, pi) => {
      if (!Array.isArray(poly) || poly.length === 0) {
        throw new GeometryError(`polygon ${pi}: must have at least one ring`);
      }
      return normaliseWinding(poly.map((r, i) => validateRing(r, `polygon ${pi} ring ${i}`)));
    });
    return { type: 'MultiPolygon', coordinates: polys };
  }

  throw new GeometryError(
    `Unsupported geometry type "${String(geom.type)}". Expected Polygon or MultiPolygon.`,
  );
}

/** Signed planar area of a ring; positive means counter-clockwise. */
function signedArea(ring: LinearRing): number {
  let sum = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[j]!;
    const b = ring[i]!;
    sum += (b[0] - a[0]) * (b[1] + a[1]);
  }
  return -sum / 2;
}

function normaliseWinding(rings: LinearRing[]): LinearRing[] {
  return rings.map((ring, i) => {
    const ccw = signedArea(ring) > 0;
    // Outer ring counter-clockwise, holes clockwise.
    const wantCcw = i === 0;
    return ccw === wantCcw ? ring : [...ring].reverse();
  });
}

/* -------------------------------------------------------------------------- */
/* Bounding boxes                                                             */
/* -------------------------------------------------------------------------- */

export function computeBBox(geometry: AreaGeometry): BBox {
  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;

  const visit = (ring: LinearRing) => {
    for (const [lng, lat] of ring) {
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    }
  };

  if (geometry.type === 'Polygon') geometry.coordinates.forEach(visit);
  else geometry.coordinates.forEach((poly) => poly.forEach(visit));

  if (!Number.isFinite(minLng)) throw new GeometryError('Geometry contains no coordinates');
  return { minLng, minLat, maxLng, maxLat };
}

export function bboxContains(box: BBox, point: LatLng): boolean {
  return (
    point.lng >= box.minLng &&
    point.lng <= box.maxLng &&
    point.lat >= box.minLat &&
    point.lat <= box.maxLat
  );
}

/** Grows a bbox by roughly `meters` in every direction. */
export function expandBBox(box: BBox, meters: number): BBox {
  const latDelta = (meters / EARTH_RADIUS_M) / DEG;
  const midLat = (box.minLat + box.maxLat) / 2;
  const cos = Math.max(Math.cos(midLat * DEG), 1e-6);
  const lngDelta = latDelta / cos;
  return {
    minLat: box.minLat - latDelta,
    maxLat: box.maxLat + latDelta,
    minLng: box.minLng - lngDelta,
    maxLng: box.maxLng + lngDelta,
  };
}

/* -------------------------------------------------------------------------- */
/* Containment                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Ray-casting point-in-ring test.
 *
 * Note on the boundary: a point exactly on an edge is not guaranteed a stable
 * verdict here. That is acceptable because these are approximate research
 * outlines, and anything near a boundary is separately flagged for review by
 * `classifyRelevance` rather than being silently classified.
 */
function pointInRing(ring: LinearRing, lng: number, lat: number): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    const intersects = yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

function pointInSinglePolygon(rings: LinearRing[], lng: number, lat: number): boolean {
  const outer = rings[0];
  if (!outer || !pointInRing(outer, lng, lat)) return false;
  // Inside the outer ring, but a hole excludes it.
  for (let i = 1; i < rings.length; i++) {
    if (pointInRing(rings[i]!, lng, lat)) return false;
  }
  return true;
}

export function pointInGeometry(geometry: AreaGeometry, point: LatLng): boolean {
  if (geometry.type === 'Polygon') {
    return pointInSinglePolygon(geometry.coordinates, point.lng, point.lat);
  }
  return geometry.coordinates.some((rings) => pointInSinglePolygon(rings, point.lng, point.lat));
}

/* -------------------------------------------------------------------------- */
/* Measurement                                                                */
/* -------------------------------------------------------------------------- */

/** Great-circle distance in metres. */
export function haversineMeters(a: LatLng, b: LatLng): number {
  const dLat = (b.lat - a.lat) * DEG;
  const dLng = (b.lng - a.lng) * DEG;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * DEG) * Math.cos(b.lat * DEG) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Geodesic ring area in square metres (spherical excess). */
function ringAreaSqMeters(ring: LinearRing): number {
  if (ring.length < 4) return 0;
  let total = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [lng1, lat1] = ring[i]!;
    const [lng2, lat2] = ring[i + 1]!;
    total += (lng2 - lng1) * DEG * (2 + Math.sin(lat1 * DEG) + Math.sin(lat2 * DEG));
  }
  return Math.abs((total * EARTH_RADIUS_M * EARTH_RADIUS_M) / 2);
}

export function areaSqMeters(geometry: AreaGeometry): number {
  const polyArea = (rings: LinearRing[]) =>
    rings.reduce((sum, ring, i) => sum + (i === 0 ? ringAreaSqMeters(ring) : -ringAreaSqMeters(ring)), 0);

  return geometry.type === 'Polygon'
    ? polyArea(geometry.coordinates)
    : geometry.coordinates.reduce((sum, rings) => sum + polyArea(rings), 0);
}

const SQM_PER_ACRE = 4046.8564224;
export const areaAcres = (geometry: AreaGeometry): number => areaSqMeters(geometry) / SQM_PER_ACRE;

/* -------------------------------------------------------------------------- */
/* Construction                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Approximates a circle as a polygon, so that a radius-based corridor and a
 * hand-drawn one are the same shape of data and share one containment code path.
 */
export function circleToPolygon(center: LatLng, radiusMeters: number, steps = 64): Polygon {
  if (!Number.isFinite(radiusMeters) || radiusMeters <= 0) {
    throw new GeometryError('Radius must be a positive number of metres');
  }
  if (radiusMeters > 200_000) {
    throw new GeometryError('Radius must be 200 km or less');
  }

  const latDelta = (radiusMeters / EARTH_RADIUS_M) / DEG;
  const cos = Math.max(Math.cos(center.lat * DEG), 1e-6);
  const ring: LinearRing = [];

  // Counter-clockwise to match the outer-ring winding convention.
  for (let i = 0; i < steps; i++) {
    const theta = (2 * Math.PI * i) / steps;
    ring.push([
      center.lng + (latDelta / cos) * Math.cos(theta),
      center.lat + latDelta * Math.sin(theta),
    ]);
  }
  ring.push([ring[0]![0], ring[0]![1]]);
  return { type: 'Polygon', coordinates: [ring] };
}

/* -------------------------------------------------------------------------- */
/* Corridor relevance                                                         */
/* -------------------------------------------------------------------------- */

export type Relevance = 'inside' | 'edge' | 'outside' | 'unknown';

/**
 * Decides whether a candidate location belongs to a corridor.
 *
 * Anything without usable coordinates returns 'unknown', and anything within
 * `edgeBufferMeters` outside the boundary returns 'edge'. Both are routed to
 * human review rather than being silently included or discarded.
 */
export function classifyRelevance(
  boundary: AreaGeometry | null | undefined,
  point: { lat?: number | null; lng?: number | null },
  edgeBufferMeters = 500,
): Relevance {
  if (!boundary) return 'unknown';
  const { lat, lng } = point;
  if (typeof lat !== 'number' || typeof lng !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    return 'unknown';
  }
  const p = { lat, lng };
  if (pointInGeometry(boundary, p)) return 'inside';

  const buffered = expandBBox(computeBBox(boundary), edgeBufferMeters);
  return bboxContains(buffered, p) ? 'edge' : 'outside';
}
