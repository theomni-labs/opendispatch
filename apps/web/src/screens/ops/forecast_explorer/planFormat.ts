// SPDX-License-Identifier: AGPL-3.0-only
// The customer plan format: pure. See docs/adr/0018.
import type { CsvCell, CsvTable } from '@/lib/export/csv';

export const WINDOWS = 48;
const FIRST_WINDOW_MINUTE = 6 * 60;
const INTERVALS_PER_DAY = 96;

export type SegmentKey = 'weekdays' | 'thursday' | 'friday' | 'saturday';

export const SEGMENT_ORDER: readonly SegmentKey[] = ['weekdays', 'thursday', 'friday', 'saturday'];
export const SEGMENT_NAMES: Readonly<Record<SegmentKey, string>> = { weekdays: 'Weekdays', thursday: 'Thursday', friday: 'Friday', saturday: 'Saturday' };

/** One calendar day of 96 fifteen-minute zone values; spread is the summed squared (high - expected) of its sub-zones. */
export interface DayValues {
  readonly date: string;
  readonly expected: readonly number[];
  readonly spread: readonly number[];
}

/** Per interval: the sum over sub-zones of (high - expected) squared. */
export function spreadOf(rows: readonly { readonly interval_index: number; readonly expected: number; readonly high: number }[]): number[] {
  const out = new Array<number>(INTERVALS_PER_DAY).fill(0);
  for (const row of rows) {
    if (row.interval_index < 0 || row.interval_index >= INTERVALS_PER_DAY) continue;
    const gap = Math.max(0, row.high - row.expected);
    out[row.interval_index] = (out[row.interval_index] ?? 0) + gap * gap;
  }
  return out;
}

export interface PlanSegment {
  readonly key: SegmentKey;
  readonly name: string;
  readonly days: number;
  readonly average: readonly number[];
  readonly needed: readonly number[];
  readonly neededHigh: readonly number[];
}

const pad = (n: number): string => String(n).padStart(2, '0');

/** The 48 window labels, 06:00 first, 05:30 last. */
export const WINDOW_LABELS: readonly string[] = Array.from({ length: WINDOWS }, (_, k) => {
  const minute = (FIRST_WINDOW_MINUTE + 30 * k) % 1440;
  return `${pad(Math.floor(minute / 60))}:${pad(minute % 60)}`;
});

const WEEKDAY_FORMAT = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: 'Asia/Riyadh' });

/** Sunday to Wednesday share one segment; the day is the Riyadh one. */
export function segmentOf(date: string): SegmentKey {
  const name = WEEKDAY_FORMAT.format(new Date(`${date}T12:00:00+03:00`));
  if (name === 'Thu') return 'thursday';
  if (name === 'Fri') return 'friday';
  if (name === 'Sat') return 'saturday';
  return 'weekdays';
}

export function nextDate(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** Cases per window of one planning day: two intervals summed, after midnight from the next date. */
function windowsOf(first: readonly number[], second: readonly number[]): number[] {
  return Array.from({ length: WINDOWS }, (_, k) => {
    const start = FIRST_WINDOW_MINUTE + 30 * k;
    const source = start < 1440 ? first : second;
    const index = (start % 1440) / 15;
    return (source[index] ?? 0) + (source[index + 1] ?? 0);
  });
}

/** The average rounded up, with a guard for float noise. */
export function neededOf(average: number): number {
  return Math.max(0, Math.ceil(average - 1e-9));
}

/** A planning day counts only when its date and the next date are both given. The high is approximate: see. */
export function buildPlan(days: readonly DayValues[]): PlanSegment[] {
  const byDate = new Map(days.filter((d) => d.expected.length === INTERVALS_PER_DAY && d.spread.length === INTERVALS_PER_DAY).map((d) => [d.date, d] as const));
  const sums = new Map<SegmentKey, { n: number; expected: number[]; high: number[] }>();
  for (const [date, day] of byDate) {
    const next = byDate.get(nextDate(date));
    if (next === undefined) continue;
    const key = segmentOf(date);
    const acc = sums.get(key) ?? { n: 0, expected: new Array<number>(WINDOWS).fill(0), high: new Array<number>(WINDOWS).fill(0) };
    const e = windowsOf(day.expected, next.expected);
    const s = windowsOf(day.spread, next.spread);
    for (let k = 0; k < WINDOWS; k += 1) {
      acc.expected[k] = (acc.expected[k] ?? 0) + (e[k] ?? 0);
      // independent parts: margins add in quadrature
      acc.high[k] = (acc.high[k] ?? 0) + (e[k] ?? 0) + Math.sqrt(s[k] ?? 0);
    }
    acc.n += 1;
    sums.set(key, acc);
  }
  return SEGMENT_ORDER.flatMap((key) => {
    const acc = sums.get(key);
    if (acc === undefined) return [];
    const average = acc.expected.map((v) => v / acc.n);
    const averageHigh = acc.high.map((v) => v / acc.n);
    return [{ key, name: SEGMENT_NAMES[key], days: acc.n, average, needed: average.map(neededOf), neededHigh: averageHigh.map(neededOf) }];
  });
}

export interface PlanLabels {
  readonly zoneLabel: string;
  readonly zoneName: string;
  readonly notes: readonly string[];
  /** Said when no segment has a full planning day. */
  readonly empty: string;
}

/** Plain dot decimals, at most 2 places, no separators. */
function plain(value: number): number {
  const rounded = Math.round(value * 100) / 100;
  return Object.is(rounded, -0) ? 0 : rounded;
}

const sum = (values: readonly number[]): number => values.reduce((s, v) => s + v, 0);

/** The sheet as rows: zone, three blocks (average, needed, needed high), then the note rows. */
export function planRows(plan: readonly PlanSegment[], labels: PlanLabels): CsvCell[][] {
  const block = (title: string, pick: (s: PlanSegment) => readonly number[]): CsvCell[][] => [
    [title, ...WINDOW_LABELS, 'Total'],
    ...plan.map((s) => [s.name, ...pick(s).map(plain), plain(sum(pick(s)))]),
    [],
  ];
  return [
    [labels.zoneLabel, labels.zoneName],
    [],
    ...block('AVERAGE CASES', (s) => s.average),
    ...block('NEEDED STAFF', (s) => s.needed),
    ...block('NEEDED STAFF (HIGH ESTIMATE)', (s) => s.neededHigh),
    ...(plan.length === 0 ? [[labels.empty]] : []),
    ...labels.notes.map((note) => [note]),
  ];
}

/** The same rows as a CSV table: the zone row is the header. */
export function planTable(plan: readonly PlanSegment[], labels: PlanLabels): CsvTable {
  return { header: [labels.zoneLabel, labels.zoneName], rows: planRows(plan, labels).slice(1) };
}
