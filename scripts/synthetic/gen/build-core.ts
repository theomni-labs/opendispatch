// SPDX-License-Identifier: AGPL-3.0-only
// Locations, case types, people, vehicles, skills, leave, and cases as contract records. Node-free.

import { calibration } from './calibration';
import { apportion } from './dist';
import { base, coord, idOf, type Ctx, type Rec } from './context';
import type { PlannedCase } from './dayplan';
import { makeRng } from './rng';
import { addDays, dayStart, iso, WEEKDAYS } from './time';

export function buildCities(ctx: Ctx): Rec[] {
  return ctx.world.locations.cities.map((c, i) => ({
    ...base(ctx, 'city', c.code, ctx.seededAt),
    external_id: String(101 + i),
    case_code: c.code,
    name_en: c.name_en,
    name_ar: null,
    is_active: true,
    extra: {},
  }));
}

export function buildZones(ctx: Ctx): Rec[] {
  return ctx.world.locations.zones.map((z, i) => ({
    ...base(ctx, 'zone', z.code, ctx.seededAt),
    external_id: String(2001 + i),
    city_id: z.city_id,
    name_en: z.name_en,
    name_ar: null,
    latitude: coord(z.center.lat),
    longitude: coord(z.center.lng),
    is_active: true,
    extra: { code: z.code, radius_km: z.radius_km },
  }));
}

export function buildSubZones(ctx: Ctx): Rec[] {
  return ctx.world.locations.subZones.map((s, i) => ({
    ...base(ctx, 'sub_zone', s.code, ctx.seededAt),
    external_id: String(30001 + i),
    zone_id: s.zone_id,
    name_en: s.name_en,
    name_ar: null,
    latitude: coord(s.center.lat),
    longitude: coord(s.center.lng),
    is_active: true,
    extra: { code: s.code },
  }));
}

export function buildStandbyPoints(ctx: Ctx): Rec[] {
  return ctx.world.locations.standbyPoints.map((p) => ({
    ...base(ctx, 'standby_point', p.code, ctx.seededAt),
    zone_id: p.zone_id,
    sub_zone_id: p.sub_zone_id,
    name_en: p.name_en,
    name_ar: null,
    latitude: coord(p.position.lat),
    longitude: coord(p.position.lng),
    coverage_radius_m: p.coverage_radius_m,
    is_active: true,
    extra: { code: p.code },
  }));
}

/** the data model spelling. External ids are invented. */
export const CASE_TYPE_NAMES = ['Standard case', 'Police attended', 'Unlisted'] as const;

export function caseTypeId(ctx: Ctx, name: string): string {
  return idOf(ctx, 'case_type', name);
}

export function buildCaseTypes(ctx: Ctx): Rec[] {
  return CASE_TYPE_NAMES.map((name, i) => ({
    ...base(ctx, 'case_type', name, ctx.seededAt),
    external_id: String(i + 1),
    name_en: name,
    name_ar: null,
    is_active: true,
    extra: {},
  }));
}

// ---------------------------------------------------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------------------------------------------------

export function buildAgents(ctx: Ctx): Rec[] {
  const cityCode = new Map(ctx.world.locations.cities.map((c) => [c.id, c.code]));
  return ctx.world.agents.map((s) => ({
    ...base(ctx, 'agent', s.employee_code, ctx.seededAt),
    code: s.employee_code,
    name_en: s.name_en,
    name_ar: null,
    kind: s.work_mode,
    // Remote agents belong to the remote pool: no home zone (contract). extra keeps the city queue they review for.
    home_zone_id: s.work_mode === 'field' ? s.zone_id : null,
    default_vehicle_id: null,
    is_active: true,
    extra: {
      home_shift: s.shift_key,
      days_off: s.days_off.map((d) => WEEKDAYS[d]),
      ...(s.work_mode === 'field'
        ? { standby_point_id: s.standby_point_id }
        : { reviews_for_city: cityCode.get(s.city_id), pool_zone_code: s.zone_code }),
    },
  }));
}

export function buildVehicles(ctx: Ctx): Rec[] {
  return ctx.world.vehicles.map((v) => ({
    ...base(ctx, 'vehicle', v.code, ctx.seededAt),
    code: v.code,
    plate_number: v.plate,
    zone_id: v.zone_id,
    is_active: v.status === 'active',
    extra: { vehicle_type: v.vehicle_type },
  }));
}

export function buildAgentSkills(ctx: Ctx): Rec[] {
  const out: Rec[] = [];
  for (const s of ctx.world.agents) {
    for (const skill of s.skills) {
      out.push({
        ...base(ctx, 'agent_skill', `${s.employee_code}|${skill}`, ctx.seededAt),
        agent_id: s.id,
        skill_code: skill,
      });
    }
  }
  return out;
}

export interface LeaveFx {
  readonly record: Rec;
  readonly agentId: string;
  readonly start: string;
  readonly end: string;
  readonly status: 'requested' | 'approved' | 'declined';
}

