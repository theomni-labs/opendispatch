// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import type { ForecastAccuracy } from '@/lib/types';
import { cityRows, rowsMape } from './accuracy';

const figures = { forecast: 10, actual: 8, difference: 0.25, wape: 0.3, within_range: 0.9 };

describe('forecast against actual: the zone rows', () => {
  it('keeps the city zones that have figures, in the city order', () => {
    const acc = { zones: [{ zone_id: 'b', figures }, { zone_id: 'x', figures }, { zone_id: 'a', figures }] } as unknown as ForecastAccuracy;
    const rows = cityRows(acc, [
      { id: 'a', code: 'RD-C', name: 'Riyadh Central' },
      { id: 'b', code: 'RD-N', name: 'Riyadh North' },
      { id: 'c', code: 'RD-E', name: 'Riyadh East' },
    ]);
    expect(rows.map((r) => [r.zone_id, r.zone.code])).toEqual([
      ['a', 'RD-C'],
      ['b', 'RD-N'],
    ]);
  });
});

describe('forecast against actual: MAPE over the shown zone-days', () => {
  const row = (forecast: number, actual: number) => ({ figures: { ...figures, forecast, actual } });

  it('averages the absolute percentage difference of each zone', () => {
    expect(rowsMape([row(12, 10), row(6, 8)])).toBeCloseTo((0.2 + 0.25) / 2, 10);
  });

  it('leaves out zones with no cases', () => {
    expect(rowsMape([row(5, 0), row(9, 10)])).toBeCloseTo(0.1, 10);
  });

  it('is null with no zone that had cases', () => {
    expect(rowsMape([])).toBeNull();
    expect(rowsMape([row(3, 0)])).toBeNull();
  });
});
