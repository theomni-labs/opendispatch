// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import type { Roster, RosterAssignment } from '@/lib/types';
import { listAuditEvents } from './audit';
import { ConflictError, ForbiddenError, InvalidInputError, NotFoundError } from './errors';
import { fixtureRecords } from './internal/fixtures';
import { applyStandbyMove, getCoverage, recommendStandbyMoves } from './standby';
import { ctxFor, expectJunkIdsForbiddenLive, expectJunkIdsInvalidLive, expectValid, fixtureZoneIds, withTempDemoState } from './test-support';

withTempDemoState();

const [riyadhCentral, riyadhNorth, riyadhEast, , , jeddahNorth] = fixtureZoneIds();
const planner = () => ctxFor('planner');
const day = '2026-09-14';
const draftDay = '2026-09-15'; // Riyadh Central: draft roster

// The committed draft; Go seeds its own copy from it.
function draftAssignments(): RosterAssignment[] {
  const roster = fixtureRecords<Roster>('Roster').find((r) => r.zone_id === riyadhCentral && r.roster_date === draftDay);
  return fixtureRecords<RosterAssignment>('RosterAssignment').filter((a) => a.roster_id === roster?.id && a.zone_id === riyadhCentral);
}

describe('reading the coverage', () => {
  it('shows each standby point of the zone, its radius, its staffing and the sub-zones no staffed point reaches', async () => {
    const coverage = await getCoverage(planner(), { zone_id: riyadhCentral, date: day });
    expect(coverage.areas).toHaveLength(3);
    expect(coverage.illustrative).toBe(true);
    expect(coverage.roster_id).toEqual(expect.any(String));
    for (const area of coverage.areas) {
      expect(area.coverage_radius_m).toBe(4500);
      expect(area.recommended_agents).toBeGreaterThan(0);
      expect(area.covered_sub_zone_ids.length).toBeGreaterThan(0);
    }
    expect(coverage.uncovered_sub_zone_ids.length).toBeGreaterThan(0);
    const covered = new Set(coverage.areas.flatMap((a) => a.covered_sub_zone_ids));
    for (const id of coverage.uncovered_sub_zone_ids) expect(covered.has(id)).toBe(false);
    expectValid('Coverage', coverage);
  });

  it('falls back to the default standby points when the zone has no roster that day', async () => {
    const coverage = await getCoverage(planner(), { zone_id: riyadhCentral, date: '2027-01-03' });
    expect(coverage.roster_id).toBeNull();
    expect(coverage.areas.some((a) => a.recommended_agents > 0)).toBe(true);
    expectValid('Coverage', coverage);
  });

  it('respects the role and the zone scope', async () => {
    for (const role of ['administrator', 'dispatch_supervisor', 'dispatcher', 'planner', 'viewer_auditor'] as const) {
      await expect(getCoverage(ctxFor(role), { zone_id: riyadhCentral, date: day })).resolves.toBeDefined();
    }
    await expect(getCoverage(ctxFor('remote_team_lead'), { zone_id: riyadhCentral, date: day })).rejects.toThrow(ForbiddenError);
    await expect(getCoverage(ctxFor('change_approver'), { zone_id: riyadhCentral, date: day })).rejects.toThrow(ForbiddenError);
    await expect(getCoverage(planner(), { zone_id: jeddahNorth, date: day })).rejects.toThrow(NotFoundError);
    await expect(getCoverage(ctxFor('dispatcher'), { zone_id: riyadhEast, date: day })).rejects.toThrow(NotFoundError);
    await expect(getCoverage(planner(), { date: day })).rejects.toThrow(InvalidInputError);
    await expect(getCoverage(planner(), { zone_id: riyadhCentral, date: 'later' })).rejects.toThrow(InvalidInputError);
  });
});