/** About 6% of agents: a mix of requested, approved and declined. Approved leave starts after the forward roster week. */
export function buildLeave(ctx: Ctx, deciderId: string): LeaveFx[] {
  const cfg = calibration.people;
  const rng = makeRng(ctx.seed, 'leave');
  const count = Math.round(ctx.world.agents.length * cfg.leave_request_share_of_agents.value);
  const picks = rng.fork('who').shuffle([...ctx.world.agents]).slice(0, count);
  const mix = cfg.leave_status_mix.value;
  const counts = apportion(count, [mix.requested, mix.approved, mix.declined]);
  const statuses: LeaveFx['status'][] = [];
  (['requested', 'approved', 'declined'] as const).forEach((st, i) => {
    for (let k = 0; k < (counts[i] as number); k += 1) statuses.push(st);
  });
  rng.fork('status').shuffle(statuses);
  const types = cfg.leave_types.value;
  const typeWeights = [0.7, 0.1, 0.1, 0.1];
  const out: LeaveFx[] = [];
  picks.forEach((s, i) => {
    const status = statuses[i] as LeaveFx['status'];
    const startOffset = status === 'approved' ? rng.int(7, 27) : rng.int(1, 27);
    const start = addDays(ctx.demoToday, startOffset);
    const length = rng.int(cfg.leave_length_days.min, cfg.leave_length_days.max);
    const end = addDays(start, length - 1);
    const requestedAt = dayStart(addDays(ctx.demoToday, -rng.int(1, 18))) + rng.int(8, 16) * 3600;
    const decidedAt = requestedAt + rng.int(4, 60) * 3600;
    const type = types[rng.weightedIndex(typeWeights)] as string;
    const decided = status !== 'requested';
    out.push({
      agentId: s.id,
      start,
      end,
      status,
      record: {
        ...base(ctx, 'leave_request', s.employee_code, requestedAt, decided ? decidedAt : requestedAt),
        agent_id: s.id,
        start_date: start,
        end_date: end,
        leave_type: type,
        status,
        requested_at: iso(requestedAt),
        decided_at: decided ? iso(decidedAt) : null,
        decided_by_user_id: decided ? deciderId : null,
        decision_note: status === 'declined' ? 'Coverage on those dates is already thin.' : null,
        note: null,
      },
    });
  });
  return out.sort((a, b) => a.start.localeCompare(b.start) || a.agentId.localeCompare(b.agentId));
}

// ---------------------------------------------------------------------------------------------------------------------
// Cases
// ---------------------------------------------------------------------------------------------------------------------

const cc = calibration.handling_model.classification_criteria;

function pick<K extends string>(rng: ReturnType<typeof makeRng>, mix: Readonly<Record<K, number>>): K {
  const keys = Object.keys(mix) as K[];
  return keys[rng.weightedIndex(keys.map((k) => mix[k]))] as K;
}

/** The rule criteria the customer has not supplied: their own stream per case, so no other draw moves. */
export function caseCriteria(seed: string, c: Pick<PlannedCase, 'case_number' | 'damage_sar' | 'severity'>): Record<string, string | number> {
  const rng = makeRng(seed, `case-criteria/${c.case_number}`);
  const factor = rng.float(cc.claim_value_factor.min, cc.claim_value_factor.max);
  return {
    claim_value_sar: Math.round((c.damage_sar * factor) / 50) * 50,
    damage_assessment_method: pick(rng, cc.damage_assessment_by_severity.value[c.severity]),
    location_type: pick(rng, cc.location_type_mix.value),
    customer_preference: pick(rng, cc.customer_preference_mix.value),
  };
}

export function caseRecord(ctx: Ctx, c: PlannedCase): Rec {
  const field = c.handling === 'field';
  return {
    ...base(ctx, 'case', c.case_number, c.registered, c.closed),
    external_id: c.external_id,
    case_number: c.case_number,
    registered_at: iso(c.registered),
    city_id: c.city.id,
    zone_id: c.zone.id,
    sub_zone_id: c.sub_zone.id,
    latitude: coord(c.location.lat),
    longitude: coord(c.location.lng),
    case_type_id: caseTypeId(ctx, c.case_type),
    parties_involved: c.parties,
    assigned_at: field && c.assigned !== null ? iso(c.assigned) : null,
    arrived_at: field && c.arrived !== null ? iso(c.arrived) : null,
    closed_at: iso(c.closed),
    handling: c.handling,
    agent_id: field && c.agent !== null ? c.agent.id : null,
    vehicle_id: field ? c.vehicle_id : null,
    severity: c.severity,
    injury_present: c.injury,
    estimated_damage_sar: c.damage_sar,
    on_scene_completed_at: field && c.on_scene_completed !== null ? iso(c.on_scene_completed) : null,
    remote_review_at: !field && c.remote_review_at !== null ? iso(c.remote_review_at) : null,
    channel: c.channel,
    extra: caseCriteria(ctx.seed, c),
  };
}

