import { describe, expect, it } from 'vitest';
import {
  GeometryError, areaAcres, bboxContains, circleToPolygon, classifyRelevance,
  computeBBox, expandBBox, haversineMeters, pointInGeometry, validateAreaGeometry,
} from '@/lib/geo/polygon';
import { geometryToLeafletLatLngs, leafletLatLngsToGeometry, type LeafletLatLngTuple } from '@/lib/geo/convert';
import type { AreaGeometry } from '@/lib/geo/types';

/** A ~0.01deg square near Augusta, GA - roughly 1.1km on a side. */
const square: AreaGeometry = {
  type: 'Polygon',
  coordinates: [[
    [-82.0, 33.0], [-81.99, 33.0], [-81.99, 33.01], [-82.0, 33.01], [-82.0, 33.0],
  ]],
};

describe('validateAreaGeometry', () => {
  it('accepts a well-formed polygon', () => {
    const g = validateAreaGeometry(square);
    expect(g.type).toBe('Polygon');
    expect(g.coordinates[0]).toHaveLength(5);
  });

  it('closes an open ring rather than rejecting it (Leaflet sends open rings)', () => {
    const open = { type: 'Polygon', coordinates: [[[-82, 33], [-81.99, 33], [-81.99, 33.01], [-82, 33.01]]] };
    const g = validateAreaGeometry(open);
    expect(g.coordinates[0]).toHaveLength(5);
    expect(g.coordinates[0]![0]).toEqual(g.coordinates[0]![4]);
  });

  it('forces the outer ring counter-clockwise', () => {
    const cw: AreaGeometry = {
      type: 'Polygon',
      coordinates: [[...square.coordinates[0]!].reverse()],
    };
    const g = validateAreaGeometry(cw);
    // Normalised back to the same winding as the canonical square.
    expect(g.coordinates[0]![1]).toEqual(square.coordinates[0]![1]);
  });

  it('rejects a ring with too few points', () => {
    expect(() => validateAreaGeometry({ type: 'Polygon', coordinates: [[[-82, 33], [-81, 33]]] }))
      .toThrow(GeometryError);
  });

  it('rejects a degenerate ring that encloses no area', () => {
    expect(() => validateAreaGeometry({
      type: 'Polygon',
      coordinates: [[[-82, 33], [-82, 33], [-82, 33], [-82, 33]]],
    })).toThrow(/distinct corners/);
  });

  it('rejects out-of-range coordinates', () => {
    expect(() => validateAreaGeometry({
      type: 'Polygon',
      coordinates: [[[-200, 33], [-81.99, 33], [-81.99, 33.01], [-200, 33]]],
    })).toThrow(/longitude/);
  });

  it('rejects non-area geometry types', () => {
    expect(() => validateAreaGeometry({ type: 'LineString', coordinates: [[0, 0], [1, 1]] }))
      .toThrow(/Polygon or MultiPolygon/);
  });

  it('accepts a MultiPolygon', () => {
    const g = validateAreaGeometry({
      type: 'MultiPolygon',
      coordinates: [square.coordinates, [[[-83, 34], [-82.99, 34], [-82.99, 34.01], [-83, 34]]]],
    });
    expect(g.type).toBe('MultiPolygon');
    expect((g as { coordinates: unknown[] }).coordinates).toHaveLength(2);
  });
});

describe('point containment', () => {
  it('finds a point inside', () => {
    expect(pointInGeometry(square, { lat: 33.005, lng: -81.995 })).toBe(true);
  });

  it('rejects a point outside', () => {
    expect(pointInGeometry(square, { lat: 33.5, lng: -81.995 })).toBe(false);
  });

  it('excludes points that fall in a hole', () => {
    const withHole: AreaGeometry = validateAreaGeometry({
      type: 'Polygon',
      coordinates: [
        square.coordinates[0]!,
        [[-81.997, 33.003], [-81.993, 33.003], [-81.993, 33.007], [-81.997, 33.007], [-81.997, 33.003]],
      ],
    });
    expect(pointInGeometry(withHole, { lat: 33.005, lng: -81.995 })).toBe(false); // in the hole
    expect(pointInGeometry(withHole, { lat: 33.001, lng: -81.995 })).toBe(true);  // outside the hole
  });

  it('handles MultiPolygon membership', () => {
    const multi = validateAreaGeometry({
      type: 'MultiPolygon',
      coordinates: [square.coordinates, [[[-83, 34], [-82.99, 34], [-82.99, 34.01], [-83, 34.01], [-83, 34]]]],
    });
    expect(pointInGeometry(multi, { lat: 34.005, lng: -82.995 })).toBe(true);
    expect(pointInGeometry(multi, { lat: 33.005, lng: -81.995 })).toBe(true);
    expect(pointInGeometry(multi, { lat: 40, lng: -75 })).toBe(false);
  });
});

