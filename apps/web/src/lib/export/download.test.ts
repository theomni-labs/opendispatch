// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { downloadText, safeFilename, saveCsv } from './download';

type UrlApi = { createObjectURL: (blob: Blob) => string; revokeObjectURL: (url: string) => void };
const url = URL as unknown as UrlApi;

// jsdom has no working Blob content API, so the Blob is stood in for: the test sees exactly what downloadText gave it.
class RecordingBlob {
  static made: RecordingBlob[] = [];
  readonly parts: readonly BlobPart[];
  readonly type: string;
  constructor(parts: readonly BlobPart[] = [], options: BlobPropertyBag = {}) {
    this.parts = parts;
    this.type = options.type ?? '';
    RecordingBlob.made.push(this);
  }
  get text(): string {
    return this.parts.join('');
  }
}

let clicked: { href: string; download: string; rel: string }[];

beforeEach(() => {
  clicked = [];
  RecordingBlob.made = [];
  vi.stubGlobal('Blob', RecordingBlob);
  url.createObjectURL = vi.fn(() => 'blob:opendispatch-test');
  url.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function click(this: HTMLAnchorElement) {
    clicked.push({ href: this.href, download: this.download, rel: this.rel });
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const blob = () => RecordingBlob.made[0];

describe('downloadText', () => {
  it('saves the text through a Blob and an anchor with a download name, then frees the URL', async () => {
    downloadText({ filename: 'users.csv', mime: 'text/csv;charset=utf-8', text: 'a,b' });
    expect(clicked).toEqual([{ href: 'blob:opendispatch-test', download: 'users.csv', rel: 'noopener' }]);
    expect(blob()?.type).toBe('text/csv;charset=utf-8');
    expect(blob()?.text).toBe('\uFEFFa,b'); // a CSV always carries its byte order mark (see below)
    expect(document.querySelector('a[download]')).toBeNull();
    // Freed on the next task, not before the download has started.
    expect(url.revokeObjectURL).not.toHaveBeenCalled();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(url.revokeObjectURL).toHaveBeenCalledWith('blob:opendispatch-test');
  });

  it('hands the Blob the byte order mark and the Arabic text unchanged', () => {
    downloadText({ filename: 'x.csv', mime: 'text/csv', text: '﻿الاسم' });
    const bytes = new TextEncoder().encode(blob()?.text ?? '');
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect([...bytes.slice(3, 5)]).toEqual([0xd8, 0xa7]); // alef, the first Arabic letter, in UTF-8
  });

  it('puts back the byte order mark a CSV lost in the server action answer, once, and leaves other files alone', () => {
    // The Flight reader drops a leading U+FEFF of a long text row, so a CSV from a server action can arrive without it.
    downloadText({ filename: 'a.csv', mime: 'text/csv;charset=utf-8', text: 'الاسم\r\nنادية' });
    // Spread to a plain array: jsdom's TextEncoder returns a Uint8Array from another realm, and Vitest's toEqual can
    // treat two same-valued typed arrays from different realms as unequal.
    expect([...new TextEncoder().encode(blob()?.text ?? '').slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(blob()?.text).toBe('\uFEFFالاسم\r\nنادية');
    // one that still has it is not given a second one
    downloadText({ filename: 'b.csv', mime: 'text/csv', text: '\uFEFFa,b' });
    expect(RecordingBlob.made[1]?.text).toBe('\uFEFFa,b');
    // a file that is not a CSV is saved as it is
    downloadText({ filename: 'c.json', mime: 'application/json', text: '{"a":1}' });
    expect(RecordingBlob.made[2]?.text).toBe('{"a":1}');
  });

  it('downgrades a mime type that is not a plain type to a binary download', () => {
    downloadText({ filename: 'x', mime: 'text/html; <script>', text: '<script>alert(1)</script>' });
    expect(blob()?.type).toBe('application/octet-stream');
  });

  it('cleans a file name from the server: no path, no control characters, never empty', () => {
    downloadText({ filename: '../../etc/passwd', mime: 'text/plain', text: '' });
    downloadText({ filename: 'a\u0000b\nc.csv', mime: 'text/plain', text: '' });
    downloadText({ filename: '', mime: 'text/plain', text: '' });
    expect(clicked.map((c) => c.download)).toEqual(['_.._etc_passwd', 'a_b_c.csv', 'export']);
  });
});

describe('safeFilename', () => {
  it('drops leading dots, replaces Windows-reserved characters and cuts to 120 characters', () => {
    expect(safeFilename('.hidden')).toBe('hidden');
    expect(safeFilename('a:b*c?"d<e>f|g')).toBe('a_b_c__d_e_f_g');
    expect(safeFilename('x'.repeat(300))).toHaveLength(120);
    expect(safeFilename('   ')).toBe('export');
    expect(safeFilename('المستخدمون.csv')).toBe('المستخدمون.csv');
  });
});

describe('saveCsv', () => {
  it('builds the CSV and saves it as text/csv, with the formula guard applied', () => {
    saveCsv('users.csv', { header: ['Name'], rows: [['=evil']] });
    expect(clicked[0]?.download).toBe('users.csv');
    expect(blob()?.type).toBe('text/csv;charset=utf-8');
    expect(blob()?.text).toBe("﻿Name\r\n'=evil");
  });

  it('leaves the byte order mark out when the table is asked for without it', () => {
    saveCsv('plain.csv', { header: ['Name'], rows: [['x']] }, { bom: false });
    expect(blob()?.text).toBe('Name\r\nx');
  });
});
