// SPDX-License-Identifier: AGPL-3.0-only
import fs from 'node:fs';
import path from 'node:path';
import { createTranslator } from 'next-intl';
import { describe, expect, it } from 'vitest';
import { loadMessages } from '@/i18n/messages';
import { issueLine, issueText, splitData } from './issueMessage';

// The api's English lines, as imports_validate.go writes them, and the seeded ones
const LINES: readonly (readonly [string, string | null])[] = [
  ['Column CaseNumber is missing from the header row.', 'CaseNumber'],
  ['Registration time is empty.', 'RegisteredTime'],
  ['SubZoneID 99999 is not in the locations or case types: add it in Admin, or correct the row.', 'SubZoneID'],
  ['ZoneID 2099 is not in the locations.', 'ZoneID'],
  ['CityName "riyadh" differs from "Riyadh" only in capitals; ids are used, so nothing changes.', 'CityName'],
  ['City name "JEDDAH" has inconsistent capitals; joined on CityID instead.', 'CityName'],
  ['CaseType "Theft" is not one of Customer, Unlisted: the case is imported without it.', 'CaseType'],
  ['Severity "tiny" is not one of minor, moderate, severe.', 'Severity'],
  ['Latitude "abc" is not a number.', 'Latitude'],
  ['ClaimValue -5 is below 0.', 'ClaimValue'],
  ['Latitude 247.0 is outside -90 to 90.', 'Latitude'],
  ['RegisteredTime "yesterday" is not a date and time: use YYYY-MM-DD HH:MM:SS (Riyadh time) or ISO 8601.', 'RegisteredTime'],
  ['PartiesInvolved "x" is not a whole number of 0 or more.', 'PartiesInvolved'],
  ['PartiesInvolved "4294967298" is too large: use 2147483647 or less.', 'PartiesInvolved'],
  ['Only 1 party involved.', 'PartiesInvolved'],
  ['Only 0 parties involved.', 'PartiesInvolved'],
  ['1 parties involved. Meaning to be confirmed by the operator.', 'PartiesInvolved'],
  ['CaseNumber "123" does not start with a two-letter city code.', 'CaseNumber'],
  ['RecordID 778 is also on row 4; one row per RecordID is imported (the first without errors).', 'RecordID'],
  ['RecordID appears twice in the file.', 'RecordID'],
  ['Assigned 64 minutes before it was registered.', 'AssignedTime'],
  ['Assigned 4 minutes before it was registered (Unlisted case).', 'AssignedTime'],
  ['AssignedTime is empty but ArrivalTime is set: the case counts as remote (inferred).', 'AssignedTime'],
  ['Registered 2027-01-02 10:00, in the future.', 'RegisteredTime'],
  ['Arrived before the case was registered.', 'ArrivalTime'],
  ['Arrived 30 hours after registration (outlier: over 24).', 'ArrivalTime'],
  ['Closed before the case was registered.', 'ClosingTime'],
  ['Closed 90 days after registration (outlier: over 60).', 'ClosingTime'],
  ['2026-09-10 has 900 cases against a median of 300 a day: a missing or doubled extract? (outlier)', 'RegisteredTime'],
  ['Latitude 46.7, Longitude 24.7 is 812 km from sub-zone 1101 (Olaya): swapped or empty coordinates? The case keeps them.', 'Latitude'],
  ['Latitude 10.0, Longitude 10.0 is outside the service area: the case keeps them.', 'Latitude'],
  ['3 empty lines were skipped (the first is line 7).', null],
  ['1 empty line was skipped (the first is line 7).', null],
  ['The file is empty: it needs a header row.', null],
  ['The file has a header row and no data rows.', null],
  ['45 rows in all like row 3 (Arrived 30 hours after registration (outlier: over 24)) Only the first 20 are listed.', 'ArrivalTime'],
  ['45 rows in all (Column CaseNumber is missing from the header row) Only the first 20 are listed.', 'CaseNumber'],
];

const t = (locale: 'en' | 'ar') => {
  const m = createTranslator({ locale, messages: loadMessages(locale, 'admin.data_import_quality'), namespace: 'admin.data_import_quality' });
  return (line: string, field: string | null) => issueLine((key, values) => m(key as never, values as never), issueText(line, field)!);
};

describe('issueText', () => {
  it('knows every line the api writes', () => {
    const unknown = LINES.filter(([line, field]) => issueText(line, field) === null).map(([line]) => line);
    expect(unknown).toEqual([]);
  });

  it('gives the English line back in English, except the empty-column and seeded parties lines', () => {
    const en = t('en');
    for (const [line, field] of LINES) {
      const key = issueText(line, field)!.key;
      if (key === 'empty' || key === 'partiesToConfirm') continue;
      expect(en(line, field), line).toBe(line);
    }
  });

  it('writes every line in Arabic with its values', () => {
    const ar = t('ar');
    for (const [line, field] of LINES) {
      const text = ar(line, field);
      expect(/[؀-ۿ]/.test(text), text).toBe(true);
      expect(text).not.toContain('{');
      expect(text).not.toMatch(/ (is|are|was|the|of) /);
    }
    expect(ar('Latitude 247.0 is outside -90 to 90.', 'Latitude')).toBe('القيمة 247.0 في Latitude خارج النطاق من -90 إلى 90.');
    expect(ar('Assigned 64 minutes before it was registered.', 'AssignedTime')).toBe('أُسند البلاغ قبل تسجيله بمدة 64 دقيقة.');
  });

  it('marks every Latin value in an Arabic line as data, so none is left outside it', () => {
    const m = createTranslator({ locale: 'ar', messages: loadMessages('ar', 'admin.data_import_quality'), namespace: 'admin.data_import_quality' });
    for (const [line, field] of LINES) {
      const marked = issueLine((key, values) => m(key as never, values as never), issueText(line, field)!, true);
      const prose = splitData(marked).filter((part) => !part.data).map((part) => part.text).join('');
      expect(prose, line).not.toMatch(/[A-Za-z]{3}/);
      expect(splitData(marked).map((part) => part.text).join(''), line).toBe(t('ar')(line, field));
    }
  });

  it('leaves an unknown line alone', () => {
    expect(issueText('Something new happened.', null)).toBeNull();
  });

  // One raise is the CSV reader's own error: English
  it('covers every message format in the api source', () => {
    const go = fs.readFileSync(path.join(import.meta.dirname, '../../../../../api-go/internal/business/imports_validate.go'), 'utf8');
    const raised = [...go.matchAll(/v\.raise\(/g)].length;
    expect(raised).toBe(29);
  });
});
