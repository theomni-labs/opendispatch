// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, vi } from 'vitest';
import type { Assignment, AssignmentComparison, Case, LiveCase } from '@/lib/types';
import { listAuditEvents } from './audit';
import { resetDemoData } from './demo';
import {
  acceptRecommendation,
  controlReplay,
  getAssignment,
  getCaseRecommendation,
  getFallbackState,
  getLiveBoard,
  getReplayState,
  getShadowComparisonSummary,
  listAssignmentEvents,
  listAssignments,
  listLiveCases,
  listShadowComparisons,
  listAgentPositions,
  listAgentStatuses,
  listUnmetDemand,
  listZoneStages,
  overrideAssignment,
  sendFallbackSignal,
  setMaintenanceMode,
  simulateFeedOutage,
} from './dispatch';
import { ConflictError, ForbiddenError, InvalidInputError, NotFoundError } from './errors';
import { fixtureRecords } from './internal/fixtures';
import { listNotificationLog } from './notifications';
import { setZoneStage, updateLiveAssignmentSettings } from './settings';
import { auditCount, ctxFor, resetGoTestState, dataSnapshot, expectValid, expectValidItems, fixtureZoneIds, withTempDemoState } from './test-support';

withTempDemoState();

const zones = () => fixtureZoneIds();
const RIYADH_CENTRAL = () => zones()[0] as string; // recommend in the fixtures
const RIYADH_EAST = () => zones()[2] as string; // shadow in the fixtures
const dispatcher = () => ctxFor('dispatcher', { zones: [RIYADH_CENTRAL(), zones()[1] as string] });
const admin = () => ctxFor('administrator');
// Four RD-C cases the customer has not yet assigned.
const RECO_AT = '2026-09-13T12:30:00+03:00';

async function seek(ctx: ReturnType<typeof dispatcher>, at: string): Promise<void> {
  await controlReplay(ctx, { action: 'seek', replay_at: at });
}

async function firstCase(ctx: ReturnType<typeof dispatcher>, zone: string, state: LiveCase['state']): Promise<LiveCase> {
  const found = (await listLiveCases(ctx, { zone_id: zone, state, limit: 200 })).items[0];
  if (found === undefined) throw new Error(`No ${state} case in the zone at this moment.`);
  return found;
}

describe('board and replay', () => {
  it('starts stopped at the script start with cases already registered, and validates against the contract', async () => {
    const ctx = admin();
    const replay = await getReplayState(ctx);
    expectValid('ReplayState', replay);
    expect(replay).toMatchObject({ status: 'stopped', replay_date: '2026-09-13', total_cases: 759 });
    expect(replay.replay_at.startsWith('2026-09-13T07:00:00')).toBe(true);
    expect(replay.delivered_cases).toBeGreaterThan(0);
    const board = await getLiveBoard(ctx, { limit: 20 });
    expectValid('LiveBoard', board);
    expect(board.cases).toHaveLength(20);
    expect(board.stages).toHaveLength(8);
    expect(board.fallback).toMatchObject({ state: 'armed', reason: 'none', opendispatch_healthy: true });
    expectValidItems('LiveCase', board.cases);
    expect(board.page?.total).toBe(replay.delivered_cases);
  });

  it('moves with the clock: seeking later delivers more cases, seeking is bounded to the replay day', async () => {
    const ctx = dispatcher();
    const before = (await getReplayState(ctx)).delivered_cases;
    const after = await controlReplay(ctx, { action: 'seek', replay_at: '2026-09-13T12:00:00+03:00' });
    expect(after.status).toBe('paused');
    expect(after.delivered_cases).toBeGreaterThan(before);
    await expect(controlReplay(ctx, { action: 'seek', replay_at: '2026-09-15T12:00:00+03:00' })).rejects.toThrow(InvalidInputError);
    expect((await controlReplay(ctx, { action: 'set_speed', speed: 300 })).speed).toBe(300);
    await expect(controlReplay(ctx, { action: 'set_speed', speed: 9000 })).rejects.toThrow(InvalidInputError);
    expect(await controlReplay(ctx, { action: 'stop' })).toMatchObject({ status: 'stopped' });
  });

  it('plays on the wall clock at the chosen speed', async () => {
    const ctx = dispatcher();
    await controlReplay(ctx, { action: 'set_speed', speed: 600 });
    const start = (await getReplayState(ctx)).replay_at;
    await controlReplay(ctx, { action: 'play' });
    await new Promise((resolve) => setTimeout(resolve, 500));
    const playing = await getReplayState(ctx);
    expect(playing.status).toBe('playing');
    expect(playing.replay_at > start).toBe(true);
    await controlReplay(ctx, { action: 'pause' });
    const paused = (await getReplayState(ctx)).replay_at;
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect((await getReplayState(ctx)).replay_at).toBe(paused);
  });

  it('shows a dispatcher only the cases of their own zones and no stage of other zones', async () => {
    const ctx = dispatcher();
    await seek(ctx, '2026-09-13T12:00:00+03:00');
    const board = await getLiveBoard(ctx, { limit: 200 });
    expect(new Set(board.cases.map((c) => c.zone_id))).toEqual(new Set([RIYADH_CENTRAL(), zones()[1]]));
    expect(board.stages.map((s) => s.zone_id).sort()).toEqual([RIYADH_CENTRAL(), zones()[1] as string].sort());
    expect((await getLiveBoard(admin(), { limit: 1 })).page?.total).toBeGreaterThan(board.page?.total ?? 0);
  });

  it('keeps the board out of the Remote Team Lead and Change Approver menus, and controls to the editors', async () => {
    await expect(getLiveBoard(ctxFor('remote_team_lead'))).rejects.toThrow(ForbiddenError);
    await expect(getLiveBoard(ctxFor('change_approver'))).rejects.toThrow(ForbiddenError);
    await expect(getLiveBoard(ctxFor('viewer_auditor'))).resolves.toBeDefined();
    await expect(controlReplay(ctxFor('planner'), { action: 'pause' })).rejects.toThrow(ForbiddenError);
    await expect(controlReplay(ctxFor('viewer_auditor'), { action: 'pause' })).rejects.toThrow(ForbiddenError);
    expect((await listAuditEvents(admin(), { action: 'replay.controlled', outcome: 'denied' })).items).toHaveLength(2);
  });
});

