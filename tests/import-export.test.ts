import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, like } from 'drizzle-orm';
import { db } from '@/db';
import { mallAnchors, markets } from '@/db/schema';
import { csvCell, normaliseHeader, parseCsv, toCsv } from '@/lib/csv';
import {
  commitMallImport, createImportBatch, parseImportFile, suggestMallMapping, validateMallRows,
} from '@/lib/services/import';
import { parseCandidateCsv, parseCandidateXlsx } from '@/lib/services/candidate-csv';
import { readXlsxRows } from '@/lib/xlsx';
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
/* Broker listings export -> discovery candidates                             */
/* ========================================================================== */

/** The real Crexi "Inventory Export" shape: a blank row, a banner, then headers. */
const CREXI_HEADER = 'Property Link,Property Name,Property Status,Type,Property Subtype,Address,City,State,Zip,County,Tenant(s),SqFt,Year Built,Lot Size,Price/Unit,NOI,Cap Rate,Asking Price,Price/SqFt,Price/Acre,Days on Market,Longitude,Latitude';

const crexi = (...rows: string[]) =>
  ['411 properties found', CREXI_HEADER, ...rows].join('\n');

describe('candidate import', () => {
  it('finds the header row below an export banner', () => {
    const parsed = parseCandidateCsv(crexi(
      'https://www.crexi.com/properties/1,Chestnut,On-Market,Land,"Commercial, Residential",4523 W Chestnut St,Tampa,FL,33607,Hillsborough County,N/A,24000,,,,,0,890000,60,,1211,-82.52186,27.958998',
    ));

    expect(parsed.headerRowNumber).toBe(2);
    expect(parsed.errors).toEqual([]);
    expect(parsed.candidates).toHaveLength(1);
    expect(parsed.candidates[0]!.addressLine1).toBe('4523 W Chestnut St');
  });

  it('maps a listing link to a source, so the candidate has provenance', () => {
    const [candidate] = parseCandidateCsv(crexi(
      'https://www.crexi.com/properties/2,Aegean,On-Market,Multifamily,Apartment Building,4325 Aegean Dr,Tampa,FL,33611,Hillsborough County,Vacant,23640,1981,1.79,195652,312604,6.95,4500000,190.36,,1156,-82.5173365,27.8970668',
    )).candidates;

    expect(candidate!.sources).toEqual([
      { url: 'https://www.crexi.com/properties/2', title: null, sourceName: null },
    ]);
    expect(candidate!.landAcreage).toBe(1.79);
    expect(candidate!.noi).toBe(312604);
    expect(candidate!.capRateReported).toBe(6.95);
    expect(candidate!.yearBuilt).toBe(1981);
    expect(candidate!.tenantInfo).toBe('Vacant');
  });

  it('treats "N/A" as empty and a zero cap rate as not stated', () => {
    const [candidate] = parseCandidateCsv(crexi(
      'https://www.crexi.com/properties/3,Chestnut,On-Market,Land,Commercial,4523 W Chestnut St,Tampa,FL,33607,Hillsborough County,N/A,24000,N/A,,,,0,890000,60,,1211,-82.52186,27.958998',
    )).candidates;

    expect(candidate!.tenantInfo).toBeNull();
    expect(candidate!.yearBuilt).toBeNull();
    expect(candidate!.capRateReported).toBeNull();
    expect(candidate!.noi).toBeNull();
  });

  it('reports the columns it could not place', () => {
    const parsed = parseCandidateCsv(crexi(
      'https://www.crexi.com/properties/4,Chestnut,On-Market,Land,Commercial,4523 W Chestnut St,Tampa,FL,33607,Hillsborough County,,24000,,,,,,890000,,,1211,-82.52186,27.958998',
    ));

    expect(parsed.unmappedHeaders).toEqual([
      'Property Status', 'Price/Unit', 'Price/SqFt', 'Price/Acre', 'Days on Market',
    ]);
  });

  it('keeps the listing\'s own subtype out of the configured type taxonomy', () => {
    const [candidate] = parseCandidateCsv(crexi(
      'https://www.crexi.com/properties/5,Chestnut,On-Market,Land,"Commercial, Residential",4523 W Chestnut St,Tampa,FL,33607,Hillsborough County,,24000,,,,,,890000,,,1211,-82.52186,27.958998',
    )).candidates;

    expect(candidate!.propertyType).toBe('Land');
    expect(candidate!.propertySubtype).toBe('Commercial, Residential');
  });

  it('refuses a file whose columns mean nothing rather than importing blanks', () => {
    expect(() => parseCandidateCsv('a report\nof no columns\nat all')).toThrow();
  });
});

/* ========================================================================== */
/* Workbook reading                                                           */
/* ========================================================================== */

