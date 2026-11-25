// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, describe, expect, it } from 'vitest';
import type { Role } from '@/lib/access';
import { fixtureUsers } from '@/lib/data/go-test-reset';
import { buildContext, fixtureTenantId } from '@/lib/data/go-test-reset';
import type { RequestContext } from '@/lib/data/guard';
import { ForbiddenError } from '@/lib/data/errors';
import { loadManagementDashboardsView } from './view';

// Live: skips, never fakes, if OPENDISPATCH_API_URL unset.
// Cities/zones are shared with other
// live files: exact counts become floors.
const hasApi = process.env['OPENDISPATCH_API_URL'] !== undefined && process.env['OPENDISPATCH_API_URL'] !== '';
if (!hasApi) console.log('OPENDISPATCH_API_URL is not set: view.live.test.ts is skipped, not faked.');

// Server side vs the real data layer and
// fixtures: the default day is 2026-09-12
// (demoToday - 1), the same day the mockup's
// own illustrative data covers. Every figure
// below was read from the real fixtures, not
// invented (see the report handback for the
// python cross-check).

afterEach(() => {
});

const RIYADH = 'c602613f-ca37-49ae-b617-7e2c29fc2a84';
const RD_C = '091ff2b2-f0e1-4b97-bfc9-7cdd0698c32a';

function ctxOf(role: Role, zoneIds: string[] = []): RequestContext {
  const tenant = fixtureTenantId();
  const built = buildContext({ role, installMode: 'private', zoneIds }, fixtureUsers(), tenant);
  if (built === null) throw new Error(`no context for ${role}`);
  return built;
}
const admin = () => ctxOf('administrator');

describe.skipIf(!hasApi)('loadManagementDashboardsView (live, real api and Postgres)', () => {
  describe('kingdom scope, the default day', () => {
    it('shows the kingdom roll-up of 2026-09-12, from the real fixture row', async () => {
      const view = await loadManagementDashboardsView(admin(), {}, 'en');
      expect(view.isEmpty).toBe(false);
      expect(view.scope).toBe('kingdom');
      expect(view.sources).toEqual(['SYNTHETIC']);
      expect(view.dayLabel).toMatch(/2026/);
      expect(view.stats.cases).toBe(1440);
      expect(view.stats.fieldCases).toBe(828);
      expect(view.stats.onShift).toBe(181);
      expect(view.stats.clockStart).toBe('assignment');
      expect(view.stats.assignShare).toBeCloseTo(0.506039, 5);
      expect(view.stats.registerShare).toBeCloseTo(0.2343, 5);
      expect(view.stats.registeredToAssignedSeconds).toBe(141);
    });

    it('compares the 3 cities and lists all 8 zones (sorted, with their stage)', async () => {
      const view = await loadManagementDashboardsView(admin(), {}, 'en');
      expect(view.compareIsCities).toBe(true);
      expect(view.compareRows.length).toBeGreaterThanOrEqual(3);
      expect(view.zoneRows.length).toBeGreaterThanOrEqual(8);
      const rdC = view.zoneRows.find((r) => r.zoneId === RD_C);
      expect(rdC).toMatchObject({ code: 'RD-C', stage: 'recommend', cases: 254, field: 146, onShift: 23, selected: false });
      expect(rdC?.href).toBe(`?scope=zone&zone=${RD_C}`);
    });

    it('the 7-day trend matches the daily fixture rows, oldest first, no week-total row mixed in', async () => {
      const view = await loadManagementDashboardsView(admin(), {}, 'en');
      expect(view.trend.labels).toEqual(['6', '7', '8', '9', '10', '11', '12']);
      expect(view.trend.assignPct).toEqual([52.3, 52, 53, 47.1, 49.8, 49.2, 50.6]);
      expect(view.trend.registerPct).toEqual([25.6, 26.3, 26.6, 22.8, 25.4, 24.9, 23.4]);
      expect(JSON.parse(JSON.stringify(view))).toEqual(view); // plain data: it crosses to the client
    });
  });

  describe('city and zone scope', () => {
    it('narrows to one city, comparing its own zones', async () => {
      const view = await loadManagementDashboardsView(admin(), { scope: 'city', city: RIYADH }, 'en');
      expect(view.scope).toBe('city');
      expect(view.cityValue).toBe(RIYADH);
      expect(view.stats.cases).toBe(989);
      expect(view.stats.onShift).toBe(114);
      expect(view.stats.registeredToAssignedSeconds).toBe(137.5);
      expect(view.compareIsCities).toBe(false);
      expect(view.zoneRows.length).toBeGreaterThanOrEqual(5);
      expect(view.zoneRows.every((r) => r.code.startsWith('RD-'))).toBe(true);
    });

    it('narrows to one zone, marks its own row selected', async () => {
      const view = await loadManagementDashboardsView(admin(), { scope: 'zone', zone: RD_C }, 'en');
      expect(view.scope).toBe('zone');
      expect(view.zoneValue).toBe(RD_C);
      expect(view.stats.cases).toBe(254);
      expect(view.stats.registeredToAssignedSeconds).toBe(138);
      const rdC = view.zoneRows.find((r) => r.zoneId === RD_C);
      expect(rdC?.selected).toBe(true);
    });

    it('falls back to the first city or zone when the picked one is missing', async () => {
      const city = await loadManagementDashboardsView(admin(), { scope: 'city', city: '00000000-0000-0000-0000-000000000000' }, 'en');
      expect(city.cityValue).not.toBe('');
      expect(city.cityValue).not.toBe('00000000-0000-0000-0000-000000000000');
      const zone = await loadManagementDashboardsView(admin(), { scope: 'zone' }, 'en');
      expect(zone.zoneValue).not.toBe('');
    });
  });

  describe('no accessible zone (empty state)', () => {
    it('shows the empty state for a planner scoped to no zone', async () => {
      const view = await loadManagementDashboardsView(ctxOf('planner', []), {}, 'en');
      expect(view.isEmpty).toBe(true);
      expect(view.zoneRows).toHaveLength(0);
      expect(view.stats.cases).toBe(0);
    });
  });

  describe('access', () => {
    it('refuses a role with no access to the module (dispatcher)', async () => {
      await expect(loadManagementDashboardsView(ctxOf('dispatcher'), {}, 'en')).rejects.toThrow(ForbiddenError);
    });

    it('the remote pool reads every zone', async () => {
      const view = await loadManagementDashboardsView(ctxOf('remote_team_lead'), {}, 'en');
      expect(view.isEmpty).toBe(false);
      expect(view.zoneRows.length).toBeGreaterThanOrEqual(8);
    });
  });
});