describe('recommend stage: accept and override', () => {
  it('accepts the recommendation, records source OpenDispatch, and refuses a second assignment', async () => {
    const ctx = dispatcher();
    await seek(ctx, RECO_AT);
    const item = await firstCase(ctx, RIYADH_CENTRAL(), 'recommended');
    expect(item.stage).toBe('recommend');
    expect(item.recommendation?.agent_id).toBeTruthy();
    const assignment = await acceptRecommendation(ctx, item.case_id, { agent_id: item.recommendation!.agent_id });
    expectValid('Assignment', assignment);
    expect(assignment).toMatchObject({ source: 'OPENDISPATCH', state: 'assigned', stage: 'recommend', case_id: item.case_id, decided_by_user_id: ctx.userId });
    const after = (await listLiveCases(ctx, { zone_id: RIYADH_CENTRAL(), limit: 200 })).items.find((c) => c.case_id === item.case_id)!;
    expect(after).toMatchObject({ state: 'assigned', assignment_source: 'OPENDISPATCH', assignment_id: assignment.id });
    await expect(acceptRecommendation(ctx, item.case_id, { agent_id: item.recommendation!.agent_id })).rejects.toThrow(ConflictError);
    expect((await listAssignmentEvents(ctx, assignment.id)).items.map((e) => e.event_type)).toEqual(['recommended', 'accepted', 'sent']);
    expectValidItems('AssignmentEvent', (await listAssignmentEvents(ctx, assignment.id)).items);
    expect(await getAssignment(ctx, assignment.id)).toEqual(assignment);
    const accepted = (await listAuditEvents(admin(), { action: 'assignment.accepted' })).items;
    expect(accepted.map((e) => e.outcome).sort()).toEqual(['denied', 'success']);
  });

  it('treats a case Customer assigned as final: Customer source and agent, and an accept refused as CUSTOMER_ASSIGNED', async () => {
    const ctx = dispatcher();
    await seek(ctx, RECO_AT);
    const taken = (await listLiveCases(ctx, { zone_id: RIYADH_CENTRAL(), state: 'fallback_assigned', limit: 200 })).items.find((c) => c.customer_agent_id !== null);
    expect(taken).toBeDefined();
    expect(taken).toMatchObject({ stage: 'recommend', assignment_source: 'CUSTOMER_FALLBACK', assigned_agent_id: taken!.customer_agent_id, assignment_id: null });
    const agent = taken!.recommendation?.agent_id ?? (taken!.customer_agent_id as string);
    await expect(acceptRecommendation(ctx, taken!.case_id, { agent_id: agent })).rejects.toThrow(/CUSTOMER_ASSIGNED/);
    expect((await listAssignments(ctx, { case_id: taken!.case_id })).items).toHaveLength(0);
    const denied = (await listAuditEvents(admin(), { action: 'assignment.accepted', outcome: 'denied' })).items;
    expect(denied[0]?.detail).toMatchObject({ reason: 'CUSTOMER_ASSIGNED', case_id: taken!.case_id });
  });

  it('refuses an accept for an agent that is not the current recommendation', async () => {
    const ctx = dispatcher();
    await seek(ctx, RECO_AT);
    const item = await firstCase(ctx, RIYADH_CENTRAL(), 'recommended');
    await expect(acceptRecommendation(ctx, item.case_id, { agent_id: '00000000-0000-4000-8000-000000000000' })).rejects.toThrow(ConflictError);
    await expect(acceptRecommendation(ctx, item.case_id, { agent_id: 'nope' })).rejects.toThrow(InvalidInputError);
  });

  it('overrides with a reason code, records source MANUAL, and keeps the recommendation as its own record', async () => {
    const ctx = dispatcher();
    await seek(ctx, RECO_AT);
    const item = await firstCase(ctx, RIYADH_CENTRAL(), 'recommended');
    const other = fixtureRecordsFieldAgentOtherThan(item.recommendation!.agent_id, RIYADH_CENTRAL());
    await expect(overrideAssignment(ctx, item.case_id, { agent_id: other })).rejects.toThrow(InvalidInputError);
    await expect(overrideAssignment(ctx, item.case_id, { agent_id: other, reason_code: 'other' })).rejects.toThrow(InvalidInputError);
    await expect(overrideAssignment(ctx, item.case_id, { agent_id: other, reason_code: 'not_a_reason' })).rejects.toThrow(InvalidInputError);
    const manual = await overrideAssignment(ctx, item.case_id, { agent_id: other, reason_code: 'other', note: 'Caller asked for this agent.' });
    expectValid('Assignment', manual);
    expect(manual).toMatchObject({ source: 'MANUAL', state: 'assigned', reason_code: 'other', reason_note: 'Caller asked for this agent.' });
    const board = (await listLiveCases(ctx, { zone_id: RIYADH_CENTRAL(), limit: 200 })).items.find((c) => c.case_id === item.case_id)!;
    expect(board).toMatchObject({ state: 'overridden', assignment_source: 'MANUAL', assigned_agent_id: other });
    const history = (await listAssignments(ctx, { case_id: item.case_id })).items;
    expect(history.map((a) => `${a.source}/${a.state}`).sort()).toEqual(['OpenDispatch/overridden', 'MANUAL/assigned']);
    expectValidItems('Assignment', history);
    const event = (await listAssignmentEvents(ctx, manual.id)).items.find((e) => e.event_type === 'overridden');
    expect(event).toMatchObject({ reason_code: 'other', source: 'MANUAL', actor_user_id: ctx.userId });
    expect((await listAuditEvents(admin(), { action: 'assignment.overridden' })).items[0]?.detail).toMatchObject({ reason_code: 'other', source: 'MANUAL' });
  });

  it('lets a dispatcher reassign an accepted case: the accept is superseded', async () => {
    const ctx = dispatcher();
    await seek(ctx, RECO_AT);
    const item = await firstCase(ctx, RIYADH_CENTRAL(), 'recommended');
    const accepted = await acceptRecommendation(ctx, item.case_id, { agent_id: item.recommendation!.agent_id });
    const other = fixtureRecordsFieldAgentOtherThan(item.recommendation!.agent_id, RIYADH_CENTRAL());
    await overrideAssignment(ctx, item.case_id, { agent_id: other, reason_code: 'agent_unavailable' });
    expect((await getAssignment(ctx, accepted.id)).state).toBe('superseded');
    expect((await listAssignments(ctx, { case_id: item.case_id })).items.filter((a) => a.state === 'assigned')).toHaveLength(1);
  });

  it('refuses writes outside the roles and zones, and audits the denial', async () => {
    const ctx = dispatcher();
    await seek(ctx, RECO_AT);
    const item = await firstCase(ctx, RIYADH_CENTRAL(), 'recommended');
    const planner = ctxFor('planner', { zones: [RIYADH_CENTRAL()] });
    await expect(acceptRecommendation(planner, item.case_id, { agent_id: item.recommendation!.agent_id })).rejects.toThrow(ForbiddenError);
    const elsewhere = ctxFor('dispatcher', { zones: [zones()[7] as string] });
    await expect(acceptRecommendation(elsewhere, item.case_id, { agent_id: item.recommendation!.agent_id })).rejects.toThrow(ForbiddenError);
    await expect(acceptRecommendation(elsewhere, item.case_id, { agent_id: item.recommendation!.agent_id })).rejects.toThrow(ForbiddenError);
    expect((await listAuditEvents(admin(), { outcome: 'denied', action: 'assignment.accepted' })).items.length).toBeGreaterThanOrEqual(3);
    for (const odd of ['', '..', 'x/../y']) await expect(overrideAssignment(planner, odd, {})).rejects.toThrow(ForbiddenError);
    expect((await listAuditEvents(admin(), { outcome: 'denied', action: 'assignment.overridden' })).items).toHaveLength(3);
    await expect(acceptRecommendation(ctx, '', { agent_id: item.recommendation!.agent_id })).rejects.toThrow(InvalidInputError);
    await expect(acceptRecommendation(ctx, '00000000-0000-4000-8000-000000000000', { agent_id: item.recommendation!.agent_id })).rejects.toThrow(NotFoundError);
  });

  it('persists a decision across a fresh module instance', async () => {
    const ctx = dispatcher();
    await seek(ctx, RECO_AT);
    const item = await firstCase(ctx, RIYADH_CENTRAL(), 'recommended');
    const assignment = await acceptRecommendation(ctx, item.case_id, { agent_id: item.recommendation!.agent_id });
    vi.resetModules();
    const fresh = await import('./dispatch');
    expect((await fresh.getAssignment(ctx, assignment.id)).case_id).toBe(item.case_id);
    expect((await fresh.listLiveCases(ctx, { zone_id: RIYADH_CENTRAL(), limit: 200 })).items.find((c) => c.case_id === item.case_id)?.state).toBe('assigned');
  });
});

