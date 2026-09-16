import '@/lib/server-guard';
import sharp from 'sharp';
import type { AreaGeometry, LatLng, LinearRing } from './types';
import { validateAreaGeometry, areaAcres } from './polygon';
import { PARCEL_LINES_OVERLAY } from '@/components/map/basemaps';

/** Deepest zoom this tile set is actually cached at (verified against the live service - higher zooms 404). */
const PARCEL_TILE_ZOOM = 17;

/**
 * Auto-traces a parcel outline from Regrid's free tile imagery, for markets
 * with no queryable county GIS feed and no PIN to look one up with anyway.
 *
 * This is a deliberately last-resort source: Regrid's tile layer is rendered
 * pixels, not vector data, so there is nothing to query - the only way to get
 * a shape out of it is to look at the picture. That makes the result an
 * inference, not a fact, and it fails in a specific, recognisable way: the
 * point sits too close to a gap in the drawn lines (often because the
 * geocoded point landed on the street rather than inside the lot), the flood
 * fill leaks along the street network, and the result balloons to the size of
 * several city blocks. Any such shape is rejected outright rather than saved -
 * a wrong multi-block outline is worse than no outline at all. What's left is
 * saved with geometrySource 'traced_tile' and a notes string that says
 * plainly where it came from, so it is never confused with a surveyed line.
 */

const TILE_SIZE = 256;
const MOSAIC_GRID = 9; // ~1.9km x 1.9km at zoom 17 - room for a mall-anchor-sized parcel, not just a small outparcel
const MIN_AREA_SQM = 10; // degenerate sliver, not a real parcel
/**
 * A real parcel, however large, is a reasonably solid shape - even an L or a
 * long highway-frontage strip fills a meaningful share of its own bounding
 * box. A flood-fill leak follows the street network instead: a thin line
 * that happens to enclose a huge box, so its filled area is a tiny fraction
 * of that box. This is what actually distinguishes "big real parcel" from
 * "leaked into the road" - a fixed area ceiling does not, since a shopping
 * center anchor can legitimately be far larger than a leak in a denser area.
 */
const MIN_FILL_RATIO = 0.2;

export interface TracedParcel {
  geometry: AreaGeometry;
  acreage: number;
  sourceLabel: string;
}

function lonLatToPixel(lng: number, lat: number, zoom: number): { x: number; y: number } {
  const n = 2 ** zoom;
  const latRad = (lat * Math.PI) / 180;
  return {
    x: ((lng + 180) / 360) * n * TILE_SIZE,
    y: ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n * TILE_SIZE,
  };
}

function pixelToLonLat(px: number, py: number, zoom: number): [number, number] {
  const n = 2 ** zoom;
  const lng = (px / (n * TILE_SIZE)) * 360 - 180;
  const y = py / (n * TILE_SIZE);
  const lat = (Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180) / Math.PI;
  return [lng, lat];
}

interface Mosaic {
  alpha: Uint8ClampedArray;
  width: number;
  height: number;
  pointPx: { x: number; y: number };
  origin: { x: number; y: number };
}

