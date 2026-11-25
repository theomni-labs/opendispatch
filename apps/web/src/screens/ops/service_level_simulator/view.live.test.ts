// SPDX-License-Identifier: AGPL-3.0-only
import { beforeEach, describe, expect, it } from 'vitest';
import type { Role } from '@/lib/access';
import { fixtureUsers } from '@/lib/data/go-test-reset';
import { buildContext, fixtureTenantId } from '@/lib/data/go-test-reset';
import type { RequestContext } from '@/lib/data/guard';
import { listScenarios, runScenario } from '@/lib/data/scenarios';
import { loadServiceLevelSimulatorView } from './view';

// Server side vs the real data layer and
// fixtures: the three seeded runs of
// fixtures/plans/simulation_runs.json (the 12
// Sep system baseline twice, nearest and
// replay_actual, and one scenario run for
// 14 Sep), from the real fixtures.

// Live: skips, never fakes, if OPENDISPATCH_API_URL unset.
// Zones shared with other live
// files: the kingdom-wide zone count is a floor.
const hasApi = process.env['OPENDISPATCH_API_URL'] !== undefined && process.env['OPENDISPATCH_API_URL'] !== '';
if (!hasApi) console.log('OPENDISPATCH_API_URL is not set: view.live.test.ts is skipped, not faked.');

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

