// SPDX-License-Identifier: AGPL-3.0-only
// Agent status and position at any moment of the synthetic case week and the demo day. NOT stored: a pure,
// deterministic function of (seed, agent, time), so the app can call it while the replay plays.
//
// How it stays consistent with the committed fixtures: it rebuilds the same day plans the generator wrote
// (same seed, same code, same order), so an agent is `en_route` exactly between the departure and the arrival that
// their case record says, `on_scene` until closed_at, then drives back to the standby point they wait at.
// Movement is a straight line between the points at the assumed speed (road distance over drawn travel
// time, kept between 9 and 100 km/h by the generator), which matches the assigned-to-arrived targets.
//
// PURE TypeScript with no Node imports (safe to bundle in the app). Memoised per seed.

import { calibration } from './gen/calibration';
import { haversineKm, type LatLng } from './gen/dist';
import { planChain, type PlannedCase } from './gen/dayplan';
import { buildWorld, dutyAt, vehiclesForZoneDate, type AgentDef, type World } from './gen/people';
import { iso, localDate, parseIso } from './gen/time';

/** The status vocabulary of the contract (AgentLiveStatus). */
export const AGENT_STATUSES = ['available', 'assigned', 'en_route', 'on_scene', 'on_break', 'offline'] as const;
export type AgentLiveStatus = (typeof AGENT_STATUSES)[number];

/** A finer reading than the status, for the map and for tests. */
export type AgentPhase = 'waiting' | 'assigned' | 'en_route' | 'on_scene' | 'returning' | 'break' | 'off_shift' | 'remote';

export interface AgentState {
  readonly agent_id: string;
  readonly status: AgentLiveStatus;
  readonly phase: AgentPhase;
  readonly latitude: number;
  readonly longitude: number;
  /** ISO 8601 with +03:00: the moment the position is for. */
  readonly position_at: string;
  readonly zone_id: string;
  readonly vehicle_id: string | null;
  readonly current_case_id: string | null;
  readonly speed_kmh: number;
  /** Compass bearing 0 to 360 while moving, else null. */
  readonly heading_deg: number | null;
}

interface JobSegment {
  readonly case: PlannedCase;
  readonly assigned: number;
  readonly depart: number;
  readonly arrived: number;
  readonly closed: number;
  readonly returning_until: number;
  readonly origin: LatLng;
  readonly road_km: number;
}

interface JobIndex {
  readonly through: string;
  readonly byAgent: ReadonlyMap<string, readonly JobSegment[]>;
}

const indexCache = new Map<string, JobIndex>();

/** Days beyond the demo day for which jobs are planned (later dates just show everyone waiting). */
const EXTRA_DAYS_AFTER_DEMO_TODAY = 14;

function lastPlannedDate(): string {
  const demo = calibration.structure.demo_today.value;
  return localDate(parseIso(`${demo}T12:00:00+03:00`) + EXTRA_DAYS_AFTER_DEMO_TODAY * 86400);
}

function jobIndex(world: World, seed: string, throughDate: string): JobIndex {
  const demo = calibration.structure.demo_today.value;
  const want = throughDate < demo ? demo : throughDate > lastPlannedDate() ? lastPlannedDate() : throughDate;
  const hit = indexCache.get(seed);
  if (hit !== undefined && hit.through >= want) return hit;
  const plans = planChain(world, seed, want);
  const by = new Map<string, JobSegment[]>();
  for (const plan of plans) {
    for (const c of plan.cases) {
      if (c.handling !== 'field' || c.agent === null || c.assigned === null || c.depart === null || c.arrived === null || c.returning_until === null || c.origin === null || c.road_km === null) continue;
      const list = by.get(c.agent.id) ?? [];
      list.push({ case: c, assigned: c.assigned, depart: c.depart, arrived: c.arrived, closed: c.closed, returning_until: c.returning_until, origin: c.origin, road_km: c.road_km });
      by.set(c.agent.id, list);
    }
  }
  for (const list of by.values()) list.sort((a, b) => a.assigned - b.assigned || a.case.index - b.case.index);
  const built: JobIndex = { through: want, byAgent: by };
  indexCache.set(seed, built);
  return built;
}

function bearing(from: LatLng, to: LatLng): number {
  const rad = Math.PI / 180;
  const y = Math.sin((to.lng - from.lng) * rad) * Math.cos(to.lat * rad);
  const x = Math.cos(from.lat * rad) * Math.sin(to.lat * rad) - Math.sin(from.lat * rad) * Math.cos(to.lat * rad) * Math.cos((to.lng - from.lng) * rad);
  return (Math.atan2(y, x) / rad + 360) % 360;
}

function lerp(a: LatLng, b: LatLng, f: number): LatLng {
  const k = Math.min(1, Math.max(0, f));
  return { lat: a.lat + (b.lat - a.lat) * k, lng: a.lng + (b.lng - a.lng) * k };
}