async function fetchMosaic(point: LatLng, zoom: number): Promise<Mosaic> {
  const { x: px, y: py } = lonLatToPixel(point.lng, point.lat, zoom);
  const centerTx = Math.floor(px / TILE_SIZE);
  const centerTy = Math.floor(py / TILE_SIZE);
  const half = Math.floor(MOSAIC_GRID / 2);
  const originTx = centerTx - half;
  const originTy = centerTy - half;

  const width = TILE_SIZE * MOSAIC_GRID;
  const height = TILE_SIZE * MOSAIC_GRID;
  const alpha = new Uint8ClampedArray(width * height);

  const fetches: Array<Promise<void>> = [];
  for (let gy = 0; gy < MOSAIC_GRID; gy++) {
    for (let gx = 0; gx < MOSAIC_GRID; gx++) {
      const tx = originTx + gx;
      const ty = originTy + gy;
      const url = PARCEL_LINES_OVERLAY.url.replace('{z}', String(zoom)).replace('{y}', String(ty)).replace('{x}', String(tx));

      fetches.push((async () => {
        try {
          const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
          if (!res.ok) return;
          const buf = Buffer.from(await res.arrayBuffer());
          const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
          if (info.width !== TILE_SIZE || info.height !== TILE_SIZE) return;
          for (let ty2 = 0; ty2 < TILE_SIZE; ty2++) {
            const destRowStart = (gy * TILE_SIZE + ty2) * width + gx * TILE_SIZE;
            const srcRowStart = ty2 * TILE_SIZE * 4;
            for (let tx2 = 0; tx2 < TILE_SIZE; tx2++) {
              alpha[destRowStart + tx2] = data[srcRowStart + tx2 * 4 + 3]!;
            }
          }
        } catch {
          // A missing/broken tile just leaves that patch blank (no lines there).
        }
      })());
    }
  }
  await Promise.all(fetches);

  return {
    alpha, width, height,
    pointPx: { x: px - originTx * TILE_SIZE, y: py - originTy * TILE_SIZE },
    origin: { x: originTx * TILE_SIZE, y: originTy * TILE_SIZE },
  };
}

/**
 * Flood fill from the point, walled off by any partially-opaque (line)
 * pixel. `touchedEdge` tells the caller the fill reached the border of the
 * fetched mosaic - meaning the shape might not actually be closed within the
 * area we looked at, so accepting it would be a guess, not a trace.
 */
function floodFill(mosaic: Mosaic): { region: Uint8Array; touchedEdge: boolean } | null {
  const { alpha, width, height, pointPx } = mosaic;
  const startX = Math.max(0, Math.min(width - 1, Math.round(pointPx.x)));
  const startY = Math.max(0, Math.min(height - 1, Math.round(pointPx.y)));
  const isLine = (i: number) => alpha[i]! > 40;
  if (isLine(startY * width + startX)) return null; // point sits on a drawn line

  const region = new Uint8Array(width * height);
  const stack: number[] = [startY * width + startX];
  region[stack[0]!] = 1;
  let count = 1;
  let touchedEdge = false;
  const maxCount = width * height * 0.6;

  while (stack.length) {
    const i = stack.pop()!;
    const x = i % width;
    const y = (i - x) / width;
    if (x === 0 || x === width - 1 || y === 0 || y === height - 1) touchedEdge = true;
    const neighbors = [
      x > 0 ? i - 1 : -1,
      x < width - 1 ? i + 1 : -1,
      y > 0 ? i - width : -1,
      y < height - 1 ? i + width : -1,
    ];
    for (const n of neighbors) {
      if (n < 0 || region[n] || isLine(n)) continue;
      region[n] = 1;
      count++;
      if (count > maxCount) return null; // leaked - the region ate most of the mosaic
      stack.push(n);
    }
  }
  return { region, touchedEdge };
}

/** Moore-neighbor boundary tracing of the filled region's outer edge. */
function traceBoundary(region: Uint8Array, width: number, height: number): Array<[number, number]> | null {
  const inRegion = (x: number, y: number) => x >= 0 && x < width && y >= 0 && y < height && region[y * width + x] === 1;

  let start: [number, number] | null = null;
  outer: for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (inRegion(x, y)) { start = [x, y]; break outer; }
    }
  }
  if (!start) return null;

  // 8-connected neighbor offsets, clockwise starting from "west".
  const dirs: Array<[number, number]> = [[-1, 0], [-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1]];
  const boundary: Array<[number, number]> = [];
  let current = start;
  let backtrack = 0; // direction we arrived from
  const maxSteps = width * height;
  let steps = 0;

  do {
    boundary.push(current);
    let dir = (backtrack + 1) % 8; // start searching one step clockwise past where we came from
    let found: [number, number] | null = null;
    let foundDir = dir;
    for (let k = 0; k < 8; k++) {
      const d = dirs[dir]!;
      const nx = current[0] + d[0];
      const ny = current[1] + d[1];
      if (inRegion(nx, ny)) { found = [nx, ny]; foundDir = dir; break; }
      dir = (dir + 1) % 8;
    }
    if (!found) break;
    current = found;
    backtrack = (foundDir + 4) % 8; // the direction back to the pixel we just came from
    steps++;
  } while ((current[0] !== start[0] || current[1] !== start[1]) && steps < maxSteps);

  return boundary.length >= 3 ? boundary : null;
}

