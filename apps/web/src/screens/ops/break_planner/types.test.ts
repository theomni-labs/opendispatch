// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { heldPrayerOf, holdsWholePrayer, nearestFreeSlot, overlapMinutesOf, prayerConflictOf, type BreakPrayerPolicy, type PrayerMinute } from './types';

const dhuhr: PrayerMinute[] = [{ name: 'dhuhr', minute: 720 }];
const clear: BreakPrayerPolicy = { mode: 'clear_of_prayer', windowMinutes: 30 };
const linedUp: BreakPrayerPolicy = { mode: 'lined_up_with_prayer', windowMinutes: 30 };

describe('breaks and prayer, as Go judges them', () => {
  it('clear of prayer: any overlap with the window breaks it, nothing lines up', () => {
    for (const [s, e] of [[710, 740], [720, 750], [700, 760]] as const) expect(prayerConflictOf(s, e, dhuhr, clear)).toBe('dhuhr');
    expect(prayerConflictOf(750, 780, dhuhr, clear)).toBeNull();
    expect(holdsWholePrayer(720, 750, dhuhr, clear)).toBe(false);
    expect(overlapMinutesOf(700, 760, dhuhr, clear)).toBe(30);
  });

  it('lined up with prayer: covering the window lines up, cutting it breaks it', () => {
    expect(prayerConflictOf(720, 750, dhuhr, linedUp)).toBeNull();
    expect(heldPrayerOf(705, 765, dhuhr, linedUp)).toBe('dhuhr');
    expect(prayerConflictOf(710, 740, dhuhr, linedUp)).toBe('dhuhr');
    expect(overlapMinutesOf(710, 740, dhuhr, linedUp)).toBe(20);
    expect(holdsWholePrayer(730, 760, dhuhr, { mode: 'lined_up_with_prayer', windowMinutes: 45 })).toBe(true);
  });

  it('the nearest free slot follows the policy and the window', () => {
    expect(nearestFreeSlot(720, 30, 705, 840, dhuhr, clear)).toBe(750);
    expect(nearestFreeSlot(720, 30, 660, 840, dhuhr, linedUp)).toBe(720);
    expect(nearestFreeSlot(720, 30, 705, 840, dhuhr, { mode: 'clear_of_prayer', windowMinutes: 60 })).toBe(780);
  });
});
