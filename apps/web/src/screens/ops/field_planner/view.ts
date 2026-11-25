// SPDX-License-Identifier: AGPL-3.0-only
// Field Planner view model (server only)

import { addDays } from '@/lib/day';
import { checkApproval, type ApprovalDenial } from '@/lib/access';
import {
  getGapSurplus,
  getNetAvailability,
  getRosterWeek,
  listRosterAssignments,
  listRosterOverrides,
  listRosters,
} from '@/lib/data/rosters';
import { listZones } from '@/lib/data/locations';
import { gapRowBlocksOf } from './gapRow';
import { overrideChangeLabel } from './overrideLabel';
import { rosterSourceOf, type RosterSource, type SolverStatus } from './source';
import { listApprovals } from '@/lib/data/notifications';
import { getDemoToday, getSettingsSnapshot } from '@/lib/data/settings';
import { listShiftPatterns } from '@/lib/data/time';
import { listAgents, listVehicles } from '@/lib/data/people';
import { listUserDisplayNames } from '@/lib/data/users';
import type { RequestContext } from '@/lib/data/guard';
import type {
  DataSource,
  Override,
  OverrideChangeType,
  OverrideReasonCode,
  Roster,
  RosterAssignment,
  ShiftPattern,
  Agent,
  Vehicle,
  Zone,
} from '@/lib/types';
import type { RosterBlock, RosterRow } from '@/components/opendispatch/RosterGrid';

/** Rosters a person can still act on today, most actionable first, for the default zone pick. */
const ACTIONABLE_ORDER: readonly Roster['status'][] = ['submitted', 'draft', 'rejected', 'approved', 'building', 'published', 'superseded'];

export interface PickerOption {
  readonly id: string;
  readonly code: string;
  readonly name: string;
}

export type RosterActionReason = 'own' | 'notPending' | 'approved' | 'needApprove' | 'notDraft' | 'needSubmit' | null;

export interface ApprovalBarView {
  readonly status: Roster['status'];
  readonly submittedByName: string | null;
  readonly submittedByIsMe: boolean;
  readonly submittedDate: string | null;
  readonly approvedByName: string | null;
  readonly approvedByIsMe: boolean;
  readonly approvedDate: string | null;
  readonly publishedDate: string | null;
  readonly canApprove: boolean;
  readonly canReject: boolean;
  readonly canSubmit: boolean;
  readonly canPublish: boolean;
  readonly approveReason: RosterActionReason;
  readonly rejectReason: RosterActionReason;
  readonly submitReason: RosterActionReason;
  readonly publishReason: RosterActionReason;
}

export interface OverrideRowView {
  readonly id: string;
  readonly changeType: OverrideChangeType;
  readonly changeLabel: string;
  readonly changeIsData: boolean;
  readonly reasonCode: OverrideReasonCode;
  readonly note: string | null;
  readonly byName: string;
  readonly own: boolean;
  readonly status: Override['status'];
  readonly canDecide: boolean;
  readonly deciderName: string | null;
}

export interface VehicleRowView {
  readonly id: string;
  readonly plate: string;
  readonly code: string;
  /** By shift pattern id: the agent's name, or null (unassigned). */
  readonly byShift: Readonly<Record<string, string | null>>;
}

export interface AssignmentOption {
  readonly id: string;
  readonly label: string;
}

export interface OverrideDrawerOptions {
  readonly assignments: readonly AssignmentOption[];
  readonly availableAgents: readonly PickerOption[];
  readonly vehicles: readonly PickerOption[];
  readonly shiftPatterns: readonly PickerOption[];
}

export interface RosterView {
  readonly id: string;
  readonly status: Roster['status'];
  readonly source: RosterSource | null;
  /** Optimizer engine version, when it ran. */
  readonly engineVersion: string | null;
  /** The model that ran and its proof. */
  readonly optimizerModel: string | null;
  readonly solverStatus: SolverStatus | null;
  readonly stats: { readonly agents: number; readonly gapIntervals: number; readonly surplusIntervals: number; readonly pendingOverrides: number };
  readonly approval: ApprovalBarView;
  readonly gridRows: readonly RosterRow[];
  readonly overrides: readonly OverrideRowView[];
  readonly vehicleRows: readonly VehicleRowView[];
  readonly shiftColumns: readonly PickerOption[];
  readonly drawer: OverrideDrawerOptions;
}

