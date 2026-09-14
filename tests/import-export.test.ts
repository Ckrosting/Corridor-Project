import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, like } from 'drizzle-orm';
import { db } from '@/db';
import { mallAnchors, markets } from '@/db/schema';
import { csvCell, normaliseHeader, parseCsv, toCsv } from '@/lib/csv';
import {
  commitMallImport, createImportBatch, parseImportFile, suggestMallMapping, validateMallRows,
} from '@/lib/services/import';
import type { Actor } from '@/lib/auth/guards';
import { cleanupTestData, ensureBaseline, testActor, TEST_PREFIX } from './helpers';

let actor: Actor;

/** Import fixtures create their own markets, so they need their own cleanup. */
async function cleanupImports() {
  const created = await db.select({ id: markets.id }).from(markets)
    .where(like(markets.name, `${TEST_PREFIX}IMP%`));
  for (const m of created) {
    await db.delete(mallAnchors).where(eq(mallAnchors.marketId, m.id));
    await db.delete(markets).where(eq(markets.id, m.id));
  }
}

beforeAll(async () => {
  await ensureBaseline();
  await cleanupTestData();
  await cleanupImports();
  actor = await testActor();
});

afterAll(async () => {
  await cleanupImports();
  await cleanupTestData();
});

/* ========================================================================== */
/* CSV encoding                                                               */
/* ========================================================================== */

describe('csv encoding', () => {
  it('quotes fields containing commas, quotes and newlines', () => {
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell('has,comma')).toBe('"has,comma"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('line1\nline2')).toBe('"line1\nline2"');
  });

  it('renders null and undefined as empty, never as zero', () => {
    expect(csvCell(null)).toBe('');
    expect(csvCell(undefined)).toBe('');
    expect(csvCell(0)).toBe('0');
  });

  it('escapes formula injection but leaves negative numbers alone', () => {
    // The dangerous cases are escaped...
    expect(csvCell('=cmd|calc')).toBe("'=cmd|calc");
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(csvCell('-not a number')).toBe("'-not a number");
    // ...but a real longitude must survive, or exports cannot be re-imported.
    expect(csvCell('-82.0812')).toBe('-82.0812');
    expect(csvCell(-82.0812)).toBe('-82.0812');
    expect(csvCell('33.4735')).toBe('33.4735');
  });
});

describe('csv parsing', () => {
  it('round-trips values through encode and parse', () => {
    const headers = ['a', 'b', 'c'];
    const rows = [['plain', 'has,comma', 'say "hi"'], ['-82.0812', '', 'multi\nline']];
    const parsed = parseCsv(toCsv(headers, rows));

    expect(parsed[0]).toEqual(headers);
    expect(parsed[1]).toEqual(['plain', 'has,comma', 'say "hi"']);
    expect(parsed[2]).toEqual(['-82.0812', '', 'multi\nline']);
  });

  it('handles CRLF, LF and a leading BOM', () => {
    expect(parseCsv('a,b\r\n1,2\r\n')).toEqual([['a', 'b'], ['1', '2']]);
    expect(parseCsv('a,b\n1,2\n')).toEqual([['a', 'b'], ['1', '2']]);
    expect(parseCsv('﻿a,b\n1,2')).toEqual([['a', 'b'], ['1', '2']]);
  });

  it('normalises header spellings', () => {
    expect(normaliseHeader('Mall Name')).toBe('mall_name');
    expect(normaliseHeader('MALL-NAME')).toBe('mall_name');
    expect(normaliseHeader('  mall_name  ')).toBe('mall_name');
  });
});

/* ========================================================================== */
/* Mall import                                                                */
/* ========================================================================== */

const HEADER = 'Mall Name,Market Name,Street Address,City,State,ZIP,Latitude,Longitude';

