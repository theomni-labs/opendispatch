// SPDX-License-Identifier: AGPL-3.0-only
// Small pure helpers for the Updates screen: the weekday of a calendar day and the parts of a Riyadh timestamp. No formatting
// of a date happens here: dates and times are written by `@opendispatch/ui/format`; this only picks parts.

/** 0 (Sunday) to 6 (Saturday) of a `YYYY-MM-DD` day, by calendar arithmetic (no time zone involved). */
export function weekdayOf(day: string): number {
  const [y = 1970, m = 1, d = 1] = day.slice(0, 10).split('-').map((part) => Number.parseInt(part, 10));
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** `YYYY-MM-DD` of a timestamp the data layer wrote with the Riyadh offset (`2026-09-14T03:00:00+03:00`). */
export function dayOf(timestamp: string): string {
  return timestamp.slice(0, 10);
}

/** `HH:MM` of a timestamp the data layer wrote with the Riyadh offset: the clock time of the window, as the mockup shows it. */
export function clockOf(timestamp: string): string {
  return timestamp.slice(11, 16);
}

/** True for `HH:MM` (00:00 to 23:59), the form the data layer takes for a window time. */
export function isClock(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

/** Days 0 to 6 in the order a week reads in the Updates screen: Sunday first (the data layer's day 0). */
export const WEEK = [0, 1, 2, 3, 4, 5, 6] as const;
