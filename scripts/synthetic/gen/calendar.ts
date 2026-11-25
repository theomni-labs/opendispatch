// SPDX-License-Identifier: AGPL-3.0-only
// Calendar facts: Hijri months and holidays for 2026 (Intl islamic-umalqura), and prayer times (adhan, Umm al-Qura).
// Node-only (uses createRequire to reach adhan, which lives in apps/web's dependencies). Not imported by the app.

import { createRequire } from 'node:module';
import { calibration } from './calibration';
import { addDays, dateRange, dayStart, iso, weekdayOf } from './time';
import type { CityDef } from './locations';

type AdhanModule = typeof import('../../../apps/web/node_modules/adhan/lib/types/Adhan');

let adhanModule: AdhanModule | undefined;
function adhan(): AdhanModule {
  if (adhanModule === undefined) {
    // adhan is a dependency of apps/web only, so resolve it from there. Nothing is installed by the generator.
    const req = createRequire(new URL('../../../apps/web/package.json', import.meta.url));
    adhanModule = req('adhan') as AdhanModule;
  }
  return adhanModule;
}

// ---------------------------------------------------------------------------------------------------------------------
// Hijri
// ---------------------------------------------------------------------------------------------------------------------

export interface HijriDate {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

const HIJRI_MONTH_NAMES = [
  'Muharram',
  'Safar',
  "Rabi' al-awwal",
  "Rabi' al-thani",
  'Jumada al-awwal',
  'Jumada al-thani',
  'Rajab',
  "Sha'ban",
  'Ramadan',
  'Shawwal',
  "Dhu al-Qi'dah",
  'Dhu al-Hijjah',
] as const;

const HIJRI_MONTH_NAMES_AR = ['محرم', 'صفر', 'ربيع الأول', 'ربيع الآخر', 'جمادى الأولى', 'جمادى الآخرة', 'رجب', 'شعبان', 'رمضان', 'شوال', 'ذو القعدة', 'ذو الحجة'] as const;

export function hijriMonthName(month: number): string {
  return HIJRI_MONTH_NAMES[month - 1] ?? `Month ${month}`;
}

export function hijriMonthNameAr(month: number): string {
  return HIJRI_MONTH_NAMES_AR[month - 1] ?? '';
}

const hijriFormat = new Intl.DateTimeFormat('en-u-ca-islamic-umalqura', { year: 'numeric', month: 'numeric', day: 'numeric', timeZone: 'UTC' });

/** The Umm al-Qura Hijri date of a Gregorian date (YYYY-MM-DD). */
export function toHijri(date: string): HijriDate {
  const parts = hijriFormat.formatToParts(new Date(`${date}T00:00:00Z`));
  const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value);
  return { year: get('year'), month: get('month'), day: get('day') };
}

export interface HijriMonthRow {
  readonly hijri_year: number;
  readonly hijri_month: number;
  readonly name_en: string;
  readonly name_ar: string;
  readonly starts_on: string;
  readonly ends_on: string;
  readonly days: number;
  readonly is_ramadan: boolean;
}

/** Every Hijri month that overlaps the calendar year, with its Gregorian start and end dates. */
export function hijriMonthsOfYear(year: number): HijriMonthRow[] {
  const dates = dateRange(`${year}-01-01`, `${year}-12-31`);
  const rows: HijriMonthRow[] = [];
  let current: { y: number; m: number; start: string; end: string; days: number } | undefined;
  const flush = (): void => {
    if (current === undefined) return;
    rows.push({
      hijri_year: current.y,
      hijri_month: current.m,
      name_en: hijriMonthName(current.m),
      name_ar: hijriMonthNameAr(current.m),
      starts_on: current.start,
      ends_on: current.end,
      days: current.days,
      is_ramadan: current.m === 9,
    });
  };
  for (const date of dates) {
    const h = toHijri(date);
    if (current !== undefined && current.y === h.year && current.m === h.month) {
      current.end = date;
      current.days += 1;
    } else {
      flush();
      current = { y: h.year, m: h.month, start: date, end: date, days: 1 };
    }
  }
  flush();
  return rows;
}

/** Is the date inside Ramadan? */
export function isRamadan(date: string): boolean {
  return toHijri(date).month === 9;
}

// ---------------------------------------------------------------------------------------------------------------------
// Holidays
// ---------------------------------------------------------------------------------------------------------------------

export interface HolidayRow {
  readonly key: string;
  readonly kind: 'public' | 'religious' | 'observance';
  readonly name_en: string;
  readonly name_ar: string;
  readonly start_date: string;
  readonly end_date: string;
  readonly hijri_start: HijriDate;
  readonly hijri_end: HijriDate;
}

/**
 * Holidays and observances of the year from the rules in calibration.json, one row per period.
 * Hijri-based ones use the Umm al-Qura calendar (Intl), so the Gregorian dates come out of the calendar, not a table.
 */
export function holidaysOfYear(year: number): HolidayRow[] {
  const rules = calibration.calendar.holiday_rules.value;
  const dates = dateRange(`${year}-01-01`, `${year}-12-31`);
  const rows: HolidayRow[] = [];
  for (const rule of rules) {
    let start: string | undefined;
    if (rule.calendar === 'gregorian') {
      start = `${year}-${String(rule.month).padStart(2, '0')}-${String(rule.day).padStart(2, '0')}`;
    } else {
      start = dates.find((d) => {
        const h = toHijri(d);
        return h.month === rule.month && h.day === rule.day;
      });
    }
    if (start === undefined) continue;
    let end: string;
    if (rule.duration_days === 0) {
      // the whole Hijri month the rule starts in
      const first = toHijri(start);
      let cursor = start;
      while (toHijri(addDays(cursor, 1)).month === first.month) cursor = addDays(cursor, 1);
      end = cursor;
    } else {
      end = addDays(start, rule.duration_days - 1);
    }
    rows.push({ key: rule.key, kind: rule.kind as HolidayRow['kind'], name_en: rule.name_en, name_ar: rule.name_ar, start_date: start, end_date: end, hijri_start: toHijri(start), hijri_end: toHijri(end) });
  }
  return rows.sort((a, b) => a.start_date.localeCompare(b.start_date) || a.key.localeCompare(b.key));
}

// ---------------------------------------------------------------------------------------------------------------------
// Prayer times
// ---------------------------------------------------------------------------------------------------------------------

export interface PrayerTimesRow {
  readonly date: string;
  readonly fajr: number;
  readonly sunrise: number;
  readonly dhuhr: number;
  readonly asr: number;
  readonly maghrib: number;
  readonly isha: number;
}

/** Prayer times as epoch seconds for a city on a date, Umm al-Qura method. Same result in every time zone. */
export function prayerTimesFor(city: Pick<CityDef, 'anchor'>, date: string): PrayerTimesRow {
  const { CalculationMethod, Coordinates, PrayerTimes } = adhan();
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  // A Date built from local components; adhan reads the same components back, so the machine's zone cancels out.
  const times = new PrayerTimes(new Coordinates(city.anchor.lat, city.anchor.lng), new Date(y, m - 1, d), CalculationMethod.UmmAlQura());
  const sec = (t: Date): number => Math.round(t.getTime() / 1000);
  return { date, fajr: sec(times.fajr), sunrise: sec(times.sunrise), dhuhr: sec(times.dhuhr), asr: sec(times.asr), maghrib: sec(times.maghrib), isha: sec(times.isha) };
}

/** "HH:MM" Riyadh time of an epoch-seconds instant. */
export function clock(epoch: number): string {
  return iso(epoch).slice(11, 16);
}

export { dayStart, weekdayOf };
