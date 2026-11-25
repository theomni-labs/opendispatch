// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { InstallMode, Role } from '@/lib/access';
import { listAuditEvents } from '@/lib/data/audit';
import { UnauthenticatedError } from '@/lib/data/errors';
import type { RequestContext } from '@/lib/data/guard';
import { getForecastModelSettings, getModelState, listModelVersions } from '@/lib/data/models';
import { listForecastExperiments } from '@/lib/data/forecast-backtest';
import { fixtureUsers, resetGoTestState } from '@/lib/data/go-test-reset';
import { listForecastRuns } from '@/lib/data/forecast';
import { getSettingsSnapshot } from '@/lib/data/settings';
import { changeAutoRetrain, changeChallenger, changeClockStart, changeGateBaseline, changeHorizon, changeOptimizer, changePlanningLevel, changeRemoteHandling, pauseForecast, resumeForecast, retrainNow, runForecast, saveSchedule, startBacktest, switchVersion } from './actions';
import { buildContext, fixtureTenantId } from '@/lib/data/go-test-reset';

// The server actions against the real data layer and the committed fixtures, with the demo store in a temp folder. The session
// is the only thing stood in for: requireRequestContext returns the context of the role the test picks, exactly what a signed
// cookie would give.
const session = vi.hoisted(() => ({ role: 'administrator' as string | null, mode: 'private' as string, revalidate: vi.fn() }));

vi.mock('next/cache', () => ({ revalidatePath: session.revalidate }));
vi.mock('@/lib/data/context', async (original) => {
  const real = await original<typeof import('@/lib/data/context')>();
  return {
    ...real,
    requireRequestContext: async () => {
      if (session.role === null) throw new UnauthenticatedError();
      return contextOf(session.role as Role, session.mode as InstallMode);
    },
  };
});

function contextOf(role: Role, installMode: InstallMode): RequestContext {
  const tenant = fixtureTenantId();
  const built = buildContext({ role, installMode, zoneIds: [] }, fixtureUsers(), tenant);
  if (built === null) throw new Error(`no context for ${role}`);
  return built;
}

let errorLog: ReturnType<typeof vi.spyOn>;

beforeEach(async () => {
  await resetGoTestState();
  session.role = 'administrator';
  session.mode = 'private';
  session.revalidate.mockReset();
  errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  errorLog.mockRestore();
});

async function ctx(): Promise<RequestContext> {
  return contextOf('administrator', 'private');
}
const events = async (action: string) => (await listAuditEvents(await ctx(), { action, limit: 200 })).items;
const versions = async () => (await listModelVersions(await ctx(), { limit: 50 })).items;
const REVALIDATED = ['/en/admin/forecast-model', '/ar/admin/forecast-model'];

describe('runForecast (the fixture forecaster answers at once; Illustrative)', () => {
  it('runs the forecast again from the day of the latest run for the configured horizon, audits it, and refreshes the page in both languages', async () => {
    const latest = (await listForecastRuns(await ctx(), { limit: 1 })).items[0];
    const configured = (await getForecastModelSettings(await ctx())).horizon_days;
    const result = await runForecast();
    expect(result).toMatchObject({ ok: true, data: { model: 'ensemble-4' } });
    if (!result.ok) throw new Error('unreachable');
    expect(result.data.horizonStart).toBe(latest?.horizon_start_date);
    expect(result.data.horizonDays).toBe(configured);
    const run = (await listForecastRuns(await ctx(), { limit: 1 })).items[0];
    expect(run).toMatchObject({ id: result.data.runId, status: 'succeeded', illustrative: true });
    expect((await events('forecast.run_created')).at(0)).toMatchObject({ outcome: 'success' });
    expect(session.revalidate.mock.calls.map((c) => c[0])).toEqual(REVALIDATED);
  });

  it('is refused while the forecast is paused, as `conflict`', async () => {
    await pauseForecast({ reason: 'Checking the data first' });
    expect(await runForecast()).toMatchObject({ ok: false, code: 'conflict' });
  });
});