const round6 = (x: number): number => Math.round(x * 1e6) / 1e6;

function stateFor(world: World, index: JobIndex, s: AgentDef, t: number): AgentState {
  const zone = world.zoneById.get(s.zone_id);
  if (zone === undefined) throw new Error(`Agent ${s.employee_code} has no zone`);
  const date = localDate(t);
  const at = iso(t);
  const make = (status: AgentLiveStatus, phase: AgentPhase, pos: LatLng, extra?: { case_id?: string; speed?: number; heading?: number | null; vehicle?: boolean }): AgentState => ({
    agent_id: s.id,
    status,
    phase,
    latitude: round6(pos.lat),
    longitude: round6(pos.lng),
    position_at: at,
    zone_id: s.zone_id,
    vehicle_id: extra?.vehicle === false ? null : s.work_mode === 'field' ? (vehiclesForZoneDate(world, s.zone_id, dutyAt(s, t, date)?.roster_date ?? date).get(s.id) ?? null) : null,
    current_case_id: extra?.case_id ?? null,
    speed_kmh: Math.round((extra?.speed ?? 0) * 10) / 10,
    heading_deg: extra?.heading === undefined || extra.heading === null ? null : Math.round(extra.heading),
  });

  // Remote reviewers have no position; they show at their home zone's centre.
  if (s.work_mode === 'remote') {
    const duty = dutyAt(s, t, date);
    if (duty === null) return make('offline', 'off_shift', zone.center, { vehicle: false });
    if (t >= duty.break_start && t < duty.break_end) return make('on_break', 'break', zone.center, { vehicle: false });
    return make('available', 'remote', zone.center, { vehicle: false });
  }

  const home = s.home_spot as LatLng;
  const jobs = index.byAgent.get(s.id) ?? [];
  // The latest job assigned at or before t decides the phase while it lasts.
  let job: JobSegment | undefined;
  for (let i = jobs.length - 1; i >= 0; i -= 1) {
    const j = jobs[i] as JobSegment;
    if (j.assigned <= t) {
      job = j;
      break;
    }
  }
  if (job !== undefined && t < job.returning_until) {
    const loc: LatLng = { lat: job.case.location.lat, lng: job.case.location.lng };
    if (t < job.depart) return make('assigned', 'assigned', job.origin, { case_id: job.case.id });
    if (t < job.arrived) {
      const seconds = Math.max(1, job.arrived - job.depart);
      const speed = job.road_km / (seconds / 3600);
      return make('en_route', 'en_route', lerp(job.origin, loc, (t - job.depart) / seconds), { case_id: job.case.id, speed, heading: bearing(job.origin, loc) });
    }
    if (t < job.closed) return make('on_scene', 'on_scene', loc, { case_id: job.case.id });
    const back = Math.max(1, job.returning_until - job.closed);
    const backKm = calibration.movement.road_distance_factor.value * haversineKm(loc, home);
    return make('available', 'returning', lerp(loc, home, (t - job.closed) / back), { speed: backKm / (back / 3600), heading: bearing(loc, home) });
  }

  const duty = dutyAt(s, t, date);
  if (duty === null) return make('offline', 'off_shift', home, { vehicle: false });
  if (t >= duty.break_start && t < duty.break_end) return make('on_break', 'break', home);
  return make('available', 'waiting', home);
}

/**
 * Status and position of one agent at a moment.
 *
 * @param seed         the generator seed (calibration.json structure.seed), a string
 * @param agentId   the agent's `id` in fixtures/agents
 * @param isoTimestamp ISO 8601 with an offset, e.g. 2026-09-13T09:41:30+03:00
 *
 * Deterministic: the same arguments always give the same answer, on every machine. No clock, no Math.random.
 * Throws for an unknown agent or a malformed timestamp.
 */
export function agentStateAt(seed: string, agentId: string, isoTimestamp: string): AgentState {
  const world = buildWorld(seed);
  const s = world.agentById.get(agentId);
  if (s === undefined) throw new Error(`Unknown agent id ${agentId}`);
  const t = parseIso(isoTimestamp);
  return stateFor(world, jobIndex(world, seed, localDate(t)), s, t);
}

/** Every agent at one moment (the map's snapshot). Same rules as agentStateAt, computed together. */
export function allAgentStatesAt(seed: string, isoTimestamp: string): AgentState[] {
  const world = buildWorld(seed);
  const t = parseIso(isoTimestamp);
  const index = jobIndex(world, seed, localDate(t));
  return world.agents.map((s) => stateFor(world, index, s, t));
}

/** The planned cases of one day (same plan the fixtures were written from). For the generator and tests. */
export function plannedCasesForDay(seed: string, date: string): readonly PlannedCase[] {
  const world = buildWorld(seed);
  const plans = planChain(world, seed, date);
  const plan = plans.find((p) => p.date === date);
  if (plan === undefined) throw new Error(`No plan for ${date}`);
  return plan.cases;
}
