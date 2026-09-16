import '@/lib/server-guard';
import { and, eq, isNull } from 'drizzle-orm';
import { db } from '@/db';
import {
  contacts, importBatches, importRows, markets, properties, propertyContacts,
} from '@/db/schema';
import type { Actor } from '@/lib/auth/guards';
import { normaliseHeader, parseCsv, unescapeCell } from '@/lib/csv';
import { NotFoundError, ValidationError } from '@/lib/errors';
import { lookupCountyParcelByAddress, lookupCountyParcelByPin } from '@/lib/geo/county-parcels';
import { recordAudit } from './audit';
import { attachCountyParcelMatch, createProperty } from './properties';

/**
 * Bulk property import: parse -> map columns -> validate/preview -> explicit
 * commit. Mirrors the mall importer's shape (see `import.ts`), but scoped to
 * ONE market chosen up front - a property list rarely spans markets the way a
 * spreadsheet of malls does, and it keeps duplicate-detection unambiguous.
 *
 * Unlike a "for sale" discovery candidate, this is for research the team
 * already has on existing properties - ownership, contact numbers, historical
 * sale price - so rows land as real Property (+ Contact) records directly,
 * never through the discovery review inbox.
 */

export interface PropertyImportRow {
  name: string | null;
  addressLine1: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  propertyType: string | null;
  lastSaleDate: string | null;
  lastSalePrice: string | null;
  ownerName: string | null;
  /** Raw text - may contain a name, a title, and/or multiple phone numbers. */
  contactRaw: string | null;
  contactEmail: string | null;
  /** County parcel ID (PIN/REID/etc) - if the market has a verified county GIS feed configured, this is looked up directly for an exact parcel match. */
  parcelId: string | null;
}

export const PROPERTY_COLUMN_ALIASES: Record<keyof PropertyImportRow, string[]> = {
  name: ['name', 'use', 'property_name', 'tenant', 'business_name'],
  addressLine1: ['address', 'address_line1', 'street_address', 'address1'],
  city: ['city'],
  state: ['state', 'st'],
  postalCode: ['postal_code', 'zip', 'zip_code'],
  propertyType: ['property_type', 'type', 'use_type'],
  lastSaleDate: ['last_sale', 'last_sale_date', 'sale_date'],
  lastSalePrice: ['sale_price', 'last_sale_price', 'price'],
  ownerName: ['owner', 'owner_name'],
  contactRaw: ['contact', 'contact_phone', 'phone', 'contact_info', 'contact_name'],
  contactEmail: ['email', 'contact_email'],
  parcelId: ['parcel_id', 'pin', 'parcel_id_pin', 'reid', 'parcel_number'],
};

export const PROPERTY_REQUIRED_FIELDS: Array<keyof PropertyImportRow> = [];

export function suggestPropertyMapping(headers: string[]): Record<string, string> {
  const mapping: Record<string, string> = {};
  const used = new Set<string>();
  for (const [field, aliases] of Object.entries(PROPERTY_COLUMN_ALIASES)) {
    const match = headers.find((h) => !used.has(h) && aliases.includes(normaliseHeader(h)));
    if (match) { mapping[match] = field; used.add(match); }
  }
  return mapping;
}

export interface ParsedPropertyImport {
  headers: string[];
  rows: string[][];
  suggestedMapping: Record<string, string>;
}

export function parsePropertyImportFile(text: string): ParsedPropertyImport {
  const table = parseCsv(text);
  if (table.length === 0) throw new ValidationError('That file has no rows.');
  const headers = table[0]!.map((h) => h.trim());
  if (headers.length === 0 || headers.every((h) => h === '')) {
    throw new ValidationError('That file has no header row.');
  }
  return { headers, rows: table.slice(1), suggestedMapping: suggestPropertyMapping(headers) };
}

export interface ValidatedPropertyRow {
  rowNumber: number;
  raw: Record<string, string>;
  mapped: Partial<PropertyImportRow>;
  errors: string[];
  warnings: string[];
  verdict: 'new' | 'duplicate' | 'error';
  duplicateOfId: string | null;
  action: 'create' | 'skip';
}

const dupeKey = (address: string | null, name: string | null) =>
  `${(address ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')}|${(name ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')}`;

const parseMoney = (s: string): string | null => {
  const n = Number(s.replace(/[$,\s]/g, ''));
  return Number.isFinite(n) && n !== 0 ? n.toFixed(2) : null;
};