function fixtureRecordsFieldAgentOtherThan(agentId: string, zone: string): string {
  const all = fixtureRecords<{ id: string; kind: string; home_zone_id: string | null; is_active: boolean }>('Agent');
  const found = all.find((s) => s.kind === 'field' && s.is_active && s.home_zone_id === zone && s.id !== agentId);
  if (found === undefined) throw new Error('No other agent.');
  return found.id;
}

describe('shadow stage', () => {
  it('sends nothing: accept and override are refused, Customer assigns, and Customer choice shows beside the shadow pick as the clock passes it', async () => {
    const ctx = ctxFor('dispatcher', { zones: [RIYADH_EAST()] });
    await seek(ctx, '2026-09-13T11:00:00+03:00');
    const assigned = (await listLiveCases(ctx, { zone_id: RIYADH_EAST(), state: 'assigned', limit: 200 })).items;
    expect(assigned.length).toBeGreaterThan(0);
    const one = assigned[0]!;
    expect(one).toMatchObject({ stage: 'shadow', assignment_source: 'CUSTOMER_FALLBACK' });
    expect(one.customer_agent_id).toBe(one.assigned_agent_id);
    expect(one.recommendation).not.toBeNull();
    await expect(acceptRecommendation(ctx, one.case_id, { agent_id: one.recommendation!.agent_id })).rejects.toThrow(ConflictError);
    await expect(overrideAssignment(ctx, one.case_id, { agent_id: one.recommendation!.agent_id, reason_code: 'skills_needed' })).rejects.toThrow(ConflictError);
  });

  it('reveals operator actual agent only after the assignment time', async () => {
    const ctx = ctxFor('dispatcher', { zones: [RIYADH_EAST()] });
    await seek(ctx, '2026-09-13T08:30:00+03:00');
    const waiting = (await listLiveCases(ctx, { zone_id: RIYADH_EAST(), state: 'waiting', limit: 200 })).items;
    for (const item of waiting) expect(item.customer_agent_id).toBeNull();
  });

  it('moving a zone to recommend makes accepts possible (the stage comes from the setting)', async () => {
    await setZoneStage(admin(), RIYADH_EAST(), { stage: 'recommend' });
    const ctx = ctxFor('dispatcher', { zones: [RIYADH_EAST()] });
    await seek(ctx, '2026-09-13T11:00:00+03:00');
    expect((await listLiveCases(ctx, { state: 'recommended', limit: 5 })).items.length).toBeGreaterThan(0);
    await setZoneStage(admin(), RIYADH_EAST(), { stage: 'automatic' });
    const automatic = (await listLiveCases(ctx, { state: 'assigned', limit: 200 })).items;
    expect(automatic.some((c) => c.assignment_source === 'OPENDISPATCH')).toBe(true);
    expect((await listZoneStages(ctx)).items[0]?.stage).toBe('automatic');
  });
});

