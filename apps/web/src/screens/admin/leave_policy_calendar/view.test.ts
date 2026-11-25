// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { riyadhDay } from './view';

// loadCalendarView is api-backed: see view.live.test.ts.
// riyadhDay is pure, no store access at all.

describe('riyadhDay', () => {
  it('reads the calendar day in Riyadh', () => {
    expect(riyadhDay(new Date('2026-09-13T22:30:00Z'))).toBe('2026-09-14');
  });
});
