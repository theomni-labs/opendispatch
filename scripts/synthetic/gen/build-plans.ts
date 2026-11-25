// SPDX-License-Identifier: AGPL-3.0-only
// Plans: forecast run and values, rosters and their assignments, overrides, scenarios and approvals, plus the placeholder
// optimizer output. Generator-only (uses build-reference, which reaches adhan).

import { calibration } from './calibration';
import { base, idOf, round, type Ctx, type Rec } from './context';
import { casesForDate, slotWeights } from './demand';
import { dutyOn, shiftDef, vehiclesForZoneDate, type Duty, type AgentDef } from './people';
import { shiftPatternId, type UserFx, userByKey } from './build-reference';
import { addDays, dateRange, dayStart, iso, parseIso, SLOT_SECONDS, SLOTS_PER_DAY } from './time';
import { uuidFor } from './rng';

const FIELD_SHARE = 0.575; // the field share the case-type mix and quotas give (placeholder forecaster)
const CASE_WORKLOAD_HOURS = 0.55; // agent time one field case takes, all in
const TARGET_UTILISATION = 0.5; // with the line above: Go fixtureCasesPerInterval
const MIN_ON_DUTY = 3; // coverage minimum per zone in every interval (assumption)

// ---------------------------------------------------------------------------------------------------------------------
// Forecast (placeholder engine output, illustrative)
// ---------------------------------------------------------------------------------------------------------------------

export interface ForecastValueRow {
  readonly zone_id: string;
  readonly sub_zone_id: string;
  readonly interval_start: string;
  readonly interval_index: number;
  readonly low: number;
  readonly expected: number;
  readonly high: number;
  readonly field_expected: number;
  readonly remote_inferred_expected: number;
}

export interface ForecastFx {
  readonly runId: string;
  readonly run: Rec;
  readonly rows: ForecastValueRow[];
  readonly zoneTotals: Map<string, number[]>; // zone id -> expected cases per slot
}

export function buildForecast(ctx: Ctx, adminId: string): ForecastFx {
  const cfg = calibration.fixtures.forecast;
  const date = cfg.horizon_start.value;
  const total = casesForDate(date);
  const weights = slotWeights();
  const midnight = dayStart(date);
  const runId = idOf(ctx, 'forecast_run', `${cfg.model_version.value}|${date}`);
  const rows: ForecastValueRow[] = [];
  const zoneTotals = new Map<string, number[]>();
  const coverageZ = 1.2816; // 80% range
  for (const zone of ctx.world.locations.zones) {
    const city = ctx.world.locations.cities.find((c) => c.id === zone.city_id);
    if (city === undefined) throw new Error('zone without city');
    const zoneShare = total * city.share * zone.demand_weight;
    zoneTotals.set(zone.id, weights.map((w) => zoneShare * w));
    for (const sub of ctx.world.locations.subZones.filter((s) => s.zone_id === zone.id)) {
      for (let slot = 0; slot < SLOTS_PER_DAY; slot += 1) {
        const e = zoneShare * sub.demand_weight * (weights[slot] as number);
        const expected = round(e, 3);
        const half = coverageZ * Math.sqrt(e) * 1.1;
        const field = round(expected * FIELD_SHARE, 3);
        rows.push({
          zone_id: zone.id,
          sub_zone_id: sub.id,
          interval_start: iso(midnight + slot * SLOT_SECONDS),
          interval_index: slot,
          low: round(Math.max(0, e - half), 3),
          expected,
          high: round(e + half, 3),
          field_expected: field,
          remote_inferred_expected: round(expected - field, 3),
        });
      }
    }
  }
  const started = parseIso(cfg.run_created_at.value);
  const run: Rec = {
    ...base(ctx, 'forecast_run', `${cfg.model_version.value}|${date}`, started, started + 240, adminId),
    model_version: cfg.model_version.value,
    engine_version: '0.1.0',
    rule_set_version: 'draft-2026-09',
    status: 'succeeded',
    horizon_start_date: date,
    horizon_days: cfg.horizon_days.value,
    range_coverage: cfg.range_coverage.value,
    illustrative: true,
    input_data_sources: ['SYNTHETIC'],
    started_at: iso(started),
    finished_at: iso(started + 240),
    error_message: null,
  };
  return { runId, run, rows, zoneTotals };
}

