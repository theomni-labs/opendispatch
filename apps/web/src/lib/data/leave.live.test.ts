// SPDX-License-Identifier: AGPL-3.0-only
// Live: skips, never fakes, if OPENDISPATCH_API_URL unset.
// LeaveRequest is api-backed; Agent/Zone stay sync.
//
// rosters.ts (loadPlan) is api-backed: a live
// approve/decline changes getGapSurplus and
// listLeaveWindows, closing the gap once
// documented here (was: , this file).

import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { LeaveRequest, Agent } from '@/lib/types';
import { listAuditEvents } from './audit';
import { DataError, ConflictError, ForbiddenError, InvalidInputError, NotFoundError } from './errors';
import { fixtureRecords } from './internal/fixtures';
import { approveLeaveRequest, createLeaveRequest, declineLeaveRequest, getLeaveCoverageEffect, getLeaveRequest, listLeaveRequests, listLeaveWindows } from './leave';
import { buildRoster, getGapSurplus, listRosterAssignments } from './rosters';
import { ctxFor, dataSnapshot, auditCount, expectValid, fixtureZoneIds, JUNK_IDS, readAll, upsert, withTempDemoState } from './test-support';

const hasApi = process.env['OPENDISPATCH_API_URL'] !== undefined && process.env['OPENDISPATCH_API_URL'] !== '';

const [riyadhCentral, riyadhNorth, , , , jeddahNorth] = fixtureZoneIds();

// buildRoster (below) reads ForecastRun via the
// sync store: isolate it, or a leaked temp dir
// from another file can hand it a stale id.
withTempDemoState();

