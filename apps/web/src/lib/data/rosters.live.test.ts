// SPDX-License-Identifier: AGPL-3.0-only
// Live: skips, never fakes, if OPENDISPATCH_API_URL unset.
// Roster/RosterAssignment/Approval/Override are all Go
// now (Approval shared with rules.ts, updates.ts, whose
// own Approval-touching writes aren't cut over yet).

import { describe, expect, it } from 'vitest';
import type { Override, Roster, RosterAssignment, Agent } from '@/lib/types';
import { listAuditEvents } from './audit';
import { ConflictError, DataError, ForbiddenError, InvalidInputError, NotFoundError } from './errors';
import { fixtureObject } from './internal/fixtures';
import { isId } from './internal/ids';
import { listApprovals } from './notifications';
import {
  approveOverride,
  approveRoster,
  buildRoster,
  createOverride,
  getGapSurplus,
  getRoster,
  listRosterAssignments,
  listRosterOverrides,
  listRosters,
  publishRoster,
  rejectOverride,
  rejectRoster,
  submitRoster,
} from './rosters';
import { ctxFor, dataSnapshot, auditCount, expectValid, fixtureZoneIds, JUNK_IDS, readAll, withTempDemoState } from './test-support';
import { freshDate } from '../../../test/live-fixtures';

const hasApi = process.env['OPENDISPATCH_API_URL'] !== undefined && process.env['OPENDISPATCH_API_URL'] !== '';

