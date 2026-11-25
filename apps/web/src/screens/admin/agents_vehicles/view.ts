// SPDX-License-Identifier: AGPL-3.0-only
// The server side of the Agents and Vehicles screen: reads through lib/data with the request context and returns plain data
//. Not a Server Component and not an action: `Screen.tsx` calls it, and the tests call it directly.
//
// Reads: listAgents, listAllAgentSkills (every page, one batch), listVehicles, getSkillVocabulary, listLeaveRequests and
// listShiftPatterns (the leave and shift columns), listZones and listStandbyPoints (names), getAgentsImportSample (only while the
// import dialog is open). The shift, the days off and the standby point of an agent are in `extra` (`home_shift`, `days_off`,
// `standby_point_id`); a vehicle's type is `extra.vehicle_type`.

import { ForbiddenError } from '@/lib/data/errors';
import type { RequestContext } from '@/lib/data/guard';
import { listLeaveRequests } from '@/lib/data/leave';
import { listStandbyPoints, listZones } from '@/lib/data/locations';
import { getSkillVocabulary } from '@/lib/data/settings';
import { getAgentsImportSample, listAllAgentSkills, listAgents, listVehicles } from '@/lib/data/people';
import { listShiftPatterns } from '@/lib/data/time';
import { getDemoToday } from '@/lib/data/settings';
import { listVehicleMaintenance } from '@/lib/data/vehicle-maintenance';
import type { MaintenanceByVehicle, MaintenanceItem } from './maintenance-types';
import type { DataSource, Extra, PageInfo, Vehicle, Zone } from '@/lib/types';
import { DAYS, LEAVE_STATUSES, REMOTE_POOL, VEHICLE_TYPES, type Day, type LeaveItem, type LeaveStatus, type ShiftChoice, type SkillRow, type StandbyChoice, type AgentRow, type VehicleRow, type VehicleType, type ZoneChoice } from './types';

/** What the address bar may ask for (already validated by parseSearchParams). */
export interface AgentsQuery {
  readonly q?: string | undefined;
  /** A zone code such as RD-C, or `remote` for the pool. */
  readonly zone?: string | undefined;
  readonly shift?: string | undefined;
  readonly leave?: LeaveStatus | undefined;
  /** `?agent=` and `?vehicle=`: the record to open (an id; `new` opens no record). */
  readonly agent?: string | undefined;
  readonly vehicle?: string | undefined;
}

export interface AgentsView {
  readonly sources: readonly DataSource[];
  readonly totals: { readonly agents: number; readonly field: number; readonly remote: number; readonly vehicles: number; readonly skills: number };
  /** The agents matching the search and filters. */
  readonly agents: readonly AgentRow[];
  /** The vehicles matching the search and the zone filter. */
  readonly vehicles: readonly VehicleRow[];
  readonly skills: readonly SkillRow[];
  readonly zones: readonly ZoneChoice[];
  readonly shifts: readonly ShiftChoice[];
  /** Every vehicle and standby point, for the agent form's choices. */
  readonly allVehicles: readonly VehicleRow[];
  readonly standby: readonly StandbyChoice[];
  /** Only when the import dialog is open: the sample file of "Use a sample file". */
  readonly sample: { readonly fileName: string; readonly text: string } | undefined;
  /** The record `?agent=` or `?vehicle=` opens; undefined when there is none, it is `new`, or it does not exist. */
  readonly openAgent: AgentRow | undefined;
  readonly openVehicle: VehicleRow | undefined;
  /** An id was asked for that names no record: the screen says so above the list. */
  readonly unknownRecord: boolean;
  readonly exportHeader: readonly string[];
  readonly exportRows: readonly (readonly string[])[];
  // Spec 4.4: maintenance windows by vehicle id.
  readonly maintenance: MaintenanceByVehicle;
}

const PAGE = 200;

async function listAll<T>(fetch: (cursor: string | undefined) => { items: T[]; page: PageInfo } | Promise<{ items: T[]; page: PageInfo }>): Promise<T[]> {
  const out: T[] = [];
  let cursor: string | undefined;
  do {
    const page = await fetch(cursor);
    out.push(...page.items);
    cursor = page.page.has_more ? (page.page.next_cursor ?? undefined) : undefined;
  } while (cursor !== undefined);
  return out;
}

const text = (extra: Extra | undefined, key: string): string | null => {
  const value = extra?.[key];
  return typeof value === 'string' && value !== '' ? value : null;
};
const isDay = (value: unknown): value is Day => (DAYS as readonly unknown[]).includes(value);
const daysOf = (extra: Extra | undefined): Day[] => (Array.isArray(extra?.['days_off']) ? (extra['days_off'] as unknown[]).filter(isDay) : []);
const isType = (value: string | null): value is VehicleType => (VEHICLE_TYPES as readonly (string | null)[]).includes(value);
const zoneCodeOf = (zone: Zone): string => text(zone.extra, 'code') ?? zone.name_en;

