// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import type { RollingForecastAccuracy } from '@/lib/types';
import { accuracyFigure } from './rollingAccuracy';

const figures = (mape: number | null) => ({ mape, wape: mape, forecast: 10, actual: mape === null ? 0 : 10, days: 28, target_status: mape === null ? null : mape <= 0.15 ? 'at_or_below' : 'above' });
const state = (overall: number | null, zones: (number | null)[]) =>
  ({
    window_days: 28,
    mape_target: 0.15,
    illustrative: true,
    overall: overall === null ? null : figures(overall),
    zones: zones.map((m, i) => ({ zone_id: `z${String(i)}`, figures: figures(m) })),
  }) as unknown as RollingForecastAccuracy;

describe('the rolling MAPE figure and alert', () => {
  it('is null when the read failed or was refused', () => {
    expect(accuracyFigure(null)).toBeNull();
  });

  it('carries the MAPE, the target, the window and the zones above target', () => {
    expect(accuracyFigure(state(0.172, [0.12, 0.18, 0.21, null]))).toEqual({ mape: 0.172, target: 0.15, days: 28, illustrative: true, status: 'above', zones: 3, zonesAbove: 2 });
  });

  it('has no MAPE and no status before the first window', () => {
    expect(accuracyFigure(state(null, []))).toMatchObject({ mape: null, status: null, zones: 0, zonesAbove: 0 });
  });
});