export interface FieldPlannerView {
  readonly zone: PickerOption;
  readonly zoneOptions: readonly PickerOption[];
  readonly date: string;
  readonly prevDate: string;
  readonly nextDate: string;
  readonly sources: readonly DataSource[];
  readonly roster: RosterView | undefined;
  /** The prayer policy, for the legend. */
  readonly prayerPolicy: 'clear_of_prayer' | 'lined_up_with_prayer';
}

// Small pure helpers


function zoneCode(zone: Zone): string {
  return typeof zone.extra?.['code'] === 'string' ? zone.extra['code'] : zone.id;
}

function pickerOf(zone: Zone): PickerOption {
  return { id: zone.id, code: zoneCode(zone), name: zone.name_en };
}

/** Hours from the midnight that starts `rosterDate`; past 24 for a time on the next calendar day (a night shift). */
function hoursFrom(rosterDate: string, iso: string): number {
  const base = Date.parse(`${rosterDate}T00:00:00+03:00`);
  return (Date.parse(iso) - base) / 3_600_000;
}

function localizedName(record: { readonly name_en: string; readonly name_ar?: string | null | undefined }, locale: 'en' | 'ar'): string {
  return locale === 'ar' && record.name_ar !== null && record.name_ar !== undefined && record.name_ar.trim() !== '' ? record.name_ar : record.name_en;
}

// Zone and date defaulting

function bestZoneFor(zones: readonly Zone[], rostersByZone: ReadonlyMap<string, Roster>): Zone | undefined {
  let best: { zone: Zone; rank: number } | undefined;
  for (const zone of zones) {
    const roster = rostersByZone.get(zone.id);
    const rank = roster === undefined ? ACTIONABLE_ORDER.length : ACTIONABLE_ORDER.indexOf(roster.status);
    if (best === undefined || rank < best.rank || (rank === best.rank && zone.name_en.localeCompare(best.zone.name_en) < 0)) {
      best = { zone, rank };
    }
  }
  return best?.zone;
}

// Names

async function namesOf(ctx: RequestContext, ids: readonly (string | null | undefined)[]): Promise<Map<string, string>> {
  const wanted = [...new Set(ids.filter((id): id is string => typeof id === 'string'))];
  const names = new Map<string, string>();
  const CHUNK = 100;
  for (let start = 0; start < wanted.length; start += CHUNK) {
    for (const person of (await listUserDisplayNames(ctx, wanted.slice(start, start + CHUNK))).items) names.set(person.id, person.display_name);
  }
  return names;
}

// Roster grid rows

interface GridResult {
  readonly rows: RosterRow[];
  readonly gapIntervals: number;
  readonly surplusIntervals: number;
}

