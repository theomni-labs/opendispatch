// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { formatDate, formatDateTime, formatHijriDate, formatMinutesSeconds, formatNumber, formatPercent, formatTime } from '@opendispatch/ui/format';

// the project rules: dates go through the shared formatter. That is the design system's (`@opendispatch/ui/format`),
// which replaced opendispatch's temporary helper under the same function names. These are the helper's five original tests, unchanged
// in what they assert; the design system's own suite covers the rest (kit API, missing input, Arabic marks).
describe('format (the design system formatter)', () => {
  it('uses Riyadh time, not UTC', () => {
    // 21:30 UTC on 6 Sep is 00:30 on 7 Sep in Riyadh.
    expect(formatTime('2026-09-06T21:30:00Z', 'en')).toBe('00:30');
    expect(formatDate('2026-09-06T21:30:00Z', 'en', 'short')).toBe('07/09/2026');
  });

  it('keeps Western digits in Arabic', () => {
    expect(formatTime('2026-09-06T09:05:00+03:00', 'ar')).toBe('09:05');
    expect(formatDate('2026-09-06T12:00:00+03:00', 'ar')).toMatch(/2026/);
    expect(formatNumber(1486, 'ar')).toMatch(/1.?486/);
    expect(formatNumber(1486, 'ar')).not.toMatch(/[٠-٩]/);
  });

  it('formats Gregorian dates in both languages', () => {
    expect(formatDate('2026-09-06T12:00:00+03:00', 'en')).toMatch(/6 .* 2026/);
    expect(formatDateTime('2026-09-06T12:00:00+03:00', 'en')).toMatch(/12:00$/);
  });

  it('supports Hijri (Umm al-Qura) dates', () => {
    expect(formatHijriDate('2026-09-06T12:00:00+03:00', 'en')).toMatch(/1448/);
    expect(formatHijriDate('2026-09-06T12:00:00+03:00', 'ar')).toMatch(/1448/);
  });

  it('formats percentages and durations', () => {
    expect(formatPercent(0.91, 'en')).toBe('91%');
    expect(formatMinutesSeconds(144)).toBe('2:24');
    expect(formatMinutesSeconds(-5)).toBe('0:00');
  });
});
