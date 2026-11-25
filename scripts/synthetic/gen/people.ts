// SPDX-License-Identifier: AGPL-3.0-only
// Invented agents, vehicles, skills and the duty roster they follow. PURE TypeScript, no Node imports
// (positions.ts, which the app imports, depends on this module).

import { calibration } from './calibration';
import { apportion, type LatLng, offsetKm } from './dist';
import { buildLocations, type Locations, type StandbyPointDef, type ZoneDef } from './locations';
import { makeRng, uuidFor } from './rng';
import { DAY_SECONDS, addDays, dayStart, parseClock, weekdayOf, WEEKDAYS } from './time';

// ---------------------------------------------------------------------------------------------------------------------
// Shift patterns. All shift times are assumptions.
// ---------------------------------------------------------------------------------------------------------------------

export type ShiftKey = 'day_a' | 'day_b' | 'evening' | 'night' | 'remote_block_1' | 'remote_block_2';

export interface ShiftDef {
  readonly key: ShiftKey;
  readonly name_en: string;
  /** A draft Arabic name: shift patterns are configuration vocabulary, the exception to empty Arabic. */
  readonly name_ar: string;
  readonly kind: 'field' | 'remote';
  /** [start, end] "HH:MM"; end may be earlier than start (the shift crosses midnight) or "00:00" (midnight). Null: no normal hours. */
  readonly normal: readonly [string, string] | null;
  readonly ramadan: readonly [string, string];
}

export const SHIFT_DEFS: readonly ShiftDef[] = [
  { key: 'day_a', name_en: 'Day A', name_ar: 'نهاري أ', kind: 'field', normal: ['06:00', '14:00'], ramadan: ['06:00', '12:00'] },
  { key: 'day_b', name_en: 'Day B', name_ar: 'نهاري ب', kind: 'field', normal: ['14:00', '22:00'], ramadan: ['12:00', '18:00'] },
  { key: 'evening', name_en: 'Evening (Ramadan only)', name_ar: 'مسائي (رمضان فقط)', kind: 'field', normal: null, ramadan: ['18:00', '00:00'] },
  { key: 'night', name_en: 'Night', name_ar: 'ليلي', kind: 'field', normal: ['22:00', '06:00'], ramadan: ['00:00', '06:00'] },
  { key: 'remote_block_1', name_en: 'Remote block 1', name_ar: 'فترة عن بُعد 1', kind: 'remote', normal: ['07:00', '15:00'], ramadan: ['07:00', '13:00'] },
  { key: 'remote_block_2', name_en: 'Remote block 2', name_ar: 'فترة عن بُعد 2', kind: 'remote', normal: ['15:00', '23:00'], ramadan: ['13:00', '19:00'] },
];

export function shiftDef(key: ShiftKey): ShiftDef {
  const found = SHIFT_DEFS.find((s) => s.key === key);
  if (found === undefined) throw new Error(`Unknown shift ${key}`);
  return found;
}

export const BREAK_AFTER_HOURS = 5;
export const BREAK_MINUTES = 30;

// ---------------------------------------------------------------------------------------------------------------------
// People and vehicles
// ---------------------------------------------------------------------------------------------------------------------

export interface AgentDef {
  readonly id: string;
  readonly employee_code: string;
  readonly name_en: string;
  readonly name_ar: string;
  readonly zone_id: string;
  readonly city_id: string;
  readonly zone_code: string;
  readonly work_mode: 'field' | 'remote';
  readonly shift_key: ShiftKey;
  /** Weekday indices (0 = Sunday) of the two days off. */
  readonly days_off: readonly number[];
  readonly standby_point_id: string | null;
  /** Where an available agent waits: near the standby point. Null for remote reviewers. */
  readonly home_spot: LatLng | null;
  readonly skills: readonly string[];
  /** Index within the (zone, shift) group; used to stagger breaks. */
  readonly group_index: number;
}

export interface VehicleDef {
  readonly id: string;
  readonly code: string;
  readonly plate: string;
  readonly zone_id: string;
  readonly vehicle_type: string;
  readonly status: 'active' | 'out_of_service';
}

export interface World {
  readonly seed: string;
  readonly locations: Locations;
  readonly agents: readonly AgentDef[];
  readonly vehicles: readonly VehicleDef[];
  readonly agentById: ReadonlyMap<string, AgentDef>;
  readonly zoneById: ReadonlyMap<string, ZoneDef>;
  readonly standbyById: ReadonlyMap<string, StandbyPointDef>;
}

const ppl = calibration.people;
const roster = calibration.roster_model;

