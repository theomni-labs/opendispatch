// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import type { Case, DashboardRollup, ProductivityRollup } from '@/lib/types';
import { ForbiddenError, InvalidInputError } from './errors';
import { fixtureRecords } from './internal/fixtures';
import { listDashboardRollups, listProductivityRollups } from './dashboards';
import { updateClockStart } from './settings';
import { ctxFor, expectValid, expectValidItems, fixtureZoneIds, withTempDemoState } from './test-support';

withTempDemoState();

const admin = () => ctxFor('administrator');
const viewer = () => ctxFor('viewer_auditor');
const zones = () => fixtureZoneIds();
const stored = () => fixtureRecords<DashboardRollup>('DashboardRollup');

describe('management dashboards', () => {
  it('serves the zone, city and kingdom roll-ups per day and validates against the contract', async () => {
    const kingdom = await listDashboardRollups(viewer(), { level: 'kingdom', limit: 200 });
    expectValid('DashboardRollupList', kingdom);
    expect(kingdom.page.total).toBe(stored().filter((r) => r.level === 'kingdom').length);
    for (const r of kingdom.items) {
      expect(r.scope_id).toBeNull();
      expect(r.cases_field + r.cases_remote_inferred).toBe(r.cases_total);
      expect(r.illustrative).toBe(true);
    }
    expect((await listDashboardRollups(viewer(), { level: 'city', limit: 200 })).page.total).toBe(stored().filter((r) => r.level === 'city').length);
    const zone = await listDashboardRollups(viewer(), { level: 'zone', limit: 200 });
    expect(zone.page.total).toBe(stored().filter((r) => r.level === 'zone').length);
    expectValidItems('DashboardRollup', zone.items);
  });

  it('always has both 10-minute readings, and the primary follows the setting, not the stored value', async () => {
    const first = (await listDashboardRollups(viewer(), { level: 'kingdom', limit: 1 })).items[0]!;
    expect(first.primary_clock_start).toBe('assignment');
    expect(first.from_registration.case_count).toBeGreaterThan(0);
    expect(first.from_assignment.case_count).toBeGreaterThan(0);
    expect(first.from_assignment.share).toBeGreaterThanOrEqual(first.from_registration.share ?? 0);
    await updateClockStart(admin(), { clock_start: 'registration' });
    const second = (await listDashboardRollups(viewer(), { level: 'kingdom', limit: 1 })).items[0]!;
    expect(second.primary_clock_start).toBe('registration');
    expect(second.from_registration).toEqual(first.from_registration);
    expect(second.from_assignment).toEqual(first.from_assignment);
  });

  it('filters by scope and dates', async () => {
    const one = await listDashboardRollups(viewer(), { level: 'zone', scope_id: zones()[0] as string, limit: 200 });
    expect(one.items.length).toBeGreaterThanOrEqual(7);
    expect((await listDashboardRollups(viewer(), { level: 'zone', scope_id: zones()[0] as string, date_from: '2026-09-06', date_to: '2026-09-12', limit: 200 })).items).toHaveLength(8);
    expect(one.items.every((r) => r.scope_id === zones()[0])).toBe(true);
    const day = await listDashboardRollups(viewer(), { level: 'kingdom', date_from: '2026-09-08', date_to: '2026-09-08' });
    expect(day.items).toHaveLength(1);
    expect(day.items[0]!.cases_total).toBe(fixtureRecords<Case>('Case').filter((c) => c.registered_at.startsWith('2026-09-08')).length);
    await expect(listDashboardRollups(viewer(), { level: 'planet' as never })).rejects.toThrow(InvalidInputError);
  });

  it('limits a Dispatch Supervisor to their zones at every level, summing the zones they may read', async () => {
    const ctx = ctxFor('dispatch_supervisor', { zones: [zones()[0] as string] });
    expect((await listDashboardRollups(ctx, { level: 'zone', limit: 200 })).items.every((r) => r.scope_id === zones()[0])).toBe(true);
    const own = (await listDashboardRollups(ctx, { level: 'kingdom', date_from: '2026-09-08', date_to: '2026-09-08' })).items[0]!;
    expect(own.cases_total).toBeLessThan((await listDashboardRollups(viewer(), { level: 'kingdom', date_from: '2026-09-08', date_to: '2026-09-08' })).items[0]!.cases_total);
    const zoneRow = (await listDashboardRollups(ctx, { level: 'zone', date_from: '2026-09-08', date_to: '2026-09-08' })).items[0]!;
    expect(own.cases_total).toBe(zoneRow.cases_total);
    expect(own.from_registration).toEqual(zoneRow.from_registration);
    const cities = (await listDashboardRollups(ctx, { level: 'city', date_from: '2026-09-08', date_to: '2026-09-08' })).items;
    expect(cities).toHaveLength(1);
    expectValid('DashboardRollup', cities[0]);
    expect((await listDashboardRollups(ctxFor('dispatch_supervisor', { zones: [] }), { level: 'kingdom' })).items).toHaveLength(0);
  });

  it('is closed to the Dispatcher and Change Approver, and open to the Remote Team Lead', async () => {
    await expect(listDashboardRollups(ctxFor('dispatcher'), { level: 'zone' })).rejects.toThrow(ForbiddenError);
    await expect(listDashboardRollups(ctxFor('change_approver'), { level: 'zone' })).rejects.toThrow(ForbiddenError);
    await listDashboardRollups(ctxFor('remote_team_lead'), { level: 'zone' });
  });
});

describe('productivity and metrics', () => {
  it('serves per zone and per agent figures, illustrative, and validates against the contract', async () => {
    const byZone = await listProductivityRollups(viewer(), { limit: 200 });
    expectValid('ProductivityRollupList', byZone);
    expect(byZone.items).toHaveLength(8);
    for (const r of byZone.items) expect(r).toMatchObject({ group_by: 'zone', agent_id: null, illustrative: true });
    const byAgent = await listProductivityRollups(viewer(), { group_by: 'agent', zone_id: zones()[0] as string, limit: 200 });
    expect(byAgent.items.length).toBeGreaterThan(10);
    expectValidItems('ProductivityRollup', byAgent.items);
    expect(byAgent.items.every((r) => r.agent_id !== null && r.zone_id === zones()[0])).toBe(true);
    expect((await listProductivityRollups(viewer(), { group_by: 'agent', limit: 200 })).page.total).toBe(fixtureRecords<ProductivityRollup>('ProductivityRollup').filter((r) => r.group_by === 'agent').length);
    const one = await listProductivityRollups(viewer(), { group_by: 'agent', agent_id: byAgent.items[0]!.agent_id as string });
    expect(one.items).toHaveLength(1);
    expect((await listProductivityRollups(viewer(), { date_from: '2026-09-13', date_to: '2026-09-13' })).items).toHaveLength(0);
  });

  it('respects the zone scope and the role', async () => {
    const ctx = ctxFor('planner', { zones: [zones()[0] as string] });
    expect((await listProductivityRollups(ctx, { limit: 200 })).items.map((r) => r.zone_id)).toEqual([zones()[0]]);
    await expect(listProductivityRollups(ctxFor('dispatcher'))).rejects.toThrow(ForbiddenError);
    await expect(listProductivityRollups(ctxFor('remote_team_lead'))).rejects.toThrow(ForbiddenError);
    await expect(listProductivityRollups(ctx, { group_by: 'day' as never })).rejects.toThrow(InvalidInputError);
  });
});
