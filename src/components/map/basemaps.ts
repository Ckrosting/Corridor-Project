/**
 * Basemap configuration.
 *
 * Leaflet is the map RENDERER, not a source of map imagery. Every tile layer
 * below belongs to a third party with its own terms and attribution
 * requirements, so:
 *   - attribution is mandatory and always rendered,
 *   - satellite imagery is only offered when a provider has been configured,
 *   - nothing here silently falls back to a provider the user has not chosen.
 *
 * Only NEXT_PUBLIC_* values appear here, because tile URLs are fetched by the
 * browser. Provider tokens placed in these variables are visible to anyone using
 * the app — that is inherent to client-side tile loading, so use tokens scoped
 * and URL-restricted at the provider. Server-side secrets never appear here.
 */

/**
 * How far a user is allowed to zoom in, on every layer. Individual tile
 * sources stop having real imagery well before this (see `maxNativeZoom`
 * below) - Leaflet then upscales each source's last real tile rather than
 * going blank, so nothing on the map (parcel lines included) disappears
 * before the others while zooming in further.
 */
const MAX_ZOOM = 22;

export interface Basemap {
  id: string;
  label: string;
  url: string;
  attribution: string;
  maxZoom: number;
  /** The deepest zoom this source actually has real tiles for; Leaflet upscales beyond it rather than going blank. */
  maxNativeZoom: number;
  /** Explains, in the UI, why a basemap is missing rather than hiding it silently. */
  unavailableReason?: string;
}

const OSM: Basemap = {
  id: 'street',
  label: 'Street',
  url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  maxZoom: MAX_ZOOM,
  maxNativeZoom: 19,
};

/**
 * Third-party county tax parcel lines, always shown on top of whichever
 * basemap is active - a visual reference only, drawn by a third party
 * (Regrid, as Esri's parcel-data partner), free and keyless. This is NOT the
 * approximate research outline a user draws for a parcel - it is
 * an actual surveyed tax line, shown for orientation only.
 *
 * Only renders once zoomed in close enough for individual parcels to be
 * legible (tax parcels are tiny at a city-wide zoom).
 *
 * The service's own tileInfo lists LODs up to 23, but that is the schema, not
 * what is actually cached - verified directly (see parcel-trace.ts) that for
 * most areas real tiles stop being served around zoom 17 and 18+ 404s. With
 * maxNativeZoom set past that, Leaflet requests those missing deeper tiles
 * directly instead of upscaling the last real one, so the lines just vanish
 * past 17 instead of getting blurrier. maxNativeZoom: 17 keeps Leaflet
 * upscaling the real z17 tile for every zoom past it, so lines stay visible
 * (softer, never gone) all the way to MAX_ZOOM.
 */
export const PARCEL_LINES_OVERLAY = {
  url: 'https://tiles.arcgis.com/tiles/KzeiCaQsMoeCfoCq/arcgis/rest/services/Regrid_Nationwide_Parcel_Boundaries_v1/MapServer/tile/{z}/{y}/{x}',
  attribution: 'Parcel lines &copy; <a href="https://regrid.com/">Regrid</a>',
  minZoom: 15,
  maxZoom: MAX_ZOOM,
  maxNativeZoom: 17,
};

export function getBasemaps(): Basemap[] {
  const provider = process.env.NEXT_PUBLIC_SATELLITE_PROVIDER ?? '';
  const mapboxToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? '';
  const maptilerKey = process.env.NEXT_PUBLIC_MAPTILER_KEY ?? '';

  const maps: Basemap[] = [OSM];

  switch (provider) {
    case 'mapbox':
      maps.push(
        mapboxToken
          ? {
              id: 'satellite',
              label: 'Satellite',
              url: `https://api.mapbox.com/styles/v1/mapbox/satellite-streets-v12/tiles/{z}/{x}/{y}?access_token=${mapboxToken}`,
              attribution: '&copy; <a href="https://www.mapbox.com/about/maps/">Mapbox</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
              maxZoom: MAX_ZOOM,
              maxNativeZoom: 20,
            }
          : unavailable('Mapbox is selected as the satellite provider, but NEXT_PUBLIC_MAPBOX_TOKEN is not set.'),
      );
      break;

    case 'maptiler':
      maps.push(
        maptilerKey
          ? {
              id: 'satellite',
              label: 'Satellite',
              url: `https://api.maptiler.com/tiles/satellite-v2/{z}/{x}/{y}.jpg?key=${maptilerKey}`,
              attribution: '&copy; <a href="https://www.maptiler.com/copyright/">MapTiler</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
              maxZoom: MAX_ZOOM,
              maxNativeZoom: 20,
            }
          : unavailable('MapTiler is selected as the satellite provider, but NEXT_PUBLIC_MAPTILER_KEY is not set.'),
      );
      break;

    case 'esri':
      // Esri's World Imagery basemap is usable without a key but carries its own
      // terms; attribution is required and volume is not unlimited.
      maps.push({
        id: 'satellite',
        label: 'Satellite',
        url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        attribution: 'Imagery &copy; Esri, Maxar, Earthstar Geographics, and the GIS User Community',
        maxZoom: MAX_ZOOM,
        maxNativeZoom: 19,
      });
      break;

    default:
      maps.push(unavailable(
        'No satellite provider is configured. Set NEXT_PUBLIC_SATELLITE_PROVIDER to mapbox, maptiler or esri (plus the matching key) to enable satellite imagery.',
      ));
  }

  return maps;
}

function unavailable(reason: string): Basemap {
  return {
    id: 'satellite', label: 'Satellite', url: '', attribution: '',
    maxZoom: MAX_ZOOM, maxNativeZoom: 19, unavailableReason: reason,
  };
}

/** Rough centre of the continental US, used before any market has coordinates. */
export const DEFAULT_CENTER: [number, number] = [33.4735, -82.0105];
export const DEFAULT_ZOOM = 12;
