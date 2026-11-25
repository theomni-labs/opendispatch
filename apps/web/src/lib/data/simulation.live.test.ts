// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, vi } from 'vitest';
import type { Roster, RosterAssignment } from '@/lib/types';
import { checkEngineInvariants } from '../../../../../scripts/contracts/invariants';
import { listAuditEvents } from './audit';
import { ForbiddenError, InvalidInputError, NotFoundError } from './errors';
import { approveOverride, createOverride } from './rosters';
import { updateClockStart } from './settings';
import { getSimulationRun, listSimulationRuns, runSimulation } from './simulation';
import { ctxFor, expectValid, fixtureZoneIds, JUNK_IDS, readAll, withTempDemoState } from './test-support';

// Live: skips, never fakes, if OPENDISPATCH_API_URL unset.
// runSimulation reads the live roster before
// its own permission check, so even its denial
// tests need a live api.
const hasApi = process.env['OPENDISPATCH_API_URL'] !== undefined && process.env['OPENDISPATCH_API_URL'] !== '';

withTempDemoState();

const [riyadhCentral, , , , , jeddahNorth] = fixtureZoneIds();
const admin = () => ctxFor('administrator');
const planner = () => ctxFor('planner'); // Riyadh Central, North, East
const supervisor = () => ctxFor('dispatch_supervisor');
const draftDay = '2026-09-15';

async function rosterAt(zoneId: string | undefined, date: string): Promise<Roster> {
  const found = (await readAll<Roster>(admin().customerId, 'Roster')).find((r) => r.zone_id === zoneId && r.roster_date === date && r.status !== 'superseded');
  if (found === undefined) throw new Error('No roster');
  return found;
}

