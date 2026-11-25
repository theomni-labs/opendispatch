// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, describe, expect, it } from 'vitest';
import type { Role } from '@/lib/access';
import { fixtureUsers } from '@/lib/data/go-test-reset';
import { buildContext, fixtureTenantId } from '@/lib/data/go-test-reset';
import { createZone, listCities } from '@/lib/data/locations';
import type { RequestContext } from '@/lib/data/guard';
import { loadStandbyCoverageView } from './view';

// Server side vs the real data layer and fixture:
// Riyadh Central on the planning day (today + 1).

// Live: skips, never fakes, if OPENDISPATCH_API_URL unset.
// Standby points shared with other
// live files: RD_C's point count is a floor.
const hasApi = process.env['OPENDISPATCH_API_URL'] !== undefined && process.env['OPENDISPATCH_API_URL'] !== '';
if (!hasApi) console.log('OPENDISPATCH_API_URL is not set: view.live.test.ts is skipped, not faked.');

afterEach(() => {
});

const RD_C = '091ff2b2-f0e1-4b97-bfc9-7cdd0698c32a';

function ctxOf(role: Role, zoneIds: string[] = [RD_C]): RequestContext {
  const tenant = fixtureTenantId();
  const built = buildContext({ role, installMode: 'private', zoneIds }, fixtureUsers(), tenant);
  if (built === null) throw new Error(`no context for ${role}`);
  return built;
}
const admin = () => ctxOf('administrator');

describe.skipIf(!hasApi)('loadStandbyCoverageView (live, real api and Postgres)', () => {
  describe('defaulting', () => {
    it('defaults to Riyadh Central and the planning day, demo today + 1, as the Field Planner and Gap and Surplus', async () => {
      const view = await loadStandbyCoverageView(admin(), { zone: RD_C });
      expect(view.zone).toMatchObject({ id: RD_C, code: 'RD-C', name: 'Riyadh Central' });
      expect(view.date).toBe('2026-09-14');
      expect(view.sources).toEqual(['SYNTHETIC']);
      expect(JSON.parse(JSON.stringify(view))).toEqual(view); // plain data: it crosses to the client
    });

    it('honours ?zone= and ?date= when both are valid and accessible', async () => {
      const other = '555117e3-96d2-43fc-9fb1-45ec4ed1d8ad';
      const view = await loadStandbyCoverageView(admin(), { zone: other, date: '2026-09-14' });
      expect(view.zone.id).toBe(other);
      expect(view.date).toBe('2026-09-14');
    });

    it('falls back to the default zone when ?zone= is outside a zone-scoped role\'s scope', async () => {
      const other = '555117e3-96d2-43fc-9fb1-45ec4ed1d8ad';
      const view = await loadStandbyCoverageView(ctxOf('planner', [RD_C]), { zone: other });
      expect(view.zone.id).toBe(RD_C);
    });
  });

  describe('coverage', () => {
    it('gives every active standby point, its radius, its staffing and the covered sub-zones', async () => {
      const view = await loadStandbyCoverageView(admin(), { zone: RD_C });
      expect(view.stats.points).toBeGreaterThanOrEqual(3);
      expect(view.points.length).toBeGreaterThanOrEqual(3);
      for (const point of view.points) {
        expect(point.radiusKm).toBeGreaterThan(0);
        expect(point.agents).toBeGreaterThan(0);
        expect(point.coversCount).toBeGreaterThan(0);
        expect(point.name.endsWith('standby')).toBe(false);
        expect(point.homeKm).toBeLessThan(15);
        expect(point.beyondLimit).toBe(false);
      }
      expect(view.limitKm).toBe(15);
      expect(view.stats.waiting).toBe(view.points.reduce((sum, p) => sum + p.agents, 0));
      expect(view.stats.subZoneCount).toBe(view.subZones.length);
      expect(view.stats.coveredCount + view.stats.uncoveredCount).toBe(view.stats.subZoneCount);
      expect(view.uncovered).toHaveLength(view.stats.uncoveredCount);
    });

    it('marks a sub-zone covered exactly when it is not in the uncovered list', async () => {
      const view = await loadStandbyCoverageView(admin(), { zone: RD_C });
      const uncoveredIds = new Set(view.uncovered.map((u) => u.id));
      for (const sub of view.subZones) expect(sub.covered).toBe(!uncoveredIds.has(sub.id));
    });

    it('finds no recommended move for Riyadh Central by default (the real gap none of its points alone can reach)', async () => {
      const view = await loadStandbyCoverageView(admin(), { zone: RD_C });
      expect(view.move).toBeNull();
      expect(view.stats.uncoveredCount).toBeGreaterThan(0);
    });
  });

  describe('no standby points (empty state)', () => {
    it('shows no points and no move when a zone has none active', async () => {
      // Empty zone: real ones' points have a real FK now.
      const ctx = admin();
      const cityId = (await listCities(ctx)).items[0]!.id;
      const zone = await createZone(ctx, { city_id: cityId, name_en: 'Empty Test Zone' });
      const view = await loadStandbyCoverageView(ctx, { zone: zone.id });
      expect(view.points).toHaveLength(0);
      expect(view.move).toBeNull();
      expect(view.stats.points).toBe(0);
    });
  });
});