async function gridRowsOf(ctx: RequestContext, zone: Zone, date: string, rosterId: string, assignments: readonly RosterAssignment[], patternsById: ReadonlyMap<string, ShiftPattern>, agentsById: ReadonlyMap<string, Agent>, vehiclesById: ReadonlyMap<string, Vehicle>, locale: 'en' | 'ar'): Promise<GridResult> {
  const rows: RosterRow[] = [...assignments]
    .sort((a, b) => a.start_at.localeCompare(b.start_at) || a.id.localeCompare(b.id))
    .map((line) => {
      const agent = agentsById.get(line.agent_id);
      const pattern = patternsById.get(line.shift_pattern_id);
      const vehicle = line.vehicle_id === null || line.vehicle_id === undefined ? undefined : vehiclesById.get(line.vehicle_id);
      const from = hoursFrom(date, line.start_at);
      const to = hoursFrom(date, line.end_at);
      const shiftLabel = pattern === undefined ? '' : localizedName(pattern, locale);
      const blocks: RosterBlock[] = [
        { kind: line.is_override ? 'override' : 'shift', from, to, label: shiftLabel, tip: `${shiftLabel} ${vehicle?.plate_number ?? vehicle?.code ?? ''}`.trim() },
      ];
      if (line.break_start_at !== null && line.break_start_at !== undefined && line.break_end_at !== null && line.break_end_at !== undefined) {
        blocks.push({ kind: 'break', from: hoursFrom(date, line.break_start_at), to: hoursFrom(date, line.break_end_at), label: '' });
      }
      const sub = `${shiftLabel} · ${vehicle?.plate_number ?? vehicle?.code ?? '—'}`;
      return { id: line.id, name: agent?.name_en ?? line.agent_id, sub, subIsData: true, blocks };
    });

  const gap = await getGapSurplus(ctx, { roster_id: rosterId });
  const zoneCells = gap.cells.filter((c) => c.zone_id === zone.id && c.kind !== 'balanced');
  const shortfalls = new Map<number, number>(zoneCells.filter((c) => c.kind === 'gap').map((c) => [c.interval_index, Math.abs(c.delta)] as const));
  rows.push({ id: 'gap-row', name: '', nameIsData: false, sub: undefined, blocks: gapRowBlocksOf(shortfalls) });

  return { rows, gapIntervals: zoneCells.filter((c) => c.kind === 'gap').length, surplusIntervals: zoneCells.filter((c) => c.kind === 'surplus').length };
}

// Main loader

export interface FieldPlannerQuery {
  readonly zone?: string | undefined;
  readonly date?: string | undefined;
}

