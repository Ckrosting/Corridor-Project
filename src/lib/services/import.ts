import '@/lib/server-guard';
import { and, eq, isNull, sql as raw } from 'drizzle-orm';
import { db } from '@/db';
import { importBatches, importRows, mallAnchors, markets } from '@/db/schema';
import type { Actor } from '@/lib/auth/guards';
import { normaliseHeader, parseCsv, unescapeCell } from '@/lib/csv';
import { NotFoundError, ValidationError } from '@/lib/errors';
import { recordAudit } from './audit';

/**
 * Spreadsheet import: parse → map columns → validate → preview → explicit commit.
 *
 * Nothing touches the real tables until `commitMallImport` is called. Every row
 * carries its own errors, warnings and duplicate verdict, so a single bad row
 * never silently poisons a whole file and never blocks the good rows either.
 */

export interface MallImportRow {
  mallName: string;
  marketName: string;
  streetAddress: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  county: string | null;
  notes: string | null;
  latitude: number | null;
  longitude: number | null;
}

/** Canonical field -> the header spellings recognised without manual mapping. */
export const MALL_COLUMN_ALIASES: Record<keyof MallImportRow, string[]> = {
  mallName: ['mall_name', 'mall', 'name', 'property_name', 'center_name', 'shopping_center'],
  marketName: ['market_name', 'market', 'metro', 'msa'],
  streetAddress: ['street_address', 'address', 'address_line1', 'address1', 'street'],
  city: ['city', 'town'],
  state: ['state', 'st', 'state_code'],
  zip: ['zip', 'zip_code', 'postal_code', 'postcode'],
  county: ['county'],
  notes: ['notes', 'comment', 'comments', 'remarks'],
  latitude: ['latitude', 'lat', 'y'],
  longitude: ['longitude', 'lng', 'lon', 'long', 'x'],
};

export const MALL_REQUIRED_FIELDS: Array<keyof MallImportRow> = ['mallName', 'marketName'];

/** Guesses a column mapping from the file's own headers. */
export function suggestMallMapping(headers: string[]): Record<string, string> {
  const mapping: Record<string, string> = {};
  const used = new Set<string>();

  for (const [field, aliases] of Object.entries(MALL_COLUMN_ALIASES)) {
    const match = headers.find((h) => !used.has(h) && aliases.includes(normaliseHeader(h)));
    if (match) {
      mapping[match] = field;
      used.add(match);
    }
  }
  return mapping;
}

export interface ParsedImport {
  headers: string[];
  rows: string[][];
  suggestedMapping: Record<string, string>;
}

export function parseImportFile(text: string): ParsedImport {
  const table = parseCsv(text);
  if (table.length === 0) throw new ValidationError('That file has no rows.');

  const headers = table[0]!.map((h) => h.trim());
  if (headers.length === 0 || headers.every((h) => h === '')) {
    throw new ValidationError('That file has no header row.');
  }

  return { headers, rows: table.slice(1), suggestedMapping: suggestMallMapping(headers) };
}

export interface ValidatedRow {
  rowNumber: number;
  raw: Record<string, string>;
  mapped: Partial<MallImportRow>;
  errors: string[];
  warnings: string[];
  verdict: 'new' | 'duplicate' | 'error';
  duplicateOfId: string | null;
  action: 'create' | 'update' | 'skip';
}

/** Normalised key used to spot the same mall arriving twice. */
const dupeKey = (name: string, city: string | null) =>
  `${name.toLowerCase().replace(/[^a-z0-9]/g, '')}|${(city ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')}`;