describe.skipIf(!hasApi)('rosters (live, real api and Postgres)', () => {
  if (!hasApi) console.log('OPENDISPATCH_API_URL is not set: rosters.live.test.ts is skipped, not faked.');

  // Resets Go's in-memory state too (rules/overrides/forecast runs, audit).
  withTempDemoState();

  const [riyadhCentral, riyadhNorth, riyadhEast, , , jeddahNorth] = fixtureZoneIds();
  const admin = () => ctxFor('administrator');
  const planner = () => ctxFor('planner'); // Reem: Riyadh Central, North, East
  const supervisor = () => ctxFor('dispatch_supervisor'); // Fahad: the five Riyadh zones
  // Read-only fixture: no test below mutates it.
  const draftDay = '2026-09-15';
  const monday = '2026-09-14';
  const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;


  async function rosterAt(zoneId: string | undefined, date: string): Promise<Roster> {
    const found = (await readAll<Roster>(admin().customerId, 'Roster')).find((r) => r.zone_id === zoneId && r.roster_date === date && r.status !== 'superseded');
    if (found === undefined) throw new Error(`No roster for ${String(zoneId)} on ${date}`);
    return found;
  }

  async function linesOf(roster: Roster): Promise<RosterAssignment[]> {
    return (await readAll<RosterAssignment>(admin().customerId, 'RosterAssignment')).filter((a) => a.roster_id === roster.id && a.zone_id === roster.zone_id);
  }

  async function gapCount(zoneId: string | undefined, date: string): Promise<number> {
    return (await getGapSurplus(admin(), { zone_id: zoneId, date })).cells.filter((c) => c.kind === 'gap').length;
  }

  async function auditActions(outcome: 'success' | 'denied' = 'success'): Promise<string[]> {
    return (await listAuditEvents(admin(), { outcome, limit: 200 })).items.map((e) => e.action);
  }

  describe('reading rosters', () => {
    it('lists the rosters with fresh gap and surplus counts and validates against the contract', async () => {
      const list = await listRosters(admin(), { limit: 200 });
      expect(list.items.length).toBeGreaterThan(40);
      expectValid('RosterList', list);
      for (const roster of list.items) expect(roster.gap_count).toEqual(expect.any(Number));
      const filtered = await listRosters(admin(), { zone_id: riyadhCentral, date: monday });
      expect(filtered.items).toHaveLength(1);
      expect((await listRosters(admin(), { status: 'published' })).items.every((r) => r.status === 'published')).toBe(true);
      await expect(listRosters(admin(), { status: 'done' as 'draft' })).rejects.toThrow(InvalidInputError);
      const roster = await getRoster(admin(), filtered.items[0]?.id ?? '');
      expect(roster.gap_count).toBe(await gapCount(riyadhCentral, monday));
      expectValid('Roster', roster);
      expect([roster.optimizer_source ?? null, roster.fallback_reason ?? null]).toEqual([null, null]);
    });

    it('shows the assignments with vehicle and break, and the overrides of a roster', async () => {
      const roster = await rosterAt(riyadhCentral, monday);
      const lines = await listRosterAssignments(admin(), roster.id, { limit: 200 });
      expect(lines.items.length).toBeGreaterThan(15);
      expectValid('RosterAssignmentList', lines);
      const zoneLines = lines.items.filter((a) => a.zone_id === roster.zone_id);
      expect(zoneLines.every((a) => a.vehicle_id !== null && a.break_start_at !== null)).toBe(true);
      expectValid('OverrideList', await listRosterOverrides(admin(), roster.id));
      await expect(getRoster(admin(), 'f0f0f0f0-0000-4000-8000-000000000000')).rejects.toThrow(NotFoundError);
    });

    it('keeps to the role and the zone scope', async () => {
      expect((await listRosters(planner(), { limit: 200 })).items.every((r) => [riyadhCentral, riyadhNorth, riyadhEast].includes(r.zone_id))).toBe(true);
      const jeddahRoster = await rosterAt(jeddahNorth, monday);
      await expect(getRoster(planner(), jeddahRoster.id)).rejects.toThrow(NotFoundError);
      await expect(listRosterAssignments(planner(), jeddahRoster.id)).rejects.toThrow(NotFoundError);
      for (const role of ['dispatcher', 'remote_team_lead', 'change_approver'] as const) {
        await expect(listRosters(ctxFor(role))).rejects.toThrow(ForbiddenError);
      }
      await expect(listRosters(ctxFor('viewer_auditor'))).resolves.not.toThrow();
    });
  });

  describe('the gap and surplus view', () => {
    it('reproduces the placeholder optimizer for 14 Sep at the set capacity: same planned, required rescaled, in every zone and interval', async () => {
      const optimizer = fixtureObject<{ readonly gap_cells: readonly { zone_id: string; interval_index: number; required: number; planned: number }[] }>('optimizer.output');
      const view = await getGapSurplus(admin(), { date: monday });
      // the fixture's own capacity
      const fixtureCapacity = (0.25 * 0.5) / 0.55;
      const capacity = new Map((view.required_staffing?.zones ?? []).map((z) => [z.zone_id, z.cases_per_agent_per_interval] as const));
      // Zone is api-backed: other live files may add one.
      expect(view.cells.length).toBeGreaterThanOrEqual(8 * 96);
      expect(view.illustrative).toBe(true);
      expectValid('GapSurplusView', view);
      const key = (c: { zone_id: string; interval_index: number }) => `${c.zone_id}|${String(c.interval_index)}`;
      const mine = new Map(view.cells.map((c) => [key(c), c] as const));
      for (const fixtureCell of optimizer?.gap_cells ?? []) {
        const cell = mine.get(key(fixtureCell));
        const ratio = fixtureCapacity / (capacity.get(fixtureCell.zone_id) ?? Number.NaN);
        expect([cell?.required, cell?.planned]).toEqual([Math.round(fixtureCell.required * ratio), fixtureCell.planned]);
      }
    });

    it('keeps kind and cause consistent with delta', async () => {
      for (const c of (await getGapSurplus(admin(), { date: draftDay })).cells) {
        expect(c.delta).toBe(c.planned - c.required);
        expect(c.kind).toBe(c.delta < 0 ? 'gap' : c.delta > 0 ? 'surplus' : 'balanced');
        expect(c.cause === null).toBe(c.kind === 'balanced');
      }
    });

    it('narrows to a zone, a roster, and refuses a roster with a scenario', async () => {
      const roster = await rosterAt(riyadhNorth, monday);
      const byRoster = await getGapSurplus(admin(), { roster_id: roster.id });
      expect(byRoster).toMatchObject({ roster_id: roster.id, roster_date: monday });
      expect(byRoster.cells).toHaveLength(96);
      expect(byRoster.cells.every((c) => c.zone_id === riyadhNorth)).toBe(true);
      const byZone = await getGapSurplus(admin(), { zone_id: riyadhNorth, date: monday });
      expect(byZone.roster_id).toBe(roster.id);
      expect(byZone.cells).toEqual(byRoster.cells);
      await expect(getGapSurplus(admin(), { roster_id: roster.id, scenario_id: roster.id })).rejects.toThrow(InvalidInputError);
      await expect(getGapSurplus(admin(), { zone_id: 'f0f0f0f0-0000-4000-8000-000000000000' })).rejects.toThrow(NotFoundError);
      await expect(getGapSurplus(admin(), { date: 'soon' })).rejects.toThrow(InvalidInputError);
    });

    it('shows a Planner their zones and the remote team lead every zone, and nobody else', async () => {
      expect(new Set((await getGapSurplus(planner(), { date: monday })).cells.map((c) => c.zone_id))).toEqual(new Set([riyadhCentral, riyadhNorth, riyadhEast]));
      expect(new Set((await getGapSurplus(ctxFor('remote_team_lead'), { date: monday })).cells.map((c) => c.zone_id)).size).toBeGreaterThanOrEqual(8);
      await expect(getGapSurplus(ctxFor('dispatcher'))).rejects.toThrow(ForbiddenError);
      await expect(getGapSurplus(ctxFor('change_approver'))).rejects.toThrow(ForbiddenError);
      await expect(getGapSurplus(planner(), { zone_id: jeddahNorth })).rejects.toThrow(NotFoundError);
    });
  });

  describe('flow 2: build, override, approve, publish (stub)', () => {
    it('builds a roster for a zone and day that has none, like the placeholder optimizer does', async () => {
      const built = await buildRoster(planner(), { zone_id: riyadhCentral, roster_date: '2026-09-21' });
      expect(built).toMatchObject({ zone_id: riyadhCentral, roster_date: '2026-09-21', status: 'draft', illustrative: true, data_source: 'SYNTHETIC', planning_level: 'zone', created_by: planner().userId });
      expect(built.optimizer_status).toMatch(/feasible|partial/);
      expectValid('Roster', built);
      const lines = await linesOf(built);
      expect(lines.length).toBeGreaterThan(15);
      expect(lines.every((a) => a.vehicle_id !== null && a.standby_point_id !== null && a.break_start_at !== null && a.is_override === false)).toBe(true);
      expect((await getRoster(planner(), built.id)).gap_count).toBe(built.gap_count);
      expect((await getGapSurplus(planner(), { zone_id: riyadhCentral, date: '2026-09-21' })).roster_id).toBe(built.id);
      expect(await auditActions()).toContain('roster.built');
    });

    it('builds the same agents on a rebuild, on their home shifts, leaving out days off', async () => {
      const date = freshDate(1);
      const first = await buildRoster(planner(), { zone_id: riyadhCentral, roster_date: date });
      const before = await linesOf(first);
      const rebuilt = await buildRoster(planner(), { zone_id: riyadhCentral, roster_date: date });
      const after = await linesOf(rebuilt);
      expect(new Set(after.map((a) => a.agent_id))).toEqual(new Set(before.map((a) => a.agent_id)));
      expect(rebuilt.id).toBe(first.id);
      const weekday = WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()];
      const agents = new Map((await readAll<Agent>(admin().customerId, 'Agent')).map((s) => [s.id, s] as const));
      for (const line of after) expect(agents.get(line.agent_id)?.extra?.['days_off']).not.toContain(weekday);
    });

    it('refuses a past day, a roster that is already approved, a zone outside the scope and a role without edit', async () => {
      await expect(buildRoster(planner(), { zone_id: riyadhCentral, roster_date: '2026-09-01' })).rejects.toThrow(InvalidInputError);
      await expect(buildRoster(planner(), { zone_id: riyadhCentral, roster_date: '2027-06-01' })).rejects.toThrow(InvalidInputError);
      await expect(buildRoster(planner(), { zone_id: riyadhNorth, roster_date: monday })).rejects.toThrow(ConflictError); // approved
      await expect(buildRoster(planner(), { zone_id: jeddahNorth, roster_date: '2026-09-21' })).rejects.toThrow(ForbiddenError);
      for (const role of ['viewer_auditor', 'administrator'] as const) await expect(buildRoster(ctxFor(role), { zone_id: riyadhCentral, roster_date: '2026-09-21' })).rejects.toThrow(ForbiddenError);
      await expect(buildRoster(planner(), { zone_id: riyadhCentral, roster_date: '2026-09-21', role: 'administrator' })).rejects.toThrow(InvalidInputError);
      expect(await auditActions('denied')).toEqual(expect.arrayContaining(['roster.built']));
    });

    it('needs a reason for an override, and a note when the reason is other', async () => {
      const roster = await rosterAt(riyadhCentral, draftDay);
      const line = (await linesOf(roster))[0];
      const base = { roster_assignment_id: line?.id, change_type: 'remove_assignment' };
      await expect(createOverride(planner(), roster.id, base)).rejects.toThrow(/reason code is required/);
      await expect(createOverride(planner(), roster.id, { ...base, reason_code: '' })).rejects.toThrow(InvalidInputError);
      await expect(createOverride(planner(), roster.id, { ...base, reason_code: 'because' })).rejects.toThrow(InvalidInputError);
      await expect(createOverride(planner(), roster.id, { ...base, reason_code: 'other' })).rejects.toThrow(/note is required/);
      await expect(createOverride(planner(), roster.id, { ...base, reason_code: 'other', note: '   ' })).rejects.toThrow(InvalidInputError);
      await expect(createOverride(planner(), roster.id, { change_type: 'replace_agent', reason_code: 'agent_unavailable' })).rejects.toThrow(InvalidInputError); // no assignment
      expect((await listRosterOverrides(admin(), roster.id)).items.every((o) => o.reason_code !== undefined)).toBe(true);
      const ok = await createOverride(planner(), roster.id, { ...base, reason_code: 'other', note: 'Vehicle workshop day.' });
      expect(ok).toMatchObject({ status: 'pending', reason_code: 'other', note: 'Vehicle workshop day.', change_type: 'remove_assignment', created_by: planner().userId, data_source: 'SYNTHETIC' });
      expectValid('Override', ok);
    });

    it('changes the gap view only when a Supervisor approves the override', async () => {
      const date = freshDate(1);
      const built = await buildRoster(planner(), { zone_id: riyadhCentral, roster_date: date });
      // Any line: the date is random, no fixed shift.
      const dayA = (await linesOf(built))[0];
      expect(dayA).toBeDefined();
      const before = await getGapSurplus(admin(), { zone_id: riyadhCentral, date });
      const override = await createOverride(planner(), built.id, { roster_assignment_id: dayA?.id, change_type: 'remove_assignment', reason_code: 'agent_unavailable' });
      expect((await getGapSurplus(admin(), { zone_id: riyadhCentral, date })).cells).toEqual(before.cells); // pending: no effect
      expect((await listApprovals(supervisor(), { subject_type: 'override', limit: 200 })).items.find((a) => a.subject_id === override.id)).toMatchObject({ subject_type: 'override', status: 'pending', created_by: planner().userId });

      const approved = await approveOverride(supervisor(), override.id, { note: 'Agreed.' });
      expect(approved).toMatchObject({ status: 'approved', decided_by_user_id: supervisor().userId });
      expectValid('Override', approved);
      const after = await getGapSurplus(admin(), { zone_id: riyadhCentral, date });
      expect(after.cells).not.toEqual(before.cells);
      // At least one interval loses exactly the one removed agent.
      const drops = before.cells.filter((c, i) => (after.cells[i]?.planned ?? 0) === c.planned - 1);
      expect(drops.length).toBeGreaterThan(0);
      expect(after.cells.filter((c) => c.kind === 'gap').length).toBeGreaterThanOrEqual(before.cells.filter((c) => c.kind === 'gap').length);
      expect((await linesOf(built)).some((a) => a.id === dayA?.id)).toBe(false);
      expect((await listApprovals(supervisor(), { subject_type: 'override', limit: 200 })).items.find((a) => a.subject_id === override.id)).toMatchObject({ status: 'approved', decided_by_user_id: supervisor().userId });
      expect((await getRoster(admin(), built.id)).gap_count).toBe(await gapCount(riyadhCentral, date));
      expect(await auditActions()).toEqual(expect.arrayContaining(['override.created', 'override.approved']));
    });

    it('applies a vehicle change, an agent replacement, a shift change and an addition when approved', async () => {
      const date = freshDate(1);
      const built = await buildRoster(planner(), { zone_id: riyadhCentral, roster_date: date });
      // Any two lines: the date is random.
      const lines = await linesOf(built);
      const a = lines[0];
      const b = lines.find((l) => l.id !== a?.id);
      const allAgents = await readAll<Agent>(admin().customerId, 'Agent');
      const allAssignments = await readAll<RosterAssignment>(admin().customerId, 'RosterAssignment');
      const spare = allAgents.find((s) => s.kind === 'field' && s.is_active && s.home_zone_id === riyadhNorth && !allAssignments.some((x) => x.roster_id === built.id && x.agent_id === s.id));
      const allVehicles = await readAll<{ id: string; zone_id: string; is_active: boolean }>(admin().customerId, 'Vehicle');
      const otherVehicle = allVehicles.find((veh) => veh.zone_id === riyadhCentral && veh.is_active && veh.id !== a?.vehicle_id);
      const allPatterns = await readAll<{ id: string; code: string }>(admin().customerId, 'ShiftPattern');
      const nightPattern = allPatterns.find((p) => p.code === 'DAY-B');
      const decide = async (input: Record<string, unknown>): Promise<Override> => approveOverride(supervisor(), (await createOverride(planner(), built.id, { reason_code: 'dispatcher_judgement', ...input })).id);

      await decide({ roster_assignment_id: a?.id, change_type: 'change_vehicle', vehicle_id: otherVehicle?.id });
      await decide({ roster_assignment_id: a?.id, change_type: 'replace_agent', agent_id: spare?.id });
      await decide({ roster_assignment_id: b?.id, change_type: 'change_shift', shift_pattern_id: allPatterns.find((p) => p.code === 'DAY-A')?.id });
      const added = allAgents.find((s) => s.kind === 'field' && s.is_active && s.home_zone_id === riyadhNorth && s.id !== spare?.id && !lines.some((x) => x.agent_id === s.id));
      await decide({ change_type: 'add_assignment', agent_id: added?.id, shift_pattern_id: nightPattern?.id });

      const after = await linesOf(built);
      expect(after.find((l) => l.id === a?.id)).toMatchObject({ vehicle_id: otherVehicle?.id, agent_id: spare?.id, is_override: true });
      // UTC hour: Postgres echoes a different string.
      const utcHourOf = (iso: string | undefined): number => new Date(iso ?? '').getUTCHours();
      expect(utcHourOf(after.find((l) => l.id === b?.id)?.start_at)).toBe(3); // DAY-A: 06:00
      expect(after.find((l) => l.agent_id === added?.id)).toMatchObject({ is_override: true });
      expect(utcHourOf(after.find((l) => l.agent_id === added?.id)?.start_at)).toBe(11); // DAY-B: 14:00
      expect(after).toHaveLength(lines.length + 1);
      expect((await listRosterOverrides(admin(), built.id)).items.filter((o) => o.status === 'approved')).toHaveLength(4);
    });

    it('never lets anyone approve their own override or roster, and keeps Planners and other Supervisors out', async () => {
      const date = freshDate(1);
      const built = await buildRoster(planner(), { zone_id: riyadhCentral, roster_date: date });
      const line = (await linesOf(built))[0];
      // A Supervisor may draft too (edit on the module), but may not approve what they asked for.
      const own = await createOverride(supervisor(), built.id, { roster_assignment_id: line?.id, change_type: 'remove_assignment', reason_code: 'skills_needed' });
      await expect(approveOverride(supervisor(), own.id)).rejects.toThrow(ForbiddenError);
      await expect(rejectOverride(supervisor(), own.id)).rejects.toThrow(ForbiddenError);
      await expect(approveOverride(planner(), own.id)).rejects.toThrow(ForbiddenError);
      await expect(approveOverride(admin(), own.id)).rejects.toThrow(ForbiddenError);
      await expect(approveOverride(ctxFor('dispatch_supervisor', { zones: [jeddahNorth ?? ''] }), own.id)).rejects.toThrow(ForbiddenError); // outside their zones
      expect((await listRosterOverrides(admin(), built.id)).items.find((o) => o.id === own.id)?.status).toBe('pending');
      const denied = (await listAuditEvents(admin(), { outcome: 'denied', limit: 200 })).items.filter((e) => e.action.startsWith('override.'));
      expect(denied.length).toBeGreaterThanOrEqual(5);
      expect(denied.some((e) => e.summary_en.includes('own_request'))).toBe(true);

      await submitRoster(supervisor(), built.id);
      await expect(approveRoster(supervisor(), built.id)).rejects.toThrow(ForbiddenError); // own submission
      await expect(approveRoster(planner(), built.id)).rejects.toThrow(ForbiddenError);
      expect((await getRoster(admin(), built.id)).status).toBe('submitted');
    });

    it('rejects an override and leaves the roster alone', async () => {
      const roster = await rosterAt(riyadhCentral, draftDay);
      const line = (await linesOf(roster))[0];
      const before = (await getGapSurplus(admin(), { zone_id: riyadhCentral, date: draftDay })).cells;
      const override = await createOverride(planner(), roster.id, { roster_assignment_id: line?.id, change_type: 'remove_assignment', reason_code: 'agent_unavailable' });
      expect(await rejectOverride(supervisor(), override.id, { note: 'Need everyone that day.' })).toMatchObject({ status: 'rejected', decision_note: 'Need everyone that day.' });
      expect((await getGapSurplus(admin(), { zone_id: riyadhCentral, date: draftDay })).cells).toEqual(before);
      await expect(approveOverride(supervisor(), override.id)).rejects.toThrow(ConflictError);
    });

    it('submits, approves and rejects a roster, then publish is a labelled stub that never pretends', async () => {
      const date = freshDate(1);
      const built = await buildRoster(planner(), { zone_id: riyadhCentral, roster_date: date });
      await expect(approveRoster(supervisor(), built.id)).rejects.toThrow(ConflictError); // draft
      await expect(publishRoster(planner(), built.id)).rejects.toThrow(ConflictError); // not approved
      const submitted = await submitRoster(planner(), built.id);
      expect(submitted.status).toBe('submitted');
      expect((await listApprovals(planner(), { subject_type: 'roster', limit: 200 })).items.find((a) => a.subject_id === built.id && a.status === 'pending')).toMatchObject({ subject_type: 'roster', created_by: planner().userId });
      const approved = await approveRoster(supervisor(), built.id, { note: 'Good to go.' });
      expect(approved).toMatchObject({ status: 'approved', approved_by_user_id: supervisor().userId });
      expect(approved.approved_at).toEqual(expect.any(String));
      expectValid('Roster', approved);
      const result = await publishRoster(planner(), built.id);
      expect(result).toMatchObject({ roster_id: built.id, stub: true, published: false });
      expect(result.message).toMatch(/stub/i);
      expectValid('PublishResult', result);
      expect(await getRoster(admin(), built.id)).toMatchObject({ status: 'approved', published_at: null });
      expect(await auditActions()).toEqual(expect.arrayContaining(['roster.submitted', 'roster.approved', 'roster.publish_stub']));
      await expect(submitRoster(planner(), built.id)).rejects.toThrow(ConflictError);

      const rejectDate = freshDate(1);
      const other = await buildRoster(planner(), { zone_id: riyadhCentral, roster_date: rejectDate });
      await submitRoster(planner(), other.id);
      expect(await rejectRoster(supervisor(), other.id, { note: 'Two afternoon gaps.' })).toMatchObject({ status: 'rejected' });
      expect((await submitRoster(planner(), other.id)).status).toBe('submitted'); // a rejected roster can be submitted again
    });

    it('keeps every write inside the zone scope of the role', async () => {
      const jeddah = await rosterAt(jeddahNorth, monday);
      await expect(submitRoster(planner(), jeddah.id)).rejects.toThrow(ForbiddenError);
      await expect(createOverride(planner(), jeddah.id, { change_type: 'remove_assignment', reason_code: 'skills_needed', roster_assignment_id: (await linesOf(jeddah))[0]?.id })).rejects.toThrow(ForbiddenError);
      await expect(publishRoster(planner(), jeddah.id)).rejects.toThrow(ForbiddenError);
      for (const role of ['viewer_auditor', 'dispatcher'] as const) await expect(submitRoster(ctxFor(role), jeddah.id)).rejects.toThrow(ForbiddenError);
    });

    // Module-reload test dropped: real Postgres.
  });

  describe('crafted ids (review M4) and guard order (review m2)', () => {
    function codeOfError(error: unknown): string {
      return error instanceof DataError ? error.code : `not a DataError: ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}`;
    }

    async function expectJunkIdsInvalidLive(call: (id: never) => Promise<unknown>, ids: readonly unknown[] = JUNK_IDS): Promise<void> {
      const before = dataSnapshot();
      const audits = await auditCount();
      for (const id of ids) {
        let code = 'did not throw';
        try {
          await call(id as never);
        } catch (error) {
          code = codeOfError(error);
        }
        expect(code, `id ${JSON.stringify(id) ?? String(id)}`).toBe('invalid');
      }
      expect(dataSnapshot()).toBe(before);
      expect(await auditCount()).toBe(audits);
    }

    async function expectJunkIdsForbiddenLive(call: (id: never) => Promise<unknown>, ids: readonly unknown[] = JUNK_IDS): Promise<void> {
      const before = dataSnapshot();
      const audits = await auditCount();
      for (const id of ids) {
        let code = 'did not throw';
        try {
          await call(id as never);
        } catch (error) {
          code = codeOfError(error);
        }
        expect(code, `id ${JSON.stringify(id) ?? String(id)}`).toBe('forbidden');
      }
      expect(dataSnapshot()).toBe(before);
      expect(await auditCount()).toBe(audits + ids.length);
    }

    it('refuses a crafted roster or override id up front and changes nothing', async () => {
      await expectJunkIdsInvalidLive((id) => submitRoster(planner(), id));
      await expectJunkIdsInvalidLive((id) => approveRoster(supervisor(), id));
      await expectJunkIdsInvalidLive((id) => rejectRoster(supervisor(), id, { note: 'no' }));
      await expectJunkIdsInvalidLive((id) => publishRoster(planner(), id));
      await expectJunkIdsInvalidLive((id) => createOverride(planner(), id, { change_type: 'remove_assignment', reason_code: 'other', note: 'x' }));
      await expectJunkIdsInvalidLive((id) => approveOverride(supervisor(), id));
      await expectJunkIdsInvalidLive((id) => rejectOverride(supervisor(), id, { note: 'no' }));
      await expectJunkIdsInvalidLive((id) => getRoster(admin(), id));
      await expectJunkIdsInvalidLive((id) => listRosterAssignments(admin(), id));
      await expectJunkIdsInvalidLive((id) => listRosterOverrides(admin(), id));
      // `undefined` means "not given" for a query filter, so it is answered, not refused: only the other junk is checked here.
      const given =
        (call: (id: never) => Promise<unknown>) =>
        async (id: unknown): Promise<unknown> => {
          if (id === undefined) throw new InvalidInputError('filter not given');
          return call(id as never);
        };
      await expectJunkIdsInvalidLive(given((id) => getGapSurplus(admin(), { roster_id: id })));
      await expectJunkIdsInvalidLive(given((id) => getGapSurplus(admin(), { scenario_id: id })));
    });

    it('answers forbidden and audits the denial for a caller who may not write, whatever the id or the body', async () => {
      const viewer = () => ctxFor('viewer_auditor');
      await expectJunkIdsForbiddenLive((id) => submitRoster(viewer(), id));
      await expectJunkIdsForbiddenLive((id) => createOverride(viewer(), id, 'not an object'));
      await expectJunkIdsForbiddenLive((id) => approveOverride(viewer(), id, 12));
      await expect(buildRoster(viewer(), 'not an object')).rejects.toThrow(ForbiddenError);
      expect((await listAuditEvents(admin(), { action: 'roster.built', outcome: 'denied' })).items).toHaveLength(1);
      expect((await listAuditEvents(admin(), { action: 'override.created', outcome: 'denied' })).items).toHaveLength(15);
    });

    it('leaves no roster or override without an id after a valid build and a refused crafted id', async () => {
      await buildRoster(planner(), { zone_id: riyadhCentral, roster_date: freshDate(1) });
      await expect(submitRoster(planner(), 'toString')).rejects.toThrow(InvalidInputError);
      await expect(createOverride(planner(), '__proto__', { change_type: 'remove_assignment', reason_code: 'other', note: 'x' })).rejects.toThrow(InvalidInputError);
      for (const schema of ['Roster', 'RosterAssignment'] as const) {
        const rows = await readAll<{ id: string; tenant_id: string }>(admin().customerId, schema);
        expect(rows.every((r) => isId(r.id) && typeof r.tenant_id === 'string'), schema).toBe(true);
      }
      // Approval lives in Go now; the Administrator sees every one (readsAll). Override has
      // no unscoped read (only by roster), so there is nothing global left to check here.
      const approvals = await listApprovals(admin(), { limit: 200 });
      expect(approvals.items.every((a) => isId(a.id) && typeof a.tenant_id === 'string')).toBe(true);
    });
  });
});
