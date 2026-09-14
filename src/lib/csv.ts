/**
 * Pure CSV encoding and decoding. No database or environment dependencies, so it
 * can be unit tested directly and reused by both export and import.
 */

/**
 * Encodes one cell, RFC 4180 style.
 *
 * Spreadsheet formula injection is guarded, but not at the cost of mangling real
 * data: a plain negative number such as a longitude of -82.0812 must survive the
 * round trip so an exported sheet can be re-imported for reconciliation. Only a
 * value that starts with a formula character AND is not a valid number is escaped.
 */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const s = value instanceof Date ? value.toISOString() : String(value);

  const startsFormula = /^[=+@\t\r]/.test(s) || s.startsWith('-');
  const isPlainNumber = Number.isFinite(Number(s)) && s.trim() !== '';
  const safe = startsFormula && !isPlainNumber ? `'${s}` : s;

  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function toCsv(headers: string[], rows: Array<Array<unknown>>): string {
  const lines = [headers.map(csvCell).join(',')];
  for (const row of rows) lines.push(row.map(csvCell).join(','));
  // A BOM so Excel on Windows opens UTF-8 correctly.
  return `﻿${lines.join('\r\n')}\r\n`;
}

/**
 * Parses CSV text into rows of strings.
 *
 * Handles quoted fields, escaped quotes, embedded newlines and commas, CRLF or
 * LF line endings, and a leading BOM. Deliberately does not coerce types — every
 * value stays a string until the import validator decides what it should be.
 */
export function parseCsv(text: string): string[][] {
  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;

  const endField = () => { row.push(field); field = ''; };
  const endRow = () => {
    endField();
    // Skip rows that are entirely empty, which trailing newlines produce.
    if (row.some((c) => c.trim() !== '')) rows.push(row);
    row = [];
  };

  while (i < input.length) {
    const ch = input[i]!;

    if (inQuotes) {
      if (ch === '"') {
        if (input[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }

    if (ch === '"') { inQuotes = true; i++; continue; }
    if (ch === ',') { endField(); i++; continue; }
    if (ch === '\r') { if (input[i + 1] === '\n') i++; endRow(); i++; continue; }
    if (ch === '\n') { endRow(); i++; continue; }

    field += ch;
    i++;
  }

  // Whatever is left after the final line ending.
  if (field !== '' || row.length > 0) endRow();
  return rows;
}

/** Normalises a header cell so "Mall Name", "mall_name" and "MALL NAME" all match. */
export const normaliseHeader = (h: string): string =>
  h.trim().toLowerCase().replace(/^'/, '').replace(/[\s-]+/g, '_').replace(/[^a-z0-9_]/g, '');

/** Strips the leading apostrophe that csvCell adds to formula-looking values. */
export const unescapeCell = (v: string): string => (v.startsWith("'") ? v.slice(1) : v);