const parseDate = (s: string): string | null => {
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
};

export async function validatePropertyRows(
  parsed: ParsedPropertyImport,
  mapping: Record<string, string>,
  marketId: string,
): Promise<ValidatedPropertyRow[]> {
  const existing = await db
    .select({ id: properties.id, addressLine1: properties.addressLine1, name: properties.name })
    .from(properties)
    .where(and(eq(properties.marketId, marketId), isNull(properties.archivedAt)));

  const existingByKey = new Map(existing.map((p) => [dupeKey(p.addressLine1, p.name), p.id]));
  const seenInFile = new Map<string, number>();
  const out: ValidatedPropertyRow[] = [];

  parsed.rows.forEach((cells, index) => {
    const rowNumber = index + 2;
    const rawRecord: Record<string, string> = {};
    parsed.headers.forEach((h, i) => { rawRecord[h] = unescapeCell(cells[i] ?? '').trim(); });
    if (Object.values(rawRecord).every((v) => v === '')) return; // blank row

    const value = (field: keyof PropertyImportRow): string => {
      const header = Object.entries(mapping).find(([, f]) => f === field)?.[0];
      return header ? (rawRecord[header] ?? '') : '';
    };

    const errors: string[] = [];
    const warnings: string[] = [];

    const name = value('name') || null;
    const addressLine1 = value('addressLine1') || null;
    if (!name && !addressLine1) errors.push('Needs at least a name/use or an address.');

    const lastSalePriceRaw = value('lastSalePrice');
    const lastSalePrice = lastSalePriceRaw ? parseMoney(lastSalePriceRaw) : null;
    if (lastSalePriceRaw && lastSalePrice === null) warnings.push(`"${lastSalePriceRaw}" is not a recognisable sale price; it will be left blank.`);

    const lastSaleDateRaw = value('lastSaleDate');
    const lastSaleDate = lastSaleDateRaw ? parseDate(lastSaleDateRaw) : null;
    if (lastSaleDateRaw && lastSaleDate === null) warnings.push(`"${lastSaleDateRaw}" is not a recognisable date; it will be left blank.`);

    const mapped: Partial<PropertyImportRow> = {
      name, addressLine1,
      city: value('city') || null,
      state: value('state') || null,
      postalCode: value('postalCode') || null,
      propertyType: value('propertyType') || null,
      lastSaleDate, lastSalePrice,
      ownerName: value('ownerName') || null,
      contactRaw: value('contactRaw') || null,
      contactEmail: value('contactEmail') || null,
      parcelId: value('parcelId') || null,
    };

    let verdict: ValidatedPropertyRow['verdict'] = 'new';
    let duplicateOfId: string | null = null;

    if (errors.length > 0) {
      verdict = 'error';
    } else {
      const key = dupeKey(addressLine1, name);
      const earlierRow = seenInFile.get(key);
      if (earlierRow !== undefined) {
        verdict = 'duplicate';
        warnings.push(`Same property as row ${earlierRow} in this file.`);
      } else if (existingByKey.has(key)) {
        verdict = 'duplicate';
        duplicateOfId = existingByKey.get(key)!;
        warnings.push('A property with this name/address already exists in this market.');
      }
      seenInFile.set(key, rowNumber);
    }

    out.push({
      rowNumber, raw: rawRecord, mapped, errors, warnings, verdict, duplicateOfId,
      action: verdict === 'error' || verdict === 'duplicate' ? 'skip' : 'create',
    });
  });

  return out;
}

