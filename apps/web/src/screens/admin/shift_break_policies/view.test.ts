// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { nextRamadan, riyadhDay } from './view';

// loadShiftsView is api-backed: see view.live.test.ts.
// riyadhDay/nextRamadan are pure, no store used.

describe('riyadhDay and nextRamadan', () => {
  it('reads the calendar day in Riyadh, which is three hours ahead of UTC', () => {
    expect(riyadhDay(new Date('2026-09-13T22:30:00Z'))).toBe('2026-09-14');
    expect(riyadhDay(new Date('2026-09-13T20:59:00Z'))).toBe('2026-09-13');
  });

  it('finds the first day of the next Ramadan by the Umm al-Qura calendar', () => {
    expect(nextRamadan('2026-09-13')).toBe('2027-02-08');
    expect(nextRamadan('2026-03-01')).toBe('2027-02-08');
    expect(nextRamadan('2026-02-18')).toBe('2026-02-18');
  });
});
