// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { toCsv } from '@/lib/export/csv';
import { buildPlan, neededOf, nextDate, planRows, planTable, segmentOf, spreadOf, WINDOW_LABELS, type DayValues } from './planFormat';

// Our own synthetic numbers only.
function day(date: string, fill: (index: number) => number, spread: (index: number) => number = () => 1): DayValues {
  return { date, expected: Array.from({ length: 96 }, (_, i) => fill(i)), spread: Array.from({ length: 96 }, (_, i) => spread(i)) };
}

const labels = { zoneLabel: 'Zone', zoneName: 'منطقة', notes: ['n1', 'n2'], empty: 'none' };

describe('window labels', () => {
  it('are 48, from 06:00 to 05:30 next day', () => {
    expect(WINDOW_LABELS).toHaveLength(48);
    expect(WINDOW_LABELS[0]).toBe('06:00');
    expect(WINDOW_LABELS[36]).toBe('00:00');
    expect(WINDOW_LABELS[47]).toBe('05:30');
  });
});

describe('segmentOf (Asia/Riyadh)', () => {
  it('groups Sunday to Wednesday and splits the rest', () => {
    expect(['2026-09-13', '2026-09-14', '2026-09-15', '2026-09-16'].map(segmentOf)).toEqual(['weekdays', 'weekdays', 'weekdays', 'weekdays']);
    expect([segmentOf('2026-09-17'), segmentOf('2026-09-18'), segmentOf('2026-09-19')]).toEqual(['thursday', 'friday', 'saturday']);
  });
  it('does not depend on the process time zone', () => {
    const before = process.env['TZ'];
    process.env['TZ'] = 'America/Los_Angeles';
    expect(segmentOf('2026-09-18')).toBe('friday');
    if (before === undefined) delete process.env['TZ'];
    else process.env['TZ'] = before;
  });
  it('nextDate crosses month ends', () => {
    expect(nextDate('2026-09-30')).toBe('2026-10-01');
  });
});

describe('neededOf', () => {
  it('rounds up, not near-integers from float noise', () => {
    expect(neededOf(1.2)).toBe(2);
    expect(neededOf(3)).toBe(3);
    expect(neededOf(3.0000000000001)).toBe(3);
    expect(neededOf(0)).toBe(0);
    expect(neededOf(0.01)).toBe(1);
  });
});

describe('buildPlan', () => {
  it('sums two intervals per half hour', () => {
    const plan = buildPlan([day('2026-09-13', (i) => i), day('2026-09-14', () => 0)]);
    const weekdays = plan[0];
    expect(weekdays?.key).toBe('weekdays');
    expect(weekdays?.average[0]).toBe(24 + 25);
    expect(weekdays?.average[1]).toBe(26 + 27);
    expect(weekdays?.needed[0]).toBe(49);
    expect(weekdays?.neededHigh[0]).toBe(51);
  });

  it('puts 00:00 to 05:30 from the next date on the previous planning day', () => {
    const plan = buildPlan([day('2026-09-13', () => 0), day('2026-09-14', (i) => (i < 24 ? 10 : 0))]);
    expect(plan[0]?.average.slice(0, 36).every((v) => v === 0)).toBe(true);
    expect(plan[0]?.average.slice(36)).toEqual(new Array(12).fill(20));
  });

  it('averages the days of a segment and ceils the average', () => {
    const plan = buildPlan([day('2026-09-13', () => 1), day('2026-09-14', () => 1.25), day('2026-09-15', () => 1.25)]);
    const weekdays = plan.find((s) => s.key === 'weekdays');
    expect(weekdays?.days).toBe(2);
    expect(weekdays?.average[0]).toBeCloseTo(2.25, 9);
    expect(weekdays?.needed[0]).toBe(3);
  });

  it('keeps one segment per day group in order, only those present', () => {
    const dates = ['2026-09-17', '2026-09-18', '2026-09-19', '2026-09-20'];
    const plan = buildPlan(dates.map((d) => day(d, () => 1)));
    expect(plan.map((s) => s.name)).toEqual(['Thursday', 'Friday', 'Saturday']);
  });

  it('works with a single planning day (two dates)', () => {
    expect(buildPlan([day('2026-09-18', () => 2), day('2026-09-19', () => 2)]).map((s) => [s.name, s.days])).toEqual([['Friday', 1]]);
  });

  it('is empty without a full planning day', () => {
    expect(buildPlan([])).toEqual([]);
    expect(buildPlan([day('2026-09-13', () => 1)])).toEqual([]);
    expect(buildPlan([day('2026-09-13', () => 1), day('2026-09-15', () => 1)])).toEqual([]);
  });

  it('ignores a day that is not 96 intervals', () => {
    expect(buildPlan([{ date: '2026-09-13', expected: [1], spread: [1] }, day('2026-09-14', () => 1)])).toEqual([]);
  });
});