describe('switchVersion', () => {
  it('makes the other version active and retires the active one, with a reason, audited', async () => {
    const before = await versions();
    const candidate = before.find((v) => v.status !== 'active');
    const active = before.find((v) => v.status === 'active');
    if (candidate === undefined || active === undefined) throw new Error('no candidate or active version');
    expect(await switchVersion({ versionId: candidate.id, reason: 'The candidate is better on the test days' })).toMatchObject({ ok: true, data: { active: candidate.version, paused: false } });
    const after = await versions();
    expect(after.find((v) => v.id === candidate.id)?.status).toBe('active');
    expect(after.find((v) => v.id === active.id)?.status).toBe('retired');
    const audit = (await events('model.version_switched')).at(0);
    expect(audit).toMatchObject({ outcome: 'success', entity_id: candidate.id });
    expect(JSON.stringify(audit?.detail)).toContain('The candidate is better');
  });

  it('refuses the active version (conflict), no reason (invalid), a long reason, an unknown version and hostile ids', async () => {
    const active = (await versions()).find((v) => v.status === 'active');
    const candidate = (await versions()).find((v) => v.status !== 'active');
    if (active === undefined || candidate === undefined) throw new Error('no versions');
    expect(await switchVersion({ versionId: active.id, reason: 'x' })).toMatchObject({ ok: false, code: 'conflict' });
    expect(await switchVersion({ versionId: candidate.id, reason: '' })).toMatchObject({ ok: false, code: 'invalid' });
    expect(await switchVersion({ versionId: candidate.id, reason: 'x'.repeat(301) })).toMatchObject({ ok: false, code: 'invalid' });
    expect(await switchVersion({ versionId: '00000000-0000-4000-8000-000000000001', reason: 'x' })).toMatchObject({ ok: false, code: 'not_found' });
    for (const bad of ['', 'toString', '__proto__', '../etc', 42, null, undefined]) expect(await switchVersion({ versionId: bad as never, reason: 'x' }), String(bad)).toMatchObject({ ok: false, code: 'invalid' });
  });
});

describe('pauseForecast and resumeForecast', () => {
  it('pauses with a reason (the alert is raised for the bell and Notifications), then resumes; each is audited', async () => {
    expect(await pauseForecast({ reason: 'The case feed is being fixed' })).toMatchObject({ ok: true, data: { paused: true } });
    const state = await getModelState(await ctx());
    expect(state).toMatchObject({ is_paused: true, pause_reason: 'The case feed is being fixed' });
    const paused = (await events('model.paused')).at(0);
    expect(paused).toMatchObject({ outcome: 'success' });
    expect(paused?.detail?.['notifications']).toBeGreaterThan(0);
    expect(await resumeForecast({ reason: 'Fixed' })).toMatchObject({ ok: true, data: { paused: false } });
    expect((await events('model.resumed')).at(0)).toMatchObject({ outcome: 'success' });
  });

  it('a pause needs a reason of 1 to 300 characters, pausing twice and resuming a forecast that runs are conflicts', async () => {
    expect(await pauseForecast({ reason: '' })).toMatchObject({ ok: false, code: 'invalid' });
    expect(await pauseForecast({ reason: 'x'.repeat(301) })).toMatchObject({ ok: false, code: 'invalid' });
    expect(await resumeForecast({ reason: 'x' })).toMatchObject({ ok: false, code: 'conflict' });
    await pauseForecast({ reason: 'x' });
    expect(await pauseForecast({ reason: 'x' })).toMatchObject({ ok: false, code: 'conflict' });
  });
});