describe.skipIf(!hasApi)('leave (live, real api and Postgres)', () => {
  if (!hasApi) console.log('OPENDISPATCH_API_URL is not set: leave.live.test.ts is skipped, not faked.');

  const admin = () => ctxFor('administrator');
  const planner = () => ctxFor('planner'); // Reem: Riyadh Central, North, East

  function agent(id: string): Agent | undefined {
    return fixtureRecords<Agent>('Agent').find((s) => s.id === id);
  }

  /** The pending leave of a field agent of Riyadh North that overlaps the drafted rosters (fixture); read only, never decided by a test. */
  async function pendingFieldLeave(): Promise<LeaveRequest> {
    const found = (await listLeaveRequests(admin(), { zone_id: riyadhNorth, status: 'requested', limit: 200 })).items.find((r) => r.start_date === '2026-09-16');
    if (found === undefined) throw new Error('The fixture has no pending leave for Riyadh North on 16 Sep.');
    return found;
  }

  async function freeAgent(zoneId: string | undefined): Promise<Agent> {
    const taken = new Set((await readAll<LeaveRequest>(admin().customerId, 'LeaveRequest')).map((r) => r.agent_id));
    const found = fixtureRecords<Agent>('Agent').find((s) => s.home_zone_id === zoneId && s.kind === 'field' && s.is_active && !taken.has(s.id));
    if (found === undefined) throw new Error('No free agent.');
    return found;
  }

  /**
   * A row nobody "entered": written through the raw store (not createLeaveRequest), so created_by is null and no
   * live session is ever its self-decider. Go re-derives the caller's user id from the signed role, so a forged
   * RequestContext.userId no longer dodges the self-decide rule the way it used to.
   */
  async function leaveOf(agentId: string, date: string): Promise<LeaveRequest> {
    const at = new Date().toISOString();
    return upsert(planner().customerId, 'LeaveRequest', {
      id: randomUUID(),
      tenant_id: planner().customerId,
      created_at: at,
      updated_at: at,
      created_by: null,
      data_source: 'SYNTHETIC',
      agent_id: agentId,
      start_date: date,
      end_date: date,
      leave_type: 'annual',
      status: 'requested',
      requested_at: at,
      decided_at: null,
      decided_by_user_id: null,
      decision_note: null,
      note: null,
    } satisfies LeaveRequest);
  }

  async function disposableLeave(zoneId: string | undefined, date: string): Promise<LeaveRequest> {
    const who = await freeAgent(zoneId);
    return leaveOf(who.id, date);
  }

  async function auditActions(outcome: 'success' | 'denied' = 'success'): Promise<string[]> {
    return (await listAuditEvents(admin(), { outcome, limit: 200 })).items.map((e) => e.action);
  }

  describe('reading leave requests', () => {
    it('lists the requests with their status and validates against the contract', async () => {
      const list = await listLeaveRequests(admin(), { limit: 200 });
      expect(list.items.length).toBeGreaterThanOrEqual(20);
      expectValid('LeaveRequestList', list);
      expect((await listLeaveRequests(admin(), { status: 'approved' })).items.every((r) => r.status === 'approved')).toBe(true);
      expect((await listLeaveRequests(admin(), { date_from: '2026-09-16', date_to: '2026-09-17' })).items.every((r) => r.start_date <= '2026-09-17' && r.end_date >= '2026-09-16')).toBe(true);
      const request = await pendingFieldLeave();
      // Other live files may also give this agent leave.
      const byAgent = (await listLeaveRequests(admin(), { agent_id: request.agent_id })).items;
      expect(byAgent.length).toBeGreaterThanOrEqual(1);
      expect(byAgent.every((r) => r.agent_id === request.agent_id)).toBe(true);
      expect((await listLeaveRequests(admin(), { zone_id: riyadhNorth })).items.every((r) => agent(r.agent_id)?.home_zone_id === riyadhNorth)).toBe(true);
      expect(await getLeaveRequest(admin(), request.id)).toEqual(request);
      expectValid('LeaveRequest', request);
      await expect(getLeaveRequest(admin(), 'f0f0f0f0-0000-4000-8000-000000000000')).rejects.toThrow(NotFoundError);
      await expect(listLeaveRequests(admin(), { status: 'maybe' as 'approved' })).rejects.toThrow(InvalidInputError);
    });

    it('keeps a zone-limited role to the agents of its zones and roles without the module out', async () => {
      const own = (await listLeaveRequests(planner(), { limit: 200 })).items;
      expect(own.length).toBeGreaterThan(0);
      expect(own.every((r) => [riyadhCentral, riyadhNorth, fixtureZoneIds()[2]].includes(agent(r.agent_id)?.home_zone_id ?? ''))).toBe(true);
      await expect(getLeaveRequest(planner(), (await listLeaveRequests(admin(), { zone_id: jeddahNorth })).items[0]?.id ?? '')).rejects.toThrow(NotFoundError);
      await expect(listLeaveRequests(ctxFor('dispatcher'))).rejects.toThrow(ForbiddenError);
      await expect(listLeaveRequests(ctxFor('remote_team_lead'))).rejects.toThrow(ForbiddenError);
      await expect(listLeaveRequests(ctxFor('change_approver'))).rejects.toThrow(ForbiddenError);
      await expect(listLeaveRequests(ctxFor('viewer_auditor'))).resolves.not.toThrow();
      await expect(listLeaveRequests(ctxFor('dispatch_supervisor'))).resolves.not.toThrow();
    });
  });

  describe('flow 3: the effect of a request on coverage, then approve or decline', () => {
    it('shows the intervals a request takes an agent out of, against the forecast demand', async () => {
      const effect = await getLeaveCoverageEffect(planner(), (await pendingFieldLeave()).id);
      expect(effect.zone_id).toBe(riyadhNorth);
      expect(effect.illustrative).toBe(true);
      expect(effect.cells.length).toBeGreaterThan(20);
      for (const cell of effect.cells) {
        expect(cell.planned_after).toBe(cell.planned_before - 1);
        expect(cell.required).toBeGreaterThanOrEqual(0);
      }
      expect(effect.new_gap_intervals).toBe(effect.cells.filter((c) => c.planned_after < c.required && c.planned_before >= c.required).length);
      expect(effect.summary_en).toContain('planned staffing falls by one');
      expectValid('LeaveCoverageEffect', effect);
    });

    it('says so when leave does not change coverage (remote pool agent)', async () => {
      const remote = (await listLeaveRequests(admin(), { status: 'requested', limit: 200 })).items.find((r) => agent(r.agent_id)?.kind === 'remote');
      const effect = await getLeaveCoverageEffect(admin(), remote?.id ?? '');
      expect(effect).toMatchObject({ zone_id: null, cells: [], new_gap_intervals: 0 });
      expectValid('LeaveCoverageEffect', effect);
    });

    it('approving leave: the decision, the audit and the roster gap view', async () => {
      const request = await disposableLeave(riyadhNorth, '2026-09-18');
      const zoneId = riyadhNorth ?? '';
      const beforeGap = await getGapSurplus(admin(), { zone_id: zoneId, date: '2026-09-18' });
      const approved = await approveLeaveRequest(planner(), request.id, { note: 'Covered.' });
      expect(approved).toMatchObject({ status: 'approved', decided_by_user_id: planner().userId, decision_note: 'Covered.' });
      expect(approved.decided_at).toEqual(expect.any(String));
      expectValid('LeaveRequest', approved);
      const afterGap = await getGapSurplus(admin(), { zone_id: zoneId, date: '2026-09-18' });
      expect(afterGap.cells).not.toEqual(beforeGap.cells);
      const event = (await listAuditEvents(admin(), { action: 'leave.approved', limit: 200 })).items[0];
      expect(event).toMatchObject({ outcome: 'success', entity_type: 'leave_request', actor_user_id: planner().userId });
      await expect(approveLeaveRequest(planner(), request.id)).rejects.toThrow(ConflictError);
    });

    it('declining leave changes nothing on the roster', async () => {
      const request = await disposableLeave(riyadhNorth, '2026-09-19');
      expect(await declineLeaveRequest(planner(), request.id, { note: 'Coverage on those dates is already thin.' })).toMatchObject({ status: 'declined' });
      expect(await auditActions()).toContain('leave.declined');
      await expect(declineLeaveRequest(planner(), request.id)).rejects.toThrow(ConflictError);
    });

    it('is decided by a Planner in the agent’s zone, never by another role, another zone or the person who entered it', async () => {
      const request = await pendingFieldLeave();
      for (const role of ['dispatch_supervisor', 'viewer_auditor', 'administrator', 'dispatcher', 'remote_team_lead', 'change_approver'] as const) {
        await expect(approveLeaveRequest(ctxFor(role), request.id)).rejects.toThrow(ForbiddenError);
      }
      await expect(approveLeaveRequest(ctxFor('planner', { zones: [jeddahNorth ?? ''] }), request.id)).rejects.toThrow(ForbiddenError);
      expect(await auditActions('denied')).toContain('leave.approved');

      const who = await freeAgent(riyadhCentral);
      // Past day 60: no buildRoster call anywhere ever reaches this date.
      const own = await createLeaveRequest(planner(), { agent_id: who.id, start_date: '2026-11-20', end_date: '2026-11-22', leave_type: 'annual' });
      await expect(approveLeaveRequest(planner(), own.id)).rejects.toThrow(ForbiddenError); // entered by the same person
      await expect(declineLeaveRequest(planner(), own.id)).rejects.toThrow(ForbiddenError);
      // Go re-derives the user: forged userId ignored.
      const colleague = { ...planner(), userId: ctxFor('dispatch_supervisor').userId };
      await expect(approveLeaveRequest(colleague, own.id)).rejects.toThrow(ForbiddenError);
      expect((await listAuditEvents(admin(), { outcome: 'denied', limit: 200 })).items.some((e) => e.summary_en.includes('own_request'))).toBe(true);
    });
  });

  describe('creating requests', () => {
    it('creates a request for an agent of the zone and validates it', async () => {
      const who = await freeAgent(riyadhCentral);
      const created = await createLeaveRequest(planner(), { agent_id: who.id, start_date: '2026-10-20', end_date: '2026-10-22', leave_type: 'sick', note: 'Medical.' });
      expect(created).toMatchObject({ status: 'requested', agent_id: who.id, leave_type: 'sick', note: 'Medical.', decided_at: null, created_by: planner().userId, data_source: 'SYNTHETIC' });
      expectValid('LeaveRequest', created);
      expect((await getLeaveCoverageEffect(planner(), created.id)).cells.length).toBeGreaterThan(0);
      expect(await auditActions()).toContain('leave.requested');
    });

    it('refuses bad input, clashes, another zone, the remote pool and roles without edit', async () => {
      const who = await freeAgent(riyadhCentral);
      const base = { agent_id: who.id, start_date: '2026-10-25', end_date: '2026-10-27', leave_type: 'annual' };
      await expect(createLeaveRequest(planner(), { ...base, end_date: '2026-10-24' })).rejects.toThrow(InvalidInputError);
      await expect(createLeaveRequest(planner(), { ...base, end_date: '2027-03-01' })).rejects.toThrow(InvalidInputError);
      await expect(createLeaveRequest(planner(), { ...base, leave_type: 'holiday' })).rejects.toThrow(InvalidInputError);
      await expect(createLeaveRequest(planner(), { ...base, agent_id: 'f0f0f0f0-0000-4000-8000-000000000000' })).rejects.toThrow(NotFoundError);
      await expect(createLeaveRequest(planner(), { ...base, tenant_id: 'x' })).rejects.toThrow(InvalidInputError);
      await createLeaveRequest(planner(), base);
      await expect(createLeaveRequest(planner(), { ...base, start_date: '2026-10-26' })).rejects.toThrow(ConflictError);
      const elsewhere = await freeAgent(jeddahNorth);
      await expect(createLeaveRequest(planner(), { ...base, agent_id: elsewhere.id })).rejects.toThrow(ForbiddenError);
      const remote = fixtureRecords<Agent>('Agent').find((s) => s.kind === 'remote');
      await expect(createLeaveRequest(planner(), { ...base, agent_id: remote?.id })).rejects.toThrow(ForbiddenError);
      for (const role of ['viewer_auditor', 'dispatch_supervisor', 'administrator'] as const) await expect(createLeaveRequest(ctxFor(role), base)).rejects.toThrow(ForbiddenError);
      expect(await auditActions('denied')).toContain('leave.requested');
    });
  });

  describe('leave windows: spare capacity against live approved leave', () => {
    it('reflects newly-approved leave in the gap view', async () => {
      // A disposable date: currentCells needs a real
      // roster on duty for leave to remove anyone from.
      const date = '2026-11-09';
      const built = await buildRoster(planner(), { zone_id: riyadhCentral, roster_date: date });
      // A remote agent has no home zone, and leave for one is outside a planner's scope.
      const homeZoneOf = new Map(fixtureRecords<Agent>('Agent').map((s) => [s.id, s.home_zone_id]));
      const onDuty = (await listRosterAssignments(planner(), built.id, { limit: 200 })).items.find((a) => a.zone_id !== null && homeZoneOf.get(a.agent_id) != null);
      if (onDuty === undefined) throw new Error('expected an agent on the fresh roster');
      const before = await getGapSurplus(admin(), { zone_id: riyadhCentral, date });
      const created = await leaveOf(onDuty.agent_id, date);
      await approveLeaveRequest(planner(), created.id);
      const after = await getGapSurplus(admin(), { zone_id: riyadhCentral, date });
      expect(after.cells).not.toEqual(before.cells);
    });
  });

  describe('leave windows against forecast demand', () => {
    it('lists a week per zone with demand and spare capacity, and validates against the contract', async () => {
      const list = await listLeaveWindows(admin());
      // Zone is api-backed: other live files may add one.
      expect(list.items.length).toBeGreaterThanOrEqual(8 * 4);
      expectValid('LeaveWindowList', list);
      const fixtureZones = new Set(fixtureZoneIds());
      for (const w of list.items) {
        // Demand data covers only the fixture zones.
        if (fixtureZones.has(w.zone_id)) expect(w.demand_index).toBeGreaterThan(0);
        expect(Number.isInteger(w.spare_capacity)).toBe(true);
        expect(typeof w.recommended).toBe('boolean');
        expect(w.end_date >= w.start_date).toBe(true);
      }
      expect(list.items.some((w) => w.recommended)).toBe(true);
      expect(await listLeaveWindows(admin())).toEqual(list);
    });

    it('follows the zone scope, the range and the module access', async () => {
      expect(new Set((await listLeaveWindows(planner())).items.map((w) => w.zone_id))).toEqual(new Set([riyadhCentral, riyadhNorth, fixtureZoneIds()[2]]));
      expect((await listLeaveWindows(admin(), { zone_id: riyadhCentral, date_from: '2026-09-20', date_to: '2026-10-10' })).items).toHaveLength(3);
      await expect(listLeaveWindows(planner(), { zone_id: jeddahNorth })).rejects.toThrow(NotFoundError);
      await expect(listLeaveWindows(admin(), { date_from: '2026-09-20', date_to: '2026-09-01' })).rejects.toThrow(InvalidInputError);
      await expect(listLeaveWindows(admin(), { date_from: '2026-09-20', date_to: '2027-03-01' })).rejects.toThrow(InvalidInputError);
      await expect(listLeaveWindows(ctxFor('remote_team_lead'))).rejects.toThrow(ForbiddenError);
    });
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

    it('refuses a crafted leave request id up front and changes nothing', async () => {
      await expectJunkIdsInvalidLive((id) => getLeaveRequest(admin(), id));
      await expectJunkIdsInvalidLive((id) => getLeaveCoverageEffect(admin(), id));
      await expectJunkIdsInvalidLive((id) => approveLeaveRequest(planner(), id, {}));
      await expectJunkIdsInvalidLive((id) => declineLeaveRequest(planner(), id, { note: 'no' }));
    });

    it('answers forbidden and audits the denial for a caller who may not write, whatever the id or the body', async () => {
      const viewer = () => ctxFor('viewer_auditor');
      await expectJunkIdsForbiddenLive((id) => approveLeaveRequest(viewer(), id, 12));
      await expect(createLeaveRequest(viewer(), 'not an object')).rejects.toThrow(ForbiddenError);
    });
  });
});
