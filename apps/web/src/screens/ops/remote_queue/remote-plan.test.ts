// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { dayLoad, durations, gapRuns, groupDurations, median, type PlanInterval } from './remote-plan';

const iv = (index: number, required: number, planned: number): PlanInterval => ({ index, required, planned });
describe('dayLoad', () => {
  it('sums quarter hours and finds the worst interval', () => {
    const load = dayLoad([iv(0, 4, 2), iv(1, 2, 2), iv(2, 4, 1)]);
    expect(load.demandHours).toBe(2.5);
    expect(load.capacityHours).toBe(1.25);
    expect(load.gapHours).toBe(-1.25);
    expect(load.worst).toEqual({ delta: -3, index: 2 });
  });
  it('has no worst interval without a gap', () => {
    expect(dayLoad([iv(0, 1, 2)]).worst).toBeNull();
  });
});

describe('gapRuns', () => {
  it('joins neighbouring short intervals and keeps the worst shortfall', () => {
    expect(gapRuns([iv(4, 3, 1), iv(5, 5, 1), iv(6, 1, 1), iv(8, 2, 1)])).toEqual([
      { from: 1, to: 1.5, short: 4 },
      { from: 2, to: 2.25, short: 1 },
    ]);
  });
});

describe('median', () => {
  it('handles odd, even and empty', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(median([])).toBeNull();
  });
});

describe('durations', () => {
  const cases = [
    { registeredAt: '2026-09-12T00:00:00+03:00', reviewAt: '2026-09-12T12:30:00+03:00', closedAt: '2026-09-12T13:00:00+03:00', caseTypeId: 'n' },
    { registeredAt: '2026-09-12T10:00:00+03:00', reviewAt: '2026-09-12T10:30:00+03:00', closedAt: '2026-09-12T11:10:00+03:00', caseTypeId: 'n' },
    { registeredAt: '2026-09-12T22:00:00+03:00', reviewAt: null, closedAt: null, caseTypeId: 'm' },
  ];
  it('measures wait, complete and receipt to close over cases with both ends', () => {
    const d = durations(cases);
    expect(d.cases).toBe(3);
    expect(d.handled).toBe(2);
    expect(d.waitSeconds).toBe((750 * 60 + 30 * 60) / 2);
    expect(d.completeSeconds).toBe(35 * 60);
    expect(d.meanCompleteSeconds).toBe(35 * 60);
    expect(d.receiptToCloseSeconds).toBe((780 * 60 + 70 * 60) / 2);
  });
  it('groups by key, largest first, skipping null keys', () => {
    const g = groupDurations(cases, (c) => (c.caseTypeId === 'x' ? null : c.caseTypeId));
    expect(g.map((x) => [x.key, x.durations.cases])).toEqual([
      ['n', 2],
      ['m', 1],
    ]);
  });
});
