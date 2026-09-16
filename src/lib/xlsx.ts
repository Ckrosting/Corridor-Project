import { inflateRawSync } from 'node:zlib';

/**
 * Minimal read-only .xlsx/.xlsm reader: a workbook's first worksheet as rows of
 * strings, matching what `parseCsv` produces so both feed one importer.
 *
 * Written by hand rather than with `exceljs` (which the project already depends
 * on) because exceljs cannot read the files this exists for. Crexi's "Inventory
 * Export" writes OOXML with the main namespace bound to an `x:` PREFIX
 * (`<x:workbook>`, `<x:sheetData>`), which is perfectly valid XML but which
 * exceljs's transforms match by literal, unprefixed tag name - it parses the
 * workbook to `undefined` and throws before reaching any data. The same is true
 * of every other library-free option here, so the prefix is simply tolerated
 * below. No formatting, formulas or types beyond text and numbers are read:
 * everything is returned as a string and the importer decides what it means.
 */

/* -------------------------------------------------------------------------- */
/* ZIP                                                                        */
/* -------------------------------------------------------------------------- */

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;

/**
 * Extracts a ZIP archive's entries.
 *
 * Reads the central directory rather than walking local headers: a local header
 * may carry zero sizes and defer them to a trailing data descriptor, which
 * cannot be parsed without the directory anyway.
 */
function unzip(buffer: Buffer): Map<string, Buffer> {
  // The end-of-central-directory record is last, but a trailing comment may
  // follow it, so scan backwards for its signature.
  let eocd = -1;
  for (let i = buffer.length - 22; i >= 0 && i >= buffer.length - 22 - 0xffff; i--) {
    if (buffer.readUInt32LE(i) === EOCD_SIGNATURE) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('not a zip archive');

  const count = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);

  const entries = new Map<string, Buffer>();
  for (let i = 0; i < count; i++) {
    if (buffer.readUInt32LE(offset) !== CENTRAL_SIGNATURE) break;

    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.toString('utf8', offset + 46, offset + 46 + nameLength);

    // The local header's own name/extra lengths differ from the directory's.
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const data = buffer.subarray(dataStart, dataStart + compressedSize);

    if (method === 0) entries.set(name, data);
    else if (method === 8) entries.set(name, inflateRawSync(data));

    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

/* -------------------------------------------------------------------------- */
/* XML                                                                        */
/* -------------------------------------------------------------------------- */

/** Matches a tag whether or not the writer bound the namespace to a prefix. */
const tag = (name: string, attrs = '[^>]*') => `<(?:[A-Za-z0-9]+:)?${name}${attrs}>`;

const ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
};

function decodeXml(s: string): string {
  return s.replace(/&(#x?[0-9A-Fa-f]+|[a-z]+);/g, (whole, body: string) => {
    if (body.startsWith('#x') || body.startsWith('#X')) return String.fromCodePoint(parseInt(body.slice(2), 16));
    if (body.startsWith('#')) return String.fromCodePoint(Number(body.slice(1)));
    return ENTITIES[body] ?? whole;
  });
}

/** Concatenated text of every `<t>` inside a fragment - a run-formatted cell has several. */
function textOf(fragment: string): string {
  const parts: string[] = [];
  const re = new RegExp(`${tag('t')}([\\s\\S]*?)</(?:[A-Za-z0-9]+:)?t>`, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(fragment)) !== null) parts.push(decodeXml(m[1]!));
  return parts.join('');
}

function parseSharedStrings(xml: string | undefined): string[] {
  if (!xml) return [];
  const out: string[] = [];
  const re = new RegExp(`${tag('si')}([\\s\\S]*?)</(?:[A-Za-z0-9]+:)?si>`, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) out.push(textOf(m[1]!));
  return out;
}

