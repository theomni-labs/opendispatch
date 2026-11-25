// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, describe, expect, it } from 'vitest';
import type { Role } from '@/lib/access';
import { fixtureUsers } from '@/lib/data/go-test-reset';
import { buildContext, fixtureTenantId } from '@/lib/data/go-test-reset';
import type { RequestContext } from '@/lib/data/guard';
import { loadProductivityMetricsView } from './view';

// Live: skips, never fakes, if OPENDISPATCH_API_URL unset.
// Zones shared with other live
// files: the kingdom-wide zone count is a floor.
const hasApi = process.env['OPENDISPATCH_API_URL'] !== undefined && process.env['OPENDISPATCH_API_URL'] !== '';
if (!hasApi) console.log('OPENDISPATCH_API_URL is not set: view.live.test.ts is skipped, not faked.');

// Server side vs the real data layer and
// fixtures: fixtures/rollups/productivity_
// rollups.json (8 zone rows, 252 agent rows,
// the week 6-12 Sep 2026) and fixtures/cases
// (6,039 field cases the same week), the same
// numbers docs/mockups/screens/ops-productivity-
// metrics.html was built to illustrate.

afterEach(() => {
});

const RD_C = '091ff2b2-f0e1-4b97-bfc9-7cdd0698c32a';
const RD_N = 'eecf5c7f-237c-443c-b331-b75ba3fb26fc';
const RD_E = '555117e3-96d2-43fc-9fb1-45ec4ed1d8ad';

function ctxOf(role: Role, zoneIds: string[] = [RD_C, RD_N, RD_E]): RequestContext {
  const tenant = fixtureTenantId();
  const built = buildContext({ role, installMode: 'private', zoneIds }, fixtureUsers(), tenant);
  if (built === null) throw new Error(`no context for ${role}`);
  return built;
}
const admin = () => ctxOf('administrator');
const planner = () => ctxOf('planner');

