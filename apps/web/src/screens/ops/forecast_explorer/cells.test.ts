// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { cellBounds, cellFeatureCollection, cellLevel, hourExpectedOf, timeOfDayFactor, type FxCell } from './cells';

const cell = (id: string, probability: number, pooled = false, south = 24.7, west = 46.7): FxCell => ({ id, probability, pooled, south, west, north: south + 0.0055, east: west + 0.011 });

describe('the micro-cell layer', () => {
  it('buckets cells in five steps of the top cell', () => {
    expect([0.4, 0.3, 0.17, 0.09, 0.01].map((p) => cellLevel(p, 0.4))).toEqual([5, 4, 3, 2, 1]);
    expect(cellLevel(0.2, 0)).toBe(1);
  });

  it('draws squares and marks the pooled rest without a level', () => {
    const fc = cellFeatureCollection([cell('th3n0b', 0.6), cell('th3n0c', 0.3), cell('th3n0', 0.1, true)]);
    expect(fc.features.map((f) => f.properties)).toEqual([
      { id: 'th3n0b', level: 5, pooled: 0 },
      { id: 'th3n0c', level: 3, pooled: 0 },
      { id: 'th3n0', level: 0, pooled: 1 },
    ]);
    expect(fc.features[0]?.geometry.coordinates[0]).toHaveLength(5);
  });

  it('fits to the listed cells, not the pool', () => {
    const box = cellBounds([cell('a', 0.5, false, 24.7, 46.7), cell('b', 0.4, false, 24.71, 46.72), cell('p', 0.1, true, 20, 40)]);
    expect(box?.flat().map((v) => Number(v.toFixed(4)))).toEqual([46.7, 24.7, 46.731, 24.7155]);
    expect(cellBounds([cell('p', 1, true)])).toBeNull();
  });
});

describe('why-card helpers', () => {
  const day = Array.from({ length: 96 }, (_, i) => (i === 60 ? 4 : 1));
  it('gives the interval against the day mean', () => {
    expect(timeOfDayFactor(day, 60)).toBeCloseTo((4 * 96) / 99, 6);
    expect(timeOfDayFactor(new Array<number>(96).fill(0), 3)).toBe(0);
  });
  it('sums the hour holding the interval', () => {
    expect(hourExpectedOf(day, 61)).toBe(7);
    expect(hourExpectedOf(day, 3)).toBe(4);
  });
});
