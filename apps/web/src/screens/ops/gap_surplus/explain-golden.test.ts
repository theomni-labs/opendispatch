// SPDX-License-Identifier: AGPL-3.0-only
import fs from 'node:fs';
import path from 'node:path';
import { formatPercent } from '@opendispatch/ui/format';
import { describe, expect, it } from 'vitest';
import { gapStats, type StatsCell, type StatsRow } from './stats';

// The Go Explain facts test reads the same file.
const golden = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '../../../../../api-go/internal/business/testdata/explain_screens.json'), 'utf8'));

interface GoldenZone {
  readonly id: string;
  readonly extra: { readonly code: string };
}

// Rows as view.ts builds them, in order.
function rowsOf(): StatsRow[] {
  const cells = golden.gap.cells as (StatsCell & { zone_id: string })[];
  return (golden.zones as GoldenZone[]).map((z) => ({
    code: z.extra.code,
    cells: cells.filter((c) => c.zone_id === z.id).sort((a, b) => a.interval_index - b.interval_index),
  }));
}

describe('Gap and Surplus stats equal the Explain facts (shared golden)', () => {
  it('counts, shares, worst gap and causes', () => {
    const { stats, causeCounts } = gapStats(rowsOf(), undefined);
    const want = golden.gap.screen;
    expect(stats.gaps).toBe(want.gaps);
    expect(stats.surplus).toBe(want.surplus);
    expect(formatPercent(stats.met, 'en')).toBe(want.met);
    expect(formatPercent(stats.outOfReach, 'en')).toBe(want.out_of_reach);
    expect(stats.worst).toEqual({ value: want.worst.value, zoneCode: want.worst.zone_code, timeLabel: want.worst.time });
    expect(stats.mainCause).toBe(want.main_cause);
    expect(causeCounts).toEqual(want.cause_counts);
  });
});