describe('recommending and applying a move', () => {
  async function emptyOnePoint(): Promise<{ emptied: string; uncoveredBefore: number }> {
    const pointIds = [...new Set(draftAssignments().map((a) => a.standby_point_id ?? ''))];
    const baseline = (await getCoverage(planner(), { zone_id: riyadhCentral, date: draftDay })).uncovered_sub_zone_ids.length;
    for (const emptied of pointIds) {
      const target = pointIds.find((id) => id !== emptied) ?? '';
      const count = draftAssignments().filter((a) => a.standby_point_id === emptied).length;
      await applyStandbyMove(planner(), { zone_id: riyadhCentral, roster_date: draftDay, from_standby_point_id: emptied, to_standby_point_id: target, agents: count });
      if ((await getCoverage(planner(), { zone_id: riyadhCentral, date: draftDay })).uncovered_sub_zone_ids.length > baseline) return { emptied, uncoveredBefore: baseline };
      await applyStandbyMove(planner(), { zone_id: riyadhCentral, roster_date: draftDay, from_standby_point_id: target, to_standby_point_id: emptied, agents: count });
    }
    throw new Error('No standby point of the zone covers a sub-zone alone.');
  }

  it('recommends moving agents to an unstaffed point that reaches uncovered sub-zones, and the move closes the gap', async () => {
    const { emptied, uncoveredBefore } = await emptyOnePoint();
    const damaged = await getCoverage(planner(), { zone_id: riyadhCentral, date: draftDay });
    expect(damaged.uncovered_sub_zone_ids.length).toBeGreaterThan(uncoveredBefore);
    const recommendation = await recommendStandbyMoves(planner(), { zone_id: riyadhCentral, date: draftDay });
    expect(recommendation.moves.length).toBeGreaterThan(0);
    expect(recommendation.uncovered_after).toBeLessThan(recommendation.uncovered_before);
    expect(recommendation.moves[0]).toMatchObject({ to_standby_point_id: emptied, agents: 1 });
    expect(recommendation.moves[0]?.reason_en).toContain('sub-zone');
    expect(recommendation.illustrative).toBe(true);

    const move = recommendation.moves[0];
    const after = await applyStandbyMove(planner(), { zone_id: riyadhCentral, roster_date: draftDay, from_standby_point_id: move?.from_standby_point_id, to_standby_point_id: move?.to_standby_point_id, agents: 1 });
    expect(after.uncovered_sub_zone_ids.length).toBe(recommendation.uncovered_after);
    expectValid('Coverage', after);
    expect((await listAuditEvents(ctxFor('administrator'), { action: 'standby.moved' })).items[0]).toMatchObject({ outcome: 'success', entity_type: 'roster' });
  });

  it('keeps a move for later reads', async () => {
    const from = draftAssignments()[0]?.standby_point_id ?? '';
    const to = draftAssignments().find((a) => a.standby_point_id !== from)?.standby_point_id ?? '';
    const applied = await applyStandbyMove(planner(), { zone_id: riyadhCentral, roster_date: draftDay, from_standby_point_id: from, to_standby_point_id: to, agents: 1 });
    expect(await getCoverage(planner(), { zone_id: riyadhCentral, date: draftDay })).toEqual(applied);
  });

  it('refuses a move outside the role, the zone scope, the roster state or the contract, and audits the denials', async () => {
    const from = draftAssignments()[0]?.standby_point_id ?? '';
    const to = draftAssignments().find((a) => a.standby_point_id !== from)?.standby_point_id ?? '';
    const move = { zone_id: riyadhCentral, roster_date: draftDay, from_standby_point_id: from, to_standby_point_id: to, agents: 1 };
    for (const role of ['dispatch_supervisor', 'dispatcher', 'viewer_auditor', 'administrator'] as const) {
      await expect(applyStandbyMove(ctxFor(role), move)).rejects.toThrow(ForbiddenError);
    }
    await expect(applyStandbyMove(planner(), { ...move, zone_id: jeddahNorth })).rejects.toThrow(ForbiddenError);
    const denied = (await listAuditEvents(ctxFor('administrator'), { action: 'standby.moved', outcome: 'denied' })).items;
    expect(denied).toHaveLength(5);
    await expect(applyStandbyMove(planner(), { ...move, to_standby_point_id: from })).rejects.toThrow(InvalidInputError);
    await expect(applyStandbyMove(planner(), { ...move, agents: 0 })).rejects.toThrow(InvalidInputError);
    await expect(applyStandbyMove(planner(), { ...move, agents: 40 })).rejects.toThrow(ConflictError);
    await expect(applyStandbyMove(planner(), { ...move, roster_date: day, zone_id: riyadhNorth })).rejects.toThrow(InvalidInputError); // points belong to another zone
    await expect(applyStandbyMove(planner(), { ...move, roster_date: '2027-01-03' })).rejects.toThrow(NotFoundError);
    await expect(applyStandbyMove(planner(), { ...move, tenant_id: 'x' })).rejects.toThrow(InvalidInputError);
    const published = fixtureRecords<Roster>('Roster').find((r) => r.zone_id === riyadhCentral && r.status === 'published');
    await expect(applyStandbyMove(planner(), { ...move, roster_date: published?.roster_date })).rejects.toThrow(ConflictError);
  });
});

describe('crafted ids (review M4) and guard order (review m2)', () => {
  it('refuses a crafted zone id up front and changes nothing', async () => {
    await expectJunkIdsInvalidLive((id) => getCoverage(planner(), { zone_id: id, date: day }));
    await expectJunkIdsInvalidLive((id) => recommendStandbyMoves(planner(), { zone_id: id, date: day }));
    await expectJunkIdsInvalidLive((id) => applyStandbyMove(planner(), { zone_id: id, roster_date: draftDay, from_standby_point_id: riyadhNorth, to_standby_point_id: riyadhEast, agents: 1 }));
  });

  it('answers forbidden and audits the denial for a caller who may not write, whatever the body', async () => {
    await expectJunkIdsForbiddenLive((id) => applyStandbyMove(ctxFor('viewer_auditor'), { zone_id: id }));
    await expect(applyStandbyMove(ctxFor('viewer_auditor'), 'not an object')).rejects.toThrow(ForbiddenError);
    const denied = (await listAuditEvents(ctxFor('administrator'), { action: 'standby.moved', outcome: 'denied' })).items;
    expect(denied).toHaveLength(16);
  });
});
