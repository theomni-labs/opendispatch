// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import type { ForecastBacktest, ForecastBacktestState } from '@/lib/types';
import { gateArm, improvementOf, isStale, mapeStatus, resultKey, sourcesOf, worstHours, type BacktestZone } from './backtest';

const arm = (wape: number | null) => ({ wape, mape: null, mae: null, rmse: null, range_coverage: null });

function latest(over: Partial<ForecastBacktest> = {}): ForecastBacktest {
  return {
    generated_at: '2026-09-13T02:00:00+03:00',
    data_source: 'SYNTHETIC',
    mixed_sources: false,
    illustrative: true,
    model_version: 'ensemble-4',
    held_out: { from: '2026-08-16', to: '2026-09-12', days: 28 },
    training: { from: null, to: null, features: null },
    gate: { result: 'pass', baseline: 'naive', min_improvement: 0.1, improvement: 0.2, worse_zones: 0, compared_zones: 8 },
    engine: arm(0.2),
    naive: arm(0.25),
    segment: arm(0.3),
    event_days: { days: 2, wape: null, baseline_wape: null },
    ordinary_days: { days: 26, wape: null, baseline_wape: null },
    weakest_zones: [],
    challenger: null,
    ...over,
  };
}

describe('the backtest card helpers', () => {
  it('measures improvement against a baseline, and none without one', () => {
    expect(improvementOf(0.2, 0.25)).toBeCloseTo(0.2);
    expect(improvementOf(0.3, 0.25)).toBeCloseTo(-0.2);
    expect(improvementOf(null, 0.25)).toBeNull();
    expect(improvementOf(0.2, 0)).toBeNull();
  });

  it('uses the arm the gate compared with', () => {
    expect(gateArm(latest()).wape).toBe(0.25);
    expect(gateArm(latest({ gate: { ...latest().gate, baseline: 'segment' } })).wape).toBe(0.3);
    expect(gateArm(latest({ gate: { ...latest().gate, baseline: 'segment' }, segment: null })).wape).toBe(0.25);
  });

  it('says better, only, or worse against the target', () => {
    expect(resultKey(0.2, 0.1)).toBe('resBetter');
    expect(resultKey(0.05, 0.1)).toBe('resShort');
    expect(resultKey(-0.05, 0.1)).toBe('resWorse');
    expect(resultKey(null, 0.1)).toBeNull();
  });

  it('marks a backtest of another model as stale', () => {
    const state = (model: string): ForecastBacktestState => ({ latest: latest(), run: { state: 'idle' }, active_model: model });
    expect(isStale(state('ensemble-4'))).toBe(false);
    expect(isStale(state('ensemble-5'))).toBe(true);
    expect(isStale({ latest: null, run: { state: 'idle' }, active_model: 'x' })).toBe(false);
  });

  it('lists the worst hours, highest error first', () => {
    const zone: BacktestZone = {
      zone_id: 'z',
      wape: 0.3,
      baseline_wape: 0.4,
      actual_total: 200,
      hours: [
        { hour: 8, wape: 0.2, baseline_wape: 0.3 },
        { hour: 17, wape: 0.5, baseline_wape: 0.4 },
        { hour: 3, wape: null, baseline_wape: null },
        { hour: 12, wape: 0.4, baseline_wape: 0.4 },
      ],
    };
    expect(worstHours(zone).map((h) => h.hour)).toEqual([17, 12, 8]);
  });

  it('shows both sources when the cases were mixed', () => {
    expect(sourcesOf({ data_source: 'SYNTHETIC', mixed_sources: false })).toEqual(['SYNTHETIC']);
    expect(sourcesOf({ data_source: 'SYNTHETIC', mixed_sources: true })).toEqual(['SYNTHETIC', 'IMPORTED']);
  });

  it('rates the backtest MAPE against the target', () => {
    expect(mapeStatus(0.12, 0.15)).toBe('ok');
    expect(mapeStatus(0.15, 0.15)).toBe('ok');
    expect(mapeStatus(0.241, 0.15)).toBe('above');
    expect(mapeStatus(null, 0.15)).toBeNull();
    expect(mapeStatus(0.1, null)).toBeNull();
  });
});
