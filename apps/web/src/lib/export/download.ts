// SPDX-License-Identifier: AGPL-3.0-only
// Saving a file from the browser: a Blob and an anchor with `download`. No route handler is added: an export is
// a server action that returns `{ filename, mime, text }` (an ExportFile) or, for the rows already on screen, a client CSV, and
// the browser saves it here. Browser only (`document`, `URL.createObjectURL`); call it from an event handler.

import { CSV_MIME, toCsv, type CsvOptions, type CsvTable } from './csv';

/** What an export action returns. `text` is the whole file. */
export interface ExportFile {
  readonly filename: string;
  readonly mime: string;
  readonly text: string;
}

const SAFE_MIME = /^[a-z0-9.+-]+\/[a-z0-9.+-]+(?:;\s*charset=[a-z0-9-]+)?$/i;

/**
 * A file name that cannot climb out of the downloads folder or hide an extension: path separators, control characters and
 * the characters Windows refuses become `_`, leading dots are dropped, at most 120 characters, and never empty.
 */
export function safeFilename(name: string): string {
  const cleaned = Array.from(name)
    .map((char) => {
      const code = char.codePointAt(0) ?? 0;
      return code < 0x20 || code === 0x7f || '\\/:*?"<>|'.includes(char) ? '_' : char;
    })
    .join('')
    .replace(/^\.+/, '')
    .trim()
    .slice(0, 120);
  return cleaned === '' ? 'export' : cleaned;
}

const BOM = '\uFEFF';
const IS_CSV = /^text\/csv\b/i;

/** The Blob and the anchor: what every save goes through. The text is saved as it is given. */
function save(file: ExportFile): void {
  const blob = new Blob([file.text], { type: SAFE_MIME.test(file.mime) ? file.mime : 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = safeFilename(file.filename);
  anchor.rel = 'noopener';
  anchor.hidden = true;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  // The download has started by the next task; freeing the URL earlier can cancel it in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/**
 * Saves a file a server action built as a download. A CSV always leaves with its UTF-8 byte order mark, so Excel reads the
 * Arabic as UTF-8: `toCsv` writes it, but the action's answer travels as React's Flight stream, whose reader decodes each long
 * text row on its own and drops a leading U+FEFF (a file over about 1,000 characters arrived without it). So it is put back
 * here when it is missing, and never doubled.
 */
export function downloadText(file: ExportFile): void {
  save(IS_CSV.test(file.mime) && !file.text.startsWith(BOM) ? { ...file, text: `${BOM}${file.text}` } : file);
}

/** Builds a CSV from `table` and saves it: the "Export" of the rows on screen. `bom: false` leaves the byte order mark out. */
export function saveCsv(filename: string, table: CsvTable, options?: CsvOptions): void {
  save({ filename, mime: CSV_MIME, text: toCsv(table, options) });
}