describe('saveSchedule, changeClockStart, changePlanningLevel', () => {
  it('stores the retraining schedule; a weekly one needs a day, a manual one none, and the time must be HH:MM', async () => {
    expect(await saveSchedule({ cadence: 'daily', day_of_week: null, time_of_day: '03:30' })).toMatchObject({ ok: true });
    expect((await getModelState(await ctx())).retraining_schedule).toMatchObject({ cadence: 'daily', time_of_day: '03:30' });
    expect(await saveSchedule({ cadence: 'weekly', day_of_week: 2, time_of_day: '01:15' })).toMatchObject({ ok: true });
    expect((await getModelState(await ctx())).retraining_schedule).toMatchObject({ cadence: 'weekly', day_of_week: 2 });
    expect(await saveSchedule({ cadence: 'manual', day_of_week: null, time_of_day: '02:00' })).toMatchObject({ ok: true });
    expect((await events('model.retraining_schedule_changed')).at(0)).toMatchObject({ outcome: 'success' });
    for (const bad of [{ cadence: 'weekly', day_of_week: null, time_of_day: '02:00' }, { cadence: 'hourly', day_of_week: null, time_of_day: '02:00' }, { cadence: 'daily', day_of_week: null, time_of_day: '2am' }, { cadence: 'weekly', day_of_week: 9, time_of_day: '02:00' }]) {
      expect(await saveSchedule(bad as never), JSON.stringify(bad)).toMatchObject({ ok: false, code: 'invalid' });
    }
  });

  it('changes the primary clock start and the planning level, audited; anything else is invalid', async () => {
    expect(await changeClockStart({ clock_start: 'registration' })).toMatchObject({ ok: true, data: { clockStart: 'registration' } });
    expect(await changePlanningLevel({ planning_level: 'city' })).toMatchObject({ ok: true, data: { planningLevel: 'city' } });
    expect(await getSettingsSnapshot(await ctx())).toMatchObject({ clock_start: 'registration', planning_level: 'city' });
    expect((await events('settings.clock_start_changed')).at(0)).toMatchObject({ outcome: 'success' });
    expect((await events('settings.planning_level_changed')).at(0)).toMatchObject({ outcome: 'success' });
    expect(await changeClockStart({ clock_start: 'arrival' })).toMatchObject({ ok: false, code: 'invalid' });
    expect(await changePlanningLevel({ planning_level: 'street' })).toMatchObject({ ok: false, code: 'invalid' });
  });

  it('chooses the optimizer model, audited; a model the engine does not know is invalid', async () => {
    expect((await getSettingsSnapshot(await ctx())).optimizer_model).toBe('cpsat-1');
    expect(await changeOptimizer({ optimizer_model: 'greedy-ls-0.3' })).toMatchObject({ ok: true, data: { optimizerModel: 'greedy-ls-0.3' } });
    expect((await getSettingsSnapshot(await ctx())).optimizer_model).toBe('greedy-ls-0.3');
    expect((await events('settings.optimizer_model_changed')).at(0)).toMatchObject({ outcome: 'success' });
    expect(await changeOptimizer({ optimizer_model: 'simplex-9' })).toMatchObject({ ok: false, code: 'invalid' });
  });

  it('sets the remote handling time, audited; minutes outside 5 to 240 are invalid', async () => {
    expect(await getSettingsSnapshot(await ctx())).toMatchObject({ remote_handling_source: 'measured', remote_handling_fixed_minutes: 31.5 });
    expect(await changeRemoteHandling({ handling_source: 'fixed', handling_fixed_minutes: 40 })).toMatchObject({ ok: true, data: { source: 'fixed', fixedMinutes: 40 } });
    expect((await events('settings.remote_handling_changed')).at(0)).toMatchObject({ outcome: 'success' });
    expect(await changeRemoteHandling({ handling_fixed_minutes: 300 })).toMatchObject({ ok: false, code: 'invalid' });
    expect(await changeRemoteHandling({ handling_source: 'auto' })).toMatchObject({ ok: false, code: 'invalid' });
  });

  it('chooses the challenger (empty is none) and the gate baseline, audited; anything else is invalid', async () => {
    expect(await changeChallenger({ challenger_model: 'ets-1' })).toMatchObject({ ok: true, data: { challenger: 'ets-1' } });
    expect(await changeChallenger({ challenger_model: '' })).toMatchObject({ ok: true, data: { challenger: null } });
    expect(await changeGateBaseline({ gate_baseline: 'naive' })).toMatchObject({ ok: true, data: { gateBaseline: 'naive' } });
    expect(await events('forecast.model_settings_changed')).toHaveLength(3);
    expect(await changeChallenger({ challenger_model: 'ensemble-4' })).toMatchObject({ ok: false, code: 'invalid' });
    expect(await changeGateBaseline({ gate_baseline: 'best' })).toMatchObject({ ok: false, code: 'invalid' });
    expect(await changeGateBaseline({ gate_baseline: 'segment' })).toMatchObject({ ok: true });
  });
});

