// SPDX-License-Identifier: AGPL-3.0-only
// Client-safe copies of breaks.ts pure checks

export const BP_TABS = ['timeline', 'conflicts'] as const;
export type BpTab = (typeof BP_TABS)[number];

export type PrayerName = 'fajr' | 'dhuhr' | 'asr' | 'maghrib' | 'isha';

export interface PrayerMinute {
  readonly name: PrayerName;
  readonly minute: number;
}

// The break grid, minutes (breaks.ts GRID).
export const GRID = 15;

export type PrayerPolicyMode = 'clear_of_prayer' | 'lined_up_with_prayer';

/** How breaks meet prayer windows (a setting). */
export interface BreakPrayerPolicy {
  readonly mode: PrayerPolicyMode;
  readonly windowMinutes: number;
}

// Go's DefaultPrayerPolicy
export const DEFAULT_PRAYER_POLICY: BreakPrayerPolicy = { mode: 'clear_of_prayer', windowMinutes: 30 };

function overlap(aStart: number, aEnd: number, bStart: number, bEnd: number): number {
  return Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart));
}

// One window holds the other whole
function aligned(shared: number, windowMinutes: number, length: number): boolean {
  return shared > 0 && (shared === windowMinutes || shared === length);
}

// @pure The prayer a break breaks, or null
export function prayerConflictOf(startMin: number, endMin: number, prayers: readonly PrayerMinute[], policy: BreakPrayerPolicy): PrayerName | null {
  for (const prayer of prayers) {
    const shared = overlap(startMin, endMin, prayer.minute, prayer.minute + policy.windowMinutes);
    if (shared === 0 || (policy.mode === 'lined_up_with_prayer' && aligned(shared, policy.windowMinutes, endMin - startMin))) continue;
    return prayer.name;
  }
  return null;
}

// @pure The prayer a break lines up with
export function heldPrayerOf(startMin: number, endMin: number, prayers: readonly PrayerMinute[], policy: BreakPrayerPolicy): PrayerName | null {
  if (policy.mode !== 'lined_up_with_prayer' || prayerConflictOf(startMin, endMin, prayers, policy) !== null) return null;
  const prayer = prayers.find((p) => aligned(overlap(startMin, endMin, p.minute, p.minute + policy.windowMinutes), policy.windowMinutes, endMin - startMin));
  return prayer?.name ?? null;
}

// @pure True when a break lines up with one
export function holdsWholePrayer(startMin: number, endMin: number, prayers: readonly PrayerMinute[], policy: BreakPrayerPolicy): boolean {
  return heldPrayerOf(startMin, endMin, prayers, policy) !== null;
}

// @pure Overlap minutes with the broken prayer
export function overlapMinutesOf(startMin: number, endMin: number, prayers: readonly PrayerMinute[], policy: BreakPrayerPolicy): number {
  const name = prayerConflictOf(startMin, endMin, prayers, policy);
  const prayer = prayers.find((p) => p.name === name && overlap(startMin, endMin, p.minute, p.minute + policy.windowMinutes) > 0);
  return prayer === undefined ? 0 : overlap(startMin, endMin, prayer.minute, prayer.minute + policy.windowMinutes);
}

// @pure Nearest free start in the window
export function nearestFreeSlot(startMin: number, durationMin: number, earliestMin: number, latestMin: number, prayers: readonly PrayerMinute[], policy: BreakPrayerPolicy): number | null {
  let best: number | null = null;
  for (let candidate = earliestMin; candidate <= latestMin; candidate += GRID) {
    if (prayerConflictOf(candidate, candidate + durationMin, prayers, policy) !== null) continue;
    if (best === null || Math.abs(candidate - startMin) < Math.abs(best - startMin)) best = candidate;
  }
  return best;
}

export interface GenerateBreakPlanInput {
  readonly zoneId: string;
  readonly date: string;
}

export interface UpdateBreakSlotInput {
  readonly rosterAssignmentId: string;
  readonly date: string;
  readonly startMin: number;
}