export async function loadFieldPlannerView(ctx: RequestContext, query: FieldPlannerQuery, locale: 'en' | 'ar'): Promise<FieldPlannerView> {
  const zones = (await listZones(ctx, { limit: 200 })).items;
  const today = await getDemoToday(ctx);
  const date = query.date ?? addDays(today, 1);

  const rostersOnDate = (await listRosters(ctx, { date, limit: 200 })).items;
  const rostersByZone = new Map(rostersOnDate.map((r) => [r.zone_id, r] as const));

  const requestedZone = query.zone === undefined ? undefined : zones.find((z: Zone) => z.id === query.zone);
  const zone = requestedZone ?? bestZoneFor(zones, rostersByZone) ?? zones[0];

  const sources: DataSource[] = ['SYNTHETIC'];
  const prayerPolicy = (await getSettingsSnapshot(ctx)).break_prayer_policy ?? 'clear_of_prayer';
  if (zone === undefined) {
    return { zone: { id: '', code: '', name: '' }, zoneOptions: [], date, prevDate: addDays(date, -1), nextDate: addDays(date, 1), sources, roster: undefined, prayerPolicy };
  }

  const zoneOptions = zones.map(pickerOf).sort((a: PickerOption, b: PickerOption) => a.name.localeCompare(b.name));
  const roster = rostersByZone.get(zone.id);

  if (roster === undefined) {
    return { zone: pickerOf(zone), zoneOptions, date, prevDate: addDays(date, -1), nextDate: addDays(date, 1), sources, roster: undefined, prayerPolicy };
  }

  // Remote pool rows have zone_id null; exclude.
  const allAssignments = (await listRosterAssignments(ctx, roster.id, { limit: 200 })).items;
  const assignments = allAssignments.filter((a) => a.zone_id !== null && a.zone_id !== undefined);
  const overrides = (await listRosterOverrides(ctx, roster.id, { limit: 200 })).items;
  const patterns = (await listShiftPatterns(ctx, { limit: 200 })).items.filter((p) => p.kind === 'field' && p.status === 'active');
  const patternsById = new Map(patterns.map((p) => [p.id, p] as const));
  const vehicles = (await listVehicles(ctx, { zone_id: zone.id, limit: 200 })).items;
  const vehiclesById = new Map(vehicles.map((v) => [v.id, v] as const));
  const zoneAgents = (await listAgents(ctx, { zone_id: zone.id, kind: 'field', is_active: true, limit: 200 })).items;
  const agentsById = new Map(zoneAgents.map((s) => [s.id, s] as const));

  const assignedAgentIds = new Set(assignments.map((a) => a.agent_id));
  const grid = await gridRowsOf(ctx, zone, date, roster.id, assignments, patternsById, agentsById, vehiclesById, locale);

  // Approval bar: the roster latest approval
  const rosterApprovals = (await listApprovals(ctx, { subject_type: 'roster', limit: 200 })).items.filter((a) => a.subject_id === roster.id);
  const latestApproval = [...rosterApprovals].sort((a, b) => b.requested_at.localeCompare(a.requested_at))[0];
  const pendingApproval = rosterApprovals.find((a) => a.status === 'pending');
  const names = await namesOf(ctx, [latestApproval?.created_by, roster.approved_by_user_id]);
  const submitterId = latestApproval?.created_by ?? null;
  const approveCheck = pendingApproval === undefined ? undefined : checkApproval({ role: ctx.role, requesterUserId: submitterId ?? 'system', approverUserId: ctx.userId, kind: 'roster_override', installMode: ctx.installMode });
  const reasonOf = (denial: ApprovalDenial | undefined): RosterActionReason => (denial === 'own_request' ? 'own' : denial === undefined ? null : 'notPending');

  const approval: ApprovalBarView = {
    status: roster.status,
    submittedByName: submitterId === null ? null : (names.get(submitterId) ?? null),
    submittedByIsMe: submitterId === ctx.userId,
    submittedDate: latestApproval?.requested_at.slice(0, 10) ?? null,
    approvedByName: roster.approved_by_user_id === null || roster.approved_by_user_id === undefined ? null : (names.get(roster.approved_by_user_id) ?? null),
    approvedByIsMe: roster.approved_by_user_id === ctx.userId,
    approvedDate: roster.approved_at?.slice(0, 10) ?? null,
    publishedDate: roster.published_at?.slice(0, 10) ?? null,
    canApprove: roster.status === 'submitted' && (approveCheck?.allowed ?? false),
    canReject: roster.status === 'submitted' && (approveCheck?.allowed ?? false),
    canSubmit: roster.status === 'draft' || roster.status === 'rejected',
    canPublish: roster.status === 'approved',
    approveReason: roster.status !== 'submitted' ? (roster.status === 'approved' ? 'approved' : 'notPending') : reasonOf(approveCheck?.allowed === true ? undefined : approveCheck?.reason),
    rejectReason: roster.status !== 'submitted' ? (roster.status === 'approved' ? 'approved' : 'notPending') : reasonOf(approveCheck?.allowed === true ? undefined : approveCheck?.reason),
    submitReason: roster.status === 'draft' || roster.status === 'rejected' ? null : 'notDraft',
    publishReason: roster.status === 'approved' ? null : 'needApprove',
  };

  // ---- Overrides tab ----
  const overrideNameIds = overrides.flatMap((o) => [o.created_by, o.decided_by_user_id]);
  const overrideNames = await namesOf(ctx, overrideNameIds);
  const assignmentsById = new Map(assignments.map((a) => [a.id, a] as const));
  const overrideRows: OverrideRowView[] = [...overrides]
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .map((o) => {
      const target = o.roster_assignment_id === null || o.roster_assignment_id === undefined ? undefined : assignmentsById.get(o.roster_assignment_id);
      const targetName = target === undefined ? null : (agentsById.get(target.agent_id)?.name_en ?? null);
      const changeLabel = overrideChangeLabel(o, targetName, (id) => agentsById.get(id)?.name_en ?? null);
      const requesterId = o.created_by;
      const own = requesterId !== null && requesterId !== undefined && requesterId === ctx.userId;
      const check = o.status === 'pending' ? checkApproval({ role: ctx.role, requesterUserId: requesterId ?? 'system', approverUserId: ctx.userId, kind: 'roster_override', installMode: ctx.installMode }) : undefined;
      return {
        id: o.id,
        changeType: o.change_type,
        changeLabel,
        changeIsData: true,
        reasonCode: o.reason_code,
        note: o.note ?? null,
        byName: requesterId === null || requesterId === undefined ? '—' : (overrideNames.get(requesterId) ?? '—'),
        own,
        status: o.status,
        canDecide: o.status === 'pending' && (check?.allowed ?? false),
        deciderName: o.decided_by_user_id === null || o.decided_by_user_id === undefined ? null : (overrideNames.get(o.decided_by_user_id) ?? null),
      };
    });

  // ---- Vehicles tab ----
  const shiftColumns: PickerOption[] = patterns
    .filter((p) => assignments.some((a) => a.shift_pattern_id === p.id))
    .sort((a, b) => a.code.localeCompare(b.code))
    .map((p) => ({ id: p.id, code: p.code, name: localizedName(p, locale) }));
  const vehicleRows: VehicleRowView[] = [...vehicles]
    .sort((a, b) => (a.plate_number ?? a.code).localeCompare(b.plate_number ?? b.code))
    .map((vehicle) => {
      const byShift: Record<string, string | null> = {};
      for (const column of shiftColumns) {
        const line = assignments.find((a) => a.vehicle_id === vehicle.id && a.shift_pattern_id === column.id);
        byShift[column.id] = line === undefined ? null : (agentsById.get(line.agent_id)?.name_en ?? null);
      }
      return { id: vehicle.id, plate: vehicle.plate_number ?? vehicle.code, code: vehicle.code, byShift };
    });

  // ---- Override drawer options ----
  const assignmentOptions: AssignmentOption[] = [...assignments]
    .sort((a, b) => a.start_at.localeCompare(b.start_at))
    .map((a) => {
      const agent = agentsById.get(a.agent_id);
      const pattern = patternsById.get(a.shift_pattern_id);
      return { id: a.id, label: `${agent?.name_en ?? a.agent_id} · ${pattern === undefined ? '' : localizedName(pattern, locale)}`.trim() };
    });
  const availableAgents: PickerOption[] = zoneAgents
    .filter((s) => !assignedAgentIds.has(s.id))
    .sort((a, b) => a.name_en.localeCompare(b.name_en))
    .map((s) => ({ id: s.id, code: s.code, name: localizedName(s, locale) }));
  const vehicleOptions: PickerOption[] = vehicles
    .filter((v) => v.is_active)
    .sort((a, b) => (a.plate_number ?? a.code).localeCompare(b.plate_number ?? b.code))
    .map((v) => ({ id: v.id, code: v.code, name: v.plate_number ?? v.code }));
  const shiftPatternOptions: PickerOption[] = patterns.map((p) => ({ id: p.id, code: p.code, name: localizedName(p, locale) }));

  return {
    zone: pickerOf(zone),
    zoneOptions,
    date,
    prevDate: addDays(date, -1),
    nextDate: addDays(date, 1),
    sources,
    prayerPolicy,
    roster: {
      id: roster.id,
      status: roster.status,
      source: rosterSourceOf(roster),
      engineVersion: roster.engine_version ?? null,
      optimizerModel: roster.optimizer_model ?? null,
      solverStatus: roster.solver_status ?? null,
      stats: {
        agents: assignments.length,
        gapIntervals: grid.gapIntervals,
        surplusIntervals: grid.surplusIntervals,
        pendingOverrides: overrides.filter((o) => o.status === 'pending').length,
      },
      approval,
      gridRows: grid.rows,
      overrides: overrideRows,
      vehicleRows,
      shiftColumns,
      drawer: { assignments: assignmentOptions, availableAgents, vehicles: vehicleOptions, shiftPatterns: shiftPatternOptions },
    },
  };
}

