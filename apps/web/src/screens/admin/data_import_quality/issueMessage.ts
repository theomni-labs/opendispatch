// SPDX-License-Identifier: AGPL-3.0-only
// An issue's English line as a message key and values

export interface IssueText {
  /** Key under `msg.` in the module's messages. */
  readonly key: string;
  readonly values: Readonly<Record<string, string | number>>;
  /** A capped summary's example line, itself translated when known. */
  readonly inner?: { readonly raw: string; readonly text: IssueText | null } | undefined;
}

const CAPPED = /^(\d+) rows in all(?: like row (\d+))? \((.+)\) Only the first (\d+) are listed\.$/;

type Rule = readonly [key: string, pattern: RegExp, names: readonly string[]];

const Q = '"([^"]*)"';

// Order matters: the first match wins
const RULES: readonly Rule[] = [
  ['headerMissing', /^Column (\S+) is missing from the header row\.$/, ['col']],
  ['empty', /^.+ is empty\.$/, []],
  ['unknownRef', /^(\S+) (.+?) is not in the locations or case types: add it in Admin, or correct the row\.$/, ['col', 'value']],
  ['unknownLocation', /^(\S+) (.+?) is not in the locations\.$/, ['col', 'value']],
  ['nameCase', new RegExp(`^(\\S+) ${Q} differs from ${Q} only in capitals; ids are used, so nothing changes\\.$`), ['col', 'value', 'known']],
  ['cityCase', new RegExp(`^City name ${Q} has inconsistent capitals; joined on CityID instead\\.$`), ['value']],
  ['notAllowed', new RegExp(`^(\\S+) ${Q} is not one of (.+): the case is imported without it\\.$`), ['col', 'value', 'list']],
  ['notOneOf', new RegExp(`^(\\S+) ${Q} is not one of (.+)\\.$`), ['col', 'value', 'list']],
  ['notNumber', new RegExp(`^(\\S+) ${Q} is not a number\\.$`), ['col', 'value']],
  ['below', /^(\S+) (\S+) is below (\S+)\.$/, ['col', 'value', 'min']],
  ['outside', /^(\S+) (\S+) is outside (\S+) to (\S+)\.$/, ['col', 'value', 'min', 'max']],
  ['notDateTime', new RegExp(`^(\\S+) ${Q} is not a date and time: .+$`), ['col', 'value']],
  ['notWhole', new RegExp(`^(\\S+) ${Q} is not a whole number of (\\S+) or more\\.$`), ['col', 'value', 'min']],
  ['parties', /^Only (\d+) part(?:y|ies) involved\.$/, ['n']],
  ['partiesToConfirm', /^(\d+) parties involved\. Meaning to be confirmed by (?:the operator|Customer)\.$/, ['n']],
  ['caseNumber', new RegExp(`^CaseNumber ${Q} does not start with a two-letter city code\\.$`), ['value']],
  ['duplicate', /^RecordID (\S+) is also on row (\d+); .+$/, ['value', 'row']],
  ['duplicateInFile', /^RecordID appears twice in the file\.$/, []],
  ['assignedBefore', /^Assigned (\d+) minutes? before it was registered\.$/, ['n']],
  ['assignedBeforeType', /^Assigned (\d+) minutes? before it was registered \((\S+) case\)\.$/, ['n', 'type']],
  ['arrivedNoAssign', /^AssignedTime is empty but ArrivalTime is set: .+$/, []],
  ['future', /^Registered (.+), in the future\.$/, ['at']],
  ['arrivedBefore', /^Arrived before the case was registered\.$/, []],
  ['arrivedLate', /^Arrived (\d+) hours after registration \(outlier: over (\d+)\)\.$/, ['n', 'max']],
  ['closedBefore', /^Closed before the case was registered\.$/, []],
  ['closedLate', /^Closed (\d+) days after registration \(outlier: over (\d+)\)\.$/, ['n', 'max']],
  ['dayOutlier', /^(\S+) has (\d+) cases against a median of (\d+) a day: .+$/, ['date', 'n', 'median']],
  ['farFromSubZone', /^Latitude (\S+), Longitude (\S+) is (\d+) km from sub-zone (\S+) \((.+)\): .+$/, ['lat', 'lon', 'km', 'sub', 'name']],
  ['outsideArea', /^Latitude (\S+), Longitude (\S+) is outside the service area: .+$/, ['lat', 'lon']],
  ['blankLines', /^(\d+) empty lines? (?:was|were) skipped \(the first is line (\d+)\)\.$/, ['n', 'first']],
  ['fileEmpty', /^The file is empty: it needs a header row\.$/, []],
  ['noDataRows', /^The file has a header row and no data rows\.$/, []],
];

const NUMERIC = new Set(['n', 'row', 'max', 'median', 'km', 'first']);

type Translate = (key: string, values: Record<string, string | number>) => string;

// Column names and formats the lines name
const FIXED: Readonly<Record<string, string>> = {
  cityId: 'CityID',
  idCol: 'RecordID',
  assignedCol: 'AssignedTime',
  arrivalCol: 'ArrivalTime',
  format: 'YYYY-MM-DD HH:MM:SS',
  iso: 'ISO 8601',
};

// Values that are data: kept as written
const DATA = new Set(['col', 'field', 'value', 'known', 'list', 'type', 'sub', 'name', ...Object.keys(FIXED)]);

/** Marks a data value inside a translated line. */
export const MARK = '\u0001';

/** The line's parts; odd ones are data. */
export function splitData(text: string): { readonly text: string; readonly data: boolean }[] {
  return text.split(MARK).map((part, i) => ({ text: part, data: i % 2 === 1 })).filter((part) => part.text !== '');
}

/** The translated line; `marked` marks data. */
export function issueLine(m: Translate, known: IssueText, marked = false): string {
  const wrap = (v: string): string => (marked ? `${MARK}${v}${MARK}` : v);
  const values = Object.fromEntries(Object.entries({ ...FIXED, ...known.values }).map(([k, v]) => [k, DATA.has(k) && typeof v === 'string' ? wrap(v) : v]));
  const inner = known.inner;
  if (inner === undefined) return m(`imsg.${known.key}`, values);
  const example = inner.text === null ? wrap(inner.raw) : issueLine(m, inner.text, marked).replace(/\.$/, '');
  return m(`imsg.${known.key}`, { ...values, inner: example });
}

/** The translated form of an issue line, or null: then the English line shows as it is. */
export function issueText(message: string, field: string | null): IssueText | null {
  const text = message.trim();
  const capped = CAPPED.exec(text);
  if (capped !== null) {
    const [, n = '0', row, raw = '', max = '0'] = capped;
    const values = { field: field ?? '-', n: Number(n), max: Number(max), ...(row === undefined ? {} : { row: Number(row) }) };
    return { key: row === undefined ? 'capped' : 'cappedLike', values, inner: { raw, text: issueText(`${raw}.`, field) } };
  }
  for (const [key, pattern, names] of RULES) {
    const match = pattern.exec(text);
    if (match === null) continue;
    const values: Record<string, string | number> = { field: field ?? '-' };
    names.forEach((name, i) => {
      const raw = match[i + 1] ?? '';
      values[name] = NUMERIC.has(name) ? Number(raw) : raw;
    });
    return { key, values };
  }
  return null;
}
