import { createHash } from 'node:crypto';

/**
 * Deduplication keys for discovery candidates.
 *
 * Two independent keys are used, because sources disagree about both:
 *  - a normalised URL, which catches the same listing page seen twice, and
 *  - an address hash, which catches the same property seen on two sites.
 *
 * Neither key uses the property NAME. Names are the least reliable field in this
 * data — "Riverbend Plaza" and "Riverbend Plaza II" are different properties,
 * and the same property appears as "Riverbend Plaza", "Riverbend Shopping
 * Center" and "3401 Sample Pkwy" across three listing sites. Similar names
 * become a *suggested* match for a human to confirm, never an automatic merge.
 */

const TRACKING_PARAMS = [
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'utm_id',
  'gclid', 'fbclid', 'msclkid', 'mc_cid', 'mc_eid', 'ref', 'referrer', 'source',
  '_ga', '_gl', 'igshid', 'sessionid', 'sid',
];

/**
 * Canonical form of a listing URL: lowercase host, no tracking parameters, no
 * trailing slash, no fragment, and no "www." prefix.
 */
export function normalizeUrl(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    return null;
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;

  url.hostname = url.hostname.toLowerCase().replace(/^www\./, '');
  url.hash = '';
  url.protocol = 'https:';
  // Default ports carry no meaning.
  if (url.port === '80' || url.port === '443') url.port = '';

  for (const param of TRACKING_PARAMS) url.searchParams.delete(param);
  // Stable parameter order, so ?a=1&b=2 and ?b=2&a=1 are the same listing.
  url.searchParams.sort();

  let out = url.toString();
  out = out.replace(/\/$/, '');
  return out;
}

const STREET_SUFFIXES: Record<string, string> = {
  street: 'st', str: 'st', st: 'st',
  avenue: 'ave', ave: 'ave', av: 'ave',
  road: 'rd', rd: 'rd',
  boulevard: 'blvd', blvd: 'blvd',
  drive: 'dr', dr: 'dr',
  lane: 'ln', ln: 'ln',
  parkway: 'pkwy', pkwy: 'pkwy', pky: 'pkwy',
  highway: 'hwy', hwy: 'hwy',
  court: 'ct', ct: 'ct',
  place: 'pl', pl: 'pl',
  circle: 'cir', cir: 'cir',
  terrace: 'ter', ter: 'ter',
  trail: 'trl', trl: 'trl',
  suite: 'ste', ste: 'ste',
  north: 'n', south: 's', east: 'e', west: 'w',
  northeast: 'ne', northwest: 'nw', southeast: 'se', southwest: 'sw',
};

/** Normalises an address so spelling variants collapse to one string. */
export function normalizeAddress(address: string | null | undefined): string {
  if (!address) return '';
  return address
    .toLowerCase()
    .replace(/[.,#]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => STREET_SUFFIXES[token] ?? token)
    .join(' ')
    .trim();
}

/**
 * A stable hash over address + locality. Returns null when there is not enough
 * information to identify the property — an empty hash would match everything.
 */
export function addressHash(input: {
  addressLine1?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
}): string | null {
  const street = normalizeAddress(input.addressLine1);
  if (!street) return null;

  const locality = [
    normalizeAddress(input.city),
    (input.state ?? '').trim().toLowerCase(),
    (input.postalCode ?? '').trim().slice(0, 5),
  ].filter(Boolean).join('|');

  // A street with no locality at all is too weak to key on.
  if (!locality) return null;

  return createHash('sha256').update(`${street}|${locality}`).digest('hex').slice(0, 32);
}

/** Normalises a parcel ID: parcel IDs are formatted inconsistently everywhere. */
export const normalizeParcelId = (id: string | null | undefined): string =>
  (id ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

/* -------------------------------------------------------------------------- */
/* Fuzzy matching (suggestions only)                                          */
/* -------------------------------------------------------------------------- */

/** Metres between two points, for "is this the same building" scoring. */
function metersBetween(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6_378_137;
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const s = Math.sin(dLat / 2) ** 2
    + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

export interface MatchCandidate {
  id: string;
  addressLine1: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  latitude: number | null;
  longitude: number | null;
  parcelIds: string[];
}

export interface MatchVerdict {
  propertyId: string;
  score: number;
  reason: string;
  /** Exact means link automatically; suggested means ask a human. */
  kind: 'exact' | 'suggested';
}

/**
 * Scores a candidate against existing properties.
 *
 * Only an exact address-hash or parcel-ID match is treated as certain. Proximity
 * alone is deliberately a SUGGESTION: two genuinely different properties can
 * share a parking lot, and merging them would silently destroy one record's call
 * history.
 */
export function findMatch(
  candidate: {
    addressLine1?: string | null;
    city?: string | null;
    state?: string | null;
    postalCode?: string | null;
    latitude?: number | null;
    longitude?: number | null;
    parcelIds?: string[];
  },
  existing: MatchCandidate[],
): MatchVerdict | null {
  const candidateHash = addressHash(candidate);
  const candidateParcels = new Set((candidate.parcelIds ?? []).map(normalizeParcelId).filter(Boolean));

  let best: MatchVerdict | null = null;

  for (const property of existing) {
    // 1. Identical normalised address — the strongest signal available.
    if (candidateHash && addressHash(property) === candidateHash) {
      return { propertyId: property.id, score: 1, reason: 'Same address', kind: 'exact' };
    }

    // 2. Shared parcel ID — equally strong where parcel IDs are known.
    if (candidateParcels.size > 0) {
      const shared = property.parcelIds.map(normalizeParcelId).find((p) => p && candidateParcels.has(p));
      if (shared) {
        return { propertyId: property.id, score: 1, reason: 'Shared parcel ID', kind: 'exact' };
      }
    }

    // 3. Very close coordinates — a suggestion for a human to confirm.
    if (
      candidate.latitude != null && candidate.longitude != null &&
      property.latitude != null && property.longitude != null
    ) {
      const distance = metersBetween(
        { lat: candidate.latitude, lng: candidate.longitude },
        { lat: property.latitude, lng: property.longitude },
      );
      if (distance <= 60) {
        const score = Math.max(0.5, 1 - distance / 120);
        if (!best || score > best.score) {
          best = {
            propertyId: property.id,
            score,
            reason: `Within ${Math.round(distance)} m of an existing property`,
            kind: 'suggested',
          };
        }
      }
    }
  }

  return best;
}
