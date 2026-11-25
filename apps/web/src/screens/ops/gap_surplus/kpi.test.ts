// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { cellMetShare, cellOutOfReach, cellValue, demandMetShare, outOfReachShare } from './kpi';

describe('demand met', () => {
  it('caps planned at required per cell', () => {
    expect(cellMetShare({ required: 4, planned: 3 })).toBe(0.75);
    expect(cellMetShare({ required: 4, planned: 9 })).toBe(1);
    expect(cellMetShare({ required: 0, planned: 0 })).toBe(1);
  });

  it('weights the share by required, a surplus never offsets a gap', () => {
    expect(demandMetShare([{ required: 4, planned: 2 }, { required: 6, planned: 10 }])).toBe(0.8);
    expect(demandMetShare([{ required: 0, planned: 2 }])).toBeNull();
  });
});

describe('out of 10-minute reach', () => {
  it('is one minus the reach share, null without it', () => {
    expect(cellOutOfReach({ required: 2, planned: 2, reach_share: 0.9 })).toBeCloseTo(0.1);
    expect(cellOutOfReach({ required: 2, planned: 2 })).toBeNull();
  });

  it('weights by required and skips cells without reach', () => {
    const cells = [
      { required: 3, planned: 3, reach_share: 1 },
      { required: 1, planned: 1, reach_share: 0.6 },
      { required: 5, planned: 5 },
    ];
    expect(outOfReachShare(cells)).toBeCloseTo(0.1);
    expect(outOfReachShare([{ required: 1, planned: 1 }])).toBeNull();
  });
});

describe('grid value', () => {
  const cell = { required: 4, planned: 3, delta: -1, reach_share: 0.82 };
  it('shows delta, percent unmet or percent out of reach', () => {
    expect(cellValue(cell, 'delta')).toBe(-1);
    expect(cellValue(cell, 'met')).toBe(25);
    expect(cellValue(cell, 'reach')).toBe(18);
    expect(cellValue({ required: 1, planned: 1, delta: 0 }, 'reach')).toBeNull();
  });
});