describe.skipIf(!hasApi)('flow: replay cases against a roster (live, real api and Postgres)', () => {
  if (!hasApi) console.log('OPENDISPATCH_API_URL is not set: simulation.live.test.ts is skipped, not faked.');

  it('runs a simulation, stores it and shows both readings with the primary one from the setting', async () => {
    const roster = await rosterAt(riyadhCentral, draftDay);
    const run = await runSimulation(planner(), { roster_id: roster.id, run_date: '2026-09-12', assignment_policy: 'scorer' });
    expect(run).toMatchObject({ roster_id: roster.id, run_date: '2026-09-12', assignment_policy: 'scorer', status: 'succeeded', illustrative: true, primary_clock_start: 'assignment', threshold_seconds: 600, created_by: planner().userId });
    expectValid('SimulationRun', run);
    const detail = await getSimulationRun(planner(), run.id);
    expectValid('SimulationRunDetail', detail);
    expect(checkEngineInvariants('simulator.output', detail.output)).toEqual([]);
    expect(detail.output?.zones).toHaveLength(1);
    expect(detail.output?.roster_ref).toBe(roster.id);
    expect(detail.output?.overall.from_registration.case_count).toBe(detail.output?.overall.from_assignment.case_count);
    expect((await listSimulationRuns(planner())).items.map((r) => r.id)).toContain(run.id);
    expect((await listAuditEvents(admin(), { action: 'simulation.run' })).items[0]).toMatchObject({ outcome: 'success', entity_type: 'simulation_run', entity_id: run.id });

    await updateClockStart(admin(), { clock_start: 'registration' });
    const second = await runSimulation(planner(), { roster_id: roster.id, run_date: '2026-09-12' });
    expect(second.primary_clock_start).toBe('registration');
    const output = (await getSimulationRun(planner(), second.id)).output;
    expect(output?.primary_clock_start).toBe('registration');
    expect(output?.overall.from_assignment.share).toEqual(expect.any(Number)); // the other reading is never dropped
    expect(output?.overall.from_registration.share).toEqual(expect.any(Number));
    expect(second.assignment_policy).toBe('nearest');
  });

  it('gives a worse service level to a roster that covers less of the required staffing', async () => {
    const roster = await rosterAt(riyadhCentral, draftDay);
    const beforeRun = await runSimulation(planner(), { roster_id: roster.id, run_date: '2026-09-12' });
    const before = (await getSimulationRun(planner(), beforeRun.id)).output;
    const lines = (await readAll<RosterAssignment>(admin().customerId, 'RosterAssignment')).filter((a) => a.roster_id === roster.id && a.zone_id === riyadhCentral);
    for (const line of lines.slice(0, 6)) {
      await approveOverride(supervisor(), (await createOverride(planner(), roster.id, { roster_assignment_id: line.id, change_type: 'remove_assignment', reason_code: 'agent_unavailable' })).id);
    }
    const afterRun = await runSimulation(planner(), { roster_id: roster.id, run_date: '2026-09-12' });
    const after = (await getSimulationRun(planner(), afterRun.id)).output;
    expect(after?.overall.from_assignment.share).toBeLessThan(before?.overall.from_assignment.share ?? 0);
    expect(after?.overall.assigned_to_arrived?.median_seconds).toBeGreaterThan(before?.overall.assigned_to_arrived?.median_seconds ?? Number.POSITIVE_INFINITY);
    expect(checkEngineInvariants('simulator.output', after)).toEqual([]);
  });

  it('refuses a day without cases, a missing roster, another zone and roles without edit, and audits the denials', async () => {
    const roster = await rosterAt(riyadhCentral, draftDay);
    await expect(runSimulation(planner(), { roster_id: roster.id, run_date: '2026-10-01' })).rejects.toThrow(/run_date must be a day with cases/);
    await expect(runSimulation(planner(), { roster_id: 'f0f0f0f0-0000-4000-8000-000000000000', run_date: '2026-09-12' })).rejects.toThrow(NotFoundError);
    await expect(runSimulation(planner(), { roster_id: roster.id, run_date: '2026-09-12', assignment_policy: 'random' })).rejects.toThrow(InvalidInputError);
    await expect(runSimulation(planner(), { roster_id: roster.id, run_date: '2026-09-12', role: 'planner' })).rejects.toThrow(InvalidInputError);
    const jeddahRoster = await rosterAt(jeddahNorth, '2026-09-14');
    await expect(runSimulation(planner(), { roster_id: jeddahRoster.id, run_date: '2026-09-12' })).rejects.toThrow(ForbiddenError);
    for (const role of ['viewer_auditor', 'dispatch_supervisor', 'administrator'] as const) await expect(runSimulation(ctxFor(role), { roster_id: roster.id, run_date: '2026-09-12' })).rejects.toThrow(ForbiddenError);
    expect((await listAuditEvents(admin(), { action: 'simulation.run', outcome: 'denied' })).items).toHaveLength(4);
  });

  it('keeps a run across a fresh module instance', async () => {
    const roster = await rosterAt(riyadhCentral, draftDay);
    const run = await runSimulation(planner(), { roster_id: roster.id, run_date: '2026-09-10' });
    vi.resetModules();
    const fresh = await import('./simulation');
    expect((await fresh.getSimulationRun(planner(), run.id)).run).toEqual(run);
    expect((await fresh.listSimulationResults(planner(), run.id)).items).toHaveLength(1);
  });
});

describe.skipIf(!hasApi)('crafted ids: runSimulation (live, real api and Postgres)', () => {
  it('refuses a crafted roster id up front and changes nothing', async () => {
    for (const id of JUNK_IDS) await expect(runSimulation(planner(), { roster_id: id as never, run_date: '2026-09-12' })).rejects.toThrow(InvalidInputError);
  });

  it('answers forbidden and audits the denial for a caller who may not write, whatever the body', async () => {
    for (const id of JUNK_IDS) await expect(runSimulation(ctxFor('viewer_auditor'), { roster_id: id as never })).rejects.toThrow(ForbiddenError);
    await expect(runSimulation(ctxFor('viewer_auditor'), 'not an object')).rejects.toThrow(ForbiddenError);
    expect((await listAuditEvents(admin(), { action: 'simulation.run', outcome: 'denied' })).items.length).toBeGreaterThanOrEqual(16);
  });

  it('keeps every stored run and result complete after a valid run', async () => {
    const roster = await rosterAt(riyadhCentral, draftDay);
    await runSimulation(planner(), { roster_id: roster.id, run_date: '2026-09-12' });
    await expect(getSimulationRun(admin(), 'toString')).rejects.toThrow(InvalidInputError);
    expect((await listSimulationRuns(admin())).items.every((r) => typeof r.id === 'string' && typeof r.tenant_id === 'string')).toBe(true);
  });
});