describe('bbox', () => {
  it('computes bounds', () => {
    expect(computeBBox(square)).toEqual({ minLng: -82.0, minLat: 33.0, maxLng: -81.99, maxLat: 33.01 });
  });

  it('expands by an approximate metre distance', () => {
    const grown = expandBBox(computeBBox(square), 1000);
    expect(grown.minLat).toBeLessThan(33.0);
    expect(grown.maxLat).toBeGreaterThan(33.01);
    expect(bboxContains(grown, { lat: 33.005, lng: -81.995 })).toBe(true);
  });
});

describe('measurement', () => {
  it('computes a plausible acreage', () => {
    // ~1.11km x ~0.93km at this latitude => ~1.04 sq km => ~255 acres.
    const acres = areaAcres(square);
    expect(acres).toBeGreaterThan(200);
    expect(acres).toBeLessThan(300);
  });

  it('subtracts holes from the area', () => {
    const withHole = validateAreaGeometry({
      type: 'Polygon',
      coordinates: [
        square.coordinates[0]!,
        [[-81.997, 33.003], [-81.993, 33.003], [-81.993, 33.007], [-81.997, 33.007], [-81.997, 33.003]],
      ],
    });
    expect(areaAcres(withHole)).toBeLessThan(areaAcres(square));
  });

  it('measures distance against a known value', () => {
    // Augusta GA -> Atlanta GA is roughly 230 km.
    const d = haversineMeters({ lat: 33.47, lng: -81.97 }, { lat: 33.749, lng: -84.388 });
    expect(d).toBeGreaterThan(220_000);
    expect(d).toBeLessThan(240_000);
  });
});

describe('circleToPolygon', () => {
  it('produces a closed ring whose radius is about right', () => {
    const center = { lat: 33.47, lng: -81.97 };
    const circle = circleToPolygon(center, 1609); // ~1 mile
    const ring = circle.coordinates[0]!;
    expect(ring[0]).toEqual(ring[ring.length - 1]);
    expect(pointInGeometry(circle, center)).toBe(true);

    for (const [lng, lat] of ring) {
      const d = haversineMeters(center, { lat, lng });
      expect(d).toBeGreaterThan(1500);
      expect(d).toBeLessThan(1700);
    }
  });

  it('rejects a non-positive or absurd radius', () => {
    expect(() => circleToPolygon({ lat: 33, lng: -82 }, 0)).toThrow(GeometryError);
    expect(() => circleToPolygon({ lat: 33, lng: -82 }, 500_000)).toThrow(/200 km/);
  });
});

describe('classifyRelevance', () => {
  it('marks points inside the boundary', () => {
    expect(classifyRelevance(square, { lat: 33.005, lng: -81.995 })).toBe('inside');
  });

  it('marks near-boundary points as edge cases for review, not as outside', () => {
    expect(classifyRelevance(square, { lat: 33.0125, lng: -81.995 }, 500)).toBe('edge');
  });

  it('marks far points outside', () => {
    expect(classifyRelevance(square, { lat: 35, lng: -81.995 })).toBe('outside');
  });

  it('returns unknown when coordinates are missing, never a silent verdict', () => {
    expect(classifyRelevance(square, { lat: null, lng: null })).toBe('unknown');
    expect(classifyRelevance(square, { lat: 33.005, lng: undefined })).toBe('unknown');
    expect(classifyRelevance(null, { lat: 33.005, lng: -81.995 })).toBe('unknown');
  });
});

describe('leaflet conversion', () => {
  it('round-trips a polygon through Leaflet ordering', () => {
    const leaflet = geometryToLeafletLatLngs(square) as LeafletLatLngTuple[][];
    // Leaflet order is [lat, lng] and drops the closing point. Exactly two
    // levels deep (rings, then points) - not three - so that getLatLngs()
    // round-trips through leafletLatLngsToGeometry without corruption; see
    // the long comment on geometryToLeafletLatLngs for why a third level here
    // silently breaks every parcel/corridor edit.
    expect(leaflet[0]![0]).toEqual([33.0, -82.0]);
    expect(leaflet[0]).toHaveLength(4);

    const back = validateAreaGeometry(
      leafletLatLngsToGeometry(leaflet[0]!.map(([lat, lng]) => ({ lat, lng }))),
    );
    expect(back.coordinates[0]).toEqual(square.coordinates[0]);
  });

  it('accepts Leaflet nested ring arrays (polygon with holes)', () => {
    const g = leafletLatLngsToGeometry([
      [{ lat: 33, lng: -82 }, { lat: 33, lng: -81.99 }, { lat: 33.01, lng: -81.99 }, { lat: 33.01, lng: -82 }],
    ]);
    expect(g.coordinates).toHaveLength(1);
    expect(g.coordinates[0]).toHaveLength(5);
  });
});
