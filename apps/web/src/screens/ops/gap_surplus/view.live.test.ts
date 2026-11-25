// SPDX-License-Identifier: AGPL-3.0-only
import { beforeEach, describe, expect, it } from 'vitest';
import type { Role } from '@/lib/access';
import { fixtureUsers } from '@/lib/data/go-test-reset';
import { buildContext, fixtureTenantId } from '@/lib/data/go-test-reset';
import type { RequestContext } from '@/lib/data/guard';
import { ForbiddenError } from '@/lib/data/errors';
import { loadGapSurplusView } from './view';

// Live: skips, never fakes, if OPENDISPATCH_API_URL unset.
const hasApi = process.env['OPENDISPATCH_API_URL'] !== undefined && process.env['OPENDISPATCH_API_URL'] !== '';
if (!hasApi) console.log('OPENDISPATCH_API_URL is not set: view.live.test.ts is skipped, not faked.');

// Server side vs the real data layer and fixtures:
// the default gap and surplus view for 2026-09-14
// (getGapSurplus's own default, demo today + 1),
// the same day the mockup's own illustrative data
// shows. Values below (causeCounts, stats, the
// worst cell, the geography example) were read from
// the real fixtures, not invented.

// Screens may not import lib/data/internal (opendispatch/no-banned-import), so this
// mirrors lib/data/test-support.ts's resetGoTestState() locally.
async function resetGoTestState(): Promise<void> {
  const url = process.env['OPENDISPATCH_API_URL'];
  if (url === undefined || url === '') return;
  try {
    await fetch(`${url}/_internal/test/reset`, { method: 'POST' });
  } catch {
    // best-effort
  }
}

beforeEach(async () => {
  await resetGoTestState();
});

const RD_C = '091ff2b2-f0e1-4b97-bfc9-7cdd0698c32a';

function ctxOf(role: Role, zoneIds: string[] = []): RequestContext {
  const tenant = fixtureTenantId();
  const built = buildContext({ role, installMode: 'private', zoneIds }, fixtureUsers(), tenant);
  if (built === null) throw new Error(`no context for ${role}`);
  return built;
}
const admin = () => ctxOf('administrator');
const lead = () => ctxOf('remote_team_lead');

