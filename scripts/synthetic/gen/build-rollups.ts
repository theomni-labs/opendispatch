// SPDX-License-Identifier: AGPL-3.0-only
// Roll-up tables the dashboards read. Computed here from the
// week's cases, so they always agree with the case fixtures. Illustrative. Node-free.

import { calibration } from './calibration';
import { base, type Ctx, type Rec, round } from './context';
import type { PlannedCase } from './dayplan';
import { percentile } from './dist';
import { dutyOn } from './people';
import { addDays, dateRange, dayStart, localDate } from './time';

/** Shares keep 6 decimals: the contract invariant is share = within_count / case_count within 1e-6, and rounding to 6 digits errs by at most 5e-7. */
const SHARE_DIGITS = 6;

const THRESHOLD = calibration.roles_and_settings.assignment_ten_minute_threshold_seconds.value;

interface Reading {
  within_count: number;
  case_count: number;
  share: number | null;
}

const reading = (within: number, total: number): Reading => ({ within_count: within, case_count: total, share: total > 0 ? round(within / total, SHARE_DIGITS) : null });

function readings(cases: readonly PlannedCase[]): { fromRegistration: Reading; fromAssignment: Reading } {
  const field = cases.filter((c) => c.handling === 'field' && c.assigned !== null && c.arrived !== null);
  const wr = field.filter((c) => (c.arrived as number) - c.registered <= THRESHOLD).length;
  const wa = field.filter((c) => (c.arrived as number) - (c.assigned as number) <= THRESHOLD).length;
  return { fromRegistration: reading(wr, field.length), fromAssignment: reading(wa, field.length) };
}

export function buildDashboardRollups(ctx: Ctx, weekCases: readonly PlannedCase[]): Rec[] {
  const rows: Rec[] = [];
  const at = dayStart(addDays(ctx.lastCaseDay, 1)) + 3600; // refreshed shortly after midnight
  const cities = ctx.world.locations.cities;
  const zones = ctx.world.locations.zones;
  const periods: { start: string; end: string }[] = [...dateRange(ctx.firstCaseDay, ctx.lastCaseDay).map((d) => ({ start: d, end: d })), { start: ctx.firstCaseDay, end: ctx.lastCaseDay }];

  const onDuty = (zoneIds: readonly string[], date: string): number =>
    ctx.world.agents.filter((s) => s.work_mode === 'field' && zoneIds.includes(s.zone_id) && dutyOn(s, date) !== null).length;

  for (const p of periods) {
    const inPeriod = weekCases.filter((c) => localDate(c.registered) >= p.start && localDate(c.registered) <= p.end);
    const single = p.start === p.end;
    const make = (level: 'zone' | 'city' | 'kingdom', scopeId: string | null, key: string, cases: readonly PlannedCase[], zoneIds: readonly string[]): void => {
      const r = readings(cases);
      const field = cases.filter((c) => c.handling === 'field').length;
      rows.push({
        ...base(ctx, 'dashboard_rollup', `${level}|${key}|${p.start}|${p.end}`, at),
        level,
        scope_id: scopeId,
        period_start: p.start,
        period_end: p.end,
        cases_total: cases.length,
        cases_field: field,
        cases_remote_inferred: cases.length - field,
        forecast_expected_total: null,
        from_registration: r.fromRegistration,
        from_assignment: r.fromAssignment,
        primary_clock_start: calibration.roles_and_settings.ten_minute_clock_start.value,
        agents_on_duty: single ? onDuty(zoneIds, p.start) : null,
        gap_intervals: null,
        surplus_intervals: null,
        illustrative: true,
      });
    };
    for (const zone of zones) make('zone', zone.id, zone.code, inPeriod.filter((c) => c.zone.id === zone.id), [zone.id]);
    for (const city of cities) make('city', city.id, city.code, inPeriod.filter((c) => c.city.id === city.id), zones.filter((z) => z.city_id === city.id).map((z) => z.id));
    make('kingdom', null, 'all', inPeriod, zones.map((z) => z.id));
  }
  return rows;
}

export function buildProductivityRollups(ctx: Ctx, weekCases: readonly PlannedCase[]): Rec[] {
  const rows: Rec[] = [];
  const at = dayStart(addDays(ctx.lastCaseDay, 1)) + 3600;
  const start = ctx.firstCaseDay;
  const end = ctx.lastCaseDay;
  const med = (a: number[]): number | null => (a.length === 0 ? null : Math.round(percentile([...a].sort((x, y) => x - y), 50)));
  const stats = (cases: readonly PlannedCase[]): { handled: number; assignedToArrived: number | null; registeredToArrived: number | null; onScene: number | null; busy: number } => {
    const field = cases.filter((c) => c.handling === 'field' && c.assigned !== null && c.arrived !== null);
    return {
      handled: field.length,
      assignedToArrived: med(field.map((c) => (c.arrived as number) - (c.assigned as number))),
      registeredToArrived: med(field.map((c) => (c.arrived as number) - c.registered)),
      onScene: med(field.map((c) => c.closed - (c.arrived as number))),
      busy: field.reduce((a, c) => a + (c.closed - (c.assigned as number)), 0),
    };
  };
  const dutySeconds = (zoneId: string, agentId: string | null): number => {
    let total = 0;
    for (const s of ctx.world.agents) {
      if (s.work_mode !== 'field' || s.zone_id !== zoneId || (agentId !== null && s.id !== agentId)) continue;
      for (const d of dateRange(start, end)) {
        const duty = dutyOn(s, d);
        if (duty !== null) total += duty.end - duty.start - (duty.break_end - duty.break_start);
      }
    }
    return total;
  };

  for (const zone of ctx.world.locations.zones) {
    const cases = weekCases.filter((c) => c.zone.id === zone.id);
    const s = stats(cases);
    const duty = dutySeconds(zone.id, null);
    rows.push({
      ...base(ctx, 'productivity_rollup', `zone|${zone.code}`, at),
      group_by: 'zone',
      zone_id: zone.id,
      agent_id: null,
      period_start: start,
      period_end: end,
      cases_handled: s.handled,
      median_assigned_to_arrived_seconds: s.assignedToArrived,
      median_registered_to_arrived_seconds: s.registeredToArrived,
      median_time_on_scene_seconds: s.onScene,
      utilisation: duty > 0 ? round(Math.min(1, s.busy / duty), 4) : null,
      illustrative: true,
    });
  }
  for (const sv of ctx.world.agents.filter((x) => x.work_mode === 'field')) {
    const cases = weekCases.filter((c) => c.agent?.id === sv.id);
    const s = stats(cases);
    const duty = dutySeconds(sv.zone_id, sv.id);
    rows.push({
      ...base(ctx, 'productivity_rollup', `agent|${sv.employee_code}`, at),
      group_by: 'agent',
      zone_id: sv.zone_id,
      agent_id: sv.id,
      period_start: start,
      period_end: end,
      cases_handled: s.handled,
      median_assigned_to_arrived_seconds: s.assignedToArrived,
      median_registered_to_arrived_seconds: s.registeredToArrived,
      median_time_on_scene_seconds: s.onScene,
      utilisation: duty > 0 ? round(Math.min(1, s.busy / duty), 4) : null,
      illustrative: true,
    });
  }
  return rows;
}