/** Leave is `ops.leave_planner`: a role without it sees no leave column rather than an error. */
async function leaveByPerson(ctx: RequestContext): Promise<Map<string, LeaveItem[]>> {
  const out = new Map<string, LeaveItem[]>();
  try {
    for (const l of await listAll((cursor) => listLeaveRequests(ctx, { limit: PAGE, ...(cursor === undefined ? {} : { cursor }) }))) {
      if (!(LEAVE_STATUSES as readonly string[]).includes(l.status)) continue;
      const items = out.get(l.agent_id) ?? [];
      items.push({ type: l.leave_type, status: l.status as LeaveStatus, from: l.start_date, to: l.end_date });
      out.set(l.agent_id, items);
    }
  } catch (error) {
    if (!(error instanceof ForbiddenError)) throw error;
  }
  return out;
}

/** Approved annual leave days inside the year. */
export function annualTaken(items: readonly LeaveItem[], year: string): number {
  const first = Date.parse(`${year}-01-01T00:00:00Z`);
  const last = Date.parse(`${year}-12-31T00:00:00Z`);
  let days = 0;
  for (const l of items) {
    if (l.type !== 'annual' || l.status !== 'approved') continue;
    const from = Math.max(first, Date.parse(`${l.from}T00:00:00Z`));
    const to = Math.min(last, Date.parse(`${l.to}T00:00:00Z`));
    if (to >= from) days += Math.round((to - from) / 86_400_000) + 1;
  }
  return days;
}

const matches = (query: string | undefined, ...parts: readonly (string | null | undefined)[]): boolean => query === undefined || query.trim() === '' || parts.join(' ').toLowerCase().includes(query.trim().toLowerCase());

// Windows open on the demo day are active.
async function maintenanceByVehicle(ctx: RequestContext): Promise<MaintenanceByVehicle> {
  const today = await getDemoToday(ctx);
  const dayStart = Date.parse(`${today}T00:00:00+03:00`);
  const dayEnd = dayStart + 86_400_000;
  const out: Record<string, MaintenanceItem[]> = {};
  for (const w of await listAll((cursor) => listVehicleMaintenance(ctx, { limit: PAGE, ...(cursor === undefined ? {} : { cursor }) }))) {
    const active = Date.parse(w.starts_at) < dayEnd && Date.parse(w.ends_at) > dayStart;
    (out[w.vehicle_id] ??= []).push({ id: w.id, from: w.starts_at, to: w.ends_at, reason: w.reason, active });
  }
  return out;
}