export async function validateMallRows(
  parsed: ParsedImport,
  mapping: Record<string, string>,
): Promise<ValidatedRow[]> {
  const existing = await db
    .select({
      id: mallAnchors.id,
      name: mallAnchors.name,
      city: mallAnchors.city,
    })
    .from(mallAnchors)
    .where(isNull(mallAnchors.archivedAt));

  const existingByKey = new Map(existing.map((a) => [dupeKey(a.name, a.city), a.id]));
  const seenInFile = new Map<string, number>();
  const out: ValidatedRow[] = [];

  parsed.rows.forEach((cells, index) => {
    const rowNumber = index + 2; // 1-based, and the header occupies row 1.
    const rawRecord: Record<string, string> = {};
    parsed.headers.forEach((h, i) => { rawRecord[h] = unescapeCell(cells[i] ?? '').trim(); });

    const value = (field: keyof MallImportRow): string => {
      const header = Object.entries(mapping).find(([, f]) => f === field)?.[0];
      return header ? (rawRecord[header] ?? '') : '';
    };

    const errors: string[] = [];
    const warnings: string[] = [];

    const mallName = value('mallName');
    const marketName = value('marketName');
    if (!mallName) errors.push('Mall name is required.');
    if (!marketName) errors.push('Market name is required.');

    const parseCoord = (field: 'latitude' | 'longitude', min: number, max: number): number | null => {
      const rawValue = value(field);
      if (!rawValue) return null;
      const n = Number(rawValue);
      if (!Number.isFinite(n)) {
        errors.push(`${field} "${rawValue}" is not a number.`);
        return null;
      }
      if (n < min || n > max) {
        errors.push(`${field} ${n} is outside the valid range ${min}..${max}.`);
        return null;
      }
      return n;
    };

    const latitude = parseCoord('latitude', -90, 90);
    const longitude = parseCoord('longitude', -180, 180);

    if ((latitude === null) !== (longitude === null)) {
      errors.push('Latitude and longitude must be provided together.');
    }
    if (latitude === null && longitude === null) {
      // Not an error. The mall imports and is flagged for manual map placement.
      warnings.push('No coordinates — this mall will be flagged as needing map placement.');
    }

    const stateValue = value('state');
    if (stateValue && stateValue.length !== 2) {
      warnings.push(`State "${stateValue}" is not a 2-letter code; it will be stored as-is.`);
    }

    const mapped: Partial<MallImportRow> = {
      mallName, marketName,
      streetAddress: value('streetAddress') || null,
      city: value('city') || null,
      state: stateValue || null,
      zip: value('zip') || null,
      county: value('county') || null,
      notes: value('notes') || null,
      latitude, longitude,
    };

    let verdict: ValidatedRow['verdict'] = 'new';
    let duplicateOfId: string | null = null;

    if (errors.length > 0) {
      verdict = 'error';
    } else {
      const key = dupeKey(mallName, mapped.city ?? null);

      const earlierRow = seenInFile.get(key);
      if (earlierRow !== undefined) {
        verdict = 'duplicate';
        warnings.push(`Same mall as row ${earlierRow} in this file.`);
      } else if (existingByKey.has(key)) {
        verdict = 'duplicate';
        duplicateOfId = existingByKey.get(key)!;
        warnings.push('A mall with this name already exists in this city.');
      }
      seenInFile.set(key, rowNumber);
    }

    out.push({
      rowNumber,
      raw: rawRecord,
      mapped,
      errors,
      warnings,
      verdict,
      duplicateOfId,
      // Duplicates default to skip; the user can switch them to update in the preview.
      action: verdict === 'error' ? 'skip' : verdict === 'duplicate' ? 'skip' : 'create',
    });
  });

  return out;
}

export async function createImportBatch(
  filename: string, mapping: Record<string, string>, rows: ValidatedRow[], actor: Actor,
) {
  const [batch] = await db.insert(importBatches).values({
    kind: 'malls',
    status: 'draft',
    filename,
    columnMapping: mapping,
    totalRows: rows.length,
    validRows: rows.filter((r) => r.verdict === 'new').length,
    errorRows: rows.filter((r) => r.verdict === 'error').length,
    duplicateRows: rows.filter((r) => r.verdict === 'duplicate').length,
    createdBy: actor.id,
  }).returning();

  if (rows.length > 0) {
    await db.insert(importRows).values(rows.map((r) => ({
      batchId: batch!.id,
      rowNumber: r.rowNumber,
      raw: r.raw,
      mapped: r.mapped as Record<string, unknown>,
      errors: r.errors,
      warnings: r.warnings,
      verdict: r.verdict,
      duplicateOfId: r.duplicateOfId,
      action: r.action,
    })));
  }

  return batch!;
}

const slugify = (name: string) =>
  name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'market';

/**
 * Applies a reviewed batch. Runs in a single transaction so a failure part-way
 * leaves nothing half-imported.
 */
