// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import type { Role } from '@/lib/access';
import { listAllCases } from '@/lib/data/cases';
import { dateOf, epochOf, toRiyadhIso } from '@/lib/data/context';
import { listProductivityRollups } from '@/lib/data/dashboards';
import { updateClockStart } from '@/lib/data/settings';
import { buildContext, fixtureTenantId, fixtureUsers } from '@/lib/data/go-test-reset';
import type { RequestContext } from '@/lib/data/guard';
import type { Case } from '@/lib/types';
import { loadProductivityMetricsView, type ProductivityMetricsQuery, type ProductivityMetricsView } from './view';

// Live: SQL durations equal the old case pass.
const hasApi = process.env['OPENDISPATCH_API_URL'] !== undefined && process.env['OPENDISPATCH_API_URL'] !== '';
if (!hasApi) console.log('OPENDISPATCH_API_URL is not set: view.parity.live.test.ts is skipped, not faked.');

const RD_C = '091ff2b2-f0e1-4b97-bfc9-7cdd0698c32a';
const RD_N = 'eecf5c7f-237c-443c-b331-b75ba3fb26fc';
const RD_E = '555117e3-96d2-43fc-9fb1-45ec4ed1d8ad';

function ctxOf(role: Role, zoneIds: string[] = [RD_C, RD_N, RD_E]): RequestContext {
  const built = buildContext({ role, installMode: 'private', zoneIds }, fixtureUsers(), fixtureTenantId());
  if (built === null) throw new Error(`no context for ${role}`);
  return built;
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2 : (sorted[mid] as number);
}

function durationsOf(c: Case): { a: number; r: number; s: number } | null {
  if (c.assigned_at === null || c.arrived_at === null || c.on_scene_completed_at === undefined || c.on_scene_completed_at === null) return null;
  return {
    a: (epochOf(c.arrived_at) - epochOf(c.assigned_at)) / 1000,
    r: (epochOf(c.arrived_at) - epochOf(c.registered_at)) / 1000,
    s: (epochOf(c.on_scene_completed_at) - epochOf(c.arrived_at)) / 1000,
  };
}

function histogram(values: readonly number[]): { counts: number[]; medianSeconds: number | null } {
  const counts = new Array<number>(16).fill(0);
  for (const v of values) {
    const idx = Math.floor(v / 120);
    const at = idx >= 15 ? 15 : Math.max(0, idx);
    counts[at] = (counts[at] ?? 0) + 1;
  }
  return { counts, medianSeconds: median(values) };
}

// The view's old figures, from listAllCases.
async function oldFigures(ctx: RequestContext, view: ProductivityMetricsView, query: ProductivityMetricsQuery, zoneIdsByRow: readonly string[], heatClock: 'a' | 'r' = 'a') {
  const cases = await listAllCases(ctx, { handling: 'field', date_from: view.periodStart, date_to: view.periodEnd });
  const pick = (c: Case) => query.zone === undefined || query.zone === '' || c.zone_id === query.zone;
  const all = cases.map((c) => [c, durationsOf(c)] as const).filter((p): p is readonly [Case, { a: number; r: number; s: number }] => p[1] !== null);
  const shown = all.filter(([c]) => pick(c));
  const heat = zoneIdsByRow.map((zoneId) =>
    [0, 4, 8, 12, 16, 20].map((block) => {
      const values = all.filter(([c]) => c.zone_id === zoneId && c.assigned_at !== null && Math.floor(Number(toRiyadhIso(epochOf(c.assigned_at)).slice(11, 13)) / 4) * 4 === block).map(([, d]) => d[heatClock]);
      const cell = values.length === 0 ? null : median(values);
      const delta = cell === null ? null : Math.round((((median(all.map(([, d]) => d[heatClock])) ?? 0) - cell) / 60) * 10) / 10;
      return delta === null ? null : delta === 0 ? 0 : delta;
    }),
  );
  const mine = cases.filter((c) => query.agent !== undefined && c.agent_id === query.agent);
  const dates = [...new Set(mine.map((c) => dateOf(c.registered_at)))].sort();
  const days = dates.map((date) => {
    const day = mine.filter((c) => dateOf(c.registered_at) === date);
    const ds = day.map(durationsOf).filter((d) => d !== null);
    return { date, cases: day.length, assignedSeconds: median(ds.map((d) => d.a)), onSceneSeconds: median(ds.map((d) => d.s)) };
  });
  return {
    toScene: histogram(shown.map(([, d]) => (query.clock === 'r' ? d.r : d.a))),
    onScene: histogram(shown.map(([, d]) => d.s)),
    heat,
    primary: median(all.map(([, d]) => d.a)),
    secondary: median(all.map(([, d]) => d.r)),
    onSceneMedian: median(all.map(([, d]) => d.s)),
    days,
  };
}

describe.skipIf(!hasApi)('productivity durations: same numbers as the old pass over cases (live)', () => {
  it.each([
    ['administrator', {}],
    ['administrator', { clock: 'r' }],
    ['administrator', { zone: RD_N }],
    ['administrator', { zone: RD_E, clock: 'r' }],
    ['planner', {}],
    ['planner', { zone: RD_C }],
  ] as const)('%s %o', async (role, query) => {
    const ctx = ctxOf(role);
    const base = await loadProductivityMetricsView(ctx, {}, 'en');
    const agent = base.rows[3]?.id;
    expect(agent).toBeDefined();
    const q: ProductivityMetricsQuery = { ...query, agent };
    const view = await loadProductivityMetricsView(ctx, q, 'en');
    const old = await oldFigures(ctx, view, q, await heatZoneIds(ctx, view));
    expect({ counts: view.toScene.counts, medianSeconds: view.toScene.medianSeconds }).toEqual(old.toScene);
    expect({ counts: view.onScene.counts, medianSeconds: view.onScene.medianSeconds }).toEqual(old.onScene);
    expect(view.heat.values).toEqual(old.heat);
    expect(view.reading.primarySeconds).toBe(old.primary);
    expect(view.reading.secondarySeconds).toBe(old.secondary);
    expect(view.stats.onSceneMedianSeconds).toBe(old.onSceneMedian);
    expect(view.drawer?.days).toEqual(old.days);
    expect(old.days.length).toBeGreaterThan(0);
    expect(old.toScene.counts.reduce((sum, n) => sum + n, 0)).toBeGreaterThan(0);
  });

  it('draws the heat map on the registration clock when the setting says so', async () => {
    const admin = ctxOf('administrator');
    await updateClockStart(admin, { clock_start: 'registration' });
    try {
      const view = await loadProductivityMetricsView(admin, {}, 'en');
      expect(view.heat.clock).toBe('r');
      const old = await oldFigures(admin, view, {}, await heatZoneIds(admin, view), 'r');
      expect(view.heat.values).toEqual(old.heat);
      expect(view.heat.values.flat().some((v) => v !== null)).toBe(true);
    } finally {
      await updateClockStart(admin, { clock_start: 'assignment' });
    }
  });
});

// The zone of each heat row, in the view's order.
async function heatZoneIds(ctx: RequestContext, view: ProductivityMetricsView): Promise<string[]> {
  const rows = (await listProductivityRollups(ctx, { group_by: 'zone', limit: 200 })).items;
  expect(rows).toHaveLength(view.heat.rows.length);
  return rows.map((r) => r.zone_id ?? '');
}
