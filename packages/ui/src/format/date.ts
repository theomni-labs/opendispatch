// SPDX-License-Identifier: AGPL-3.0-only

import { NO_VALUE, resolveFormatLocale, stripBidiMarks } from './locale';

/**
 * Dates and times. The default zone is Asia/Riyadh (UTC+3, no daylight saving), whatever the zone of the machine.
 * Input is a Date or an ISO 8601 string. A bare day ("2026-09-06") is read as noon in the zone in use so it stays
 * that day; a date and time without an offset is a wall-clock time in that zone. Anything else, impossible days
 * included, is missing and gives NO_VALUE. Digits are Western in both languages and no direction marks remain.
 */

export const TIME_ZONE = 'Asia/Riyadh';

export type DateValue = string | Date | null | undefined;
export type CalendarKind = 'gregory' | 'hijri';
export type DateStyle = 'short' | 'medium' | 'long';
export type DurationMode = 'min' | 'clock';

export interface DateOptions {
  locale?: string | undefined;
  calendar?: CalendarKind | undefined;
  month?: 'short' | 'long' | undefined;
  timeZone?: string | undefined;
}

export interface TimeOptions {
  timeZone?: string | undefined;
}

const ISO =
  /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(\.\d+)?)?\s?(Z|[+-]\d{2}(?::?\d{2})?)?)?$/i;

const partsFormats = new Map<string, Intl.DateTimeFormat | null>();

/** A numeric 24-hour clock for a zone, or null when Intl does not know the zone. */
function zoneParts(zone: string): Intl.DateTimeFormat | null {
  if (partsFormats.has(zone)) return partsFormats.get(zone) ?? null;
  let format: Intl.DateTimeFormat | null = null;
  try {
    format = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
  } catch {
    format = null;
  }
  partsFormats.set(zone, format);
  return format;
}

function knownZone(zone: string | undefined): string | null {
  const name = zone ?? TIME_ZONE;
  return zoneParts(name) ? name : null;
}

/** Milliseconds the zone's clock is ahead of UTC at an instant. */
function offsetAt(ms: number, format: Intl.DateTimeFormat): number {
  const seconds = Math.floor(ms / 1000) * 1000;
  const field: Record<string, number> = {};
  for (const part of format.formatToParts(seconds)) {
    if (part.type !== 'literal') field[part.type] = Number(part.value);
  }
  const asUtc = Date.UTC(
    field['year'] ?? 1970,
    (field['month'] ?? 1) - 1,
    field['day'] ?? 1,
    field['hour'] ?? 0,
    field['minute'] ?? 0,
    field['second'] ?? 0,
  );
  return asUtc - seconds;
}

/** The instant a zone's clock shows a wall time (given as if it were UTC), checked twice around offset changes. */
function fromWallClock(wall: number, zone: string): Date | null {
  const format = zoneParts(zone);
  if (!format) return null;
  const guess = offsetAt(wall, format);
  let instant = wall - guess;
  const check = offsetAt(instant, format);
  if (check !== guess) instant = wall - check;
  return new Date(instant);
}

function realDay(year: number, month: number, day: number): boolean {
  const probe = new Date(Date.UTC(year, month - 1, day));
  return probe.getUTCFullYear() === year && probe.getUTCMonth() === month - 1 && probe.getUTCDate() === day;
}

function offsetMinutes(offset: string): number {
  if (offset.toUpperCase() === 'Z') return 0;
  const sign = offset.startsWith('-') ? -1 : 1;
  const digits = offset.slice(1).replace(':', '');
  const hours = Number(digits.slice(0, 2));
  const minutes = digits.length > 2 ? Number(digits.slice(2, 4)) : 0;
  return sign * (hours * 60 + minutes);
}

function parseIso(text: string, zone: string): Date | null {
  const match = ISO.exec(text.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!realDay(year, month, day)) return null;
  if (match[4] === undefined) return fromWallClock(Date.UTC(year, month - 1, day, 12), zone);
  const hour = Number(match[4]);
  const minute = Number(match[5] ?? '0');
  const second = Number(match[6] ?? '0');
  if (hour > 23 || minute > 59 || second > 59) return null;
  const ms = match[7] ? Math.round(Number(`0${match[7]}`) * 1000) : 0;
  const wall = Date.UTC(year, month - 1, day, hour, minute, second, ms);
  const offset = match[8];
  if (offset === undefined) return fromWallClock(wall, zone);
  return new Date(wall - offsetMinutes(offset) * 60_000);
}

/** The instant a value names, or null when it is missing or not a real date. */
export function toInstant(value: DateValue, timeZone: string = TIME_ZONE): Date | null {
  if (value === null || value === undefined) return null;
  const instant = value instanceof Date ? value : parseIso(value, timeZone);
  if (!instant || Number.isNaN(instant.getTime())) return null;
  return instant;
}

function languageTag(locale: string | undefined, calendar: CalendarKind | undefined): string {
  const base = resolveFormatLocale(locale) === 'ar' ? 'ar-SA' : 'en-GB';
  const kind = calendar === 'hijri' ? 'islamic-umalqura' : 'gregory';
  return `${base}-u-ca-${kind}-nu-latn`;
}

const dateFormats = new Map<string, Intl.DateTimeFormat>();