export function forecastValueRecord(ctx: Ctx, runId: string, r: ForecastValueRow): Rec {
  const at = parseIso(calibration.fixtures.forecast.run_created_at.value) + 240;
  return {
    ...base(ctx, 'forecast_value', `${r.sub_zone_id}|${r.interval_index}`, at),
    forecast_run_id: runId,
    zone_id: r.zone_id,
    sub_zone_id: r.sub_zone_id,
    interval_start: r.interval_start,
    interval_index: r.interval_index,
    low: r.low,
    expected: r.expected,
    high: r.high,
    field_expected: r.field_expected,
    remote_inferred_expected: r.remote_inferred_expected,
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Rosters
// ---------------------------------------------------------------------------------------------------------------------

export interface GapCellRow {
  zone_id: string;
  interval_start: string;
  interval_index: number;
  required: number;
  planned: number;
  delta: number;
  kind: 'gap' | 'surplus' | 'balanced';
  cause: 'people' | 'vehicles' | 'geography' | null;
  cause_detail?: string;
}

export interface RosterAssignmentFx {
  readonly record: Rec;
  readonly agent: AgentDef;
  readonly duty: Duty;
  readonly zoneCode: string;
  readonly rosterDate: string;
  readonly vehicleId: string | null;
  readonly standbyPointId: string | null;
  readonly rosterId: string;
  readonly isOverride: boolean;
}

export interface RosterFx {
  readonly rosterId: string;
  readonly zoneCode: string;
  readonly zoneId: string;
  readonly date: string;
  readonly status: string;
  readonly record: Rec;
  readonly assignments: RosterAssignmentFx[];
  gaps: GapCellRow[];
}

function requiredFor(ctx: Ctx, zoneId: string, date: string, slot: number): number {
  const zone = ctx.world.zoneById.get(zoneId);
  const city = ctx.world.locations.cities.find((c) => c.id === zone?.city_id);
  if (zone === undefined || city === undefined) throw new Error('zone without city');
  const cases = casesForDate(date) * city.share * zone.demand_weight * (slotWeights()[slot] as number) * FIELD_SHARE;
  return Math.max(MIN_ON_DUTY, Math.ceil((cases * CASE_WORKLOAD_HOURS) / (SLOT_SECONDS / 3600) / TARGET_UTILISATION));
}

/** Field agents of the zone whose shift began the day before and runs past midnight (the night crew). */
function carriedOver(ctx: Ctx, zoneId: string, date: string): Duty[] {
  const previous = addDays(date, -1);
  const out: Duty[] = [];
  for (const s of ctx.world.agents) {
    if (s.work_mode !== 'field' || s.zone_id !== zoneId) continue;
    const duty = dutyOn(s, previous);
    if (duty !== null && duty.end > dayStart(date)) out.push(duty);
  }
  return out;
}

function plannedAt(assignments: readonly RosterAssignmentFx[], carried: readonly Duty[], slotStart: number): number {
  let n = 0;
  const count = (duty: Duty): void => {
    if (slotStart >= duty.start && slotStart < duty.end && !(slotStart >= duty.break_start && slotStart < duty.break_end)) n += 1;
  };
  for (const a of assignments) if (a.agent.work_mode === 'field') count(a.duty);
  for (const duty of carried) count(duty);
  return n;
}

function gapCellsFor(ctx: Ctx, zoneId: string, date: string, assignments: readonly RosterAssignmentFx[]): GapCellRow[] {
  const midnight = dayStart(date);
  const activeVehicles = ctx.world.vehicles.filter((v) => v.zone_id === zoneId && v.status === 'active').length;
  const standbyCount = ctx.world.locations.standbyPoints.filter((p) => p.zone_id === zoneId).length;
  const carried = carriedOver(ctx, zoneId, date);
  const out: GapCellRow[] = [];
  for (let slot = 0; slot < SLOTS_PER_DAY; slot += 1) {
    const start = midnight + slot * SLOT_SECONDS;
    const required = requiredFor(ctx, zoneId, date, slot);
    const planned = plannedAt(assignments, carried, start);
    const delta = planned - required;
    const kind = delta < 0 ? 'gap' : delta > 0 ? 'surplus' : 'balanced';
    let cause: GapCellRow['cause'] = null;
    let detail: string | undefined;
    if (kind !== 'balanced') {
      const onShift = assignments.filter((a) => a.agent.work_mode === 'field' && start >= a.duty.start && start < a.duty.end).length + carried.filter((d) => start >= d.start && start < d.end).length;
      if (onShift > activeVehicles) {
        cause = 'vehicles';
        detail = `${onShift} agents on shift for ${activeVehicles} active vehicles.`;
      } else if (kind === 'gap' && standbyCount <= 3 && Math.abs(delta) === 1) {
        cause = 'geography';
        detail = `Only ${standbyCount} standby points cover the zone.`;
      } else {
        cause = 'people';
        detail = kind === 'gap' ? `${-delta} more agents needed.` : `${delta} more agents than needed.`;
      }
    }
    out.push({
      zone_id: zoneId,
      interval_start: iso(start),
      interval_index: slot,
      required,
      planned,
      delta,
      kind,
      cause,
      ...(detail === undefined ? {} : { cause_detail: detail }),
    });
  }
  return out;
}

/** Which status a roster has, by date and zone (a mix, so every state exists for the demo). */
function rosterStatus(date: string, zoneCode: string, demoToday: string): string | null {
  if (date < demoToday) return 'published';
  if (date === demoToday) return 'published';
  const dayIndex = dateRange(demoToday, date).length - 1; // 1 = tomorrow
  if (dayIndex === 1) return zoneCode === 'RD-C' ? 'submitted' : zoneCode === 'RD-E' ? 'rejected' : 'approved';
  if (dayIndex === 2) return ['RD-N', 'RD-S', 'JD-N'].includes(zoneCode) ? 'approved' : 'draft';
  if (dayIndex <= 5) return 'draft';
  // The last day is left open for the demo: no roster yet for these zones.
  return ['RD-C', 'RD-N', 'JD-N'].includes(zoneCode) ? null : 'draft';
}

export interface RostersFx {
  readonly rosters: RosterFx[];
}

/** After overrides: gap and surplus cells for every roster from the demo day on, and the counts on the roster record. */
export function finalizeRosters(ctx: Ctx, rosters: RostersFx): void {
  for (const r of rosters.rosters) {
    if (r.date < ctx.demoToday) continue;
    r.gaps = gapCellsFor(ctx, r.zoneId, r.date, r.assignments);
    const gapCount = r.gaps.filter((g) => g.kind === 'gap').length;
    r.record['gap_count'] = gapCount;
    r.record['surplus_count'] = r.gaps.filter((g) => g.kind === 'surplus').length;
    r.record['optimizer_status'] = gapCount > 0 ? 'partial' : 'feasible';
  }
}

export function buildRosters(ctx: Ctx, users: readonly UserFx[], forecast: ForecastFx): RostersFx {
  const planner = userByKey(users, 'planner').id;
  const supervisor = userByKey(users, 'dispatch_supervisor').id;
  const supervisorWest = userByKey(users, 'supervisor_west').id;
  const cfg = calibration.fixtures;
  const dates = dateRange(cfg.roster_days.from, cfg.roster_days.to);
  const rosters: RosterFx[] = [];

  for (const date of dates) {
    for (const zone of ctx.world.locations.zones) {
      const status = rosterStatus(date, zone.code, ctx.demoToday);
      if (status === null) continue;
      const rosterId = idOf(ctx, 'roster', `${zone.code}|${date}`);
      const vehicles = vehiclesForZoneDate(ctx.world, zone.id, date);
      const assignments: RosterAssignmentFx[] = [];
      const relevant = ctx.world.agents.filter((s) => (s.work_mode === 'field' ? s.zone_id === zone.id : s.zone_code === zone.code));
      const created = dayStart(date) - 2 * 86400;
      for (const s of relevant) {
        const duty = dutyOn(s, date);
        if (duty === null) continue;
        const field = s.work_mode === 'field';
        const vehicleId = field ? (vehicles.get(s.id) ?? null) : null;
        const standby = field ? s.standby_point_id : null;
        const record: Rec = {
          ...base(ctx, 'roster_assignment', `${s.employee_code}|${date}`, created, created, planner),
          roster_id: rosterId,
          agent_id: s.id,
          shift_pattern_id: shiftPatternId(ctx, s.shift_key),
          zone_id: field ? zone.id : null,
          roster_date: date,
          start_at: iso(duty.start),
          end_at: iso(duty.end),
          vehicle_id: vehicleId,
          break_start_at: iso(duty.break_start),
          break_end_at: iso(duty.break_end),
          standby_point_id: standby,
          is_override: false,
        };
        assignments.push({ record, agent: s, duty, zoneCode: zone.code, rosterDate: date, vehicleId, standbyPointId: standby, rosterId, isOverride: false });
      }
      const forward = date >= ctx.demoToday;
      const decided = status === 'approved' || status === 'published' || status === 'rejected';
      const approverId = zone.city_id === ctx.world.locations.cities[0]?.id ? supervisor : supervisorWest;
      const approvedAt = dayStart(date) - 20 * 3600;
      const record: Rec = {
        ...base(ctx, 'roster', `${zone.code}|${date}`, created, decided ? approvedAt : created, planner),
        zone_id: zone.id,
        roster_date: date,
        status,
        forecast_run_id: date === cfg.forecast.horizon_start.value ? forecast.runId : null,
        planning_level: 'zone',
        optimizer_status: null,
        engine_version: forward ? '0.1.0' : null,
        illustrative: true,
        gap_count: null,
        surplus_count: null,
        approved_by_user_id: status === 'approved' || status === 'published' ? approverId : null,
        approved_at: status === 'approved' || status === 'published' ? iso(approvedAt) : null,
        published_at: status === 'published' ? iso(approvedAt + 1800) : null,
      };
      rosters.push({ rosterId, zoneCode: zone.code, zoneId: zone.id, date, status, record, assignments, gaps: [] });
    }
  }
  return { rosters };
}

// ---------------------------------------------------------------------------------------------------------------------
// Overrides (reason code required), applied to a few forward rosters
// ---------------------------------------------------------------------------------------------------------------------

export function applyOverrides(ctx: Ctx, users: readonly UserFx[], rosters: RostersFx): { overrides: Rec[]; approvals: Rec[] } {
  const planner = userByKey(users, 'planner').id;
  const westPlanner = userByKey(users, 'planner_west').id;
  const supervisor = userByKey(users, 'dispatch_supervisor').id;
  const supervisorWest = userByKey(users, 'supervisor_west').id;
  const find = (zoneCode: string, date: string): RosterFx => {
    const r = rosters.rosters.find((x) => x.zoneCode === zoneCode && x.date === date);
    if (r === undefined) throw new Error(`No roster ${zoneCode} ${date}`);
    return r;
  };
  const pickAssignment = (r: RosterFx, shift: string, nth: number): RosterAssignmentFx => {
    const list = r.assignments.filter((a) => a.agent.work_mode === 'field' && a.agent.shift_key === shift);
    const a = list[nth];
    if (a === undefined) throw new Error(`No ${shift} assignment #${nth} in ${r.zoneCode} ${r.date}`);
    return a;
  };
  const spareAgent = (r: RosterFx, shift: string): AgentDef => {
    const onDuty = new Set(r.assignments.map((a) => a.agent.id));
    const spare = ctx.world.agents.find((s) => s.work_mode === 'field' && s.zone_id === r.zoneId && s.shift_key === shift && !onDuty.has(s.id));
    if (spare === undefined) throw new Error(`No spare ${shift} agent in ${r.zoneCode}`);
    return spare;
  };
  const spareVehicle = (r: RosterFx): string => {
    const used = new Set(r.assignments.map((a) => a.vehicleId));
    const v = ctx.world.vehicles.find((x) => x.zone_id === r.zoneId && x.status === 'active' && !used.has(x.id));
    return (v ?? (ctx.world.vehicles.find((x) => x.zone_id === r.zoneId && x.status === 'active') as { id: string })).id;
  };

  const overrides: Rec[] = [];
  const approvals: Rec[] = [];
  const tomorrow = '2026-09-14';
  const dayAfter = '2026-09-15';
  const inTwo = '2026-09-16';

  type Spec = { key: string; roster: RosterFx; type: string; reason: string; note: string | null; status: 'pending' | 'approved' | 'rejected'; targetIndex: number; by: string; decider: string; before: Rec | null; after: Rec | null; assignmentId: string | null; mutate?: () => void };
  const specs: Spec[] = [];

  // 1. Pending: replace an agent who is unavailable (RD-C, tomorrow).
  {
    const r = find('RD-C', tomorrow);
    const a = pickAssignment(r, 'day_b', 0);
    const spare = spareAgent(r, 'day_b');
    specs.push({ key: 'o1', roster: r, type: 'replace_agent', reason: 'agent_unavailable', note: null, status: 'pending', targetIndex: 0, by: planner, decider: supervisor, before: { agent_id: a.agent.id }, after: { agent_id: spare.id }, assignmentId: a.record['id'] as string });
  }
  // 2. Approved: change a vehicle (RD-N, tomorrow). The roster already shows the new vehicle.
  {
    const r = find('RD-N', tomorrow);
    const a = pickAssignment(r, 'day_a', 1);
    const newVehicle = spareVehicle(r);
    specs.push({
      key: 'o2', roster: r, type: 'change_vehicle', reason: 'vehicle_unavailable', note: null, status: 'approved', targetIndex: 1, by: planner, decider: supervisor,
      before: { vehicle_id: a.vehicleId }, after: { vehicle_id: newVehicle }, assignmentId: a.record['id'] as string,
      mutate: () => {
        (a.record as Record<string, unknown>)['vehicle_id'] = newVehicle;
        (a.record as Record<string, unknown>)['is_override'] = true;
      },
    });
  }
  // 3. Rejected: remove an assignment with a note (RD-E, tomorrow).
  {
    const r = find('RD-E', tomorrow);
    const a = pickAssignment(r, 'night', 0);
    specs.push({ key: 'o3', roster: r, type: 'remove_assignment', reason: 'other', note: 'Requested a lighter night, refused: night cover is already at the minimum.', status: 'rejected', targetIndex: 0, by: planner, decider: supervisor, before: { agent_id: a.agent.id }, after: null, assignmentId: a.record['id'] as string });
  }
  // 4. Approved: add an assignment for an agent who was off (JD-N, tomorrow). The roster already shows the extra agent.
  {
    const r = find('JD-N', tomorrow);
    const spare = spareAgent(r, 'day_b');
    const duty = { ...dutyOnFor(spare, tomorrow) };
    const record: Rec = {
      ...base(ctx, 'roster_assignment', `${spare.employee_code}|${tomorrow}|override`, dayStart(tomorrow) - 2 * 86400, dayStart(tomorrow) - 20 * 3600, westPlanner),
      roster_id: r.rosterId,
      agent_id: spare.id,
      shift_pattern_id: shiftPatternId(ctx, spare.shift_key),
      zone_id: r.zoneId,
      roster_date: tomorrow,
      start_at: iso(duty.start),
      end_at: iso(duty.end),
      vehicle_id: spareVehicle(r),
      break_start_at: iso(duty.break_start),
      break_end_at: iso(duty.break_end),
      standby_point_id: spare.standby_point_id,
      is_override: true,
    };
    r.assignments.push({ record, agent: spare, duty, zoneCode: r.zoneCode, rosterDate: tomorrow, vehicleId: record['vehicle_id'] as string, standbyPointId: spare.standby_point_id, rosterId: r.rosterId, isOverride: true });
    specs.push({ key: 'o4', roster: r, type: 'add_assignment', reason: 'skills_needed', note: null, status: 'approved', targetIndex: 0, by: westPlanner, decider: supervisorWest, before: null, after: { agent_id: spare.id, shift: shiftDef(spare.shift_key).name_en }, assignmentId: record['id'] as string });
  }
  // 5. Pending: change a shift (RD-C, the day after).
  {
    const r = find('RD-C', dayAfter);
    const a = pickAssignment(r, 'day_a', 2);
    specs.push({ key: 'o5', roster: r, type: 'change_shift', reason: 'closer_agent_known', note: null, status: 'pending', targetIndex: 2, by: planner, decider: supervisor, before: { shift: 'Day A' }, after: { shift: 'Day B' }, assignmentId: a.record['id'] as string });
  }
  // 6. Approved: replace an agent at the dispatcher's judgement (DM-C, two days out). Shown as already applied.
  {
    const r = find('DM-C', inTwo);
    const a = pickAssignment(r, 'day_b', 1);
    const spare = spareAgent(r, 'day_b');
    const original = a.agent;
    const duty = dutyOnFor(spare, inTwo);
    (a.record as Record<string, unknown>)['agent_id'] = spare.id;
    (a.record as Record<string, unknown>)['is_override'] = true;
    (a.record as Record<string, unknown>)['standby_point_id'] = spare.standby_point_id;
    (a.record as Record<string, unknown>)['start_at'] = iso(duty.start);
    (a.record as Record<string, unknown>)['end_at'] = iso(duty.end);
    (a.record as Record<string, unknown>)['break_start_at'] = iso(duty.break_start);
    (a.record as Record<string, unknown>)['break_end_at'] = iso(duty.break_end);
    const idx = r.assignments.indexOf(a);
    r.assignments[idx] = { ...a, agent: spare, duty, standbyPointId: spare.standby_point_id, isOverride: true };
    specs.push({ key: 'o6', roster: r, type: 'replace_agent', reason: 'dispatcher_judgement', note: null, status: 'approved', targetIndex: 1, by: westPlanner, decider: supervisorWest, before: { agent_id: original.id }, after: { agent_id: spare.id }, assignmentId: a.record['id'] as string });
  }

  specs.forEach((sp, i) => {
    sp.mutate?.();
    const requestedAt = dayStart(sp.roster.date) - 30 * 3600 + i * 900;
    const decided = sp.status !== 'pending';
    const decidedAt = requestedAt + 3 * 3600;
    const overrideRec = base(ctx, 'override', sp.key, requestedAt, decided ? decidedAt : requestedAt, sp.by);
    overrides.push({
      ...overrideRec,
      roster_id: sp.roster.rosterId,
      roster_assignment_id: sp.assignmentId,
      change_type: sp.type,
      reason_code: sp.reason,
      note: sp.note,
      before: sp.before,
      after: sp.after,
      status: sp.status,
      decided_by_user_id: decided ? sp.decider : null,
      decided_at: decided ? iso(decidedAt) : null,
      decision_note: sp.status === 'rejected' ? 'Night cover is at the minimum.' : sp.status === 'approved' ? 'Approved.' : null,
    });
    approvals.push({
      ...base(ctx, 'approval', `override|${sp.key}`, requestedAt, decided ? decidedAt : requestedAt, sp.by),
      subject_type: 'override',
      subject_id: overrideRec.id,
      status: sp.status,
      summary_en: `Override on ${sp.roster.zoneCode} roster of ${sp.roster.date}: ${sp.type.replace(/_/g, ' ')} (${sp.reason.replace(/_/g, ' ')})`,
      requested_at: iso(requestedAt),
      decided_at: decided ? iso(decidedAt) : null,
      decided_by_user_id: decided ? sp.decider : null,
      decision_note: sp.status === 'rejected' ? 'Night cover is at the minimum.' : sp.status === 'approved' ? 'Approved.' : null,
    });
  });

  // Roster approvals for the forward rosters that have moved through the workflow.
  for (const r of rosters.rosters) {
    if (!['submitted', 'approved', 'rejected'].includes(r.status) || r.date < ctx.demoToday) continue;
    const west = ['JD-N', 'JD-S', 'DM-C'].includes(r.zoneCode);
    const decider = west ? supervisorWest : supervisor;
    const requestedAt = dayStart(r.date) - 26 * 3600;
    const decidedAt = requestedAt + 2 * 3600;
    const st = r.status === 'submitted' ? 'pending' : r.status === 'rejected' ? 'rejected' : 'approved';
    approvals.push({
      ...base(ctx, 'approval', `roster|${r.zoneCode}|${r.date}`, requestedAt, st === 'pending' ? requestedAt : decidedAt, west ? westPlanner : planner),
      subject_type: 'roster',
      subject_id: r.rosterId,
      status: st,
      summary_en: `Roster for ${r.zoneCode} on ${r.date}`,
      requested_at: iso(requestedAt),
      decided_at: st === 'pending' ? null : iso(decidedAt),
      decided_by_user_id: st === 'pending' ? null : decider,
      decision_note: st === 'rejected' ? 'Gaps in the afternoon peak. Please rework.' : null,
    });
  }
  return { overrides, approvals };
}

function dutyOnFor(s: AgentDef, date: string): Duty {
  const own = dutyOn(s, date);
  if (own !== null) return own;
  // The spare agent is off that day; use the shift's normal hours for the day.
  const def = shiftDef(s.shift_key);
  const midnight = dayStart(date);
  const [a, b] = def.normal as readonly [string, string];
  const start = midnight + Number(a.slice(0, 2)) * 3600 + Number(a.slice(3, 5)) * 60;
  let end = midnight + Number(b.slice(0, 2)) * 3600 + Number(b.slice(3, 5)) * 60;
  if (end <= start) end += 86400;
  const breakStart = start + 5 * 3600;
  return { agent_id: s.id, roster_date: date, shift_key: s.shift_key, start, end, break_start: breakStart, break_end: breakStart + 1800 };
}

// ---------------------------------------------------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------------------------------------------------

export interface ScenarioFx {
  readonly key: string;
  readonly id: string;
  readonly record: Rec;
  readonly zoneIds: string[];
}

const STANDARD_PATTERNS = ['day_a', 'day_b', 'night'];

export function buildScenarios(ctx: Ctx, users: readonly UserFx[]): ScenarioFx[] {
  const planner = userByKey(users, 'planner').id;
  const zoneId = (code: string): string => idOf(ctx, 'zone', code);
  const defs: { key: string; name: string; zones: string[]; adj: Rec; status: 'draft' | 'completed'; lastRun: string | null }[] = [
    { key: 'riyadh_plus_four', name: 'Riyadh Central: four more field agents', zones: ['RD-C'], adj: { headcount_delta: [{ zone_id: zoneId('RD-C'), field_agents: 4, remote_agents: 0, vehicles: 2 }], shift_pattern_ids: STANDARD_PATTERNS.map((k) => shiftPatternId(ctx, k)), remote_share: null }, status: 'completed', lastRun: '2026-09-11T10:20:00+03:00' },
    { key: 'ramadan_shifts', name: 'Ramadan shift pattern with an evening shift', zones: ['RD-C', 'RD-N'], adj: { headcount_delta: [], shift_pattern_ids: ['day_a', 'day_b', 'evening', 'night'].map((k) => shiftPatternId(ctx, k)), remote_share: null }, status: 'draft', lastRun: null },
    { key: 'remote_share_35', name: 'Remote share raised to 35 percent', zones: ['RD-C', 'RD-N', 'RD-E', 'RD-S', 'RD-W'], adj: { headcount_delta: [], shift_pattern_ids: STANDARD_PATTERNS.map((k) => shiftPatternId(ctx, k)), remote_share: 0.35 }, status: 'completed', lastRun: '2026-09-12T09:05:00+03:00' },
  ];
  return defs.map((d, i) => {
    const at = parseIso('2026-09-10T09:00:00+03:00') + i * 3600;
    const id = idOf(ctx, 'scenario', d.key);
    return {
      key: d.key,
      id,
      zoneIds: d.zones.map(zoneId),
      record: {
        ...base(ctx, 'scenario', d.key, at, d.lastRun === null ? at : parseIso(d.lastRun), planner),
        name: d.name,
        base_date: '2026-09-14',
        zone_ids: d.zones.map(zoneId),
        adjustments: d.adj,
        status: d.status,
        last_run_at: d.lastRun,
      },
    };
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// Optimizer output (placeholder)
// ---------------------------------------------------------------------------------------------------------------------

export function buildOptimizerOutput(ctx: Ctx, rosters: RostersFx, date: string): Record<string, unknown> {
  const day = rosters.rosters.filter((r) => r.date === date);
  const assignments = day.flatMap((r) => r.assignments);
  const cells = day.flatMap((r) => r.gaps);
  const anyGap = cells.some((c) => c.kind === 'gap');
  return {
    schema_version: '1.0',
    request_id: uuidFor(ctx.seed, 'engine_request', `optimizer|${date}`),
    engine: { name: 'optimizer', version: '0.1.0' },
    model_version: 'placeholder-0.1',
    generated_at: iso(parseIso(calibration.fixtures.forecast.run_created_at.value) + 900),
    data_source: 'SYNTHETIC',
    input_data_sources: ['SYNTHETIC'],
    illustrative: true,
    roster_date: date,
    status: anyGap ? 'partial' : 'feasible',
    run_seconds: 4.2,
    roster_assignments: assignments.map((a) => ({
      agent_id: a.agent.id,
      shift_pattern_id: a.record['shift_pattern_id'],
      zone_id: a.record['zone_id'],
      roster_date: date,
      start_at: a.record['start_at'],
      end_at: a.record['end_at'],
      break_start_at: a.record['break_start_at'],
      break_end_at: a.record['break_end_at'],
      standby_point_id: a.record['standby_point_id'],
    })),
    vehicle_assignments: assignments
      .filter((a) => a.record['vehicle_id'] !== null)
      .map((a) => ({
        vehicle_id: a.record['vehicle_id'],
        agent_id: a.agent.id,
        zone_id: a.record['zone_id'],
        roster_date: date,
        shift_pattern_id: a.record['shift_pattern_id'],
      })),
    gap_cells: cells,
    violations: [],
  };
}

