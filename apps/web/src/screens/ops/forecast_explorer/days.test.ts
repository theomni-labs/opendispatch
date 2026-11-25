// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { horizonDates, otherDayOf, pickDay, stripDates } from './days';

describe('stripDates', () => {
  it('covers the run horizon only, never days before it', () => {
    const dates = stripDates({ start: '2026-09-13', days: 10 }, '2026-09-13');
    expect(dates).toHaveLength(10);
    expect(dates[0]).toBe('2026-09-13');
    expect(dates[9]).toBe('2026-09-22');
    expect(dates).not.toContain('2026-09-10');
  });
  it('is a week around today without a run', () => {
    expect(stripDates(undefined, '2026-09-13')).toEqual(['2026-09-10', '2026-09-11', '2026-09-12', '2026-09-13', '2026-09-14', '2026-09-15', '2026-09-16']);
  });
  it('crosses a month end and caps at 62 days', () => {
    expect(horizonDates('2026-09-29', 3)).toEqual(['2026-09-29', '2026-09-30', '2026-10-01']);
    expect(horizonDates('2026-09-01', 90)).toHaveLength(62);
  });
});

describe('pickDay', () => {
  const dates = ['2026-09-13', '2026-09-14', '2026-09-15'];
  it('keeps an asked day inside the horizon', () => {
    expect(pickDay(dates, '2026-09-15', '2026-09-13')).toBe('2026-09-15');
  });
  it('drops an asked day outside the horizon for today', () => {
    expect(pickDay(dates, '2026-09-10', '2026-09-13')).toBe('2026-09-13');
  });
  it('falls back to the first horizon day when today is outside it', () => {
    expect(pickDay(dates, undefined, '2026-09-11')).toBe('2026-09-13');
  });
});

describe('otherDayOf', () => {
  it('offers the run first day when another day is shown', () => {
    expect(otherDayOf({ start: '2026-09-13', days: 10 }, '2026-09-20')).toBe('2026-09-13');
  });
  it('offers nothing without a run or on its first day', () => {
    expect(otherDayOf(undefined, '2026-09-13')).toBeNull();
    expect(otherDayOf({ start: '2026-09-13', days: 0 }, '2026-09-14')).toBeNull();
    expect(otherDayOf({ start: '2026-09-13', days: 10 }, '2026-09-13')).toBeNull();
  });
});