describe('fallback', () => {
  it('follows the scripted feed outage: cases registered during it go to operator dispatch, and the board recovers after', async () => {
    const ctx = dispatcher();
    await seek(ctx, '2026-09-13T15:26:00+03:00');
    const during = await getFallbackState(ctx);
    expectValid('FallbackState', during);
    expect(during).toMatchObject({ state: 'active', reason: 'feed_outage', opendispatch_healthy: false });
    expect((await getReplayState(ctx)).feed_outage_active).toBe(true);
    const fallback = (await listLiveCases(ctx, { state: 'fallback_assigned', limit: 200 })).items;
    expect(fallback.length).toBeGreaterThan(0);
    for (const item of fallback.filter((c) => c.registered_at >= '2026-09-13T15:20:00' && c.registered_at < '2026-09-13T15:32:00')) expect(item.assignment_source).toBe('CUSTOMER_FALLBACK');
    expect(during.fallback_assigned_count).toBeGreaterThan(0);
    await seek(ctx, '2026-09-13T16:00:00+03:00');
    expect(await getFallbackState(ctx)).toMatchObject({ state: 'armed', reason: 'none', opendispatch_healthy: true });
    // Cases registered during the outage stay fallback assigned afterwards.
    const after = (await listLiveCases(ctx, { state: 'fallback_assigned', limit: 200 })).items;
    expect(after.length).toBeGreaterThanOrEqual(fallback.length);
    for (const item of fallback) expect(after.map((c) => c.case_id)).toContain(item.case_id);
  });

  it('never gives a fallback-assigned case a second OpenDispatch assignment', async () => {
    const ctx = dispatcher();
    await seek(ctx, '2026-09-13T15:40:00+03:00');
    const item = (await listLiveCases(ctx, { zone_id: RIYADH_CENTRAL(), state: 'fallback_assigned', limit: 200 })).items[0];
    if (item === undefined) return;
    await expect(acceptRecommendation(ctx, item.case_id, { agent_id: item.recommendation?.agent_id ?? '00000000-0000-4000-8000-000000000000' })).rejects.toThrow(ConflictError);
  });

  it('switches to fallback when a feed outage is simulated, and back when it ends (audited)', async () => {
    const ctx = dispatcher();
    await seek(ctx, '2026-09-13T10:00:00+03:00');
    expect((await getFallbackState(ctx)).state).toBe('armed');
    const down = await simulateFeedOutage(ctx, { feed: 'agent_feed', active: true });
    expect(down).toMatchObject({ state: 'active', reason: 'feed_outage', opendispatch_healthy: false });
    await seek(ctx, '2026-09-13T10:05:00+03:00');
    expect((await getFallbackState(ctx)).state).toBe('active');
    await simulateFeedOutage(ctx, { feed: 'agent_feed', active: false });
    expect((await getFallbackState(ctx)).state).toBe('armed');
    expect((await listAuditEvents(admin(), { action: 'fallback.outage_simulated' })).items).toHaveLength(2);
    await expect(simulateFeedOutage(ctxFor('planner'), { feed: 'case_feed', active: true })).rejects.toThrow(ForbiddenError);
    await expect(simulateFeedOutage(ctx, { feed: 'nope', active: true })).rejects.toThrow(InvalidInputError);
  });

  it('takes the manual fallback signal from the Administrator only (Admin 9), and resume hands control back', async () => {
    const dispatchCtx = dispatcher();
    await expect(sendFallbackSignal(dispatchCtx, { signal: 'fallback', reason: 'Planned maintenance.' })).rejects.toThrow(ForbiddenError);
    const state = await sendFallbackSignal(admin(), { signal: 'fallback', reason: 'Planned maintenance.' });
    expect(state).toMatchObject({ state: 'active', reason: 'manual', last_signal: 'fallback' });
    expectValid('FallbackState', state);
    expect(await sendFallbackSignal(admin(), { signal: 'resume', reason: 'Maintenance finished.' })).toMatchObject({ state: 'armed', last_signal: 'resume' });
    await expect(sendFallbackSignal(admin(), { signal: 'stop', reason: 'x' })).rejects.toThrow(InvalidInputError);
  });

  it('measures its own answers against the decision deadline, never against Customer timer', async () => {
    const { updateLiveAssignmentSettings } = await import('./settings');
    const ctx = dispatcher();
    await seek(ctx, RECO_AT);
    // The customer's fallback timeout is shown, not enforced by OpenDispatch
    await updateLiveAssignmentSettings(admin(), { fallback_timeout_seconds: 1 });
    expect((await listLiveCases(ctx, { state: 'recommended', limit: 5 })).items.length).toBeGreaterThan(0);
    expect((await getFallbackState(ctx)).timeout_seconds).toBe(1);
    // fixture decision times are 60 to 300 ms: a 50 ms budget misses
    await updateLiveAssignmentSettings(admin(), { decision_deadline_ms: 50 });
    expect((await listLiveCases(ctx, { state: 'recommended', limit: 5 })).items).toHaveLength(0);
  });
});

