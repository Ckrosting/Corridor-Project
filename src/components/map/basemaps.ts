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

export interface Basemap {
  id: string;
  label: string;
  url: string;
  attribution: string;
  maxZoom: number;
  /** Explains, in the UI, why a basemap is missing rather than hiding it silently. */
  unavailableReason?: string;
}

const OSM: Basemap = {
  id: 'street',
  label: 'Street',
  url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  maxZoom: 19,
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
              maxZoom: 20,
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
              maxZoom: 20,
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
        maxZoom: 19,
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
  return { id: 'satellite', label: 'Satellite', url: '', attribution: '', maxZoom: 19, unavailableReason: reason };
}

/** Rough centre of the continental US, used before any market has coordinates. */
export const DEFAULT_CENTER: [number, number] = [33.4735, -82.0105];
export const DEFAULT_ZOOM = 12;