function render(tag: string, options: Intl.DateTimeFormatOptions, instant: Date, zone: string): string {
  const key = `${tag} ${zone} ${JSON.stringify(options)}`;
  let format = dateFormats.get(key);
  if (!format) {
    format = new Intl.DateTimeFormat(tag, { ...options, timeZone: zone });
    dateFormats.set(key, format);
  }
  return format
    .formatToParts(instant)
    .map((part) => stripBidiMarks(part.value))
    .join('');
}

const two = (n: number): string => String(n).padStart(2, '0');

/** Reads a value in a zone and renders it, or gives NO_VALUE. */
function withInstant(value: DateValue, timeZone: string | undefined, draw: (instant: Date, zone: string) => string): string {
  const zone = knownZone(timeZone);
  if (zone === null) return NO_VALUE;
  const instant = toInstant(value, zone);
  return instant ? draw(instant, zone) : NO_VALUE;
}

/** "HH:mm" on a 24-hour clock. A number is minutes since midnight, wrapped into one day. */
export function time(value: number | DateValue, options: TimeOptions = {}): string {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return NO_VALUE;
    const minutes = ((Math.round(value) % 1440) + 1440) % 1440;
    return `${two(Math.floor(minutes / 60))}:${two(minutes % 60)}`;
  }
  return withInstant(value, options.timeZone, (instant, zone) =>
    render('en-GB-u-nu-latn', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }, instant, zone),
  );
}

/** "6 Sept 2026", or the Umm al-Qura date with `calendar: "hijri"`. */
export function date(value: DateValue, options: DateOptions = {}): string {
  return withInstant(value, options.timeZone, (instant, zone) =>
    render(
      languageTag(options.locale, options.calendar),
      { day: 'numeric', month: options.month ?? 'short', year: 'numeric' },
      instant,
      zone,
    ),
  );
}

/** The Gregorian date, a middle dot, then the Hijri date. */
export function dateBoth(value: DateValue, options: Omit<DateOptions, 'calendar'> = {}): string {
  const gregorian = date(value, { ...options, calendar: 'gregory' });
  if (gregorian === NO_VALUE) return NO_VALUE;
  return `${gregorian} · ${date(value, { ...options, calendar: 'hijri' })}`;
}

export interface WeekdayOptions {
  locale?: string;
  length?: 'short' | 'long';
  timeZone?: string;
}

/** The weekday name: "Sun", or "Sunday" with `length: "long"`. */
export function weekday(value: DateValue, options: WeekdayOptions = {}): string {
  return withInstant(value, options.timeZone, (instant, zone) =>
    render(languageTag(options.locale, 'gregory'), { weekday: options.length ?? 'short' }, instant, zone),
  );
}

/** Seven weekday names, Sunday first. */
export function weekdayNames(options: { locale?: string; length?: 'short' | 'long' } = {}): string[] {
  const names: string[] = [];
  // 2026-09-13 is a Sunday. Noon UTC keeps every day on its own date.
  for (let i = 0; i < 7; i += 1) {
    names.push(weekday(new Date(Date.UTC(2026, 8, 13 + i, 12)), { ...options, timeZone: 'UTC' }));
  }
  return names;
}

/** The month name: "September", or "Sept" with `month: "short"`. */
export function monthName(value: DateValue, options: DateOptions = {}): string {
  return withInstant(value, options.timeZone, (instant, zone) =>
    render(languageTag(options.locale, options.calendar), { month: options.month ?? 'long' }, instant, zone),
  );
}

/** Seconds as "6 min" (mode "min") or "10:52" (mode "clock"). Zero never carries a minus sign. */
export function duration(seconds: number | null | undefined, mode: DurationMode = 'min', minuteLabel = 'min'): string {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds)) return NO_VALUE;
  const minus = seconds < 0 ? '-' : '';
  if (mode === 'clock') {
    const total = Math.round(Math.abs(seconds));
    return `${total > 0 ? minus : ''}${Math.floor(total / 60)}:${two(total % 60)}`;
  }
  const minutes = Math.round(Math.abs(seconds) / 60);
  return `${minutes > 0 ? minus : ''}${minutes} ${minuteLabel}`;
}

/** The Gregorian date in an Intl date style, in Riyadh. */
export function formatDate(value: DateValue, locale?: string, style: DateStyle = 'medium'): string {
  return withInstant(value, undefined, (instant, zone) => render(languageTag(locale, 'gregory'), { dateStyle: style }, instant, zone));
}

/** "HH:mm" in Riyadh. The clock reads the same in both languages. */
export function formatTime(value: DateValue, locale?: string): string {
  void locale; // kept so calls that pass the language compile
  return time(value);
}

/** formatDate and formatTime with a space between. */
export function formatDateTime(value: DateValue, locale?: string, style: DateStyle = 'medium'): string {
  const day = formatDate(value, locale, style);
  const clock = formatTime(value);
  return day === NO_VALUE || clock === NO_VALUE ? NO_VALUE : `${day} ${clock}`;
}

/** The Umm al-Qura date in an Intl date style, day first in English. */
export function formatHijriDate(value: DateValue, locale?: string, style: DateStyle = 'medium'): string {
  return withInstant(value, undefined, (instant, zone) => render(languageTag(locale, 'hijri'), { dateStyle: style }, instant, zone));
}

/** Seconds as "2:24". A negative length shows as 0:00. */
export function formatMinutesSeconds(totalSeconds: number | null | undefined): string {
  if (typeof totalSeconds !== 'number' || !Number.isFinite(totalSeconds)) return NO_VALUE;
  return duration(Math.max(0, totalSeconds), 'clock');
}