describe('scripted reassignment', () => {
  it('applies the replay scripts reassignment (a dispatcher picks another agent with a reason) once the clock passes it', async () => {
    const ctx = ctxFor('dispatch_supervisor');
    await controlReplay(ctx, { action: 'seek', replay_at: '2026-09-13T10:38:30+03:00' });
    const target = (await listLiveCases(ctx, { limit: 200 })).items.find((c) => c.case_number === 'RD-260913-00241');
    expect(target).toBeDefined();
    expect(target?.state).toBe('recommended');
    await controlReplay(ctx, { action: 'seek', replay_at: '2026-09-13T10:45:00+03:00' });
    const after = (await listLiveCases(ctx, { limit: 200 })).items.find((c) => c.case_number === 'RD-260913-00241');
    expect(after).toMatchObject({ state: 'overridden', assignment_source: 'MANUAL' });
    expect(after?.assigned_agent_id).not.toBe(after?.recommendation?.agent_id);
  });
});

describe('agents, recommendations and history', () => {
  it('lists field agent status and position at the replay time, scoped to the zones', async () => {
    const ctx = dispatcher();
    const list = await listAgentStatuses(ctx, { limit: 200 });
    expect(list.items.length).toBeGreaterThan(10);
    expectValidItems('AgentStatus', list.items);
    expect(new Set(list.items.map((s) => s.zone_id)).size).toBeLessThanOrEqual(2);
    const available = (await listAgentStatuses(ctx, { status: 'available', limit: 200 })).items;
    expect(available.every((s) => s.status === 'available')).toBe(true);
    const one = list.items[0]!;
    const positions = await listAgentPositions(ctx, one.agent_id, { limit: 10 });
    expect(positions.items.length).toBeGreaterThan(0);
    expectValidItems('AgentPosition', positions.items);
    await expect(listAgentPositions(ctxFor('dispatcher', { zones: [zones()[7] as string] }), one.agent_id)).rejects.toThrow(NotFoundError);
  });

  it('serves the recommendation of a delivered case with reason codes, and hides one that has not arrived', async () => {
    const ctx = admin();
    const item = (await listLiveCases(ctx, { limit: 1 })).items[0]!;
    const output = await getCaseRecommendation(ctx, item.case_id);
    expectValid('AssignmentEngineOutput', output);
    expect(output.ranking[0]?.reason_codes.length).toBeGreaterThan(0);
    const later = fixtureRecords<Case>('ReplayCase').find((c) => c.registered_at > '2026-09-13T20:00:00')!;
    await expect(getCaseRecommendation(ctx, later.id)).rejects.toThrow(NotFoundError);
  });

  it('serves the previous days assignments and shadow comparisons from the fixtures', async () => {
    const ctx = ctxFor('viewer_auditor');
    expect((await listAssignments(ctx, { limit: 200 })).page.total).toBe(fixtureRecords<Assignment>('Assignment').length);
    expect((await listAssignments(ctx, { source: 'CUSTOMER_FALLBACK', limit: 200 })).items.every((a) => a.source === 'CUSTOMER_FALLBACK')).toBe(true);
    const comparisons = await listShadowComparisons(ctx, { limit: 200 });
    expect(comparisons.page.total).toBe(fixtureRecords<AssignmentComparison>('AssignmentComparison').length);
    expectValidItems('AssignmentComparison', comparisons.items);
    const summary = await getShadowComparisonSummary(ctx);
    expectValid('ShadowComparisonSummary', summary);
    expect(summary).toMatchObject({ cases_compared: fixtureRecords<AssignmentComparison>('AssignmentComparison').length, illustrative: true });
    expect(summary.opendispatch.from_registration.case_count).toBeGreaterThan(0);
    expect(summary.customer.from_assignment.case_count).toBeGreaterThan(0);
    const oneZone = await getShadowComparisonSummary(ctx, { zone_id: RIYADH_EAST() });
    expect(oneZone.cases_compared).toBeLessThan(summary.cases_compared);
    expect((await listAssignments(ctxFor('dispatcher', { zones: [zones()[7] as string] }), { limit: 200 })).page.total).toBeLessThan(fixtureRecords<Assignment>('Assignment').length);
  });

  it('resets to the fixtures with the demo data (clock, decisions, outages)', async () => {
    const ctx = dispatcher();
    await seek(ctx, RECO_AT);
    const item = await firstCase(ctx, RIYADH_CENTRAL(), 'recommended');
    await acceptRecommendation(ctx, item.case_id, { agent_id: item.recommendation!.agent_id });
    await simulateFeedOutage(ctx, { feed: 'case_feed', active: true });
    await resetDemoData(ctxFor('administrator')); // only an administrator may reset (review M2)
    await resetGoTestState();
    expect((await getReplayState(ctx)).status).toBe('stopped');
    expect((await getFallbackState(ctx)).state).toBe('armed');
    expect((await listAssignments(ctx, { case_id: item.case_id })).items).toHaveLength(0);
  });
});

