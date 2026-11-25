// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import {
  NO_VALUE,
  date,
  dateBoth,
  duration,
  formatDate,
  formatDateTime,
  formatDelta,
  formatHijriDate,
  formatMinutesSeconds,
  formatNumber,
  formatPercent,
  initials,
  int,
  monthName,
  num,
  pct,
  resolveFormatLocale,
  textCollator,
  time,
  toInstant,
  weekday,
  weekdayNames,
} from './index';

describe('numbers', () => {
  it('write Western digits with comma grouping in both languages', () => {
    expect(num(1234.56)).toBe('1,234.6');
    expect(num(1234.5, 2, 'ar')).toBe('1,234.50');
    expect(int(1234.6, 'ar')).toBe('1,235');
    expect(pct(91)).toBe('91%');
    expect(formatPercent(0.912, 'ar', 1)).toBe('91.2%');
    expect(formatNumber(1.23456)).toBe('1.235');
  });

  it('never write a minus on zero, and give NO_VALUE for missing input', () => {
    expect(num(-0.04)).toBe('0');
    expect(int(-0)).toBe('0');
    expect(num(Number.NaN)).toBe(NO_VALUE);
    expect(pct(null)).toBe(NO_VALUE);
    expect(formatPercent(Number.POSITIVE_INFINITY)).toBe(NO_VALUE);
  });

  it('write deltas with a true minus sign', () => {
    expect(formatDelta(12.44)).toBe('+12.4%');
    expect(formatDelta(-3.1)).toBe('−3.1%');
    expect(formatDelta(0)).toBe('0%');
  });

  it('take initials from the first two words', () => {
    expect(initials('Sara  Haddad Omar')).toBe('SH');
    expect(initials('')).toBe('');
  });

  it('sort numbers inside text naturally and treat unknown tags as English', () => {
    expect(['item 10', 'item 2'].sort(textCollator('en').compare)).toEqual(['item 2', 'item 10']);
    expect(textCollator('not a tag').compare('a', 'A')).toBe(0);
    expect(resolveFormatLocale('AR_sa')).toBe('ar');
    expect(resolveFormatLocale(undefined)).toBe('en');
  });
});

describe('dates', () => {
  it('read a bare day as that day in Riyadh, and an offset-free time as Riyadh wall time', () => {
    expect(toInstant('2026-09-06')?.toISOString()).toBe('2026-09-06T09:00:00.000Z');
    expect(toInstant('2026-09-06T12:00')?.toISOString()).toBe('2026-09-06T09:00:00.000Z');
    expect(toInstant('2026-09-06T12:00Z')?.toISOString()).toBe('2026-09-06T12:00:00.000Z');
    expect(toInstant('2026-02-30')).toBeNull();
    expect(toInstant('6 September')).toBeNull();
  });

  it('write days, times and both calendars without direction marks', () => {
    expect(date('2026-09-06')).toBe('6 Sept 2026');
    expect(date('2026-09-06', { locale: 'ar', month: 'long' })).toBe('6 سبتمبر 2026');
    expect(date('2026-09-06T21:30:00Z')).toBe('7 Sept 2026');
    expect(date('2026-09-06T21:30:00Z', { timeZone: 'Europe/London' })).toBe('6 Sept 2026');
    expect(date('2026-09-06', { timeZone: 'Nowhere/Else' })).toBe(NO_VALUE);
    expect(dateBoth('2026-09-06')).toMatch(/^6 Sept 2026 · \d+ .+ 1448 AH$/);
    expect(dateBoth('2026-09-06', { locale: 'ar' })).not.toMatch(/[‎‏؜]/);
    expect(time('2026-09-06T05:07:00Z')).toBe('08:07');
    expect(time(1440 + 75)).toBe('01:15');
    expect(time(-30)).toBe('23:30');
  });

  it('name weekdays and months', () => {
    expect(weekday('2026-09-13')).toBe('Sun');
    expect(weekday('2026-09-13', { length: 'long' })).toBe('Sunday');
    expect(weekdayNames()).toEqual(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']);
    expect(monthName('2026-09-06')).toBe('September');
  });

  it('write durations and the older helper shapes', () => {
    expect(duration(360)).toBe('6 min');
    expect(duration(652, 'clock')).toBe('10:52');
    expect(duration(-20)).toBe('0 min');
    expect(duration(-90, 'clock', 'د')).toBe('-1:30');
    expect(formatMinutesSeconds(-5)).toBe('0:00');
    expect(formatDate('2026-09-06', 'en', 'short')).toBe('06/09/2026');
    expect(formatDateTime('2026-09-06T08:00')).toBe('6 Sept 2026 08:00');
    expect(formatHijriDate('2026-09-06', 'en', 'long')).toMatch(/1448 AH$/);
    expect(formatDate(null)).toBe(NO_VALUE);
  });
});
