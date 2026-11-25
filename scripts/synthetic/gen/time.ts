// SPDX-License-Identifier: AGPL-3.0-only
// Time helpers. Instants are integer epoch seconds; local time is Asia/Riyadh, a fixed +03:00 (no daylight
// saving), so all arithmetic is plain integer maths and never touches the machine's time zone or clock.
// PURE TypeScript, no Node imports.

export const RIYADH_OFFSET_SECONDS = 3 * 3600;
export const SLOT_SECONDS = 900;
export const SLOTS_PER_DAY = 96;
export const DAY_SECONDS = 86400;

export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;
export type Weekday = (typeof WEEKDAYS)[number];

const pad = (n: number, width = 2): string => String(n).padStart(width, '0');

/** Epoch seconds of local midnight (Riyadh) at the start of `date` (YYYY-MM-DD). */
export function dayStart(date: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (m === null) throw new Error(`Not a YYYY-MM-DD date: ${date}`);
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 1000 - RIYADH_OFFSET_SECONDS;
}

/** The local calendar date (YYYY-MM-DD) that contains the instant. */
export function localDate(epoch: number): string {
  const d = new Date((epoch + RIYADH_OFFSET_SECONDS) * 1000);
  return `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** Seconds since local midnight, 0 to 86399. */
export function secondsOfDay(epoch: number): number {
  return (((epoch + RIYADH_OFFSET_SECONDS) % DAY_SECONDS) + DAY_SECONDS) % DAY_SECONDS;
}

/** ISO 8601 with the +03:00 offset, e.g. 2026-09-06T07:12:45+03:00. */
export function iso(epoch: number): string {
  const d = new Date((epoch + RIYADH_OFFSET_SECONDS) * 1000);
  return (
    `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}+03:00`
  );
}

/** Epoch seconds of an ISO 8601 timestamp with an offset (or Z). Whole seconds only. */
export function parseIso(text: string): number {
  const ms = Date.parse(text);
  if (Number.isNaN(ms)) throw new Error(`Not an ISO 8601 timestamp: ${text}`);
  return Math.round(ms / 1000);
}

/** HH:MM local time of an instant. */
export function hhmm(epoch: number): string {
  const s = secondsOfDay(epoch);
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}`;
}

/** Seconds since midnight for "HH:MM" or "HH:MM:SS". "24:00" is allowed and means 86400. */
export function parseClock(text: string): number {
  const m = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(text);
  if (m === null) throw new Error(`Not an HH:MM clock time: ${text}`);
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3] ?? 0);
}

export function addDays(date: string, days: number): string {
  return localDate(dayStart(date) + days * DAY_SECONDS + 12 * 3600);
}

/** Every date from `first` to `last`, both inclusive. */
export function dateRange(first: string, last: string): string[] {
  const out: string[] = [];
  for (let d = first; d <= last; d = addDays(d, 1)) out.push(d);
  return out;
}

export function weekdayOf(date: string): Weekday {
  const d = new Date(dayStart(date) * 1000 + RIYADH_OFFSET_SECONDS * 1000);
  return WEEKDAYS[d.getUTCDay()] as Weekday;
}

/** Compact date for ids and case numbers: 2026-09-06 gives 260906. */
export function yymmdd(date: string): string {
  return date.slice(2, 4) + date.slice(5, 7) + date.slice(8, 10);
}

/** "HH:MM" label of a 15-minute slot index 0 to 95. */
export function slotLabel(slot: number): string {
  const s = slot * SLOT_SECONDS;
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}`;
}
