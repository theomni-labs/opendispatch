// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, vi } from 'vitest';
import type { Case, LeaveRequest, Agent } from '@/lib/types';
import { listAuditEvents } from './audit';
import { controlReplay } from './dispatch';
import { ConflictError, ForbiddenError, InvalidInputError, NotFoundError, UnauthenticatedError } from './errors';
import { fixtureRecords } from './internal/fixtures';
import { assignRemoteReviewer, getRemoteCapacity, getRemoteProductivity, getRemoteQueueClock, getRemoteRoster, getRemoteStaffing, listRemoteQueue } from './remote';
import { getSettingsSnapshot, updateRemoteHandling } from './settings';
import { ctxFor, expectJunkIdsForbiddenLive, expectJunkIdsInvalidLive, resetGoTestState, expectValid, expectValidItems, fixtureZoneIds, withTempDemoState } from './test-support';

withTempDemoState();

const lead = () => ctxFor('remote_team_lead');
const zones = () => fixtureZoneIds();
// Rows the rules read live in Postgres, so a test changes them through the raw api route.
async function upsert(table: 'cases' | 'agents' | 'leave-requests', record: object): Promise<void> {
  const res = await fetch(`${process.env['OPENDISPATCH_API_URL']}/_internal/${table}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-opendispatch-tenant-id': lead().customerId },
    body: JSON.stringify(record),
  });
  if (!res.ok) throw new Error(`Raw upsert of ${table} failed: ${String(res.status)} ${await res.text()}`);
}

const QUEUE_DAY = '2026-09-12'; // the latest case day, a Saturday

async function seek(time: string): Promise<void> {
  await controlReplay(ctxFor('dispatch_supervisor'), { action: 'seek', replay_at: `2026-09-13T${time}+03:00` });
}

function remoteAgents(): Agent[] {
  return fixtureRecords<Agent>('Agent').filter((s) => s.kind === 'remote' && s.is_active);
}

/** A remote agent on duty at 07:00 on the queue day (block 1, not off on Saturday). */
function morningReviewer(skip = 0): Agent {
  const found = remoteAgents().filter((s) => s.extra?.['home_shift'] === 'remote_block_1' && !(s.extra['days_off'] as string[]).includes('Saturday'));
  return found[skip] as Agent;
}

async function waitingCase(ctx = lead()) {
  const item = (await listRemoteQueue(ctx, { status: 'waiting', limit: 200 })).items[0];
  if (item === undefined) throw new Error('No waiting case.');
  return item;
}

describe('the queue', () => {
  it('shows the remote_inferred cases of the queue day as of the replay clock, validated against the contract', async () => {
    const list = await listRemoteQueue(lead(), { limit: 200 });
    expectValid('RemoteQueueItemList', list);
    expectValidItems('RemoteQueueItem', list.items);
    expect(list.items.length).toBeGreaterThan(20);
    const all = fixtureRecords<Case>('Case').filter((c) => c.handling === 'remote_inferred' && c.registered_at.startsWith(QUEUE_DAY));
    expect(new Set(list.items.map((i) => i.case_id)).size).toBe(list.items.length);
    for (const item of list.items) {
      expect(all.map((c) => c.id)).toContain(item.case_id);
      expect(item.registered_at <= `${QUEUE_DAY}T07:00:00+03:00`).toBe(true);
      expect(item.data_source).toBe('SYNTHETIC');
    }
    // 07:00: the overnight cases still wait for the daytime queue (opens 12:30)
    expect(list.items.filter((i) => i.status === 'waiting').length).toBeGreaterThan(list.items.length / 2);
    const order = list.items.map((i) => ['waiting', 'in_review', 'done'].indexOf(i.status));
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('the clock reads the queue day, with the replay clock time of day applied to that day (getRemoteQueueClock)', async () => {
    const clock = await getRemoteQueueClock(lead());
    expect(clock).toEqual({ date: QUEUE_DAY, as_of: `${QUEUE_DAY}T07:00:00+03:00`, live_as_of: expect.stringMatching(/T07:00:00\+03:00$/) });
    expect(await getRemoteQueueClock(ctxFor('administrator'))).toEqual(clock);
    await seek('13:00:00');
    expect((await getRemoteQueueClock(lead()))?.as_of).toBe(`${QUEUE_DAY}T13:00:00+03:00`);
  });

  it('follows the replay clock: the queue drains as the day goes on and is all done at the end', async () => {
    const early = (await listRemoteQueue(lead(), { limit: 200 })).page.total ?? 0;
    await seek('13:00:00');
    const midday = await listRemoteQueue(lead(), { limit: 200 });
    expect(midday.page.total).toBeGreaterThan(early);
    expect(midday.items.some((i) => i.status === 'in_review')).toBe(true);
    expect(midday.items.some((i) => i.status === 'done')).toBe(true);
    const inReview = midday.items.find((i) => i.status === 'in_review')!;
    expect(inReview.review_started_at).not.toBeNull();
    expect(inReview.review_finished_at).toBeNull();
    // End of the day: every case of the day has arrived; only late-evening cases still wait for the next daytime queue.
    await controlReplay(ctxFor('dispatch_supervisor'), { action: 'seek', replay_at: '2026-09-14T00:00:00+03:00' });
    const end = await listRemoteQueue(lead(), { limit: 200 });
    expect(end.page.total).toBe(fixtureRecords<Case>('Case').filter((c) => c.handling === 'remote_inferred' && c.registered_at.startsWith(QUEUE_DAY)).length);
    const doneAtEnd = end.items.filter((i) => i.status === 'done');
    expect(doneAtEnd.length).toBeGreaterThan(midday.items.filter((i) => i.status === 'done').length);
    expect(doneAtEnd.length).toBeGreaterThan(end.items.length / 2);
    for (const item of doneAtEnd) expect(item.review_finished_at).not.toBeNull();
    for (const item of end.items.filter((i) => i.status === 'waiting')) expect(item.registered_at >= `${QUEUE_DAY}T12:00:00+03:00`).toBe(true);
  });

  it('filters by status and zone, and rejects an unknown status', async () => {
    const waiting = await listRemoteQueue(lead(), { status: 'waiting', limit: 200 });
    expect(waiting.items.every((i) => i.status === 'waiting')).toBe(true);
    const zone = waiting.items[0]!.zone_id;
    expect((await listRemoteQueue(lead(), { zone_id: zone, limit: 200 })).items.every((i) => i.zone_id === zone)).toBe(true);
    await expect(listRemoteQueue(lead(), { status: 'lost' as never })).rejects.toThrow(InvalidInputError);
    const page = await listRemoteQueue(lead(), { limit: 5 });
    expect(page.items).toHaveLength(5);
    expect(page.page.has_more).toBe(true);
  });

  it('follows the access matrix: the lead edits, four roles view, dispatcher and change approver are out', async () => {
    for (const role of ['administrator', 'dispatch_supervisor', 'planner', 'viewer_auditor', 'remote_team_lead'] as const) await expect(listRemoteQueue(ctxFor(role))).resolves.toBeDefined();
    await expect(listRemoteQueue(ctxFor('dispatcher'))).rejects.toThrow(ForbiddenError);
    await expect(listRemoteQueue(ctxFor('change_approver'))).rejects.toThrow(ForbiddenError);
    // Go has no such session
    await expect(listRemoteQueue(ctxFor('change_approver', { installMode: 'shared' }))).rejects.toThrow(UnauthenticatedError);
  });

  it('shows a role with assigned zones only the cases of its zones; the remote pool sees every zone', async () => {
    const everything = (await listRemoteQueue(lead(), { limit: 200 })).page.total ?? 0;
    const own = ctxFor('planner', { zones: [zones()[0] as string] });
    const scoped = await listRemoteQueue(own, { limit: 200 });
    expect(scoped.items.length).toBeGreaterThan(0);
    expect(scoped.items.every((i) => i.zone_id === zones()[0])).toBe(true);
    expect(scoped.page.total ?? 0).toBeLessThan(everything);
    expect((await listRemoteQueue(ctxFor('planner', { zones: [] }))).items).toHaveLength(0);
    expect((await listRemoteQueue(ctxFor('viewer_auditor'), { limit: 200 })).page.total).toBe(everything);
  });
});

describe('assigning a reviewer', () => {
  it('assigns a remote agent who is on duty, starts the review at the replay clock, audits it and persists', async () => {
    const item = await waitingCase();
    const reviewer = morningReviewer();
    const assigned = await assignRemoteReviewer(lead(), item.case_id, { agent_id: reviewer.id });
    expectValid('RemoteQueueItem', assigned);
    expect(assigned).toMatchObject({ case_id: item.case_id, status: 'in_review', assigned_reviewer_id: reviewer.id, review_finished_at: null });
    expect(assigned.review_started_at?.startsWith(`${QUEUE_DAY}T07:00:00`)).toBe(true);
    const listed = (await listRemoteQueue(lead(), { limit: 200 })).items.find((i) => i.case_id === item.case_id)!;
    expect(listed).toEqual(assigned);
    const event = (await listAuditEvents(ctxFor('administrator'), { action: 'remote_queue.reviewer_assigned' })).items[0]!;
    expect(event).toMatchObject({ entity_id: item.case_id, outcome: 'success', actor_user_id: lead().userId });
    expect(event.detail).toMatchObject({ agent_id: reviewer.id });
    vi.resetModules();
    const fresh = await import('./remote');
    expect((await fresh.listRemoteQueue(lead(), { limit: 200 })).items.find((i) => i.case_id === item.case_id)?.assigned_reviewer_id).toBe(reviewer.id);
  });

  it('finishes the review after its handling time as the clock moves on', async () => {
    const item = await waitingCase();
    await assignRemoteReviewer(lead(), item.case_id, { agent_id: morningReviewer().id });
    await seek('07:10:00');
    expect((await listRemoteQueue(lead(), { limit: 200 })).items.find((i) => i.case_id === item.case_id)?.status).toBe('in_review');
    await seek('08:30:00');
    const done = (await listRemoteQueue(lead(), { limit: 200 })).items.find((i) => i.case_id === item.case_id)!;
    expect(done.status).toBe('done');
    expect(done.review_finished_at).not.toBeNull();
    expect(done.assigned_reviewer_id).toBe(morningReviewer().id);
    await seek('06:00:00');
    expect((await listRemoteQueue(lead(), { limit: 200 })).items.find((i) => i.case_id === item.case_id)?.assigned_reviewer_id ?? null).toBeNull();
  });

  it('refuses an agent who is not a remote agent, is off shift, is off duty that day, or is on leave', async () => {
    const item = await waitingCase();
    const field = fixtureRecords<Agent>('Agent').find((s) => s.kind === 'field')!;
    await expect(assignRemoteReviewer(lead(), item.case_id, { agent_id: field.id })).rejects.toThrow(InvalidInputError);
    const evening = remoteAgents().find((s) => s.extra?.['home_shift'] === 'remote_block_2' && !(s.extra['days_off'] as string[]).includes('Saturday'))!;
    await expect(assignRemoteReviewer(lead(), item.case_id, { agent_id: evening.id })).rejects.toThrow(/not on shift/);
    const dayOff = remoteAgents().find((s) => s.extra?.['home_shift'] === 'remote_block_1' && (s.extra['days_off'] as string[]).includes('Saturday'))!;
    await expect(assignRemoteReviewer(lead(), item.case_id, { agent_id: dayOff.id })).rejects.toThrow(/off duty/);
    const onLeave = morningReviewer(1);
    const leave: LeaveRequest = {
      id: '99999999-9999-4999-8999-999999999999',
      tenant_id: lead().customerId,
      created_at: '2026-09-01T09:00:00+03:00',
      updated_at: '2026-09-01T09:00:00+03:00',
      created_by: null,
      data_source: 'SYNTHETIC',
      agent_id: onLeave.id,
      start_date: QUEUE_DAY,
      end_date: QUEUE_DAY,
      leave_type: 'annual',
      status: 'approved',
      requested_at: '2026-09-01T09:00:00+03:00',
    };
    await upsert('leave-requests', leave);
    await expect(assignRemoteReviewer(lead(), item.case_id, { agent_id: onLeave.id })).rejects.toThrow(/on approved leave/);
    await expect(assignRemoteReviewer(lead(), item.case_id, { agent_id: onLeave.id })).rejects.toThrow(ConflictError);
    expect((await listRemoteQueue(lead(), { limit: 200 })).items.find((i) => i.case_id === item.case_id)?.status).toBe('waiting');
    expect((await listAuditEvents(ctxFor('administrator'), { action: 'remote_queue.reviewer_assigned' })).items).toHaveLength(0);
    await upsert('leave-requests', { ...leave, status: 'declined' });
  });

  it('refuses to assign their own case: not the agent who attended it, not the person assigning', async () => {
    const item = await waitingCase();
    const reviewer = morningReviewer();
    const original = fixtureRecords<Case>('Case').find((c) => c.id === item.case_id)!;
    await upsert('cases', { ...original, agent_id: reviewer.id });
    await expect(assignRemoteReviewer(lead(), item.case_id, { agent_id: reviewer.id })).rejects.toThrow(/own case/);
    await upsert('cases', original);
    await upsert('agents', { ...reviewer, extra: { ...reviewer.extra, user_id: lead().userId } });
    await expect(assignRemoteReviewer(lead(), item.case_id, { agent_id: reviewer.id })).rejects.toThrow(/own case/);
    await upsert('agents', reviewer);
    expect(morningReviewer(2).id).not.toBe(reviewer.id);
    expect((await assignRemoteReviewer(lead(), item.case_id, { agent_id: morningReviewer(2).id })).status).toBe('in_review');
  });

  it('assigns only a waiting case, once', async () => {
    const item = await waitingCase();
    await assignRemoteReviewer(lead(), item.case_id, { agent_id: morningReviewer().id });
    await expect(assignRemoteReviewer(lead(), item.case_id, { agent_id: morningReviewer(1).id })).rejects.toThrow(/ALREADY_ASSIGNED/);
    await seek('23:00:00');
    const done = (await listRemoteQueue(lead(), { status: 'done', limit: 200 })).items[0]!;
    await expect(assignRemoteReviewer(lead(), done.case_id, { agent_id: morningReviewer().id })).rejects.toThrow(ConflictError);
    await expect(assignRemoteReviewer(lead(), '00000000-0000-4000-8000-000000000000', { agent_id: morningReviewer().id })).rejects.toThrow(NotFoundError);
  });

  it('validates the input and refuses every role but the Remote Team Lead, auditing the denial', async () => {
    const item = await waitingCase();
    const reviewer = morningReviewer();
    await expect(assignRemoteReviewer(lead(), item.case_id, { agent_id: 'nope' })).rejects.toThrow(InvalidInputError);
    await expect(assignRemoteReviewer(lead(), item.case_id, {})).rejects.toThrow(InvalidInputError);
    await expect(assignRemoteReviewer(lead(), item.case_id, { agent_id: reviewer.id, role: 'planner' })).rejects.toThrow(InvalidInputError);
    await expect(assignRemoteReviewer(lead(), item.case_id, { agent_id: '00000000-0000-4000-8000-000000000000' })).rejects.toThrow(NotFoundError);
    for (const role of ['administrator', 'dispatch_supervisor', 'planner', 'viewer_auditor', 'dispatcher', 'change_approver'] as const) {
      await expect(assignRemoteReviewer(ctxFor(role), item.case_id, { agent_id: reviewer.id })).rejects.toThrow(ForbiddenError);
    }
    expect((await listAuditEvents(ctxFor('administrator'), { action: 'remote_queue.reviewer_assigned', outcome: 'denied' })).items).toHaveLength(6);
    expect((await listRemoteQueue(lead(), { limit: 200 })).items.find((i) => i.case_id === item.case_id)?.status).toBe('waiting');
  });

  it('resets to the fixtures with the demo data', async () => {
    const item = await waitingCase();
    await assignRemoteReviewer(lead(), item.case_id, { agent_id: morningReviewer().id });
    await resetGoTestState(); // Go keeps the reviews; the demo reset does not reach it yet
    expect((await listRemoteQueue(lead(), { limit: 200 })).items.find((i) => i.case_id === item.case_id)).toMatchObject({ status: 'waiting', assigned_reviewer_id: null });
  });
});

describe('remote staffing', () => {
  const day = '2026-09-14'; // a date with a remote roster and a forecast

  it('gives 96 intervals with expected cases, required and planned reviewers and the gap, validated against the contract', async () => {
    const admin = ctxFor('administrator');
    await updateRemoteHandling(admin, { handling_source: 'fixed', handling_fixed_minutes: 31.5 });
    try {
      const staffing = await getRemoteStaffing(lead(), { date: day });
      expectValid('RemoteStaffing', staffing);
      expect(staffing).toMatchObject({ date: day, illustrative: true, data_source: 'SYNTHETIC', handling: { setting: 'fixed', source: 'fixed', minutes: 31.5 } });
      expect(staffing.intervals).toHaveLength(96);
      staffing.intervals.forEach((interval, index) => {
        expect(interval.interval_index).toBe(index);
        expect(interval.interval_start).toBe(`${day}T${String(Math.floor(index / 4)).padStart(2, '0')}:${String((index % 4) * 15).padStart(2, '0')}:00+03:00`);
        expect(interval.required_reviewers).toBeCloseTo((interval.expected_cases * 31.5) / 15, 1);
        expect(interval.delta).toBeCloseTo(interval.planned_reviewers - interval.required_reviewers, 1);
        expect(interval.on_shift).toBeGreaterThanOrEqual(0);
      });
      expect(staffing.intervals.reduce((sum, i) => sum + i.expected_cases, 0)).toBeGreaterThan(100);
    } finally {
      await updateRemoteHandling(admin, { handling_source: 'measured', handling_fixed_minutes: 31.5 });
    }
  });

  it('uses the measured time to complete by default, and returns the minutes it used', async () => {
    const staffing = await getRemoteStaffing(lead(), { date: day });
    expect(staffing.handling).toMatchObject({ setting: 'measured', fixed_minutes: 31.5, window_days: 28 });
    expect(staffing.handling!.minutes).toBeGreaterThan(0);
    for (const zone of staffing.handling!.zones ?? []) expect(zone.minutes).toBeGreaterThan(0);
  });

  it('plans reviewers only inside the two remote blocks (07:00 to 23:00) and not during breaks', async () => {
    const { intervals } = await getRemoteStaffing(lead(), { date: day });
    expect(intervals.slice(0, 28).every((i) => i.planned_reviewers === 0)).toBe(true); // before 07:00
    expect(intervals[95]!.planned_reviewers).toBe(0); // 23:45
    const working = intervals.slice(28, 92).map((i) => i.planned_reviewers);
    expect(Math.max(...working)).toBeGreaterThan(5);
    expect(Math.min(...working)).toBeLessThan(Math.max(...working)); // breaks and block changes move the count
    expect(intervals.some((i) => i.delta < 0)).toBe(true);
  });

  it('takes an approved leave off the plan, and plans the home shifts on a date with no remote roster', async () => {
    const before = await getRemoteStaffing(lead(), { date: day });
    const roster = fixtureRecords<{ roster_date: string; agent_id: string }>('RosterAssignment').filter((a) => a.roster_date === day && remoteAgents().some((s) => s.id === a.agent_id));
    const away = roster[0]!.agent_id;
    const leave: LeaveRequest = {
      id: '88888888-8888-4888-8888-888888888888',
      tenant_id: lead().customerId,
      created_at: '2026-09-01T09:00:00+03:00',
      updated_at: '2026-09-01T09:00:00+03:00',
      created_by: null,
      data_source: 'SYNTHETIC',
      agent_id: away,
      start_date: day,
      end_date: day,
      leave_type: 'sick',
      status: 'approved',
      requested_at: '2026-09-01T09:00:00+03:00',
    };
    await upsert('leave-requests', leave);
    const after = await getRemoteStaffing(lead(), { date: day });
    await upsert('leave-requests', { ...leave, status: 'declined' });
    expect(after.intervals.reduce((s, i) => s + i.planned_reviewers, 0)).toBeLessThan(before.intervals.reduce((s, i) => s + i.planned_reviewers, 0));
    const none = await getRemoteStaffing(lead(), { date: '2026-09-25' });
    expectValid('RemoteStaffing', none);
    expect(none.intervals.slice(0, 28).every((i) => i.planned_reviewers === 0)).toBe(true); // before 07:00
    expect(none.intervals.some((i) => i.planned_reviewers > 0)).toBe(true);
    expect(none.intervals.reduce((s, i) => s + i.expected_cases, 0)).toBeGreaterThan(0);
  });

  it('counts only the zones a role may read, and follows the access matrix', async () => {
    const all = await getRemoteStaffing(lead(), { date: day });
    const own = await getRemoteStaffing(ctxFor('planner', { zones: [zones()[0] as string] }), { date: day });
    expectValid('RemoteStaffing', own);
    expect(own.intervals.reduce((s, i) => s + i.expected_cases, 0)).toBeLessThan(all.intervals.reduce((s, i) => s + i.expected_cases, 0));
    expect(own.intervals.reduce((s, i) => s + i.planned_reviewers, 0)).toBeLessThan(all.intervals.reduce((s, i) => s + i.planned_reviewers, 0));
    expect((await getRemoteStaffing(ctxFor('viewer_auditor'), { date: day })).intervals).toEqual(all.intervals);
    await expect(getRemoteStaffing(ctxFor('dispatcher'), { date: day })).rejects.toThrow(ForbiddenError);
    await expect(getRemoteStaffing(ctxFor('change_approver'), { date: day })).rejects.toThrow(ForbiddenError);
    await expect(getRemoteStaffing(lead(), { date: 'tomorrow' })).rejects.toThrow(InvalidInputError);
    await expect(getRemoteStaffing(lead(), {} as never)).rejects.toThrow(InvalidInputError);
  });
});

describe('remote roster, capacity and productivity', () => {
  const day = '2026-09-14';

  it('gives the Remote Team Lead the roster lines, the day and its shifts, validated against the contract', async () => {
    const roster = await getRemoteRoster(lead(), { date: day });
    expectValid('RemoteRoster', roster);
    expect(roster).toMatchObject({ date: day, illustrative: true, data_source: 'SYNTHETIC', reviewer_share: 0.34 });
    expect(roster.day.source).toBe('roster');
    expect(roster.lines.length).toBeGreaterThan(5);
    expect(roster.lines.every((l) => l.source === 'roster')).toBe(true);
    expect(roster.fte).toBe(remoteAgents().length);
    expect(roster.day.scheduled + roster.day.on_leave + roster.day.off).toBeLessThanOrEqual(roster.fte + roster.day.on_leave);
    expect(roster.intervals).toHaveLength(96);
    const shiftDemand = roster.day.shifts.reduce((s, r) => s + r.demand_hours, 0);
    expect(shiftDemand).toBeCloseTo(roster.day.demand_hours, 0);
    expect(roster.day.capacity_hours).toBeCloseTo(roster.day.available_hours * roster.reviewer_share, 1);
  });

  it('projects the home shifts on a date with no remote roster', async () => {
    const roster = await getRemoteRoster(lead(), { date: '2026-09-25' });
    expectValid('RemoteRoster', roster);
    expect(roster.day.source).toBe('home_shifts');
    expect(roster.lines.every((l) => l.source === 'home_shift' && l.break_start_at === null)).toBe(true);
    expect(roster.day.scheduled).toBeGreaterThan(0);
    expect(roster.day.off).toBeGreaterThan(0);
  });

  it('sums capacity per date and per 7-day run', async () => {
    const capacity = await getRemoteCapacity(lead(), { date_from: day, date_to: '2026-09-22' });
    expectValid('RemoteCapacity', capacity);
    expect(capacity.days.map((d) => d.date)).toHaveLength(9);
    expect(capacity.weeks.map((w) => w.days)).toEqual([7, 2]);
    const first = capacity.days.slice(0, 7);
    expect(capacity.weeks[0]!.demand_hours).toBeCloseTo(first.reduce((s, d) => s + d.demand_hours, 0), 1);
    expect(capacity.days[0]).toEqual((await getRemoteRoster(lead(), { date: day })).day);
    await expect(getRemoteCapacity(lead(), { date_from: day, date_to: '2026-10-15' })).rejects.toThrow(InvalidInputError);
  });

  it('measures the remote queue over a period, with post-close admin time null', async () => {
    const prod = await getRemoteProductivity(lead(), { date_from: '2026-09-06', date_to: QUEUE_DAY });
    expectValid('RemoteProductivity', prod);
    expect(prod.overall.cases).toBeGreaterThan(100);
    expect(prod.overall.median_post_close_admin_seconds).toBeNull();
    expect(prod.hours).toHaveLength(24);
    expect(prod.hours.reduce((s, h) => s + h.received, 0)).toBe(prod.overall.cases);
    expect(prod.available_hours).toBeGreaterThan(0);
    expect(prod.utilization).not.toBeNull();
    expect(prod.unattributed_cases).toBe(prod.overall.cases - prod.reviewers.reduce((s, r) => s + r.durations.cases, 0));
  });

  it('attributes a review assigned in the queue to its reviewer', async () => {
    await seek('07:00:00');
    const item = await waitingCase();
    const reviewer = morningReviewer();
    await assignRemoteReviewer(lead(), item.case_id, { agent_id: reviewer.id });
    const prod = await getRemoteProductivity(lead(), { date_from: QUEUE_DAY, date_to: QUEUE_DAY });
    expect(prod.reviewers.map((r) => r.agent_id)).toContain(reviewer.id);
    expect(prod.reviewers.find((r) => r.agent_id === reviewer.id)!.available_hours).toBeGreaterThan(0);
  });

  it('follows the access matrix', async () => {
    for (const role of ['dispatcher', 'change_approver'] as const) {
      await expect(getRemoteRoster(ctxFor(role), { date: day })).rejects.toThrow(ForbiddenError);
      await expect(getRemoteCapacity(ctxFor(role), { date_from: day, date_to: day })).rejects.toThrow(ForbiddenError);
      await expect(getRemoteProductivity(ctxFor(role), { date_from: day, date_to: day })).rejects.toThrow(ForbiddenError);
    }
    await expect(getRemoteRoster(lead(), { date: 'tomorrow' })).rejects.toThrow(InvalidInputError);
  });
});

describe('the remote handling setting', () => {
  it('is set by the administrator only, audited, and shown in the snapshot', async () => {
    const admin = ctxFor('administrator');
    const snap = await updateRemoteHandling(admin, { handling_source: 'fixed', handling_fixed_minutes: 40 });
    expectValid('SettingsSnapshot', snap);
    expect(snap).toMatchObject({ remote_handling_source: 'fixed', remote_handling_fixed_minutes: 40 });
    expect((await getRemoteStaffing(lead(), { date: '2026-09-14' })).handling).toMatchObject({ source: 'fixed', minutes: 40 });
    await updateRemoteHandling(admin, { handling_source: 'measured', handling_fixed_minutes: 31.5 });
    expect(await getSettingsSnapshot(admin)).toMatchObject({ remote_handling_source: 'measured', remote_handling_fixed_minutes: 31.5 });
    expect((await listAuditEvents(admin, { action: 'settings.remote_handling_changed', outcome: 'success' })).items).toHaveLength(2);
    await expect(updateRemoteHandling(lead(), { handling_source: 'fixed' })).rejects.toThrow(ForbiddenError);
    await expect(updateRemoteHandling(admin, { handling_fixed_minutes: 2 })).rejects.toThrow(InvalidInputError);
    await expect(updateRemoteHandling(admin, {})).rejects.toThrow(InvalidInputError);
  });
});

describe('crafted ids (review M4) and guard order (review m2)', () => {
  it('refuses a crafted case id up front and changes nothing', async () => {
    await expectJunkIdsInvalidLive((id) => assignRemoteReviewer(lead(), id, { agent_id: morningReviewer().id }));
  });

  it('answers forbidden and audits the denial for a caller who may not write, whatever the id or the body', async () => {
    await expectJunkIdsForbiddenLive((id) => assignRemoteReviewer(ctxFor('viewer_auditor'), id, 12));
    expect((await listAuditEvents(ctxFor('administrator'), { action: 'remote_queue.reviewer_assigned', outcome: 'denied' })).items).toHaveLength(15);
  });
});