// Week view

export type WeekCellState = 'buildable' | 'kept' | 'passed' | 'too_far';

export interface WeekCellView {
  readonly date: string;
  readonly state: WeekCellState;
  readonly status: Roster['status'] | null;
  readonly agents: number;
  readonly gaps: number | null;
  readonly href: string;
}

export interface WeekZoneView {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly cells: readonly WeekCellView[];
}

export interface AvailabilityRowView {
  readonly id: string;
  readonly zoneCode: string;
  readonly zoneName: string;
  readonly shiftName: string;
  readonly agents: number;
  readonly shiftHours: number;
  readonly leaveRestHours: number;
  readonly sickHours: number;
  readonly breakPrayerHours: number;
  readonly netHours: number;
}

export interface FieldPlannerWeekView {
  readonly weekStart: string;
  readonly days: readonly string[];
  readonly prevWeek: string;
  readonly nextWeek: string;
  readonly zones: readonly WeekZoneView[];
  readonly availability: readonly AvailabilityRowView[];
  readonly stats: { readonly built: number; readonly cells: number; readonly shifts: number; readonly gaps: number; readonly netHours: number };
  readonly limits: { readonly maxDays: number; readonly maxHours: number };
  readonly sources: readonly DataSource[];
  readonly canBuild: boolean;
  readonly canSubmit: boolean;
  readonly canPublish: boolean;
}