describe('mall import validation', () => {
  it('suggests a column mapping from varied header spellings', () => {
    const mapping = suggestMallMapping(['Mall Name', 'Market', 'Address', 'City', 'ST', 'Zip Code', 'Lat', 'Lon']);
    expect(mapping['Mall Name']).toBe('mallName');
    expect(mapping['Market']).toBe('marketName');
    expect(mapping['Address']).toBe('streetAddress');
    expect(mapping['Lat']).toBe('latitude');
    expect(mapping['Lon']).toBe('longitude');
  });

  it('reports row-level errors without discarding the good rows', async () => {
    const csv = [
      HEADER,
      `${TEST_PREFIX}IMP Good Mall,${TEST_PREFIX}IMP Market A,1 Main St,Augusta,GA,30909,33.4735,-82.0812`,
      `,${TEST_PREFIX}IMP Market A,2 Main St,Augusta,GA,30909,,`,            // missing mall name
      `${TEST_PREFIX}IMP Bad Coords,${TEST_PREFIX}IMP Market A,3 Main St,Augusta,GA,30909,notanumber,-82.08`,
      `${TEST_PREFIX}IMP Out Of Range,${TEST_PREFIX}IMP Market A,4 Main St,Augusta,GA,30909,999,-82.08`,
    ].join('\r\n');

    const parsed = parseImportFile(csv);
    const rows = await validateMallRows(parsed, parsed.suggestedMapping);

    expect(rows).toHaveLength(4);
    expect(rows[0]!.verdict).toBe('new');
    expect(rows[0]!.errors).toHaveLength(0);

    expect(rows[1]!.verdict).toBe('error');
    expect(rows[1]!.errors.join(' ')).toMatch(/mall name is required/i);

    expect(rows[2]!.verdict).toBe('error');
    expect(rows[2]!.errors.join(' ')).toMatch(/not a number/i);

    expect(rows[3]!.verdict).toBe('error');
    expect(rows[3]!.errors.join(' ')).toMatch(/outside the valid range/i);

    // Row numbers are 1-based and account for the header row.
    expect(rows.map((r) => r.rowNumber)).toEqual([2, 3, 4, 5]);
  });

  it('warns rather than errors when coordinates are missing', async () => {
    const csv = [HEADER, `${TEST_PREFIX}IMP No Coords,${TEST_PREFIX}IMP Market B,5 Main St,Augusta,GA,30909,,`].join('\r\n');
    const parsed = parseImportFile(csv);
    const rows = await validateMallRows(parsed, parsed.suggestedMapping);

    expect(rows[0]!.verdict).toBe('new');
    expect(rows[0]!.errors).toHaveLength(0);
    expect(rows[0]!.warnings.join(' ')).toMatch(/needing map placement/i);
  });

  it('errors when only one of latitude/longitude is given', async () => {
    const csv = [HEADER, `${TEST_PREFIX}IMP Half Coords,${TEST_PREFIX}IMP Market B,6 Main St,Augusta,GA,30909,33.47,`].join('\r\n');
    const parsed = parseImportFile(csv);
    const rows = await validateMallRows(parsed, parsed.suggestedMapping);

    expect(rows[0]!.verdict).toBe('error');
    expect(rows[0]!.errors.join(' ')).toMatch(/together/i);
  });

  it('flags duplicates within the same file', async () => {
    const csv = [
      HEADER,
      `${TEST_PREFIX}IMP Twice,${TEST_PREFIX}IMP Market C,7 Main St,Augusta,GA,30909,33.47,-82.08`,
      `${TEST_PREFIX}IMP Twice,${TEST_PREFIX}IMP Market C,7 Main Street,Augusta,GA,30909,33.47,-82.08`,
    ].join('\r\n');

    const parsed = parseImportFile(csv);
    const rows = await validateMallRows(parsed, parsed.suggestedMapping);

    expect(rows[0]!.verdict).toBe('new');
    expect(rows[1]!.verdict).toBe('duplicate');
    expect(rows[1]!.warnings.join(' ')).toMatch(/row 2/);
    // Duplicates default to skip so a re-run cannot quietly double the data.
    expect(rows[1]!.action).toBe('skip');
  });
});

