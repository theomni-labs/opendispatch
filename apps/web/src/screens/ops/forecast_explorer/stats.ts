// SPDX-License-Identifier: AGPL-3.0-only
// Top stats, pure (Explain mirrors them)

export interface ForecastStats {
  readonly expected: number;
  readonly peakIndex: number;
  readonly peakValue: number;
  readonly rangeLow: number;
  readonly rangeHigh: number;
}

/** One interval as the timeline read gives it. */
export interface SeriesPoint {
  readonly interval_index: number;
  readonly low: number;
  readonly expected: number;
  readonly high: number;
}

/** 96 slots each; missing intervals stay 0. */
export function seriesOf(points: readonly SeriesPoint[]): { low: number[]; expected: number[]; high: number[] } {
  const low = new Array<number>(96).fill(0);
  const expected = new Array<number>(96).fill(0);
  const high = new Array<number>(96).fill(0);
  for (const p of points) {
    low[p.interval_index] = p.low;
    expected[p.interval_index] = p.expected;
    high[p.interval_index] = p.high;
  }
  return { low, expected, high };
}

/** The first highest interval. */
export function peakOf(values: readonly number[]): number {
  let peak = 0;
  values.forEach((v, i) => {
    if (v > (values[peak] ?? -Infinity)) peak = i;
  });
  return peak;
}

/** Day total, peak, likely range at the peak. */
export function forecastStats(series: { readonly low: readonly number[]; readonly expected: readonly number[]; readonly high: readonly number[] }): ForecastStats {
  const peakIndex = peakOf(series.expected);
  return {
    expected: Math.round(series.expected.reduce((s, v) => s + v, 0)),
    peakIndex,
    peakValue: series.expected[peakIndex] ?? 0,
    rangeLow: Math.round(series.low[peakIndex] ?? 0),
    rangeHigh: Math.round(series.high[peakIndex] ?? 0),
  };
}