export async function commitMallImport(
  batchId: string,
  actions: Record<number, 'create' | 'update' | 'skip'>,
  actor: Actor,
) {
  const [batch] = await db.select().from(importBatches).where(eq(importBatches.id, batchId)).limit(1);
  if (!batch) throw new NotFoundError('Import batch');
  if (batch.status === 'committed') throw new ValidationError('This import has already been committed.');

  const rows = await db.select().from(importRows).where(eq(importRows.batchId, batchId));

  let created = 0;
  let updated = 0;
  let skipped = 0;

  await db.transaction(async (tx) => {
    // Cache markets so a file with 30 malls in 12 markets does not re-query per row.
    const marketCache = new Map<string, string>();
    const allMarkets = await tx.select({ id: markets.id, name: markets.name }).from(markets);
    for (const m of allMarkets) marketCache.set(m.name.trim().toLowerCase(), m.id);

    const takenSlugs = new Set(
      (await tx.select({ slug: markets.slug }).from(markets)).map((m) => m.slug),
    );

    for (const row of rows) {
      const action = actions[row.rowNumber] ?? row.action;
      const mapped = row.mapped as Partial<MallImportRow> | null;

      if (action === 'skip' || !mapped?.mallName || !mapped.marketName || (row.errors?.length ?? 0) > 0) {
        skipped++;
        continue;
      }

      // Find or create the market named in the row.
      const marketKey = mapped.marketName.trim().toLowerCase();
      let marketId = marketCache.get(marketKey);
      if (!marketId) {
        let slug = slugify(mapped.marketName);
        for (let i = 2; takenSlugs.has(slug); i++) slug = `${slugify(mapped.marketName)}-${i}`;
        takenSlugs.add(slug);

        const [created] = await tx.insert(markets).values({
          name: mapped.marketName.trim(),
          slug,
          state: mapped.state ?? null,
          createdBy: actor.id,
        }).returning();
        marketId = created!.id;
        marketCache.set(marketKey, marketId);
      }

      const hasCoords = mapped.latitude != null && mapped.longitude != null;
      const values = {
        marketId,
        name: mapped.mallName.trim(),
        addressLine1: mapped.streetAddress ?? null,
        city: mapped.city ?? null,
        state: mapped.state ?? null,
        postalCode: mapped.zip ?? null,
        county: mapped.county ?? null,
        notes: mapped.notes ?? null,
        latitude: mapped.latitude ?? null,
        longitude: mapped.longitude ?? null,
        // A mall without reliable coordinates is imported and FLAGGED, never
        // silently dropped and never given invented coordinates.
        needsMapPlacement: !hasCoords,
        locationSource: hasCoords ? 'imported' : null,
        locationSetAt: hasCoords ? new Date() : null,
      };

      if (action === 'update' && row.duplicateOfId) {
        await tx.update(mallAnchors)
          .set({ ...values, updatedAt: new Date(), version: raw`${mallAnchors.version} + 1` })
          .where(eq(mallAnchors.id, row.duplicateOfId));
        await tx.update(importRows)
          .set({ committedEntityId: row.duplicateOfId })
          .where(eq(importRows.id, row.id));
        updated++;
      } else {
        const [anchor] = await tx.insert(mallAnchors)
          .values({ ...values, createdBy: actor.id })
          .returning();
        await tx.update(importRows)
          .set({ committedEntityId: anchor!.id })
          .where(eq(importRows.id, row.id));
        created++;
      }
    }

    await tx.update(importBatches).set({
      status: 'committed',
      createdRows: created,
      updatedRows: updated,
      skippedRows: skipped,
      committedAt: new Date(),
    }).where(eq(importBatches.id, batchId));
  });

  await recordAudit({
    entityType: 'import_batch', entityId: batchId, action: 'commit',
    summary: `Imported malls from "${batch.filename}": ${created} created, ${updated} updated, ${skipped} skipped`,
    actor,
  });

  return { created, updated, skipped };
}

export async function getImportBatch(batchId: string) {
  const [batch] = await db.select().from(importBatches).where(eq(importBatches.id, batchId)).limit(1);
  if (!batch) throw new NotFoundError('Import batch');
  const rows = await db.select().from(importRows)
    .where(eq(importRows.batchId, batchId))
    .orderBy(importRows.rowNumber);
  return { batch, rows };
}