describe('who may write, and what is audited', () => {
  const writes: readonly [string, () => Promise<{ ok: boolean; code?: string }>, string][] = [
    ['runForecast', () => runForecast(), 'forecast.run_created'],
    ['switchVersion', () => switchVersion({ versionId: '00000000-0000-4000-8000-000000000001', reason: 'x' }), 'model.version_switched'],
    ['pauseForecast', () => pauseForecast({ reason: 'x' }), 'model.paused'],
    ['resumeForecast', () => resumeForecast({ reason: 'x' }), 'model.resumed'],
    ['saveSchedule', () => saveSchedule({ cadence: 'daily', day_of_week: null, time_of_day: '02:00' }), 'model.retraining_schedule_changed'],
    ['changeClockStart', () => changeClockStart({ clock_start: 'registration' }), 'settings.clock_start_changed'],
    ['changePlanningLevel', () => changePlanningLevel({ planning_level: 'city' }), 'settings.planning_level_changed'],
    ['changeChallenger', () => changeChallenger({ challenger_model: 'ets-1' }), 'forecast.model_settings_changed'],
    ['changeOptimizer', () => changeOptimizer({ optimizer_model: 'greedy-ls-0.3' }), 'settings.optimizer_model_changed'],
    ['changeRemoteHandling', () => changeRemoteHandling({ handling_source: 'fixed' }), 'settings.remote_handling_changed'],
  ];

  it.each(writes)('%s is refused for a role with no edit access (a Planner, a Viewer), audited as denied, and changes nothing', async (_name, call, action) => {
    const stateBefore = JSON.stringify(await getModelState(await ctx()));
    const settingsBefore = JSON.stringify(await getSettingsSnapshot(await ctx()));
    for (const role of ['planner', 'viewer_auditor', 'dispatch_supervisor'] as const) {
      session.role = role;
      expect(await call(), role).toMatchObject({ ok: false, code: 'forbidden' });
    }
    expect((await events(action)).some((e) => e.outcome === 'denied')).toBe(true);
    expect(session.revalidate).not.toHaveBeenCalled();
    expect(JSON.stringify(await getModelState(await ctx()))).toBe(stateBefore);
    expect(JSON.stringify(await getSettingsSnapshot(await ctx()))).toBe(settingsBefore);
  });

  it('every write answers `unauthenticated` with no session, and touches nothing', async () => {
    session.role = null;
    for (const [, call] of writes) expect(await call()).toMatchObject({ ok: false, code: 'unauthenticated' });
    expect(session.revalidate).not.toHaveBeenCalled();
  });
});

describe('an unexpected error', () => {
  it('returns a reference ODP- and 8 hex characters, logs only that reference and the error name, and leaks no input', async () => {
    const hostile = new Proxy({}, {
      getOwnPropertyDescriptor() {
        throw new TypeError('boom: password=hunter2 reason=secret-note');
      },
    });
    const result = await pauseForecast(hostile as never);
    expect(result).toMatchObject({ ok: false, code: 'unexpected' });
    if (result.ok) throw new Error('unreachable');
    expect(result.reference).toMatch(/^ODP-[0-9A-F]{8}$/);
    expect(JSON.stringify(result)).not.toMatch(/hunter2|secret-note|boom/);
    const logged = errorLog.mock.calls.flat().join('\n');
    expect(logged).toContain(result.reference);
    expect(logged).not.toMatch(/hunter2|secret-note|boom|password/);
    expect(session.revalidate).not.toHaveBeenCalled();
  });
});

describe('changeHorizon, changeAutoRetrain, retrainNow', () => {
  it('sets the horizon from 7 to 30 days and the retrain switch, audited', async () => {
    expect(await changeHorizon({ horizon_days: 30 })).toMatchObject({ ok: true, data: { horizonDays: 30 } });
    expect(await changeHorizon({ horizon_days: 31 })).toMatchObject({ ok: false, code: 'invalid' });
    expect(await changeAutoRetrain({ auto_retrain: false })).toMatchObject({ ok: true, data: { autoRetrain: false } });
    expect(await getForecastModelSettings(await ctx())).toMatchObject({ horizon_days: 30, auto_retrain: false });
    expect((await events('forecast.model_settings_changed')).length).toBeGreaterThanOrEqual(2);
    expect(await changeHorizon({ horizon_days: 10 })).toMatchObject({ ok: true });
    expect(await changeAutoRetrain({ auto_retrain: true })).toMatchObject({ ok: true });
  });

  it('retrains in the background and lists it as an experiment', async () => {
    const result = await retrainNow();
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) throw new Error('unreachable');
    const listed = (await listForecastExperiments(await ctx(), { limit: 50 })).items;
    expect(listed.find((e) => e.id === result.data.experimentId)).toMatchObject({ kind: 'retrain', trigger: 'manual' });
    session.role = 'planner';
    expect(await retrainNow()).toMatchObject({ ok: false, code: 'forbidden' });
  });
});

describe('startBacktest', () => {
  it('is refused as a conflict while the forecaster engine is not in use, and audits nothing as started', async () => {
    expect(await startBacktest()).toMatchObject({ ok: false, code: 'conflict' });
    expect(await events('forecast.backtest_started')).toEqual([]);
  });

  it('is the Administrator only: another role is refused and the refusal is audited', async () => {
    session.role = 'planner';
    expect(await startBacktest()).toMatchObject({ ok: false, code: 'forbidden' });
    session.role = 'administrator';
    expect((await events('forecast.backtest_run')).map((e) => e.outcome)).toContain('denied');
  });
});
