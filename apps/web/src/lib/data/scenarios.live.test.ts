// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, vi } from 'vitest';
import type { Roster } from '@/lib/types';
import { checkEngineInvariants } from '../../../../../scripts/contracts/invariants';
import { listAuditEvents } from './audit';
import { ForbiddenError, NotFoundError } from './errors';
import { getGapSurplus } from './rosters';
import { createScenario, getScenario, listScenarios, runScenario } from './scenarios';
import { getSimulationRun, listSimulationRuns, runSimulation } from './simulation';
import { ctxFor, expectValid, fieldShareForTest, fixtureZoneIds, readAll, withTempDemoState } from './test-support';

// Live: skips, never fakes, if OPENDISPATCH_API_URL unset.
// runScenario reads the real roster plan:
// Scenario itself stays demo-store, reset per
// test below.
const hasApi = process.env['OPENDISPATCH_API_URL'] !== undefined && process.env['OPENDISPATCH_API_URL'] !== '';

withTempDemoState();

const [riyadhCentral, riyadhNorth, riyadhEast] = fixtureZoneIds();
const admin = () => ctxFor('administrator');
const planner = () => ctxFor('planner'); // Reem: Riyadh Central, North, East
const monday = '2026-09-14';

async function fixtureScenario(startsWith: string): Promise<Awaited<ReturnType<typeof listScenarios>>['items'][number]> {
  const found = (await listScenarios(admin(), { limit: 50 })).items.find((s) => s.name.startsWith(startsWith));
  if (found === undefined) throw new Error(`No scenario ${startsWith}`);
  return found;
}

function gapCount(cells: readonly { kind: string }[]): number {
  return cells.filter((c) => c.kind === 'gap').length;
}

function surplusCount(cells: readonly { kind: string }[]): number {
  return cells.filter((c) => c.kind === 'surplus').length;
}

function sumOf(cells: readonly { planned: number; required: number }[], key: 'planned' | 'required'): number {
  return cells.reduce((s, c) => s + c[key], 0);
}

const baseWrite = (zones: (string | undefined)[], adjustments: Record<string, unknown>) => ({ name: 'What if', base_date: monday, zone_ids: zones, adjustments });

async function rosterOf(zoneId: string | undefined, date: string): Promise<Roster> {
  const found = (await readAll<Roster>(admin().customerId, 'Roster')).find((r) => r.zone_id === zoneId && r.roster_date === date && r.status !== 'superseded');
  if (found === undefined) throw new Error('No roster');
  return found;
}