describe('unmet demand: cases out of 10-minute reach', () => {
  it('lists every field case of the day out of reach, paged and filtered, against the contract', async () => {
    const ctx = admin();
    await seek(ctxFor('dispatch_supervisor'), '2026-09-13T23:59:00+03:00');
    const all = await listUnmetDemand(ctx, { limit: 200 });
    expectValid('UnmetDemandList', all);
    expect(all).toMatchObject({ date: '2026-09-13', threshold_seconds: 600, illustrative: true, data_source: 'SYNTHETIC' });
    expect(all.page.total).toBeGreaterThan(200);
    expect(all.items.every((r) => r.cause === 'people' ? r.nearest_agent_id === null : (r.nearest_travel_seconds ?? 0) > 600)).toBe(true);
    const people = await listUnmetDemand(ctx, { cause: 'people', limit: 200 });
    expect(people.items.length).toBeGreaterThan(0);
    expect(people.items.every((r) => r.cause === 'people')).toBe(true);
    const zone = await listUnmetDemand(ctx, { zone_id: RIYADH_CENTRAL(), limit: 200 });
    expect(zone.items.every((r) => r.zone_id === RIYADH_CENTRAL())).toBe(true);
    expect((await listUnmetDemand(ctx, { date: '2026-09-12' })).items).toEqual([]);
    const scoped = await listUnmetDemand(dispatcher(), { limit: 200 });
    expect(scoped.items.every((r) => [RIYADH_CENTRAL(), zones()[1]].includes(r.zone_id))).toBe(true);
    await expect(listUnmetDemand(ctxFor('remote_team_lead'))).rejects.toThrow(ForbiddenError);
    await expect(listUnmetDemand(ctx, { cause: 'vehicles' as 'people' })).rejects.toThrow(InvalidInputError);
  });

  it('reads the threshold from the setting and alerts supervisors once per case', async () => {
    const ctx = admin();
    await seek(ctxFor('dispatch_supervisor'), '2026-09-13T09:00:00+03:00');
    const first = await listUnmetDemand(ctx, { limit: 200 });
    const alerts = async () => (await listNotificationLog(ctx, { category: 'dispatch', limit: 200 })).page.total ?? 0;
    expect(await alerts()).toBe(first.page.total);
    await listUnmetDemand(ctx, { limit: 200 });
    expect(await alerts()).toBe(first.page.total);
    expect((await listAuditEvents(ctx, { action: 'dispatch.case_unreachable_flagged' })).items).toHaveLength(1);
    await updateLiveAssignmentSettings(ctx, { ten_minute_threshold_seconds: 900 } as never);
    const wider = await listUnmetDemand(ctx, { limit: 200 });
    expect(wider.threshold_seconds).toBe(900);
    expect(wider.page.total).toBeLessThan(first.page.total ?? 0);
  });
});

