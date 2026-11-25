// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, describe, expect, it } from 'vitest';
import type { Role } from '@/lib/access';
import { fixtureUsers } from '@/lib/data/go-test-reset';
import { buildContext, fixtureTenantId } from '@/lib/data/go-test-reset';
import type { RequestContext } from '@/lib/data/guard';
import { loadScenarioLabView } from './view';

// Live: skips, never fakes, if OPENDISPATCH_API_URL unset.
// Zones/shift patterns is api-backed (api-backed), read only here.
const hasApi = process.env['OPENDISPATCH_API_URL'] !== undefined && process.env['OPENDISPATCH_API_URL'] !== '';
if (!hasApi) console.log('OPENDISPATCH_API_URL is not set: view.live.test.ts is skipped, not faked.');

// Server side vs the real data layer and
// fixtures: the three scenarios of
// fixtures/plans/scenarios.json, the same one
// the mockup shows
//.

afterEach(() => {
});

function ctxOf(role: Role, zoneIds: string[] = []): RequestContext {
  const tenant = fixtureTenantId();
  const built = buildContext({ role, installMode: 'private', zoneIds }, fixtureUsers(), tenant);
  if (built === null) throw new Error(`no context for ${role}`);
  return built;
}
/** administrator: whole install, sees every zone. */
const viewer = () => ctxOf('administrator');

describe.skipIf(!hasApi)('loadScenarioLabView (live, real api and Postgres)', () => {
  describe('the saved list and the default open scenario', () => {
    it('opens the most recently created scenario by default', async () => {
      const view = await loadScenarioLabView(viewer(), {}, 'en');
      expect(view.isEmpty).toBe(false);
      expect(view.total).toBe(3);
      expect(view.savedRows).toHaveLength(3);
      expect(view.sources).toEqual(['SYNTHETIC']);
      expect(view.form.name).toBe('Remote share raised to 35 percent');
      expect(view.form.sharePercent).toBe(35);
      expect(view.form.zoneIds).toHaveLength(5);
      expect(view.openStatus).toBe('completed');
      expect(view.comparison).toBeDefined();
      // No SimulationRun is stored for this scenario
      // in fixtures: a real gap, not fabricated.
      expect(view.comparison?.reading).toBeUndefined();
      expect(JSON.parse(JSON.stringify(view))).toEqual(view);
    });

    it('offers at least the four active field shift patterns', async () => {
      const view = await loadScenarioLabView(viewer(), {}, 'en');
      // A floor, not exact: other live files may add their own active field patterns.
      expect(view.patternOptions.map((p) => p.code)).toEqual(expect.arrayContaining(['DAY-A', 'DAY-B', 'EVENING', 'NIGHT']));
    });
  });

  describe('opening a specific scenario', () => {
    it('shows a real stored scenario, its adjustments and a live comparison', async () => {
      const first = await loadScenarioLabView(viewer(), {}, 'en');
      const s1 = first.savedRows.find((r) => r.name.includes('four more field agents'))!;
      const view = await loadScenarioLabView(viewer(), { scenario: s1.id }, 'en');
      expect(view.openId).toBe(s1.id);
      expect(view.openIsNew).toBe(false);
      expect(view.form.field).toBe(4);
      expect(view.form.veh).toBe(2);
      expect(view.form.remote).toBe(0);
      expect(view.form.zoneIds).toHaveLength(1);
      expect(view.form.patternIds).toHaveLength(3);
      expect(view.comparison?.zoneRows).toHaveLength(1);
      expect(view.comparison?.zoneRows.every((z) => z.after.gap <= z.before.gap)).toBe(true);
      expect(view.dateOptions.map((o) => o.value)).toContain(view.form.baseDate);
      // fixtures store a real SimulationRun for it
      expect(view.comparison?.reading).toBeDefined();
      expect(view.comparison?.stale).toBe(false);
    });

    it('shows no notice for a known id, and a notice plus the default for an unknown one', async () => {
      const first = await loadScenarioLabView(viewer(), {}, 'en');
      const s1 = first.savedRows[0]!;
      expect((await loadScenarioLabView(viewer(), { scenario: s1.id }, 'en')).unknownId).toBe(false);
      const missing = await loadScenarioLabView(viewer(), { scenario: '00000000-0000-0000-0000-000000000000' }, 'en');
      expect(missing.unknownId).toBe(true);
      expect(missing.openId).toBe(first.openId);
    });
  });

  describe('a new scenario from a template', () => {
    it('pre-fills real zone and shift-pattern ids, and shows no comparison yet', async () => {
      const view = await loadScenarioLabView(viewer(), { scenario: 'new', tpl: 'people' }, 'en');
      expect(view.openId).toBeNull();
      expect(view.openIsNew).toBe(true);
      expect(view.form.field).toBe(4);
      expect(view.form.veh).toBe(2);
      expect(view.form.zoneIds).toHaveLength(1);
      expect(view.comparison).toBeUndefined();
    });

    it('the Ramadan template picks all four field patterns, the remote template raises the share', async () => {
      const ramadan = await loadScenarioLabView(viewer(), { scenario: 'new', tpl: 'ramadan' }, 'en');
      expect(ramadan.form.patternIds).toHaveLength(4);
      expect(ramadan.form.zoneIds).toHaveLength(2);
      const remote = await loadScenarioLabView(viewer(), { scenario: 'new', tpl: 'remote' }, 'en');
      expect(remote.form.sharePercent).toBe(35);
      expect(remote.form.zoneIds).toHaveLength(5);
    });
  });

  // NOT COVERED: loadScenarioLabView's `isEmpty`
  // branch (no scenario at all) has no test here --
  // the fixtures always hold three, and a screen
  // may not drop fixture rows to force it.
});