/** "BC" -> 54. Cell references carry the column, so gaps in a sparse row are kept. */
function columnIndex(ref: string): number {
  const letters = /^([A-Z]+)/.exec(ref)?.[1] ?? 'A';
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function parseSheet(xml: string, sharedStrings: string[]): string[][] {
  const rows: string[][] = [];
  const rowRe = new RegExp(`${tag('row')}([\\s\\S]*?)</(?:[A-Za-z0-9]+:)?row>`, 'g');
  // The two cell forms are ALTERNATIVES, not an optional tail: an empty cell is
  // written `<c r="Q9" t="s"/>`, and letting a body group scan past that `/>`
  // makes it swallow the NEXT cell's <v> - consuming that cell's closing tag
  // too, so the following value silently vanishes from the row. Matching `/>`
  // first keeps a self-closing cell to itself.
  const cellRe = new RegExp(
    `<(?:[A-Za-z0-9]+:)?c\\b([^>]*?)(?:/>|>([\\s\\S]*?)</(?:[A-Za-z0-9]+:)?c>)`,
    'g',
  );

  let rowMatch: RegExpExecArray | null;
  while ((rowMatch = rowRe.exec(xml)) !== null) {
    const row: string[] = [];
    let cellMatch: RegExpExecArray | null;
    cellRe.lastIndex = 0;

    while ((cellMatch = cellRe.exec(rowMatch[1]!)) !== null) {
      const attrs = cellMatch[1]!;
      const body = cellMatch[2] ?? '';
      const ref = /r="([A-Z]+\d+)"/.exec(attrs)?.[1];
      const type = /t="([^"]+)"/.exec(attrs)?.[1] ?? 'n';

      let value: string;
      if (type === 's') {
        // An index is required here: without this guard an empty shared-string
        // cell reads as Number('') === 0 and picks up the FIRST string in the
        // table as though it were the cell's own value.
        const index = new RegExp(`${tag('v')}([\\s\\S]*?)</(?:[A-Za-z0-9]+:)?v>`).exec(body)?.[1];
        value = index === undefined ? '' : sharedStrings[Number(index)] ?? '';
      } else if (type === 'inlineStr') {
        value = textOf(body);
      } else {
        const raw = new RegExp(`${tag('v')}([\\s\\S]*?)</(?:[A-Za-z0-9]+:)?v>`).exec(body)?.[1];
        value = raw === undefined ? '' : decodeXml(raw);
      }

      const at = ref ? columnIndex(ref) : row.length;
      while (row.length < at) row.push('');
      row[at] = value;
    }
    rows.push(row);
  }
  return rows;
}

/* -------------------------------------------------------------------------- */
/* Workbook                                                                   */
/* -------------------------------------------------------------------------- */

/** The path of the workbook's FIRST sheet, which is the one an export puts data on. */
function firstSheetPath(entries: Map<string, Buffer>): string {
  const workbook = entries.get('xl/workbook.xml')?.toString('utf8');
  const relsXml = entries.get('xl/_rels/workbook.xml.rels')?.toString('utf8');

  const relId = workbook ? /<(?:[A-Za-z0-9]+:)?sheet [^>]*r:id="([^"]+)"/.exec(workbook)?.[1] : undefined;
  if (relId && relsXml) {
    const target = new RegExp(`<Relationship [^>]*Id="${relId}"[^>]*Target="([^"]+)"`).exec(relsXml)?.[1]
      ?? new RegExp(`<Relationship [^>]*Target="([^"]+)"[^>]*Id="${relId}"`).exec(relsXml)?.[1];
    if (target) {
      const path = target.replace(/^\/?(xl\/)?/, 'xl/');
      if (entries.has(path)) return path;
    }
  }

  const fallback = [...entries.keys()].filter((k) => /^xl\/worksheets\/sheet\d+\.xml$/.test(k)).sort();
  if (fallback.length === 0) throw new Error('the workbook contains no worksheets');
  return fallback[0]!;
}

/**
 * Reads the first worksheet of an .xlsx/.xlsm file as rows of cell strings.
 *
 * Numbers come back as their stored text, so a date stored as an Excel serial
 * arrives as that serial rather than a date - the importer rejects it as
 * unparseable rather than inventing a date from it.
 */
export function readXlsxRows(buffer: Buffer): string[][] {
  let entries: Map<string, Buffer>;
  try {
    entries = unzip(buffer);
  } catch {
    throw new Error('That file is not a readable Excel workbook.');
  }

  const sharedStrings = parseSharedStrings(entries.get('xl/sharedStrings.xml')?.toString('utf8'));
  const sheet = entries.get(firstSheetPath(entries));
  if (!sheet) throw new Error('That workbook has no readable worksheet.');

  return parseSheet(sheet.toString('utf8'), sharedStrings);
}
