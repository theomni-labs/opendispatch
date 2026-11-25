// SPDX-License-Identifier: AGPL-3.0-only
// Which days the explorer offers: pure.

const MAX_DAYS = 62;

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** The run's horizon dates, at most 62. */
export function horizonDates(start: string, count: number): string[] {
  return Array.from({ length: Math.max(0, Math.min(count, MAX_DAYS)) }, (_, i) => addDays(start, i));
}

/** The run's horizon, or a week around today without a run. */
export function stripDates(horizon: { readonly start: string; readonly days: number } | undefined, today: string): string[] {
  if (horizon !== undefined && horizon.days > 0) return horizonDates(horizon.start, horizon.days);
  return Array.from({ length: 7 }, (_, i) => addDays(today, i - 3));
}

/** The asked day if offered, else today if offered, else the first. */
export function pickDay(dates: readonly string[], asked: string | undefined, today: string): string {
  if (asked !== undefined && dates.includes(asked)) return asked;
  if (dates.includes(today)) return today;
  return dates[0] ?? today;
}

/** A day to offer when this one has no forecast. */
export function otherDayOf(horizon: { readonly start: string; readonly days: number } | undefined, day: string): string | null {
  if (horizon === undefined || horizon.days <= 0) return null;
  return horizon.start === day ? null : horizon.start;
}