// ---------------------------------------------------------------------------------------------
// DG6: maintenance mode (Data Sources): the fallback state reads it
// ---------------------------------------------------------------------------------------------

describe('maintenance mode (DG6)', () => {
  it('puts the fallback state into maintenance while it is on: Operator dispatch assigns, and it is armed again when it is off', async () => {
    const ctx = dispatcher();
    await seek(ctx, '2026-09-13T10:00:00+03:00');
    const before = await getFallbackState(ctx);
    expect(before).toMatchObject({ state: 'armed', reason: 'none' });
    const on = await setMaintenanceMode(admin(), { enabled: true });
    expectValid('FallbackState', on);
    expect(on).toMatchObject({ state: 'maintenance', reason: 'maintenance', opendispatch_healthy: true, data_source: 'SYNTHETIC' });
    expect(on.since).not.toBeNull();
    // every reader of the board sees it, whatever their role or zones
    for (const reader of [ctx, admin(), ctxFor('viewer_auditor'), ctxFor('planner')]) expect(await getFallbackState(reader)).toMatchObject({ state: 'maintenance', reason: 'maintenance' });
    // cases registered while it is on are assigned by the customer's dispatch (never a second OpenDispatch assignment)
    await seek(ctx, '2026-09-13T10:20:00+03:00');
    const during = await getFallbackState(admin());
    expect(during).toMatchObject({ state: 'maintenance' });
    expect(during.fallback_assigned_count).toBeGreaterThan(before.fallback_assigned_count);
    const fallback = (await listLiveCases(admin(), { state: 'fallback_assigned', limit: 200 })).items.filter((c) => c.registered_at >= '2026-09-13T10:00:00+03:00' && c.registered_at <= '2026-09-13T10:20:00+03:00');
    expect(fallback.length).toBeGreaterThan(0);
    for (const item of fallback) expect(item.assignment_source).toBe('CUSTOMER_FALLBACK');
    const off = await setMaintenanceMode(admin(), { enabled: false });
    expect(off).toMatchObject({ state: 'armed', reason: 'none' });
    expect((await getFallbackState(admin())).state).toBe('armed');
  });

  it('takes precedence over a manual signal and a feed outage in the reason, and leaves them in place when it ends', async () => {
    const ctx = admin();
    await seek(dispatcher(), '2026-09-13T10:00:00+03:00');
    await sendFallbackSignal(ctx, { signal: 'fallback', reason: 'Planned work.' });
    expect(await setMaintenanceMode(ctx, { enabled: true })).toMatchObject({ state: 'maintenance', reason: 'maintenance', last_signal: 'fallback' });
    expect(await setMaintenanceMode(ctx, { enabled: false })).toMatchObject({ state: 'active', reason: 'manual' });
  });

  it('is audited with the new state, raises the fallback alert when it goes on, and a repeat call changes nothing', async () => {
    const ctx = admin();
    const alerts = async () => (await listNotificationLog(ctx, { category: 'fallback', limit: 200 })).items.length;
    const first = await alerts();
    await setMaintenanceMode(ctx, { enabled: true });
    expect(await alerts()).toBeGreaterThan(first);
    const events = (await listAuditEvents(ctx, { action: 'fallback.maintenance_changed' })).items;
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ outcome: 'success', actor_user_id: ctx.userId, entity_type: 'fallback', detail: { enabled: true } });
    const snapshot = dataSnapshot();
    expect(await setMaintenanceMode(ctx, { enabled: true })).toMatchObject({ state: 'maintenance' });
    expect(dataSnapshot()).toBe(snapshot); // already on: no second event in the log
    expect((await listAuditEvents(ctx, { action: 'fallback.maintenance_changed', limit: 200 })).items).toHaveLength(2); // the call is still audited
    const afterOn = await alerts();
    await setMaintenanceMode(ctx, { enabled: false });
    expect(await alerts()).toBe(afterOn); // going off raises nothing
  });

  it('is the Administrator only: every other role is forbidden, the denial is audited, and nothing changes', async () => {
    for (const role of ['dispatch_supervisor', 'dispatcher', 'planner', 'remote_team_lead', 'viewer_auditor', 'change_approver'] as const) {
      const before = dataSnapshot();
      const audits = await auditCount();
      await expect(setMaintenanceMode(ctxFor(role), { enabled: true })).rejects.toThrow(ForbiddenError);
      expect(dataSnapshot()).toBe(before);
      expect(await auditCount()).toBe(audits + 1);
    }
    expect((await listAuditEvents(admin(), { action: 'fallback.maintenance_changed', outcome: 'denied', limit: 200 })).items).toHaveLength(6);
    expect((await getFallbackState(admin())).state).toBe('armed');
    // the role check comes first
    await expect(setMaintenanceMode(ctxFor('planner'), 'nonsense')).rejects.toThrow(ForbiddenError);
  });

  it('needs a boolean and nothing else', async () => {
    for (const bad of [{}, { enabled: 'yes' }, { enabled: 1 }, { enabled: null }, { enabled: true, reason: 'x' }, { on: true }, null, 'true', []]) {
      await expect(setMaintenanceMode(admin(), bad)).rejects.toThrow(InvalidInputError);
    }
    expect((await getFallbackState(admin())).state).toBe('armed');
  });

  it('is undone by resetting the demo data', async () => {
    await setMaintenanceMode(admin(), { enabled: true });
    await resetDemoData(admin());
    await resetGoTestState();
    expect((await getFallbackState(admin())).state).toBe('armed');
  });
});
