import '@/lib/server-guard';
import { env } from '@/lib/env';
import { ConfigurationError } from '@/lib/errors';

/**
 * Pluggable forward geocoding.
 *
 * Leaflet renders maps; it does not provide geocoding or imagery. The provider is
 * configurable because none of the realistic options are unlimited and free:
 * Nominatim is free but explicitly rate-limited and forbids bulk use, while the
 * commercial providers need a key and have quotas.
 *
 * When geocoding is unavailable the caller must still be able to place a marker
 * by hand — every call site treats a failure as "fall back to manual placement",
 * never as a hard error.
 */

export interface GeocodeResult {
  label: string;
  lat: number;
  lng: number;
  confidence: 'high' | 'medium' | 'low';
  provider: string;
  raw?: unknown;
}

export interface GeocodeOutcome {
  results: GeocodeResult[];
  provider: string;
  /** Populated when the provider is unavailable, so the UI can explain why. */
  unavailableReason?: string;
}

const USER_AGENT = () => {
  const contact = env.geocoder.nominatimContact;
  return `HullCorridor/0.1 (+internal acquisitions research${contact ? `; ${contact}` : ''})`;
};

async function fetchJson(url: string, headers: Record<string, string> = {}): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(url, { headers, signal: controller.signal, cache: 'no-store' });
    if (!res.ok) throw new Error(`Provider responded ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Nominatim asks for no more than one request per second. This is a simple
 * in-process gate; it is not a distributed limiter, which is exactly why
 * Nominatim is unsuitable for bulk import geocoding.
 */
let lastNominatimCall = 0;
async function throttleNominatim() {
  const wait = 1100 - (Date.now() - lastNominatimCall);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastNominatimCall = Date.now();
}

async function nominatim(query: string, limit: number): Promise<GeocodeResult[]> {
  await throttleNominatim();
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=${limit}&q=${encodeURIComponent(query)}`;
  const data = (await fetchJson(url, { 'User-Agent': USER_AGENT(), 'Accept-Language': 'en' })) as Array<{
    display_name: string; lat: string; lon: string; importance?: number;
  }>;

  return data.map((r) => ({
    label: r.display_name,
    lat: Number(r.lat),
    lng: Number(r.lon),
    confidence: (r.importance ?? 0) > 0.5 ? 'high' : (r.importance ?? 0) > 0.25 ? 'medium' : 'low',
    provider: 'nominatim',
  }));
}

async function mapbox(query: string, limit: number): Promise<GeocodeResult[]> {
  const key = env.geocoder.apiKey;
  if (!key) throw new ConfigurationError('Mapbox geocoding is selected but GEOCODER_API_KEY is not set.');
  const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json?limit=${limit}&country=US&access_token=${encodeURIComponent(key)}`;
  const data = (await fetchJson(url)) as { features?: Array<{ place_name: string; center: [number, number]; relevance?: number }> };

  return (data.features ?? []).map((f) => ({
    label: f.place_name,
    lng: f.center[0],
    lat: f.center[1],
    confidence: (f.relevance ?? 0) > 0.9 ? 'high' : (f.relevance ?? 0) > 0.7 ? 'medium' : 'low',
    provider: 'mapbox',
  }));
}

async function maptiler(query: string, limit: number): Promise<GeocodeResult[]> {
  const key = env.geocoder.apiKey;
  if (!key) throw new ConfigurationError('MapTiler geocoding is selected but GEOCODER_API_KEY is not set.');
  const url = `https://api.maptiler.com/geocoding/${encodeURIComponent(query)}.json?limit=${limit}&country=us&key=${encodeURIComponent(key)}`;
  const data = (await fetchJson(url)) as { features?: Array<{ place_name: string; center: [number, number]; relevance?: number }> };

  return (data.features ?? []).map((f) => ({
    label: f.place_name,
    lng: f.center[0],
    lat: f.center[1],
    confidence: (f.relevance ?? 0) > 0.9 ? 'high' : 'medium',
    provider: 'maptiler',
  }));
}

async function google(query: string, limit: number): Promise<GeocodeResult[]> {
  const key = env.geocoder.apiKey;
  if (!key) throw new ConfigurationError('Google geocoding is selected but GEOCODER_API_KEY is not set.');
  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(query)}&key=${encodeURIComponent(key)}`;
  const data = (await fetchJson(url)) as {
    status: string;
    results?: Array<{ formatted_address: string; geometry: { location: { lat: number; lng: number }; location_type?: string } }>;
  };
  if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
    throw new Error(`Google Geocoding returned status ${data.status}`);
  }

  return (data.results ?? []).slice(0, limit).map((r) => ({
    label: r.formatted_address,
    lat: r.geometry.location.lat,
    lng: r.geometry.location.lng,
    confidence: r.geometry.location_type === 'ROOFTOP' ? 'high' : r.geometry.location_type === 'RANGE_INTERPOLATED' ? 'medium' : 'low',
    provider: 'google',
  }));
}

/**
 * Geocodes an address. Never throws for provider problems — it returns an empty
 * result set plus a reason, so the caller can offer manual placement instead.
 */
export async function geocode(query: string, limit = 5): Promise<GeocodeOutcome> {
  const provider = env.geocoder.provider || 'nominatim';
  const trimmed = query.trim();
  if (!trimmed) return { results: [], provider, unavailableReason: 'Enter an address to search.' };

  try {
    const impl = { nominatim, mapbox, maptiler, google }[provider];
    if (!impl) {
      return { results: [], provider, unavailableReason: `Unknown geocoding provider "${provider}". Set GEOCODER_PROVIDER to nominatim, mapbox, maptiler or google.` };
    }
    const results = await impl(trimmed, Math.min(limit, 10));
    return {
      results: results.filter((r) => Number.isFinite(r.lat) && Number.isFinite(r.lng)),
      provider,
    };
  } catch (err) {
    const message = err instanceof ConfigurationError
      ? err.message
      : `Address lookup is unavailable right now (${err instanceof Error ? err.message : 'unknown error'}). You can still place the location by clicking the map.`;
    console.warn('[geocode] provider failure:', err);
    return { results: [], provider, unavailableReason: message };
  }
}
