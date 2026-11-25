// SPDX-License-Identifier: AGPL-3.0-only
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildContext, fixtureTenantId } from '@/lib/data/go-test-reset';
import { getForecastTimeline } from '@/lib/data/forecast';
import { fixtureUsers } from '@/lib/data/go-test-reset';
import type { RequestContext } from '@/lib/data/guard';
import { createForecastRun } from '@/lib/data/models';
import { nextDate, segmentOf } from './planFormat';
import { buildPlanExport } from './planExport';

vi.mock('next-intl/server', () => ({
  getTranslations: async () => (key: string, values?: Record<string, unknown>) => (values === undefined ? key : `${key} ${JSON.stringify(values)}`),
}));

// Live: skips, never fakes, if OPENDISPATCH_API_URL unset.
const hasApi = process.env['OPENDISPATCH_API_URL'] !== undefined && process.env['OPENDISPATCH_API_URL'] !== '';

const RD_C = '091ff2b2-f0e1-4b97-bfc9-7cdd0698c32a';

beforeEach(async () => {
  const url = process.env['OPENDISPATCH_API_URL'];
  if (url !== undefined && url !== '') await fetch(`${url}/_internal/test/reset`, { method: 'POST' }).catch(() => undefined);
});

function ctxOf(): RequestContext {
  const built = buildContext({ role: 'planner', installMode: 'private', zoneIds: [RD_C] }, fixtureUsers(), fixtureTenantId());
  if (built === null) throw new Error('no context');
  return built;
}

function rowsOf(text: string): string[][] {
  return text
    .replace(/^﻿/, '')
    .split('\r\n')
    .map((line) => line.split(','));
}

describe.skipIf(!hasApi)('buildPlanExport (live, real api and Postgres)', () => {
  it('matches the forecast timeline for a segment and a window', async () => {
    const ctx = ctxOf();
    const admin = buildContext({ role: 'administrator', installMode: 'private', zoneIds: [RD_C] }, fixtureUsers(), fixtureTenantId());
    if (admin === null) throw new Error('no admin context');
    await createForecastRun(admin, { horizon_start_date: '2026-09-13', horizon_days: 10 });
    const file = await buildPlanExport(ctx, RD_C, 'en');
    expect(file.mime).toMatch(/^text\/csv/);
    const rows = rowsOf(file.text);
    expect(rows[0]).toEqual(['plan.zone', 'Riyadh Central']);
    const avg = rows.find((r) => r[0] === 'AVERAGE CASES');
    expect(avg?.[1]).toBe('06:00');
    const first = rows.findIndex((r) => r[0] === 'AVERAGE CASES') + 1;
    const segment = rows[first];
    expect(segment?.[0]).toMatch(/^(Weekdays|Thursday|Friday|Saturday)$/);
    // recompute the 06:00 and 00:00 windows of that segment from the data function
    const dates = ['2026-09-13', '2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18', '2026-09-19', '2026-09-20', '2026-09-21', '2026-09-22'];
    const timelines = new Map(await Promise.all(dates.map(async (d) => [d, await getForecastTimeline(ctx, { zone_id: RD_C, date: d })] as const)));
    const at = (d: string, i: number) => timelines.get(d)?.intervals.find((x) => x.interval_index === i)?.expected ?? 0;
    const planDays = dates.filter((d) => timelines.has(nextDate(d)) && segmentOf(d) === (segment?.[0] === 'Weekdays' ? 'weekdays' : (segment?.[0] ?? '').toLowerCase()));
    const mean = (f: (d: string) => number) => planDays.reduce((s, d) => s + f(d), 0) / planDays.length;
    const w0 = mean((d) => at(d, 24) + at(d, 25));
    const wMid = mean((d) => at(nextDate(d), 0) + at(nextDate(d), 1));
    expect(Number(segment?.[1])).toBeCloseTo(Math.round(w0 * 100) / 100, 2);
    expect(Number(segment?.[37])).toBeCloseTo(Math.round(wMid * 100) / 100, 2);
    const needed = rows[rows.findIndex((r) => r[0] === 'NEEDED STAFF') + 1];
    expect(Number(needed?.[1])).toBe(Math.ceil(w0 - 1e-9));
    // high: expected plus sub-zone margins in quadrature
    const high = rows[rows.findIndex((r) => r[0] === 'NEEDED STAFF (HIGH ESTIMATE)') + 1];
    const cells = (r: string[] | undefined) => (r ?? []).slice(1, 49).map(Number);
    cells(high).forEach((v, k) => expect(v).toBeGreaterThanOrEqual(cells(needed)[k] ?? 0));
    expect(Number(high?.[49])).toBeLessThan(2 * Number(needed?.[49]));
    expect(file.text).toContain('plan.noteStaff');
  });

  it('is a file with notes, no throw, for a zone the run does not know', async () => {
    const file = await buildPlanExport(ctxOf(), '00000000-0000-4000-8000-000000000000', 'en');
    expect(file.text).toContain('plan.empty');
  });
});
