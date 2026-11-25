// SPDX-License-Identifier: AGPL-3.0-only
// Calendar-day arithmetic on ISO dates (no zone)

/** The ISO day `days` after `day` ("2026-09-30", 1 gives "2026-10-01"). */
export function addDays(day: string, days: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
