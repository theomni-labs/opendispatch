// SPDX-License-Identifier: AGPL-3.0-only
// Placement is Go's: business/breaks_test.go.
import { describe, expect, it } from 'vitest';
import { isoAtMinute } from './breaks';

describe('isoAtMinute', () => {
  it('turns minutes into a Riyadh date-time, rolling past midnight', () => {
    expect(isoAtMinute('2026-09-14', 11 * 60 + 45)).toBe('2026-09-14T11:45:00+03:00');
    expect(isoAtMinute('2026-09-14', 1440 + 3 * 60)).toBe('2026-09-15T03:00:00+03:00');
  });
});