export async function createPropertyImportBatch(
  filename: string, mapping: Record<string, string>, marketId: string, rows: ValidatedPropertyRow[], actor: Actor,
) {
  const [batch] = await db.insert(importBatches).values({
    kind: 'properties',
    status: 'draft',
    filename,
    columnMapping: { ...mapping, __marketId: marketId },
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

/**
 * Splits a free-text "Contact" cell into phone numbers and whatever text is
 * left over (usually a person's name, sometimes with a title). Real sheets are
 * inconsistent here - "David Ulgenalp (727) 643-7334", six numbers stacked in
 * one cell, or just a bare number - so this is a best-effort split, never a
 * fabrication: every phone number found is kept, and leftover text becomes the
 * contact's name only when there IS leftover text.
 */
function splitContact(raw: string): { name: string | null; phones: string[] } {
  const phoneRe = /(\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4})/g;
  const phones = [...raw.matchAll(phoneRe)].map((m) => m[1]!.trim());
  const name = raw.replace(phoneRe, '').replace(/[,()\n]+/g, ' ').replace(/\s+/g, ' ').trim();
  return { name: name || null, phones };
}

export async function commitPropertyImport(
  batchId: string,
  actions: Record<number, 'create' | 'skip'>,
  actor: Actor,
) {
  const [batch] = await db.select().from(importBatches).where(eq(importBatches.id, batchId)).limit(1);
  if (!batch) throw new NotFoundError('Import batch');
  if (batch.status === 'committed') throw new ValidationError('This import has already been committed.');

  const marketId = (batch.columnMapping as Record<string, string> | null)?.__marketId;
  if (!marketId) throw new ValidationError('This import batch has no market recorded.');

  const rows = await db.select().from(importRows).where(eq(importRows.batchId, batchId));
  const [market] = await db.select({ name: markets.name }).from(markets).where(eq(markets.id, marketId)).limit(1);

  let created = 0;
  let skipped = 0;
  let parcelsMatched = 0;

  for (const row of rows) {
    const action = actions[row.rowNumber] ?? row.action;
    const mapped = row.mapped as Partial<PropertyImportRow> | null;

    if (action !== 'create' || !mapped || (row.errors?.length ?? 0) > 0) {
      skipped++;
      continue;
    }

    const noteLines: string[] = ['Imported from a property research spreadsheet.'];
    if (mapped.lastSaleDate || mapped.lastSalePrice) {
      noteLines.push(`Last sale: ${mapped.lastSalePrice ? `$${mapped.lastSalePrice}` : 'price unknown'}${mapped.lastSaleDate ? ` on ${mapped.lastSaleDate}` : ''}.`);
    }

    const property = await createProperty({
      marketId,
      name: mapped.name ?? null,
      addressLine1: mapped.addressLine1 ?? null,
      city: mapped.city ?? null,
      state: mapped.state ?? null,
      postalCode: mapped.postalCode ?? null,
      propertyType: mapped.propertyType ?? null,
      listingStatus: 'unknown',
      researchNotes: noteLines.join(' '),
    }, actor);

    if (mapped.ownerName) {
      const { name: contactName, phones } = mapped.contactRaw ? splitContact(mapped.contactRaw) : { name: null, phones: [] };
      const [contact] = await db.insert(contacts).values({
        name: contactName ?? mapped.ownerName,
        company: contactName ? mapped.ownerName : null,
        role: 'owner',
        phone: phones[0] ?? null,
        phoneAlt: phones[1] ?? null,
        email: mapped.contactEmail ?? null,
        notes: phones.length > 2 ? `Additional numbers: ${phones.slice(2).join(', ')}` : null,
        source: `Imported from "${batch.filename}"`,
        createdBy: actor.id,
      }).returning();

      await db.insert(propertyContacts).values({
        propertyId: property.id, contactId: contact!.id, relationship: 'owner', isPrimary: true,
      }).onConflictDoNothing();
    }

    if (market) {
      const match = mapped.parcelId
        ? await lookupCountyParcelByPin(mapped.parcelId, market.name)
        : mapped.addressLine1
          ? await lookupCountyParcelByAddress(mapped.addressLine1, market.name)
          : null;
      if (match) {
        await attachCountyParcelMatch(property.id, match, actor);
        parcelsMatched++;
      }
    }

    await db.update(importRows).set({ committedEntityId: property.id }).where(eq(importRows.id, row.id));
    created++;
  }

  await db.update(importBatches).set({
    status: 'committed', createdRows: created, updatedRows: 0, skippedRows: skipped, committedAt: new Date(),
  }).where(eq(importBatches.id, batchId));

  await recordAudit({
    entityType: 'import_batch', entityId: batchId, action: 'commit',
    summary: `Imported properties from "${batch.filename}": ${created} created, ${skipped} skipped`,
    actor,
  });

  return { created, skipped, parcelsMatched };
}

export async function getPropertyImportBatch(batchId: string) {
  const [batch] = await db.select().from(importBatches).where(eq(importBatches.id, batchId)).limit(1);
  if (!batch) throw new NotFoundError('Import batch');
  const rows = await db.select().from(importRows).where(eq(importRows.batchId, batchId));
  return { batch, rows };
}
