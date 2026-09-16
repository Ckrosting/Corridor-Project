import '@/lib/server-guard';
import { parseCsv, normaliseHeader, unescapeCell } from '@/lib/csv';
import { ValidationError } from '@/lib/errors';
import type { Candidate } from '@/lib/ai/extraction';

/**
 * A flat, spreadsheet-friendly stand-in for `Candidate` (see
 * `src/lib/ai/extraction.ts`), for candidates found by hand or by a
 * human/LLM research pass outside the app - e.g. a scheduled Claude Code task
 * that searches the web and writes rows here instead of the app calling the
 * Anthropic API directly. Rows are converted to `Candidate[]` and handed to
 * the exact same `stageCandidates()` used by a real scan, so they land in the
 * discovery inbox under the same dedup/suppression/review rules. Nothing here
 * ever touches `properties` directly.
 */
export const CANDIDATE_CSV_COLUMNS = [
  'name', 'address_line1', 'city', 'state', 'postal_code', 'county',
  'latitude', 'longitude', 'property_type', 'asking_price', 'building_sqft',
  'land_acreage', 'listing_date', 'owner_name', 'broker_name', 'broker_company',
  'broker_phone', 'broker_email', 'source_url', 'source_title', 'source_name',
  'evidence_excerpt', 'location_note', 'needs_verification',
] as const;

type Column = (typeof CANDIDATE_CSV_COLUMNS)[number];

const COLUMN_ALIASES: Record<Column, string[]> = {
  name: ['name', 'property_name', 'listing_name'],
  address_line1: ['address_line1', 'address', 'street_address', 'address1'],
  city: ['city'],
  state: ['state', 'st'],
  postal_code: ['postal_code', 'zip', 'zip_code', 'postcode'],
  county: ['county'],
  latitude: ['latitude', 'lat'],
  longitude: ['longitude', 'lng', 'lon', 'long'],
  property_type: ['property_type', 'type'],
  asking_price: ['asking_price', 'price'],
  building_sqft: ['building_sqft', 'sqft', 'building_sq_ft'],
  land_acreage: ['land_acreage', 'acreage', 'acres'],
  listing_date: ['listing_date', 'listed'],
  owner_name: ['owner_name', 'owner'],
  broker_name: ['broker_name', 'broker'],
  broker_company: ['broker_company', 'brokerage'],
  broker_phone: ['broker_phone', 'phone'],
  broker_email: ['broker_email', 'email'],
  source_url: ['source_url', 'url', 'listing_url'],
  source_title: ['source_title'],
  source_name: ['source_name', 'site', 'publisher'],
  evidence_excerpt: ['evidence_excerpt', 'excerpt', 'evidence'],
  location_note: ['location_note', 'note', 'notes'],
  needs_verification: ['needs_verification', 'unverified_fields'],
};

function suggestCandidateMapping(headers: string[]): Record<string, Column> {
  const mapping: Record<string, Column> = {};
  const used = new Set<string>();
  for (const col of CANDIDATE_CSV_COLUMNS) {
    const match = headers.find((h) => !used.has(h) && COLUMN_ALIASES[col].includes(normaliseHeader(h)));
    if (match) { mapping[match] = col; used.add(match); }
  }
  return mapping;
}

export interface CandidateCsvError {
  rowNumber: number;
  message: string;
}

const blank = (v: string | undefined): string | null => {
  const s = (v ?? '').trim();
  return s === '' ? null : s;
};

const num = (v: string | undefined): number | null => {
  const s = (v ?? '').trim();
  if (s === '') return null;
  const n = Number(s.replace(/[$,\s]/g, ''));
  return Number.isFinite(n) ? n : null;
};

const dateOrNull = (v: string | undefined): string | null => {
  const s = (v ?? '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
};

/**
 * Parses a candidates CSV into `Candidate[]`, ready for `stageCandidates()`.
 *
 * A field with no source URL is treated the same way the AI pipeline treats an
 * unsupported value: kept, but flagged in `needsVerification` so a reviewer
 * sees it needs a second look before it becomes a property record. Confidence
 * is always "medium" - there is no model self-assessment to carry across from
 * a manually produced row.
 */
export function parseCandidateCsv(text: string): { candidates: Candidate[]; errors: CandidateCsvError[] } {
  const table = parseCsv(text);
  if (table.length === 0) throw new ValidationError('That file has no rows.');

  const headers = table[0]!.map((h) => h.trim());
  const mapping = suggestCandidateMapping(headers);
  const columnIndex = new Map(headers.map((h, i) => [h, i]));

  const get = (row: string[], col: Column): string | undefined => {
    const header = Object.entries(mapping).find(([, c]) => c === col)?.[0];
    if (!header) return undefined;
    const idx = columnIndex.get(header);
    if (idx === undefined) return undefined;
    return row[idx] === undefined ? undefined : unescapeCell(row[idx]!);
  };

  const candidates: Candidate[] = [];
  const errors: CandidateCsvError[] = [];

  table.slice(1).forEach((row, i) => {
    const rowNumber = i + 2; // +1 for header, +1 for 1-indexing
    if (row.every((c) => c.trim() === '')) return; // blank row

    const name = blank(get(row, 'name'));
    const addressLine1 = blank(get(row, 'address_line1'));
    if (!name && !addressLine1) {
      errors.push({ rowNumber, message: 'Needs at least a name or an address so it can be identified.' });
      return;
    }

    const sourceUrl = blank(get(row, 'source_url'));
    const needsVerification = (get(row, 'needs_verification') ?? '')
      .split(/[;,]/).map((s) => s.trim()).filter(Boolean);

    const sourced = (value: string | null, confidence: 'high' | 'medium' | 'low' = 'medium') => ({
      value,
      sourceUrl: value ? sourceUrl : null,
      excerpt: value ? blank(get(row, 'evidence_excerpt')) : null,
      confidence: value ? confidence : 'low' as const,
    });

    const askingPrice = num(get(row, 'asking_price'));

    candidates.push({
      name,
      addressLine1,
      city: blank(get(row, 'city')),
      state: blank(get(row, 'state')),
      postalCode: blank(get(row, 'postal_code')),
      county: blank(get(row, 'county')),
      latitude: num(get(row, 'latitude')),
      longitude: num(get(row, 'longitude')),
      propertyType: blank(get(row, 'property_type')),
      askingPrice,
      buildingSqft: num(get(row, 'building_sqft')),
      landAcreage: num(get(row, 'land_acreage')),
      listingDate: dateOrNull(get(row, 'listing_date')),
      ownerName: sourced(blank(get(row, 'owner_name'))),
      brokerName: sourced(blank(get(row, 'broker_name'))),
      brokerCompany: sourced(blank(get(row, 'broker_company'))),
      brokerPhone: sourced(blank(get(row, 'broker_phone'))),
      brokerEmail: sourced(blank(get(row, 'broker_email'))),
      priceSource: {
        value: askingPrice,
        sourceUrl: askingPrice != null ? sourceUrl : null,
        excerpt: askingPrice != null ? blank(get(row, 'evidence_excerpt')) : null,
        confidence: askingPrice != null ? 'medium' : 'low',
      },
      sources: sourceUrl
        ? [{ url: sourceUrl, title: blank(get(row, 'source_title')), sourceName: blank(get(row, 'source_name')) }]
        : [],
      evidenceExcerpt: blank(get(row, 'evidence_excerpt')),
      needsVerification,
      locationNote: blank(get(row, 'location_note')),
    });
  });

  return { candidates, errors };
}