describe.skipIf(!hasApi)('flow 4: run a scenario and the gap view recalculates (live, real api and Postgres)', () => {
  if (!hasApi) console.log('OPENDISPATCH_API_URL is not set: scenarios.live.test.ts is skipped, not faked.');

  it('more field agents and vehicles add cover, never gaps, and the result follows the contract', async () => {
    const baseline = await getGapSurplus(admin(), { zone_id: riyadhCentral, date: monday });
    const scenario = await fixtureScenario('Riyadh Central');
    const result = await runScenario(planner(), scenario.id);
    expectValid('ScenarioRunResult', result);
    expect(result).toMatchObject({ scenario_id: scenario.id, illustrative: true, data_source: 'SYNTHETIC' });
    expect(checkEngineInvariants('optimizer.output', result.optimizer)).toEqual([]);
    expect(checkEngineInvariants('simulator.output', result.simulation)).toEqual([]);
    const cells = result.optimizer.gap_cells;
    expect(cells).toHaveLength(96);
    expect(cells.every((c) => c.zone_id === riyadhCentral)).toBe(true);
    expect(sumOf(cells, 'planned')).toBeGreaterThan(sumOf(baseline.cells, 'planned'));
    // at 0.5 RD-C has one geography gap left
    expect(gapCount(cells)).toBeLessThanOrEqual(gapCount(baseline.cells));
    expect(surplusCount(cells)).toBeGreaterThan(surplusCount(baseline.cells));
    expect(sumOf(cells, 'required')).toBe(sumOf(baseline.cells, 'required'));
    expect(result.optimizer.roster_assignments.filter((a) => a.zone_id === riyadhCentral).length).toBeGreaterThan(20);
    // The gap view of the scenario is what the run produced.
    const view = await getGapSurplus(planner(), { scenario_id: scenario.id });
    expect(view).toMatchObject({ scenario_id: scenario.id, roster_date: monday, illustrative: true });
    expect(view.cells).toEqual(cells);
    expectValid('GapSurplusView', view);
    // A run changes nothing on the stored roster.
    expect((await getGapSurplus(admin(), { zone_id: riyadhCentral, date: monday })).cells).toEqual(baseline.cells);
    expect(await getScenario(planner(), scenario.id)).toMatchObject({ status: 'completed', last_run_at: expect.any(String) });
    expect((await listAuditEvents(admin(), { action: 'scenario.run' })).items[0]).toMatchObject({ outcome: 'success', entity_id: scenario.id });
  });

  it('is deterministic', async () => {
    const scenario = await fixtureScenario('Riyadh Central');
    const a = await runScenario(planner(), scenario.id);
    const b = await runScenario(planner(), scenario.id);
    expect(b.optimizer.gap_cells).toEqual(a.optimizer.gap_cells);
    expect(b.optimizer.roster_assignments).toEqual(a.optimizer.roster_assignments);
    expect(b.optimizer.vehicle_assignments).toEqual(a.optimizer.vehicle_assignments);
    expect(b.simulation?.overall).toEqual(a.simulation?.overall);
  });

  it('fewer agents add gaps, and fewer vehicles make the cause vehicles', async () => {
    const baseline = await getGapSurplus(admin(), { zone_id: riyadhCentral, date: monday });
    const fewerScenario = await createScenario(planner(), baseWrite([riyadhCentral], { headcount_delta: [{ zone_id: riyadhCentral, field_agents: -6 }] }));
    const fewer = await runScenario(planner(), fewerScenario.id);
    expect(gapCount(fewer.optimizer.gap_cells)).toBeGreaterThan(gapCount(baseline.cells));
    expect(sumOf(fewer.optimizer.gap_cells, 'planned')).toBeLessThan(sumOf(baseline.cells, 'planned'));
    const noVehiclesScenario = await createScenario(planner(), baseWrite([riyadhCentral], { headcount_delta: [{ zone_id: riyadhCentral, vehicles: -9 }] }));
    const noVehicles = await runScenario(planner(), noVehiclesScenario.id);
    expect(noVehicles.optimizer.gap_cells.some((c) => c.kind === 'gap' && c.cause === 'vehicles')).toBe(true);
    expect(noVehicles.optimizer.vehicle_assignments.length).toBeLessThan(baseline.cells.length);
    expect(checkEngineInvariants('optimizer.output', noVehicles.optimizer)).toEqual([]);
    const plusPeopleNoVehiclesScenario = await createScenario(planner(), baseWrite([riyadhCentral], { headcount_delta: [{ zone_id: riyadhCentral, field_agents: 4, vehicles: 0 }] }));
    const plusPeopleNoVehicles = await runScenario(planner(), plusPeopleNoVehiclesScenario.id);
    expect(plusPeopleNoVehicles.optimizer.gap_cells.filter((c) => c.kind === 'gap').length).toBeLessThanOrEqual(gapCount(baseline.cells));
  });

  it('follows the remote share: required staffing moves with the field share the rules give', async () => {
    const baseline = await getGapSurplus(admin(), { zone_id: riyadhCentral, date: monday });
    const share = (await fieldShareForTest(admin(), { zoneId: riyadhCentral })).zones[0]?.field_share ?? 0.5;
    const moreScenario = await createScenario(planner(), baseWrite([riyadhCentral], { remote_share: 0.6 }));
    const more = await runScenario(planner(), moreScenario.id);
    const requiredMore = sumOf(more.optimizer.gap_cells, 'required');
    expect(requiredMore).toBeLessThan(sumOf(baseline.cells, 'required'));
    expect(requiredMore / sumOf(baseline.cells, 'required')).toBeCloseTo((1 - 0.6) / share, 0);
    const sameScenario = await createScenario(planner(), baseWrite([riyadhCentral], { remote_share: 1 - share }));
    const same = await runScenario(planner(), sameScenario.id);
    expect(Math.abs(sumOf(same.optimizer.gap_cells, 'required') - sumOf(baseline.cells, 'required'))).toBeLessThan(sumOf(baseline.cells, 'required') * 0.05);
  });

  it('deals the agents over the chosen shift patterns and places their breaks again', async () => {
    const scenario = await fixtureScenario('Ramadan shift pattern');
    const result = await runScenario(planner(), scenario.id);
    expect(result.optimizer.gap_cells.map((c) => c.zone_id)).toEqual(expect.arrayContaining([riyadhCentral, riyadhNorth]));
    expect(result.optimizer.gap_cells).toHaveLength(2 * 96);
    const chosen = new Set(scenario.adjustments.shift_pattern_ids);
    expect(result.optimizer.roster_assignments.every((a) => chosen.has(a.shift_pattern_id))).toBe(true);
    expect(new Set(result.optimizer.roster_assignments.map((a) => a.shift_pattern_id)).size).toBeGreaterThanOrEqual(3);
    expect(result.optimizer.roster_assignments.every((a) => a.break_start_at !== null && a.break_start_at !== undefined)).toBe(true);
    expect(checkEngineInvariants('optimizer.output', result.optimizer)).toEqual([]);
    expectValid('ScenarioRunResult', result);
  });

  it('gives the simulator no worse a service level for the scenario with more coverage, both readings shown', async () => {
    const roster = await rosterOf(riyadhCentral, monday);
    const simRun = await runSimulation(planner(), { roster_id: roster.id, run_date: '2026-09-07' });
    const baseline = (await getSimulationRun(admin(), simRun.id)).output;
    const scenario = await fixtureScenario('Riyadh Central');
    const result = await runScenario(planner(), scenario.id);
    // the roster already covers the need at 0.5
    expect(result.simulation?.overall.from_assignment.share).toBeGreaterThanOrEqual(baseline?.overall.from_assignment.share ?? 1);
    const fewer = await runScenario(planner(), (await createScenario(planner(), baseWrite([riyadhCentral], { headcount_delta: [{ zone_id: riyadhCentral, field_agents: -12 }] }))).id);
    expect(fewer.simulation?.overall.from_assignment.share).toBeLessThan(baseline?.overall.from_assignment.share ?? 0);
    expect(result.simulation?.overall.from_registration.share).toEqual(expect.any(Number));
    expect(result.simulation?.primary_clock_start).toBe('assignment');
    expect(result.simulation?.illustrative).toBe(true);
    const stored = (await listSimulationRuns(planner())).items.find((r) => r.scenario_id === scenario.id);
    expect(stored).toMatchObject({ status: 'succeeded', roster_id: null });
    expect((await getSimulationRun(planner(), stored?.id ?? '')).output?.overall.from_assignment.share).toBeCloseTo(result.simulation?.overall.from_assignment.share ?? 0, 10);
  });

  it('runs without a roster for the day by projecting one', async () => {
    const scenario = await createScenario(planner(), { ...baseWrite([riyadhCentral], { headcount_delta: [{ zone_id: riyadhCentral, field_agents: 3 }] }), base_date: '2026-10-05' });
    const result = await runScenario(planner(), scenario.id);
    expect(result.optimizer.roster_assignments.length).toBeGreaterThan(15);
    expectValid('ScenarioRunResult', result);
  });

  it('hides scenarios of other zones and audits a run outside the write scope', async () => {
    const wide = await fixtureScenario('Remote share');
    await expect(runScenario(planner(), wide.id)).rejects.toThrow(NotFoundError);
    await expect(getGapSurplus(planner(), { scenario_id: wide.id })).rejects.toThrow(NotFoundError);
    await expect(getGapSurplus(ctxFor('remote_team_lead'), { scenario_id: wide.id })).rejects.toThrow(ForbiddenError);
    expect((await getGapSurplus(admin(), { scenario_id: wide.id })).cells).toHaveLength(5 * 96);
    expect(riyadhEast).toBeDefined();
  });

  it('keeps a run across a fresh module instance', async () => {
    const scenario = await fixtureScenario('Riyadh Central');
    const result = await runScenario(planner(), scenario.id);
    vi.resetModules();
    const fresh = await import('./scenarios');
    expect(await fresh.getScenario(planner(), scenario.id)).toMatchObject({ status: 'completed' });
    const freshRosters = await import('./rosters');
    expect((await freshRosters.getGapSurplus(planner(), { scenario_id: scenario.id })).cells).toEqual(result.optimizer.gap_cells);
  });
});