/** A stored (uncompressed) ZIP, which is all `readXlsxRows` needs to open. */
function zip(files: Array<[string, string]>): Buffer {
  const locals: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;

  for (const [name, content] of files) {
    const nameBuf = Buffer.from(name, 'utf8');
    const data = Buffer.from(content, 'utf8');

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 8); // stored
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    locals.push(local, nameBuf, data);

    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(0, 10); // stored
    entry.writeUInt32LE(data.length, 20);
    entry.writeUInt32LE(data.length, 24);
    entry.writeUInt16LE(nameBuf.length, 28);
    entry.writeUInt32LE(offset, 42);
    central.push(entry, nameBuf);

    offset += local.length + nameBuf.length + data.length;
  }

  const body = Buffer.concat(locals);
  const directory = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(directory.length, 12);
  eocd.writeUInt32LE(body.length, 16);

  return Buffer.concat([body, directory, eocd]);
}

/**
 * A workbook shaped like Crexi's: every tag namespace-PREFIXED, a banner above
 * the header row, and empty cells written self-closing rather than omitted.
 */
function workbook(sheetRows: string): Buffer {
  const strings = [
    '3 properties found', 'Property Link', 'Property Name', 'Address', 'City', 'State',
    'Asking Price', 'https://www.crexi.com/properties/9', 'Test Plaza', '1 Main St', 'Tampa',
  ];
  return zip([
    ['xl/workbook.xml',
      '<x:workbook><x:sheets><x:sheet name="S" sheetId="1" r:id="rId1"/></x:sheets></x:workbook>'],
    ['xl/_rels/workbook.xml.rels',
      '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>'],
    ['xl/sharedStrings.xml',
      `<x:sst>${strings.map((s) => `<x:si><x:t>${s}</x:t></x:si>`).join('')}</x:sst>`],
    ['xl/worksheets/sheet1.xml', `<x:worksheet><x:sheetData>${sheetRows}</x:sheetData></x:worksheet>`],
  ]);
}

const CREXI_SHEET = [
  // Banner row: the merged cells after A1 are self-closing and carry no index.
  '<x:row r="1"><x:c r="A1" t="s"><x:v>0</x:v></x:c><x:c r="B1" s="1" t="s"/></x:row>',
  `<x:row r="2">${
    ['A', 'B', 'C', 'D', 'E', 'F']
      .map((col, i) => `<x:c r="${col}2" t="s"><x:v>${i + 1}</x:v></x:c>`).join('')
  }</x:row>`,
  // State (E3) is empty and self-closing, and the asking price follows it.
  '<x:row r="3">'
  + '<x:c r="A3" t="s"><x:v>7</x:v></x:c>'
  + '<x:c r="B3" t="s"><x:v>8</x:v></x:c>'
  + '<x:c r="C3" t="s"><x:v>9</x:v></x:c>'
  + '<x:c r="D3" t="s"><x:v>10</x:v></x:c>'
  + '<x:c r="E3" s="1" t="s"/>'
  + '<x:c r="F3" t="n"><x:v>890000</x:v></x:c>'
  + '</x:row>',
].join('');

describe('xlsx reading', () => {
  it('reads a namespace-prefixed workbook that tag-name-matching libraries cannot', () => {
    const rows = readXlsxRows(workbook(CREXI_SHEET));

    expect(rows[1]).toEqual([
      'Property Link', 'Property Name', 'Address', 'City', 'State', 'Asking Price',
    ]);
  });

  it('keeps the value after a self-closing cell instead of swallowing it', () => {
    // Regression: a body group that scanned past `/>` consumed the NEXT cell's
    // <v> and its closing tag, silently dropping a real asking price.
    const rows = readXlsxRows(workbook(CREXI_SHEET));

    expect(rows[2]![4]).toBe('');       // the empty, self-closing cell
    expect(rows[2]![5]).toBe('890000'); // the price that followed it
  });

  it('leaves an empty shared-string cell empty rather than reusing the first string', () => {
    // Regression: Number('') === 0 previously resolved to shared string #0, so
    // every blank cell on the banner row repeated the banner text.
    const rows = readXlsxRows(workbook(CREXI_SHEET));

    expect(rows[0]![0]).toBe('3 properties found');
    expect(rows[0]![1]).toBe('');
  });

  it('imports a workbook end to end, finding the header below the banner', () => {
    const parsed = parseCandidateXlsx(workbook(CREXI_SHEET));

    expect(parsed.headerRowNumber).toBe(2);
    expect(parsed.candidates).toHaveLength(1);
    expect(parsed.candidates[0]!.askingPrice).toBe(890000);
    expect(parsed.candidates[0]!.state).toBeNull();
    expect(parsed.candidates[0]!.sources[0]!.url).toBe('https://www.crexi.com/properties/9');
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
