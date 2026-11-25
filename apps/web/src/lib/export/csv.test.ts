// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { CSV_MIME, csvCell, toCsv } from './csv';

const BOM = '﻿';

describe('toCsv: the format', () => {
  it('writes a header and rows, records ending in CRLF, the byte order mark first', () => {
    expect(toCsv({ header: ['Name', 'Email'], rows: [['Nadia', 'n@example.test'], ['Fahad', 'f@example.test']] })).toBe(`${BOM}Name,Email\r\nNadia,n@example.test\r\nFahad,f@example.test`);
  });

  it('can leave the byte order mark out', () => {
    expect(toCsv({ header: ['a'], rows: [['1']] }, { bom: false })).toBe('a\r\n1');
  });

  it('has a header row even when there are no rows', () => {
    expect(toCsv({ header: ['a', 'b'], rows: [] }, { bom: false })).toBe('a,b');
  });

  it('pads a short row to the header width and keeps a long one', () => {
    expect(toCsv({ header: ['a', 'b', 'c'], rows: [['1'], ['1', '2', '3', '4']] }, { bom: false })).toBe('a,b,c\r\n1,,\r\n1,2,3,4');
  });

  it('is readable as UTF-8 Arabic with the byte order mark', () => {
    const text = toCsv({ header: ['الاسم'], rows: [['نادية']] });
    expect(text.startsWith(BOM)).toBe(true);
    expect(new TextDecoder('utf-8').decode(new TextEncoder().encode(text))).toContain('نادية');
    expect([...new TextEncoder().encode(text).slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  });

  it('names its mime type', () => {
    expect(CSV_MIME).toBe('text/csv;charset=utf-8');
  });
});

describe('csvCell: RFC 4180 quoting', () => {
  it('quotes a field with a comma, a quote, a CR or an LF, and doubles the quotes', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('line1\nline2')).toBe('"line1\nline2"');
    expect(csvCell('line1\r\nline2')).toBe('"line1\r\nline2"');
  });

  it('quotes a field with a leading or trailing space, so it survives a reader that trims', () => {
    expect(csvCell(' x')).toBe('" x"');
    expect(csvCell('x ')).toBe('"x "');
  });

  it('leaves a plain field alone', () => {
    expect(csvCell('Nadia Al-Ghalani')).toBe('Nadia Al-Ghalani');
  });

  it('writes numbers, booleans, dates and missing values', () => {
    expect(csvCell(13)).toBe('13');
    expect(csvCell(-5)).toBe('-5');
    expect(csvCell(0.5)).toBe('0.5');
    expect(csvCell(Number.NaN)).toBe('');
    expect(csvCell(Number.POSITIVE_INFINITY)).toBe('');
    expect(csvCell(true)).toBe('true');
    expect(csvCell(false)).toBe('false');
    expect(csvCell(null)).toBe('');
    expect(csvCell(undefined)).toBe('');
    expect(csvCell(new Date('2026-09-12T05:00:00Z'))).toBe('2026-09-12T05:00:00.000Z');
    expect(csvCell(new Date('nope'))).toBe('');
  });
});

describe('csvCell: formula injection (hostile cells)', () => {
  it.each([
    ['=1+1', "'=1+1"],
    ['=HYPERLINK("http://evil.example","x")', `"'=HYPERLINK(""http://evil.example"",""x"")"`],
    ['+SUM(A1:A2)', "'+SUM(A1:A2)"],
    ['-2+3', "'-2+3"],
    ['@SUM(1)', "'@SUM(1)"],
    ['\t=1', "'\t=1"],
    ['\r=1', `"'\r=1"`],
    ['  =1+1', "'  =1+1"],
    [`${String.fromCharCode(0xa0)}=1+1`, `'${String.fromCharCode(0xa0)}=1+1`],
    ['=cmd|" /C calc"!A0', `"'=cmd|"" /C calc""!A0"`],
  ])('neutralises %j', (cell, expected) => {
    expect(csvCell(cell)).toBe(expected);
  });

  it('does not touch a cell that only contains those characters later on', () => {
    expect(csvCell('a=1')).toBe('a=1');
    expect(csvCell('x-y')).toBe('x-y');
    expect(csvCell('user@example.test')).toBe('user@example.test');
  });

  it('guards the header as well as the rows', () => {
    expect(toCsv({ header: ['=evil'], rows: [['ok']] }, { bom: false })).toBe("'=evil\r\nok");
  });

  it('guards a name from the data: a person called =2+2 opens as text', () => {
    const text = toCsv({ header: ['Name'], rows: [['=2+2'], ['@x']] }, { bom: false });
    expect(text.split('\r\n').slice(1)).toEqual(["'=2+2", "'@x"]);
  });

  it('leaves a negative number a number and a numeric string a guarded string', () => {
    expect(csvCell(-5)).toBe('-5');
    expect(csvCell('-5')).toBe("'-5");
  });
});