describe.skipIf(!hasApi)('loadGapSurplusView (live, real api and Postgres)', () => {
  describe('the default day, all zones', () => {
    it('shows 2026-09-14 (getGapSurplus\'s own default), 8 zones and the real cause counts', async () => {
      const view = await loadGapSurplusView(admin(), {}, 'en');
      expect(view.isEmpty).toBe(false);
      expect(view.dateLabel).toMatch(/2026/);
      expect(view.sources).toEqual(['SYNTHETIC']);
      expect(view.grid.rowLabels.length).toBeGreaterThanOrEqual(8);
      // duration demand (the default): no gap that day
      expect(view.causeCounts).toEqual({ people: 0, vehicles: 0, geography: 0 });
      expect(view.stats.gaps).toBe(0);
      expect(view.stats.surplus).toBe(764);
      expect(view.stats.mainCause).toBeNull();
      expect(view.stats.worst).toBeNull();
      expect(JSON.parse(JSON.stringify(view))).toEqual(view); // plain data: it crosses to the client
    });

    it('defaults to 15-minute columns (96), switches to 24 hourly columns with ?dens=h', async () => {
      const quarter = await loadGapSurplusView(admin(), {}, 'en');
      expect(quarter.density).toBe('q');
      expect(quarter.grid.columns).toHaveLength(96);
      expect(quarter.grid.compact).toBe(true);

      const hourly = await loadGapSurplusView(admin(), { dens: 'h' }, 'en');
      expect(hourly.density).toBe('h');
      expect(hourly.grid.columns).toHaveLength(24);
      expect(hourly.grid.compact).toBe(false);
    });
  });

  describe('city, zone and search filters', () => {
    it('narrows the grid rows by city', async () => {
      const riyadh = await loadGapSurplusView(admin(), { city: 'RD' }, 'en');
      expect(riyadh.grid.rowLabels).toHaveLength(5);
      const dammam = await loadGapSurplusView(admin(), { city: 'DM' }, 'en');
      expect(dammam.grid.rowLabels).toEqual(['Dammam Central']);
    });

    it('narrows to one row by zone id', async () => {
      const view = await loadGapSurplusView(admin(), { zone: RD_C }, 'en');
      expect(view.grid.rowLabels).toEqual(['Riyadh Central']);
      expect(view.grid.zoneIds).toEqual([RD_C]);
    });

    it('searches the zone name', async () => {
      const view = await loadGapSurplusView(admin(), { q: 'central' }, 'en');
      expect([...view.grid.rowLabels].sort()).toEqual(['Dammam Central', 'Riyadh Central']);
    });
  });

  describe('the cause filter', () => {
    it('blanks every cell of a cause with none in the current fixtures (no matching cells)', async () => {
      const view = await loadGapSurplusView(admin(), { cause: 'vehicles' }, 'en');
      expect(view.stats.gaps).toBe(0);
      expect(view.grid.anyVisible).toBe(false);
    });

    it('counts only geography gaps under ?cause=geography, and no surplus (a surplus is always people)', async () => {
      const view = await loadGapSurplusView(admin(), { date: '2026-09-16', cause: 'geography' }, 'en');
      expect(view.stats.gaps).toBe(1);
      expect(view.stats.surplus).toBe(0);
      expect(view.stats.mainCause).toBe('geography');
      expect(view.grid.anyVisible).toBe(true);
    });

    it('the chip counts follow the zone filter only, never the cause filter itself', async () => {
      const all = await loadGapSurplusView(admin(), { cause: 'geography' }, 'en');
      const none = await loadGapSurplusView(admin(), {}, 'en');
      expect(all.causeCounts).toEqual(none.causeCounts);
    });
  });

  describe('the cell detail drawer', () => {
    it('shows a geography gap with the real cause_detail sentence and a Standby Coverage link', async () => {
      const view = await loadGapSurplusView(admin(), { date: '2026-09-16', cell: `${RD_C}:45` }, 'en');
      expect(view.drawer).toBeDefined();
      expect(view.drawer).toMatchObject({
        zoneCode: 'RD-C',
        kind: 'gap',
        required: 4,
        planned: 3,
        delta: -1,
        cause: 'geography',
        causeDetailEn: 'Only 3 standby points cover 14 of 16 sub-zones.',
        linkIsStandby: true,
      });
      expect(view.drawer?.linkHref).toBe(view.standbyHref);
    });

    it('shows a people gap with a Field Planner link', async () => {
      // first people gap: RD-C, 19 Sept, 06:00
      const view = await loadGapSurplusView(admin(), { date: '2026-09-19', cell: `${RD_C}:24` }, 'en');
      expect(view.drawer).toMatchObject({ zoneCode: 'RD-C', kind: 'gap', cause: 'people', causeDetailEn: '1 more agent needed.', linkIsStandby: false });
      expect(view.drawer?.linkHref).toBe(view.fieldPlannerHref);
    });

    it('leaves the link out for a role that may not open the target module', async () => {
      const view = await loadGapSurplusView(lead(), { cell: `${RD_C}:29` }, 'en');
      expect(view.canOpenFieldPlanner).toBe(false);
      expect(view.canOpenStandby).toBe(false);
      expect(view.drawer?.cause).toBe('people');
      expect(view.drawer?.linkHref).toBeNull();
    });

    it('shows no drawer for an unknown zone or a malformed cell', async () => {
      const view = await loadGapSurplusView(admin(), { cell: '00000000-0000-0000-0000-000000000000:0' }, 'en');
      expect(view.drawer).toBeUndefined();
    });
  });

  describe('no accessible zone (empty state)', () => {
    it('shows the true empty state, not the no-matching-cells sub-state', async () => {
      const view = await loadGapSurplusView(ctxOf('planner', []), {}, 'en');
      expect(view.isEmpty).toBe(true);
      expect(view.grid.rowLabels).toHaveLength(0);
      expect(view.emptyActionHref).toBe(view.fieldPlannerHref); // planner may open Field Planner
    });
  });

  describe('access', () => {
    it('refuses a role with no access to the module (dispatcher)', async () => {
      await expect(loadGapSurplusView(ctxOf('dispatcher'), {}, 'en')).rejects.toThrow(ForbiddenError);
    });
  });
});