describe('spreadOf', () => {
  it('sums squared (high - expected) over sub-zones per interval', () => {
    const rows = [
      { interval_index: 24, expected: 2, high: 5 },
      { interval_index: 24, expected: 1, high: 5 },
      { interval_index: 25, expected: 3, high: 2 },
      { interval_index: 96, expected: 0, high: 9 },
    ];
    const out = spreadOf(rows);
    expect(out).toHaveLength(96);
    expect(out[24]).toBe(9 + 16);
    expect(out[25]).toBe(0);
    expect(out.reduce((s, v) => s + v, 0)).toBe(25);
  });
});

describe('high estimate (independence across sub-zones)', () => {
  it('is expected plus the root of the summed squared margins of a window', () => {
    // window 06:00 = intervals 24 and 25; margins 3 and 4
    const plan = buildPlan([day('2026-09-13', () => 1, (i) => (i === 24 ? 25 : 0)), day('2026-09-14', () => 0, () => 0)]);
    expect(plan[0]?.average[0]).toBe(2);
    expect(plan[0]?.neededHigh[0]).toBe(7);
    expect(plan[0]?.neededHigh[1]).toBe(2);
  });

  it('averages the per-day highs over the segment and rounds up', () => {
    const plan = buildPlan([day('2026-09-13', () => 1, (i) => (i === 24 ? 25 : 0)), day('2026-09-14', () => 1, () => 0), day('2026-09-15', () => 0, () => 0)]);
    // (2 + 5) and (2 + 0): mean 4.5, so 5
    expect(plan[0]?.days).toBe(2);
    expect(plan[0]?.neededHigh[0]).toBe(5);
  });

  it('stays far below the sum of 16 sub-zone highs', () => {
    // 16 sub-zones, margin 1 each, per interval
    const plan = buildPlan([day('2026-09-13', () => 4, () => 16), day('2026-09-14', () => 4, () => 16)]);
    expect(plan[0]?.needed[0]).toBe(8);
    expect(plan[0]?.neededHigh[0]).toBe(Math.ceil(8 + Math.sqrt(32)));
    expect(plan[0]?.neededHigh[0]).toBe(14);
    expect(plan[0]?.neededHigh[0]).toBeLessThan(8 + 32);
  });
});

describe('planRows', () => {
  const plan = buildPlan([day('2026-09-13', () => 0.3, () => 0.5), day('2026-09-14', () => 0.3, () => 0.5)]);
  const rows = planRows(plan, labels);

  it('lays out zone, three blocks and notes', () => {
    expect(rows[0]).toEqual(['Zone', 'منطقة']);
    const titles = rows.filter((r) => r[1] === '06:00').map((r) => r[0]);
    expect(titles).toEqual(['AVERAGE CASES', 'NEEDED STAFF', 'NEEDED STAFF (HIGH ESTIMATE)']);
    expect(rows.slice(-2)).toEqual([['n1'], ['n2']]);
  });

  it('writes header times as text, a Total column and plain numbers', () => {
    const header = rows.find((r) => r[0] === 'AVERAGE CASES');
    expect(header?.slice(1, 3)).toEqual(['06:00', '06:30']);
    expect(header?.[49]).toBe('Total');
    const avg = rows[3];
    expect(avg?.[0]).toBe('Weekdays');
    expect(avg?.[1]).toBe(0.6);
    expect(avg?.[49]).toBe(28.8);
    const needed = rows.find((r, i) => r[0] === 'Weekdays' && i > 3);
    expect(needed?.[1]).toBe(1);
    expect(needed?.[49]).toBe(48);
  });

  it('serialises with dot decimals and no separators', () => {
    const text = toCsv(planTable(plan, labels));
    expect(text.startsWith('﻿')).toBe(true);
    expect(text).toContain('Weekdays,0.6,0.6');
    for (const cell of rows.flat()) if (typeof cell === 'number') expect(String(cell)).toMatch(/^\d+(\.\d{1,2})?$/);
    expect(text).toContain('منطقة');
  });

  it('says so when there is no full planning day', () => {
    const empty = planRows([], labels);
    expect(empty).toContainEqual(['none']);
    expect(empty.filter((r) => r[1] === '06:00')).toHaveLength(3);
  });
});