const dayHref = (zoneId: string, date: string): string => `/ops/field-planner?${new URLSearchParams({ zone: zoneId, date }).toString()}`;
const tenth = (n: number): number => Math.round(n * 10) / 10;

export async function loadFieldPlannerWeekView(ctx: RequestContext, query: { readonly date?: string | undefined }, locale: 'en' | 'ar'): Promise<FieldPlannerWeekView> {
  const today = await getDemoToday(ctx);
  const week = await getRosterWeek(ctx, query.date ?? addDays(today, 1));
  const availability = await getNetAvailability(ctx, { week_start: week.week_start });
  const zonesById = new Map((await listZones(ctx, { limit: 200 })).items.map((z: Zone) => [z.id, z] as const));
  const patternsById = new Map((await listShiftPatterns(ctx, { limit: 200 })).items.map((p) => [p.id, p] as const));

  const zones: WeekZoneView[] = week.zones.map((row) => {
    const zone = zonesById.get(row.zone_id);
    return {
      id: row.zone_id,
      code: zone === undefined ? row.zone_id : zoneCode(zone),
      name: zone?.name_en ?? '',
      cells: row.cells.map((cell) => ({
        date: cell.roster_date,
        state: cell.state,
        status: cell.roster?.status ?? null,
        agents: cell.agents,
        gaps: cell.roster?.gap_count ?? null,
        href: dayHref(row.zone_id, cell.roster_date),
      })),
    };
  });
  const rows: AvailabilityRowView[] = availability.rows.map((r) => {
    const zone = zonesById.get(r.zone_id);
    const pattern = patternsById.get(r.shift_pattern_id);
    return {
      id: `${r.zone_id}:${r.shift_pattern_id}`,
      zoneCode: zone === undefined ? r.zone_id : zoneCode(zone),
      zoneName: zone?.name_en ?? '',
      shiftName: pattern === undefined ? '' : localizedName(pattern, locale),
      agents: r.agents,
      shiftHours: r.shift_hours,
      leaveRestHours: tenth(r.leave_hours + r.rest_hours),
      sickHours: r.sick_hours,
      breakPrayerHours: tenth(r.break_hours + r.prayer_hours),
      netHours: r.net_hours,
    };
  });
  rows.sort((a, b) => a.zoneCode.localeCompare(b.zoneCode) || a.shiftName.localeCompare(b.shiftName));
  const cells = zones.flatMap((z) => z.cells);
  return {
    weekStart: week.week_start,
    days: week.days,
    prevWeek: addDays(week.week_start, -7),
    nextWeek: addDays(week.week_start, 7),
    zones,
    availability: rows,
    stats: {
      built: cells.filter((c) => c.status !== null).length,
      cells: cells.length,
      shifts: cells.reduce((n, c) => n + c.agents, 0),
      gaps: cells.reduce((n, c) => n + (c.gaps ?? 0), 0),
      netHours: Math.round(rows.reduce((n, r) => n + r.netHours, 0)),
    },
    limits: { maxDays: week.limits.max_days_per_week, maxHours: week.limits.max_hours_per_week },
    sources: availability.data_sources.length === 0 ? ['SYNTHETIC'] : availability.data_sources,
    canBuild: cells.some((c) => c.state === 'buildable'),
    canSubmit: cells.some((c) => c.status === 'draft' || c.status === 'rejected'),
    canPublish: cells.some((c) => c.status === 'approved'),
  };
}