describe.skipIf(!hasApi)('loadProductivityMetricsView (live, real api and Postgres)', () => {
  describe('the kingdom-wide week', () => {
    it('shows the week, every zone and agent, and both readings', async () => {
      const view = await loadProductivityMetricsView(admin(), {}, 'en');
      expect(view.isEmpty).toBe(false);
      expect(view.sources).toEqual(['SYNTHETIC']);
      expect(view.periodStart).toBe('2026-09-06');
      expect(view.periodEnd).toBe('2026-09-12');
      expect(view.zoneOptions.length).toBeGreaterThanOrEqual(8);
      expect(view.rows).toHaveLength(252);
      expect(view.stats.agents).toBe(252);
      expect(view.stats.cases).toBe(6039);
      expect(view.reading.clockStart).toBe('assignment');
      expect(view.reading.primaryKey).toBe('from_assignment');
      expect(view.reading.primarySeconds).toBeGreaterThan(0);
      expect(view.reading.secondarySeconds).toBeGreaterThan(0);
      expect(JSON.parse(JSON.stringify(view))).toEqual(view); // plain data: it crosses to the client
    });

    it('buckets every field case into the to-scene histogram (zone "all")', async () => {
      const view = await loadProductivityMetricsView(admin(), {}, 'en');
      expect(view.toScene.labels).toHaveLength(16);
      expect(view.toScene.labels[15]).toBe('30+');
      expect(view.toScene.counts.reduce((sum, n) => sum + n, 0)).toBe(6039);
      expect(view.onScene.counts.reduce((sum, n) => sum + n, 0)).toBe(6039);
    });

    it('shows a zone-by-hour heat map, one row per zone, six 4-hour columns', async () => {
      const view = await loadProductivityMetricsView(admin(), {}, 'en');
      expect(view.heat.rows.length).toBeGreaterThanOrEqual(8);
      expect(view.heat.columns).toEqual(['00:00', '04:00', '08:00', '12:00', '16:00', '20:00']);
      for (const row of view.heat.values) expect(row).toHaveLength(6);
    });

    it('the clock toggle changes which histogram is bucketed', async () => {
      const fromAssignment = await loadProductivityMetricsView(admin(), {}, 'en');
      const fromRegistration = await loadProductivityMetricsView(admin(), { clock: 'r' }, 'en');
      expect(fromRegistration.clock).toBe('r');
      expect(fromRegistration.toScene.medianSeconds).not.toBe(fromAssignment.toScene.medianSeconds);
      expect(fromRegistration.onScene.medianSeconds).toBe(fromAssignment.onScene.medianSeconds); // unaffected by clock
    });

    it('?zone= narrows the histograms to one zone, without narrowing the table', async () => {
      const all = await loadProductivityMetricsView(admin(), {}, 'en');
      const view = await loadProductivityMetricsView(admin(), { zone: RD_C }, 'en');
      expect(view.zone).toBe(RD_C);
      expect(view.toScene.counts.reduce((sum, n) => sum + n, 0)).toBeLessThan(all.toScene.counts.reduce((sum, n) => sum + n, 0));
      expect(view.rows).toHaveLength(252);
    });
  });

  describe('the agent table', () => {
    it('sorts by cases handled, descending, by default', async () => {
      const view = await loadProductivityMetricsView(admin(), {}, 'en');
      expect(view.sort).toEqual({ key: 'cases', direction: 'desc' });
      const cases = view.rows.map((r) => r.cases);
      expect(cases).toEqual([...cases].sort((a, b) => b - a));
    });

    it('?sort=name:asc sorts by name', async () => {
      const view = await loadProductivityMetricsView(admin(), { sort: { key: 'name', direction: 'asc' } }, 'en');
      const names = view.rows.map((r) => r.name);
      expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
    });

    it('?fcases=hi keeps only agents with 30 or more cases', async () => {
      const view = await loadProductivityMetricsView(admin(), { fcases: 'hi' }, 'en');
      expect(view.rows.length).toBeGreaterThan(0);
      for (const row of view.rows) expect(row.cases).toBeGreaterThanOrEqual(30);
    });

    it('?fspeed=fast keeps only agents under 10 minutes, from assignment', async () => {
      const view = await loadProductivityMetricsView(admin(), { fspeed: 'fast' }, 'en');
      expect(view.rows.length).toBeGreaterThan(0);
      for (const row of view.rows) expect(row.assignedSeconds ?? 600).toBeLessThan(600);
    });

    it('?fzone= keeps only that zone', async () => {
      const view = await loadProductivityMetricsView(admin(), { fzone: RD_C }, 'en');
      expect(view.rows.length).toBeGreaterThan(0);
      const zoneCode = view.rows[0]?.zoneCode;
      for (const row of view.rows) expect(row.zoneCode).toBe(zoneCode);
    });

    it('?q= searches the agent name and code', async () => {
      const base = await loadProductivityMetricsView(admin(), {}, 'en');
      const target = base.rows[0];
      expect(target).toBeDefined();
      const view = await loadProductivityMetricsView(admin(), { q: target?.code }, 'en');
      expect(view.rows.some((r) => r.id === target?.id)).toBe(true);
    });

    it('a search that matches nothing gives an empty table, not an error', async () => {
      const view = await loadProductivityMetricsView(admin(), { q: 'no such agent at all' }, 'en');
      expect(view.rows).toEqual([]);
    });
  });

  describe('the agent drawer', () => {
    it('?agent= opens the week for that agent', async () => {
      const base = await loadProductivityMetricsView(admin(), {}, 'en');
      const target = base.rows[0];
      expect(target).toBeDefined();
      const view = await loadProductivityMetricsView(admin(), { agent: target?.id }, 'en');
      expect(view.drawer).toBeDefined();
      expect(view.drawer?.name).toBe(target?.name);
      expect(view.drawer?.cases).toBe(target?.cases);
      expect(view.drawer?.days.length).toBeGreaterThan(0);
      expect(view.drawer?.days.reduce((sum, d) => sum + d.cases, 0)).toBe(target?.cases);
      expect(view.drawer?.zoneMedianSeconds).toBeGreaterThan(0);
    });

    it('an unknown ?agent= leaves the drawer closed, not an error', async () => {
      const view = await loadProductivityMetricsView(admin(), { agent: '00000000-0000-0000-0000-000000000000' }, 'en');
      expect(view.drawer).toBeUndefined();
    });
  });

  describe('zone scope', () => {
    it('a Planner scoped to three zones sees only those zones', async () => {
      const view = await loadProductivityMetricsView(planner(), {}, 'en');
      expect(view.isEmpty).toBe(false);
      expect(view.zoneOptions).toHaveLength(3);
      expect(view.heat.rows).toHaveLength(3);
      const zoneCodes = new Set(view.rows.map((r) => r.zoneCode));
      expect(zoneCodes).toEqual(new Set(['RD-C', 'RD-N', 'RD-E']));
    });
  });

  // NOT COVERED: isEmpty (no rollup at all) has
  // no test here, same as Service-Level
  // Simulator's own precedent - the fixtures
  // always seed the week's rollups and a screen
  // may not remove fixture rows to force it
  //.
});
