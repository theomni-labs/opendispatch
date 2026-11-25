// SPDX-License-Identifier: AGPL-3.0-only
// Demand: the shape of a day in 15-minute slots, day-of-week multipliers, and the Ramadan profile.
// PURE TypeScript, no Node imports.

import { calibration } from './calibration';
import { apportion } from './dist';
import type { Rng } from './rng';
import { SLOTS_PER_DAY, WEEKDAYS, parseClock, weekdayOf, type Weekday } from './time';

const demand = calibration.demand;

/** Relative level of each of the 96 slots (not normalised): hourly levels interpolated, then the pinned slots. */
export function baseSlotLevels(): number[] {
  const hourly = demand.hourly_levels.value;
  const overrides = demand.slot_overrides.value as Record<string, number>;
  const out: number[] = [];
  for (let slot = 0; slot < SLOTS_PER_DAY; slot += 1) {
    const label = `${String(Math.floor(slot / 4)).padStart(2, '0')}:${String((slot % 4) * 15).padStart(2, '0')}`;
    const pinned = overrides[label];
    if (pinned !== undefined) {
      out.push(pinned);
      continue;
    }
    // Hour h has its level at h + 0.5; slot centres are at (slot + 0.5) / 4.
    const x = (slot + 0.5) / 4 - 0.5;
    const lo = Math.floor(x);
    const frac = x - lo;
    const a = hourly[(lo + 24) % 24] as number;
    const b = hourly[(lo + 25) % 24] as number;
    out.push(a + (b - a) * frac);
  }
  return out;
}

/** Slot shares of a day, summing to 1. */
export function slotWeights(): number[] {
  const levels = baseSlotLevels();
  const sum = levels.reduce((a, b) => a + b, 0);
  return levels.map((l) => l / sum);
}

/** Day-of-week multiplier (mean 1.0 over the week). */
export function dayMultiplier(date: string): number {
  const table = demand.day_of_week_multiplier.value as Record<Weekday, number>;
  return table[weekdayOf(date)];
}

export function checkDayMultipliersAverageOne(): number {
  const table = demand.day_of_week_multiplier.value as Record<Weekday, number>;
  return WEEKDAYS.reduce((a, d) => a + table[d], 0) / WEEKDAYS.length;
}

/** Total cases for a date: cases per day times the weekday multiplier. */
export function casesForDate(date: string): number {
  return Math.round(calibration.structure.cases_per_day.value * dayMultiplier(date));
}

/** Case count per slot for one day: expected shares with a little lognormal noise, apportioned to the total. */
export function slotCountsForDay(rng: Rng, total: number): number[] {
  const sigma = demand.slot_count_noise_sigma.value;
  const weights = slotWeights().map((w) => w * Math.exp(sigma * rng.normal()));
  return apportion(total, weights);
}

export interface RamadanDay {
  /** Seconds since midnight of fajr and maghrib for the day being drawn. */
  readonly fajr: number;
  readonly maghrib: number;
}

/**
 * The Ramadan demand profile: the normal shape multiplied by the windows of calibration.json
 * (spike in the hour before fajr and before iftar, quieter midday). Used for the by-eye chart only;
 * the fixtures never contain Ramadan days. Returns slot shares summing to 1.
 */
export function ramadanSlotWeights(day: RamadanDay): number[] {
  const levels = baseSlotLevels();
  const windows = demand.ramadan_profile.value.multipliers;
  const shaped = levels.map((level, slot) => {
    const mid = slot * 900 + 450;
    let m = 1;
    for (const w of windows) {
      let from: number;
      let to: number;
      if (w.from_minutes_after_fajr !== undefined && w.to_minutes_after_fajr !== undefined) {
        from = day.fajr + w.from_minutes_after_fajr * 60;
        to = day.fajr + w.to_minutes_after_fajr * 60;
      } else if (w.from_minutes_after_maghrib !== undefined && w.to_minutes_after_maghrib !== undefined) {
        from = day.maghrib + w.from_minutes_after_maghrib * 60;
        to = day.maghrib + w.to_minutes_after_maghrib * 60;
      } else if (w.from_local_time !== undefined && w.to_local_time !== undefined) {
        from = parseClock(w.from_local_time);
        to = parseClock(w.to_local_time);
      } else continue;
      if (mid >= from && mid < to) m *= w.multiplier;
    }
    return level * m;
  });
  const sum = shaped.reduce((a, b) => a + b, 0);
  return shaped.map((s) => s / sum);
}