function buildWorldUncached(seed: string): World {
  const locations = buildLocations(seed);
  const rng = makeRng(seed, 'people');
  const agents: AgentDef[] = [];
  const vehicles: VehicleDef[] = [];

  // Names: unique given + invented family name pairs.
  const familyNames: string[] = [];
  for (const stem of ppl.person_names.family_name_stems) for (const end of ppl.person_names.family_name_endings) familyNames.push(`Al-${stem}${end}`);
  const nameRng = rng.fork('names');
  const pairs: string[] = [];
  for (const g of ppl.person_names.given_names) for (const f of familyNames) pairs.push(`${g} ${f}`);
  nameRng.shuffle(pairs);
  let nameCursor = 0;

  const skillCodes = ppl.skills_vocabulary.value.map((s) => s.code);
  const fieldSkillPool = skillCodes.filter((c) => c !== 'remote_review' && c !== 'senior_agent' && c !== 'night_operations');
  const perZone = calibration.structure.agents_per_zone.value;
  const remoteShare = calibration.structure.remote_share_of_agents.value;
  const split = roster.field_shift_split.value;
  const remoteSplit = roster.remote_block_split.value;
  const daysOff = roster.days_off_per_week.value;

  locations.zones.forEach((zone, zoneIndex) => {
    const zrng = rng.fork(`zone/${zone.code}`);
    // 42 x 0.25 = 10.5: alternate 11 and 10 remote so the total is exactly a quarter.
    const remoteCount = Math.round(perZone * remoteShare + (zoneIndex % 2 === 0 ? 0.5 : -0.5));
    const fieldCount = perZone - remoteCount;
    const points = locations.standbyPoints.filter((p) => p.zone_id === zone.id);

    const fieldShifts = apportion(fieldCount, [split.day_a, split.day_b, split.night]);
    const groups: { shift: ShiftKey; mode: 'field' | 'remote'; count: number }[] = [
      { shift: 'day_a', mode: 'field', count: fieldShifts[0] as number },
      { shift: 'day_b', mode: 'field', count: fieldShifts[1] as number },
      { shift: 'night', mode: 'field', count: fieldShifts[2] as number },
    ];
    const remoteBlocks = apportion(remoteCount, [remoteSplit.remote_block_1, remoteSplit.remote_block_2]);
    groups.push({ shift: 'remote_block_1', mode: 'remote', count: remoteBlocks[0] as number });
    groups.push({ shift: 'remote_block_2', mode: 'remote', count: remoteBlocks[1] as number });

    let employee = 0;
    for (const group of groups) {
      for (let i = 0; i < group.count; i += 1) {
        employee += 1;
        const code = `SVR-${zone.code}-${String(employee).padStart(3, '0')}`;
        const name = pairs[nameCursor];
        nameCursor += 1;
        if (name === undefined) throw new Error('Ran out of invented agent names.');

        const off: number[] = [];
        for (let d = 0; d < daysOff; d += 1) off.push((i + zoneIndex + d) % 7);

        let standby: StandbyPointDef | undefined;
        let homeSpot: LatLng | null = null;
        if (group.mode === 'field') {
          standby = points[(i + zoneIndex) % points.length];
          if (standby !== undefined) {
            const r = calibration.movement.standby_roam_radius_km.value * Math.sqrt(zrng.next());
            const theta = zrng.float(0, 2 * Math.PI);
            homeSpot = offsetKm(standby.position, r * Math.cos(theta), r * Math.sin(theta));
          }
        }

        const skills = new Set<string>();
        if (group.mode === 'remote') {
          skills.add('remote_review');
          if (zrng.chance(0.6)) skills.add('bilingual_en_ar');
          if (zrng.chance(0.4)) skills.add('photo_documentation');
          if (zrng.chance(0.15)) skills.add('senior_agent');
        } else {
          const n = zrng.int(ppl.skills_per_field_agent.min, ppl.skills_per_field_agent.max);
          while (skills.size < n) skills.add(zrng.pick(fieldSkillPool));
          if (group.shift === 'night') skills.add('night_operations');
          if (zrng.chance(0.12)) skills.add('senior_agent');
        }

        agents.push({
          id: uuidFor(seed, 'agent', code),
          employee_code: code,
          name_en: name,
          name_ar: '',
          zone_id: zone.id,
          city_id: zone.city_id,
          zone_code: zone.code,
          work_mode: group.mode,
          shift_key: group.shift,
          days_off: off,
          standby_point_id: standby?.id ?? null,
          home_spot: homeSpot,
          skills: skillCodes.filter((c) => skills.has(c)),
          group_index: i,
        });
      }
    }

    // Vehicles: 14 per zone, a few out of service.
    const vehicleCount = calibration.structure.vehicles_per_zone.value;
    for (let v = 0; v < vehicleCount; v += 1) {
      const code = `VEH-${zone.code}-${String(v + 1).padStart(2, '0')}`;
      const plateNumber = 1000 + zrng.int(0, 8999);
      const outOfService = v >= vehicleCount - Math.round(ppl.vehicle_out_of_service_share.value * vehicleCount);
      vehicles.push({
        id: uuidFor(seed, 'vehicle', code),
        code,
        plate: `SYN ${plateNumber}`,
        zone_id: zone.id,
        vehicle_type: ppl.vehicle_types.value[v % ppl.vehicle_types.value.length] as string,
        status: outOfService ? 'out_of_service' : 'active',
      });
    }
  });

  return {
    seed,
    locations,
    agents,
    vehicles,
    agentById: new Map(agents.map((s) => [s.id, s])),
    zoneById: new Map(locations.zones.map((z) => [z.id, z])),
    standbyById: new Map(locations.standbyPoints.map((p) => [p.id, p])),
  };
}