export async function loadAgentsView(ctx: RequestContext, query: AgentsQuery, canEdit: boolean, importOpen: boolean): Promise<AgentsView> {
  const zones = await listAll((cursor) => listZones(ctx, { limit: PAGE, ...(cursor === undefined ? {} : { cursor }) }));
  const vehicles = await listAll((cursor) => listVehicles(ctx, { limit: PAGE, ...(cursor === undefined ? {} : { cursor }) }));
  const agents = await listAll((cursor) => listAgents(ctx, { limit: PAGE, ...(cursor === undefined ? {} : { cursor }) }));
  const patterns = await listAll((cursor) => listShiftPatterns(ctx, { limit: PAGE, ...(cursor === undefined ? {} : { cursor }) }));
  const standbyPoints = await listAll((cursor) => listStandbyPoints(ctx, { limit: PAGE, ...(cursor === undefined ? {} : { cursor }) }));
  const vocabulary = await getSkillVocabulary(ctx);
  const leave = await leaveByPerson(ctx);
  const year = (await getDemoToday(ctx)).slice(0, 4);

  const zoneCode = new Map(zones.map((z) => [z.id, zoneCodeOf(z)] as const));
  // An agent keeps its shift as `extra.home_shift` in snake case (`day_a`); the shift patterns are coded `DAY-A`.
  const shiftKey = (code: string): string => code.toLowerCase().replaceAll('-', '_');
  const shiftName = new Map(patterns.map((p) => [shiftKey(p.code), p.name_en] as const));
  const vehicleById = new Map<string, Vehicle>(vehicles.map((v) => [v.id, v] as const));
  const owner = new Map<string, string>();
  for (const s of agents) if (s.default_vehicle_id !== null && s.default_vehicle_id !== undefined) owner.set(s.default_vehicle_id, s.name_en);

  const wantedZone = query.zone === undefined || query.zone === REMOTE_POOL ? undefined : zones.find((z) => zoneCodeOf(z) === query.zone)?.id;
  const zoneFilterActive = query.zone !== undefined && (query.zone === REMOTE_POOL || wantedZone !== undefined);

  const rowOf = (s: (typeof agents)[number], skills: readonly string[]): AgentRow => {
    const shift = text(s.extra, 'home_shift');
    const vehicle = s.default_vehicle_id === null || s.default_vehicle_id === undefined ? undefined : vehicleById.get(s.default_vehicle_id);
    return {
      id: s.id,
      code: s.code,
      name: s.name_en,
      nameAr: s.name_ar,
      kind: s.kind,
      zoneId: s.home_zone_id,
      zoneCode: s.home_zone_id === null ? null : (zoneCode.get(s.home_zone_id) ?? null),
      shiftCode: shift,
      shiftName: shift === null ? null : (shiftName.get(shift) ?? shift),
      vehicleId: vehicle?.id ?? null,
      vehicleCode: vehicle?.code ?? null,
      skills,
      daysOff: daysOf(s.extra),
      standbyPointId: text(s.extra, 'standby_point_id'),
      active: s.is_active,
      leave: leave.get(s.id) ?? [],
      eligibleShiftIds: s.eligible_shift_pattern_ids ?? [],
      annualLeaveDays: s.annual_leave_days ?? null,
      annualLeaveTaken: annualTaken(leave.get(s.id) ?? [], year),
    };
  };

  const inZone = (s: (typeof agents)[number]): boolean => !zoneFilterActive || (query.zone === REMOTE_POOL ? s.home_zone_id === null : s.home_zone_id === wantedZone);
  const shown = agents.filter(
    (s) =>
      inZone(s) &&
      (query.shift === undefined || text(s.extra, 'home_shift') === query.shift) &&
      (query.leave === undefined || (leave.get(s.id) ?? []).some((l) => l.status === query.leave)) &&
      matches(query.q, s.name_en, s.name_ar, s.code),
  );
  const skillRows = await listAll((cursor) => listAllAgentSkills(ctx, { limit: PAGE, ...(cursor === undefined ? {} : { cursor }) }));
  const skillsOf = new Map<string, string[]>(agents.map((s) => [s.id, []] as const));
  for (const k of skillRows) skillsOf.get(k.agent_id)?.push(k.skill_code);
  const shownRows = shown.map((s) => rowOf(s, skillsOf.get(s.id) ?? []));

  const vehicleRow = (v: Vehicle): VehicleRow => {
    const type = text(v.extra, 'vehicle_type');
    return { id: v.id, code: v.code, plate: v.plate_number ?? '', type: isType(type) ? type : null, zoneId: v.zone_id, zoneCode: zoneCode.get(v.zone_id) ?? '', active: v.is_active, assignedTo: owner.get(v.id) ?? null };
  };
  const allVehicles = vehicles.map(vehicleRow);
  const shownVehicles = allVehicles.filter((v) => (!zoneFilterActive || query.zone === REMOTE_POOL || v.zoneId === wantedZone) && matches(query.q, v.code, v.plate));

  // How many agents hold each skill (over everyone, not only those shown).
  const inUse = new Map<string, number>();
  for (const codes of skillsOf.values()) for (const code of codes) inUse.set(code, (inUse.get(code) ?? 0) + 1);
  const skills: SkillRow[] = vocabulary.map((k) => ({ code: k.code, nameEn: k.name_en, nameAr: k.name_ar ?? null, inUse: inUse.get(k.code) ?? 0 }));

  const maintenance = await maintenanceByVehicle(ctx);
  const sample = importOpen && canEdit ? getAgentsImportSample(ctx) : undefined;
  const asked = (id: string | undefined): id is string => id !== undefined && id !== 'new';
  const openSource = asked(query.agent) ? agents.find((s) => s.id === query.agent) : undefined;
  const openAgent = openSource === undefined ? undefined : rowOf(openSource, skillsOf.get(openSource.id) ?? []);
  const openVehicle = asked(query.vehicle) ? allVehicles.find((v) => v.id === query.vehicle) : undefined;
  return {
    openAgent,
    openVehicle,
    unknownRecord: (asked(query.agent) && openAgent === undefined) || (asked(query.vehicle) && openVehicle === undefined),
    sources: [...new Set<DataSource>([...agents, ...vehicles].map((r) => r.data_source))],
    totals: { agents: agents.length, field: agents.filter((s) => s.kind === 'field').length, remote: agents.filter((s) => s.kind === 'remote').length, vehicles: vehicles.length, skills: skills.length },
    agents: shownRows,
    vehicles: shownVehicles,
    skills,
    zones: zones.map((z) => ({ id: z.id, code: zoneCodeOf(z), name: z.name_en })),
    shifts: patterns.map((p) => ({ id: p.id, code: shiftKey(p.code), name: p.name_en, kind: p.kind })),
    allVehicles,
    standby: standbyPoints.map((p) => ({ id: p.id, zoneId: p.zone_id, name: p.name_en })),
    sample: sample === undefined ? undefined : { fileName: sample.file_name, text: sample.text },
    maintenance,
    exportHeader: ['code', 'name_en', 'kind', 'zone', 'shift', 'vehicle', 'skills', 'status'],
    exportRows: shownRows.map((s) => [s.code, s.name, s.kind, s.zoneCode ?? REMOTE_POOL, s.shiftCode ?? '', s.vehicleCode ?? '', s.skills.join(';'), s.active ? 'active' : 'inactive']),
  };
}