describe.skipIf(!hasApi)('loadServiceLevelSimulatorView (live, real api and Postgres)', () => {
  describe('the default (most recent) run', () => {
    it('shows the 12 Sep nearest baseline, all 8 zones, both readings and history', async () => {
      const view = await loadServiceLevelSimulatorView(admin(), {}, 'en');
      expect(view.isEmpty).toBe(false);
      expect(view.sources).toEqual(['SYNTHETIC']);
      expect(view.illustrative).toBe(true);
      expect(view.clockStart).toBe('assignment');
      expect(view.runMeta?.policy).toBe('nearest');
      expect(view.runMeta?.runDate).toBe('2026-09-12');
      expect(view.runMeta?.ref).toEqual({ kind: 'all' });
      expect(view.zones.length).toBeGreaterThanOrEqual(8);
      expect(view.showTotal).toBe(true);
      expect(view.overall?.fieldCaseCount).toBe(view.zones.reduce((s, z) => s + z.fieldCount, 0));
      expect(view.historyCount).toBeGreaterThanOrEqual(3);
      expect(view.history.find((r) => r.selected)?.ref.kind).not.toBe('scenario');
      expect(view.dateOptions.map((o) => o.value)).toEqual(['2026-09-06', '2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11', '2026-09-12']);
      expect(view.rosterOptions.length).toBeGreaterThan(0);
      expect(JSON.parse(JSON.stringify(view))).toEqual(view); // plain data: it crosses to the client
    });

    it('defaults the replay-inputs form from the selected run, falling back to a real roster when it has none', async () => {
      const view = await loadServiceLevelSimulatorView(admin(), {}, 'en');
      expect(view.form.runDate).toBe('2026-09-12');
      expect(view.form.policy).toBe('nearest');
      expect(view.rosterOptions.some((o) => o.value === view.form.rosterId)).toBe(true);
    });

    it('has no interval-level results yet: the Intervals tab is honestly empty', async () => {
      const view = await loadServiceLevelSimulatorView(admin(), {}, 'en');
      expect(view.intervals).toEqual([]);
      expect(view.intervalZoneOptions.length).toBeGreaterThanOrEqual(8);
    });
  });

  describe('selecting a run', () => {
    it('?run= shows that run instead of the newest one', async () => {
      const base = await loadServiceLevelSimulatorView(admin(), {}, 'en');
      const replay = base.history.find((r) => r.policy === 'replay_actual');
      expect(replay).toBeDefined();
      const view = await loadServiceLevelSimulatorView(admin(), { run: replay?.id }, 'en');
      expect(view.selectedRunId).toBe(replay?.id);
      expect(view.runMeta?.policy).toBe('replay_actual');
      // Replaying reality: from-registration
      // reads clearly lower than from-assignment.
      expect(view.overall?.fromRegistration.share ?? 1).toBeLessThan((view.overall?.fromAssignment.share ?? 0) - 0.1);
    });

    it('shows the one scenario run with its scenario name as the reference', async () => {
      const base = await loadServiceLevelSimulatorView(admin(), {}, 'en');
      const scenarioRow = base.history.find((r) => r.ref.kind === 'scenario');
      expect(scenarioRow).toBeDefined();
      const view = await loadServiceLevelSimulatorView(admin(), { run: scenarioRow?.id }, 'en');
      expect(view.runMeta?.ref.kind).toBe('scenario');
      expect(view.runMeta?.ref.name).toBeTruthy();
    });

    it('a newer scenario run is not the default result, but can be selected', async () => {
      const ctx = planner();
      const scenario = (await listScenarios(ctx, { limit: 50 })).items[0];
      expect(scenario).toBeDefined();
      await runScenario(ctx, scenario?.id ?? '');
      const view = await loadServiceLevelSimulatorView(ctx, {}, 'en');
      expect(view.runMeta?.ref.kind).not.toBe('scenario');
      const newest = [...view.history].sort((a, b) => b.createdAtIso.localeCompare(a.createdAtIso))[0];
      expect(newest?.ref.kind).toBe('scenario');
      expect(newest?.selected).toBe(false);
      const picked = await loadServiceLevelSimulatorView(ctx, { run: newest?.id }, 'en');
      expect(picked.selectedRunId).toBe(newest?.id);
    });

    it('an unknown ?run= falls back to the default run', async () => {
      const base = await loadServiceLevelSimulatorView(admin(), {}, 'en');
      const view = await loadServiceLevelSimulatorView(admin(), { run: '00000000-0000-0000-0000-000000000000' }, 'en');
      expect(view.selectedRunId).toBe(base.selectedRunId);
    });
  });

  describe('zone scope', () => {
    it('a Planner scoped to three zones sees only those zones of the system-wide run', async () => {
      const view = await loadServiceLevelSimulatorView(planner(), {}, 'en');
      expect(view.isEmpty).toBe(false);
      expect(view.zones).toHaveLength(3);
      expect(new Set(view.zones.map((z) => z.zoneCode))).toEqual(new Set(['RD-C', 'RD-N', 'RD-E']));
      expect(view.showTotal).toBe(true);
      expect(view.rosterOptions.every((o) => /^(RD-C|RD-N|RD-E)/.test(o.label))).toBe(true);
    });
  });

  describe('the pending replay-inputs form', () => {
    it('honours ?ref= ?date= ?policy= when they are real options', async () => {
      const base = await loadServiceLevelSimulatorView(admin(), {}, 'en');
      const roster = base.rosterOptions[0];
      expect(roster).toBeDefined();
      const view = await loadServiceLevelSimulatorView(admin(), { ref: roster?.value, date: '2026-09-06', policy: 'scorer' }, 'en');
      expect(view.form).toEqual({ rosterId: roster?.value, runDate: '2026-09-06', policy: 'scorer' });
    });

    it('ignores a roster or date not on the list and keeps the run-derived default', async () => {
      const base = await loadServiceLevelSimulatorView(admin(), {}, 'en');
      const view = await loadServiceLevelSimulatorView(admin(), { ref: '00000000-0000-0000-0000-000000000000', date: '2020-01-01' }, 'en');
      expect(view.form.rosterId).toBe(base.form.rosterId);
      expect(view.form.runDate).toBe(base.form.runDate);
    });
  });

  // NOT COVERED: isEmpty (no simulation run at
  // all) has no test here, same as Remote
  // Queue's own precedent - the fixtures
  // always seed three runs and a screen may
  // not remove fixture rows to force it
  //.
});
