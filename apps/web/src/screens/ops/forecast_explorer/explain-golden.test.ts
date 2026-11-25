// SPDX-License-Identifier: AGPL-3.0-only
import fs from 'node:fs';
import path from 'node:path';
import { formatPercent, time } from '@opendispatch/ui/format';
import { describe, expect, it } from 'vitest';
import { forecastStats, seriesOf } from './stats';

// The Go Explain facts test reads the same file.
const golden = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '../../../../../api-go/internal/business/testdata/explain_screens.json'), 'utf8'));
const fx = golden.forecast;

describe('Forecast Explorer stats equal the Explain facts (shared golden)', () => {
  it('expected, peak, range at peak and field share', () => {
    const stats = forecastStats(seriesOf(fx.intervals));
    const want = fx.screen;
    expect(stats.expected).toBe(want.expected);
    expect(time(stats.peakIndex * 15)).toBe(want.peak);
    expect([stats.rangeLow, stats.rangeHigh]).toEqual([want.range_low, want.range_high]);
    // view.ts: the zone's field_share, as is
    expect(formatPercent(fx.field_share, 'en')).toBe(want.field);
  });
});
