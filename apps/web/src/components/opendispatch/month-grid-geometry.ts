// SPDX-License-Identifier: AGPL-3.0-only
// The pure part of MonthGrid: which days a month grid shows and what each day carries. No React, so a Server Component can build
// the cells and hand them to the client component. Weeks start on Sunday (Saudi Arabia). A Gregorian month is the calendar
// month; a Hijri month is one row of the reference table (`gregorian_start` to `gregorian_end`, 29 or 30 days, Umm al-Qura).

export interface GridHoliday {
  readonly id: string;
  readonly name: string;
  /** `YYYY-MM-DD`, both ends included. */
  readonly from: string;
  readonly to: string;
}

export interface DayContext {
  /** The day to mark as today, `YYYY-MM-DD`. */
  readonly today: string;
  /** Ramadan windows, both ends included. */
  readonly ramadan: readonly { readonly from: string; readonly to: string }[];
  readonly holidays: readonly GridHoliday[];
}

export interface GridCell {
  /** `YYYY-MM-DD`. */
  readonly iso: string;
  /** The day number in the grid's own calendar. */
  readonly day: number;
  /** The day number in the other calendar (Hijri day on a Gregorian grid, Gregorian day on a Hijri grid). */
  readonly secondary: number;
  readonly today: boolean;
  readonly ramadan: boolean;
  /** The first holiday that covers the day. */
  readonly holiday: { readonly id: string; readonly name: string } | null;
}

/** A week of seven cells: `null` for a day of the neighbouring month, which the grid leaves empty. */
export type GridWeek = readonly (GridCell | null)[];

const DAY_MS = 86_400_000;
const at = (iso: string): number => Date.parse(`${iso}T12:00:00Z`);
export const addDays = (iso: string, days: number): string => new Date(at(iso) + days * DAY_MS).toISOString().slice(0, 10);
/** 0 is Sunday. */
const weekdayOf = (iso: string): number => new Date(at(iso)).getUTCDay();

const umalqura = new Intl.DateTimeFormat('en-u-ca-islamic-umalqura-nu-latn', { day: 'numeric', month: 'numeric', year: 'numeric', timeZone: 'UTC' });

/** The Umm al-Qura date of a day. */
export function hijriOf(iso: string): { readonly year: number; readonly month: number; readonly day: number } {
  const parts = Object.fromEntries(umalqura.formatToParts(new Date(at(iso))).map((p) => [p.type, Number.parseInt(p.value, 10)]));
  return { year: parts['year'] as number, month: parts['month'] as number, day: parts['day'] as number };
}

const dayNumber = (iso: string): number => Number.parseInt(iso.slice(8, 10), 10);

function cellOf(iso: string, day: number, secondary: number, context: DayContext): GridCell {
  const holiday = context.holidays.find((h) => h.from <= iso && iso <= h.to);
  return {
    iso,
    day,
    secondary,
    today: iso === context.today,
    ramadan: context.ramadan.some((r) => r.from <= iso && iso <= r.to),
    holiday: holiday === undefined ? null : { id: holiday.id, name: holiday.name },
  };
}

/** The days from `from` to `to` (both included) as weeks of seven, Sunday first; days before and after are empty. */
function weeksOf(days: readonly GridCell[]): GridWeek[] {
  const first = days[0];
  if (first === undefined) return [];
  const flat: (GridCell | null)[] = [...Array.from({ length: weekdayOf(first.iso) }, () => null), ...days];
  while (flat.length % 7 !== 0) flat.push(null);
  return Array.from({ length: flat.length / 7 }, (_, week) => flat.slice(week * 7, week * 7 + 7));
}

/** A Gregorian month (`month` 1 to 12) as weeks. */
export function gregorianWeeks(year: number, month: number, context: DayContext): GridWeek[] {
  const from = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-01`;
  const count = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return weeksOf(Array.from({ length: count }, (_, i) => addDays(from, i)).map((iso) => cellOf(iso, dayNumber(iso), hijriOf(iso).day, context)));
}

/** A Hijri month, given as the Gregorian days it spans, as weeks. */
export function hijriWeeks(gregorianStart: string, gregorianEnd: string, context: DayContext): GridWeek[] {
  const count = Math.round((at(gregorianEnd) - at(gregorianStart)) / DAY_MS) + 1;
  return weeksOf(Array.from({ length: Math.max(count, 0) }, (_, i) => addDays(gregorianStart, i)).map((iso) => cellOf(iso, hijriOf(iso).day, dayNumber(iso), context)));
}
