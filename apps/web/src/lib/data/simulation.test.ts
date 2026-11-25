// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { checkEngineInvariants } from '../../../../../scripts/contracts/invariants';
import { ForbiddenError, InvalidInputError, NotFoundError } from './errors';
import { getSimulationHistoryRange, getSimulationRun, listSimulationResults, listSimulationRuns } from './simulation';
import { ctxFor, expectJunkIdsInvalidLive, expectValid, fixtureZoneIds, withTempDemoState } from './test-support';

// runSimulation is api-backed: see simulation.live.test.ts.

withTempDemoState();

const [, riyadhNorth, , , , jeddahNorth] = fixtureZoneIds();
const admin = () => ctxFor('administrator');
const planner = () => ctxFor('planner'); // Riyadh Central, North, East
const replayRun = async () => (await listSimulationRuns(admin())).items.find((r) => r.assignment_policy === 'replay_actual');

describe('reading simulation runs', () => {
  it('lists the committed runs and validates against the contract', async () => {
    const list = await listSimulationRuns(admin());
    expect(list.items.map((r) => r.assignment_policy).sort()).toEqual(['nearest', 'replay_actual', 'scorer']);
    expectValid('SimulationRunList', list);
    expect(list.items.every((r) => r.illustrative)).toBe(true);
    expect((await listSimulationRuns(admin(), { date: '2026-09-14' })).items).toHaveLength(1);
    await expect(listSimulationRuns(admin(), { date: 'x' })).rejects.toThrow(InvalidInputError);
  });

  it('shows the output with both 10-minute readings, overall and per zone, and the Illustrative flag', async () => {
    const detail = await getSimulationRun(admin(), (await replayRun())?.id ?? '');
    expectValid('SimulationRunDetail', detail);
    const output = detail.output;
    expect(output).not.toBeNull();
    expect(output?.illustrative).toBe(true);
    expect(output?.zones).toHaveLength(8);
    expect(checkEngineInvariants('simulator.output', output)).toEqual([]);
    for (const level of [output?.overall, ...(output?.zones ?? []).map((z) => z.service_level)]) {
      expect(level?.from_registration.share).toEqual(expect.any(Number));
      expect(level?.from_assignment.share).toEqual(expect.any(Number));
      expect(level?.from_registration.within_count).toBeLessThanOrEqual(level?.from_assignment.within_count ?? 0);
    }
    // The replay of what really happened: from registration is clearly lower than from assignment.
    expect(output?.overall.from_registration.share).toBeLessThan((output?.overall.from_assignment.share ?? 0) - 0.1);
    expect(output?.primary_clock_start).toBe('assignment');
    expect(output?.overall.field_case_count).toBe(output?.zones?.reduce((s, z) => s + z.service_level.field_case_count, 0));
  });

  it('lists stored results and follows the zone scope', async () => {
    const id = (await replayRun())?.id ?? '';
    const all = await listSimulationResults(admin(), id);
    expect(all.items).toHaveLength(8);
    expectValid('SimulationResultList', all);
    expect((await listSimulationResults(admin(), id, { zone_id: riyadhNorth })).items).toHaveLength(1);
    expect((await listSimulationResults(planner(), id)).items.map((r) => r.zone_id).sort()).toEqual([...fixtureZoneIds().slice(0, 3)].sort());
    expect((await getSimulationRun(planner(), id)).output?.zones).toHaveLength(3);
    const outputOverall = (await getSimulationRun(planner(), id)).output?.overall;
    expect(outputOverall?.case_count).toBe((await listSimulationResults(planner(), id)).items.reduce((s, r) => s + r.case_count, 0));
    await expect(getSimulationRun(admin(), 'f0f0f0f0-0000-4000-8000-000000000000')).rejects.toThrow(NotFoundError);
  });

  it('hides a run tied to zones outside the scope', async () => {
    const scenarioRun = (await listSimulationRuns(admin())).items.find((r) => r.scenario_id !== null && r.scenario_id !== undefined);
    expect(scenarioRun).toBeDefined();
    expect((await listSimulationRuns(planner())).items.some((r) => r.id === scenarioRun?.id)).toBe(true); // Riyadh Central is the Planner's
    const otherPlanner = ctxFor('planner', { zones: [jeddahNorth ?? ''] });
    expect((await listSimulationRuns(otherPlanner)).items.some((r) => r.id === scenarioRun?.id)).toBe(false);
    await expect(getSimulationRun(otherPlanner, scenarioRun?.id ?? '')).rejects.toThrow(NotFoundError);
  });

  it('is visible to the roles with the module and to nobody else', async () => {
    for (const role of ['administrator', 'dispatch_supervisor', 'planner', 'viewer_auditor'] as const) await expect(listSimulationRuns(ctxFor(role))).resolves.toBeDefined();
    for (const role of ['dispatcher', 'remote_team_lead', 'change_approver'] as const) await expect(listSimulationRuns(ctxFor(role))).rejects.toThrow(ForbiddenError);
  });
});

describe('getSimulationHistoryRange', () => {
  it('gives the first and last day the committed case history covers', async () => {
    const range = await getSimulationHistoryRange(admin());
    expect(range).toEqual({ first: '2026-09-06', last: '2026-09-12' });
  });

  it('is visible to the roles with the module and to nobody else', async () => {
    for (const role of ['administrator', 'dispatch_supervisor', 'planner', 'viewer_auditor'] as const) await expect(getSimulationHistoryRange(ctxFor(role))).resolves.toBeDefined();
    for (const role of ['dispatcher', 'remote_team_lead', 'change_approver'] as const) await expect(getSimulationHistoryRange(ctxFor(role))).rejects.toThrow(ForbiddenError);
  });
});

describe('crafted ids (review M4) and guard order (review m2)', () => {
  it('refuses a crafted run id or roster id up front and changes nothing', async () => {
    await expectJunkIdsInvalidLive((id) => getSimulationRun(admin(), id));
    await expectJunkIdsInvalidLive((id) => listSimulationResults(admin(), id));
  });
});
