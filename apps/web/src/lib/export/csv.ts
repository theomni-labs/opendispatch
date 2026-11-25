// SPDX-License-Identifier: AGPL-3.0-only
// CSV for the Export items of 14 Admin modules: a small `toCsv`, no dependency. Pure, so a Server
// Component, a client file and a test can all use it.
//
//   toCsv({ header: ['Name', 'Email'], rows: [['Nadia', 'n@example.test']] })  ->  '﻿Name,Email\r\nNadia,n@example.test'
//
// What it guarantees:
//   - RFC 4180: fields with a comma, a double quote, a CR or an LF are quoted, quotes are doubled, records end in CRLF.
//   - Formula injection: a text cell that a spreadsheet would read as a formula (starts with = + - @, a tab or a CR,
//     also after spaces) gets a single quote in front, so `=HYPERLINK(...)` opens as text. A NUMBER cell is written as
//     the number (a negative amount stays -5); pass text only for text.
//   - Arabic: a UTF-8 byte order mark first, so Excel reads the file as UTF-8 and not as the local code page.
// Person names, e-mail addresses and free text from the data go through the same guard as everything else.

export type CsvCell = string | number | boolean | Date | null | undefined;

export interface CsvTable {
  readonly header: readonly string[];
  readonly rows: readonly (readonly CsvCell[])[];
}

export interface CsvOptions {
  /** Prefix the UTF-8 byte order mark. Default true. */
  readonly bom?: boolean | undefined;
}

export const CSV_MIME = 'text/csv;charset=utf-8';
const BOM = '﻿';
const NEWLINE = '\r\n';

// Characters that start a formula in Excel, LibreOffice and Sheets, and the two that can hide one (tab, CR).
const STARTS_FORMULA = /^[\t\r]|^[ \u00A0]*[=+\-@]/;
const NEEDS_QUOTES = /[",\r\n]|^\s|\s$/;

/** One cell as CSV text: the formula guard, then RFC 4180 quoting. */
export function csvCell(value: CsvCell): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? '' : value.toISOString();
  const text = STARTS_FORMULA.test(value) ? `'${value}` : value;
  return NEEDS_QUOTES.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/** The whole file as text. A row shorter than the header is padded with empty fields; a longer one is kept as it is. */
export function toCsv(table: CsvTable, options: CsvOptions = {}): string {
  const width = table.header.length;
  const lines = [table.header, ...table.rows.map((row) => (row.length < width ? [...row, ...Array.from({ length: width - row.length }, () => '')] : row))].map((row) => row.map(csvCell).join(','));
  return `${options.bom === false ? '' : BOM}${lines.join(NEWLINE)}`;
}