/** Ramer-Douglas-Peucker simplification so the saved polygon isn't thousands of points. */
function simplify(points: Array<[number, number]>, epsilon: number): Array<[number, number]> {
  if (points.length < 3) return points;
  const sqDist = (p: [number, number], a: [number, number], b: [number, number]) => {
    let [x, y] = a;
    const dx = b[0] - x;
    const dy = b[1] - y;
    if (dx !== 0 || dy !== 0) {
      const t = ((p[0] - x) * dx + (p[1] - y) * dy) / (dx * dx + dy * dy);
      if (t > 1) { x = b[0]; y = b[1]; } else if (t > 0) { x += dx * t; y += dy * t; }
    }
    return (p[0] - x) ** 2 + (p[1] - y) ** 2;
  };
  const simplifyRange = (pts: Array<[number, number]>): Array<[number, number]> => {
    if (pts.length <= 2) return pts;
    let maxDist = 0;
    let index = 0;
    for (let i = 1; i < pts.length - 1; i++) {
      const d = sqDist(pts[i]!, pts[0]!, pts[pts.length - 1]!);
      if (d > maxDist) { maxDist = d; index = i; }
    }
    if (maxDist > epsilon * epsilon) {
      const left = simplifyRange(pts.slice(0, index + 1));
      const right = simplifyRange(pts.slice(index));
      return [...left.slice(0, -1), ...right];
    }
    return [pts[0]!, pts[pts.length - 1]!];
  };
  return simplifyRange(points);
}

function polygonAreaPx(points: Array<[number, number]>): number {
  let sum = 0;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    sum += points[j]![0] * points[i]![1] - points[i]![0] * points[j]![1];
  }
  return Math.abs(sum / 2);
}

/**
 * Attempts to trace a parcel outline around `point` from Regrid's free tile
 * layer. Returns null on any failure - no tiles, point on a line, flood fill
 * leaked, or the traced shape implausibly large/elongated - rather than ever
 * returning a guessed shape that might be wrong.
 */
export async function traceParcelFromTiles(point: LatLng): Promise<TracedParcel | null> {
  try {
    const zoom = PARCEL_TILE_ZOOM;
    const mosaic = await fetchMosaic(point, zoom);
    const filled = floodFill(mosaic);
    if (!filled) return null;
    if (filled.touchedEdge) return null; // might not actually be closed within what we fetched

    const boundaryPx = traceBoundary(filled.region, mosaic.width, mosaic.height);
    if (!boundaryPx) return null;

    const simplified = simplify(boundaryPx, 1.5);
    if (simplified.length < 3) return null;

    const metersPerPx = 156543.033928 / 2 ** zoom;
    const areaPx = polygonAreaPx(simplified);
    const areaSqm = areaPx * metersPerPx ** 2;

    const xs = simplified.map((p) => p[0]);
    const ys = simplified.map((p) => p[1]);
    const bboxW = Math.max(...xs) - Math.min(...xs);
    const bboxH = Math.max(...ys) - Math.min(...ys);
    const fillRatio = areaPx / Math.max(1, bboxW * bboxH);

    if (areaSqm < MIN_AREA_SQM || fillRatio < MIN_FILL_RATIO) return null;

    const ring: LinearRing = simplified.map(([px, py]) => {
      const [lng, lat] = pixelToLonLat(px + mosaic.origin.x, py + mosaic.origin.y, zoom);
      return [lng, lat] as [number, number];
    });
    ring.push(ring[0]!);

    const geometry = validateAreaGeometry({ type: 'Polygon', coordinates: [ring] });
    return {
      geometry,
      acreage: areaAcres(geometry),
      sourceLabel: "Regrid parcel-line imagery (auto-traced, unsurveyed)",
    };
  } catch (err) {
    console.warn('[parcel-trace] failed:', err);
    return null;
  }
}