describe('mall import commit', () => {
  it('creates markets and malls, and flags those without coordinates', async () => {
    const csv = [
      HEADER,
      `${TEST_PREFIX}IMP Alpha Mall,${TEST_PREFIX}IMP Commit Market,10 Main St,Augusta,GA,30909,33.4735,-82.0812`,
      `${TEST_PREFIX}IMP Beta Mall,${TEST_PREFIX}IMP Commit Market,11 Main St,Augusta,GA,30909,,`,
    ].join('\r\n');

    const parsed = parseImportFile(csv);
    const rows = await validateMallRows(parsed, parsed.suggestedMapping);
    const batch = await createImportBatch('malls.csv', parsed.suggestedMapping, rows, actor);

    const result = await commitMallImport(batch.id, {}, actor);
    expect(result.created).toBe(2);
    expect(result.skipped).toBe(0);

    const [market] = await db.select().from(markets)
      .where(eq(markets.name, `${TEST_PREFIX}IMP Commit Market`)).limit(1);
    expect(market).toBeTruthy();

    const anchors = await db.select().from(mallAnchors).where(eq(mallAnchors.marketId, market!.id));
    expect(anchors).toHaveLength(2);

    const alpha = anchors.find((a) => a.name.includes('Alpha'))!;
    const beta = anchors.find((a) => a.name.includes('Beta'))!;

    expect(alpha.latitude).toBeCloseTo(33.4735, 4);
    expect(alpha.needsMapPlacement).toBe(false);

    // Imported without coordinates: flagged for placement, never given invented ones.
    expect(beta.latitude).toBeNull();
    expect(beta.needsMapPlacement).toBe(true);
  });

  it('does not create duplicates when the same file is imported twice', async () => {
    const csv = [
      HEADER,
      `${TEST_PREFIX}IMP Repeat Mall,${TEST_PREFIX}IMP Repeat Market,20 Main St,Augusta,GA,30909,33.47,-82.08`,
    ].join('\r\n');

    // First import creates it.
    const first = parseImportFile(csv);
    const firstRows = await validateMallRows(first, first.suggestedMapping);
    expect(firstRows[0]!.verdict).toBe('new');
    const batch1 = await createImportBatch('repeat.csv', first.suggestedMapping, firstRows, actor);
    expect((await commitMallImport(batch1.id, {}, actor)).created).toBe(1);

    // Second import of the same file recognises the existing record.
    const second = parseImportFile(csv);
    const secondRows = await validateMallRows(second, second.suggestedMapping);
    expect(secondRows[0]!.verdict).toBe('duplicate');
    expect(secondRows[0]!.duplicateOfId).toBeTruthy();

    const batch2 = await createImportBatch('repeat.csv', second.suggestedMapping, secondRows, actor);
    const result = await commitMallImport(batch2.id, {}, actor);

    // Skipped by default, so the mall is not duplicated.
    expect(result.created).toBe(0);
    expect(result.skipped).toBe(1);

    const [market] = await db.select().from(markets)
      .where(eq(markets.name, `${TEST_PREFIX}IMP Repeat Market`)).limit(1);
    const anchors = await db.select().from(mallAnchors).where(eq(mallAnchors.marketId, market!.id));
    expect(anchors).toHaveLength(1);
  });

  it('updates the existing record when the user explicitly chooses update', async () => {
    const create = [
      HEADER,
      `${TEST_PREFIX}IMP Update Mall,${TEST_PREFIX}IMP Update Market,30 Old St,Augusta,GA,30909,,`,
    ].join('\r\n');

    const p1 = parseImportFile(create);
    const r1 = await validateMallRows(p1, p1.suggestedMapping);
    const b1 = await createImportBatch('update.csv', p1.suggestedMapping, r1, actor);
    await commitMallImport(b1.id, {}, actor);

    // Same mall, now with an address and coordinates.
    const revised = [
      HEADER,
      `${TEST_PREFIX}IMP Update Mall,${TEST_PREFIX}IMP Update Market,30 New Street,Augusta,GA,30909,33.50,-82.10`,
    ].join('\r\n');

    const p2 = parseImportFile(revised);
    const r2 = await validateMallRows(p2, p2.suggestedMapping);
    expect(r2[0]!.verdict).toBe('duplicate');

    const b2 = await createImportBatch('update.csv', p2.suggestedMapping, r2, actor);
    // The user opts into updating this row rather than skipping it.
    const result = await commitMallImport(b2.id, { [r2[0]!.rowNumber]: 'update' }, actor);

    expect(result.updated).toBe(1);
    expect(result.created).toBe(0);

    const [market] = await db.select().from(markets)
      .where(eq(markets.name, `${TEST_PREFIX}IMP Update Market`)).limit(1);
    const anchors = await db.select().from(mallAnchors).where(eq(mallAnchors.marketId, market!.id));

    expect(anchors).toHaveLength(1);
    expect(anchors[0]!.addressLine1).toBe('30 New Street');
    expect(anchors[0]!.needsMapPlacement).toBe(false);
    expect(anchors[0]!.latitude).toBeCloseTo(33.5, 4);
  });

  it('refuses to commit the same batch twice', async () => {
    const csv = [HEADER, `${TEST_PREFIX}IMP Once Mall,${TEST_PREFIX}IMP Once Market,40 Main St,Augusta,GA,30909,33.47,-82.08`].join('\r\n');
    const parsed = parseImportFile(csv);
    const rows = await validateMallRows(parsed, parsed.suggestedMapping);
    const batch = await createImportBatch('once.csv', parsed.suggestedMapping, rows, actor);

    await commitMallImport(batch.id, {}, actor);
    await expect(commitMallImport(batch.id, {}, actor)).rejects.toThrow(/already been committed/i);
  });

  it('skips error rows on commit while importing the valid ones', async () => {
    const csv = [
      HEADER,
      `${TEST_PREFIX}IMP Valid Mall,${TEST_PREFIX}IMP Mixed Market,50 Main St,Augusta,GA,30909,33.47,-82.08`,
      `,${TEST_PREFIX}IMP Mixed Market,51 Main St,Augusta,GA,30909,,`,
    ].join('\r\n');

    const parsed = parseImportFile(csv);
    const rows = await validateMallRows(parsed, parsed.suggestedMapping);
    const batch = await createImportBatch('mixed.csv', parsed.suggestedMapping, rows, actor);
    const result = await commitMallImport(batch.id, {}, actor);

    expect(result.created).toBe(1);
    expect(result.skipped).toBe(1);
  });
});