const worldCache = new Map<string, World>();

/** The invented world for a seed: pure and memoised, so repeated calls are free and always identical. */
export function buildWorld(seed: string): World {
  let world = worldCache.get(seed);
  if (world === undefined) {
    world = buildWorldUncached(seed);
    worldCache.set(seed, world);
  }
  return world;
}

// ---------------------------------------------------------------------------------------------------------------------
// Duty roster (normal hours; the case week and the roster fixtures contain no Ramadan days)
// ---------------------------------------------------------------------------------------------------------------------

export interface Duty {
  readonly agent_id: string;
  readonly roster_date: string;
  readonly shift_key: ShiftKey;
  readonly start: number;
  readonly end: number;
  readonly break_start: number;
  readonly break_end: number;
}

/** The duty an agent works on a roster date (the shift STARTS on that date), or null on a day off. */
export function dutyOn(agent: AgentDef, date: string): Duty | null {
  const weekday = WEEKDAYS.indexOf(weekdayOf(date));
  if (agent.days_off.includes(weekday)) return null;
  const def = shiftDef(agent.shift_key);
  if (def.normal === null) return null;
  const midnight = dayStart(date);
  const start = midnight + parseClock(def.normal[0]);
  let end = midnight + parseClock(def.normal[1]);
  if (end <= start) end += DAY_SECONDS;
  const stagger = (agent.group_index % 5) * 15 * 60;
  const breakStart = start + BREAK_AFTER_HOURS * 3600 + stagger;
  return {
    agent_id: agent.id,
    roster_date: date,
    shift_key: agent.shift_key,
    start,
    end,
    break_start: breakStart,
    break_end: breakStart + BREAK_MINUTES * 60,
  };
}

/** The duty that covers an instant (from that day's or the previous day's roster), or null. */
export function dutyAt(agent: AgentDef, epoch: number, dateOfEpoch: string): Duty | null {
  for (const date of [dateOfEpoch, addDays(dateOfEpoch, -1)]) {
    const duty = dutyOn(agent, date);
    if (duty !== null && epoch >= duty.start && epoch < duty.end) return duty;
  }
  return null;
}

/**
 * Vehicles for the field agents of one zone on a roster date: one vehicle each within a shift, taken from the
 * zone's active vehicles in order. If more agents are on a shift than active vehicles, the extras share
 * (that shortage is real for the Gap and Surplus screen). Returns agent id to vehicle id.
 */
const vehicleMapCache = new Map<string, Map<string, string>>();

export function vehiclesForZoneDate(world: World, zoneId: string, date: string): Map<string, string> {
  const key = `${world.seed}|${zoneId}|${date}`;
  const cached = vehicleMapCache.get(key);
  if (cached !== undefined) return cached;
  const active = world.vehicles.filter((v) => v.zone_id === zoneId && v.status === 'active');
  const out = new Map<string, string>();
  for (const shift of ['day_a', 'day_b', 'night'] as const) {
    const onDuty = world.agents.filter((s) => s.zone_id === zoneId && s.work_mode === 'field' && s.shift_key === shift && dutyOn(s, date) !== null);
    onDuty.forEach((s, i) => {
      const v = active[i % active.length];
      if (v !== undefined) out.set(s.id, v.id);
    });
  }
  vehicleMapCache.set(key, out);
  return out;
}
