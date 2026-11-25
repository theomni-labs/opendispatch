// SPDX-License-Identifier: AGPL-3.0-only
// Plans one day of cases, and the movements of the agents who serve them. Everything is a pure function of
// (seed, date, carry-over from the day before). PURE TypeScript, no Node imports: positions.ts (imported by the app)
// builds the same plans, so what the app draws is exactly what the committed fixtures say.

import { calibration } from './calibration';
import { apportion, clamp, haversineKm, lognormalFromMedianP90, lognormalQuantile, offsetKm, stratifiedUniforms, type LatLng, type Lognormal } from './dist';
import { casesForDate, slotCountsForDay } from './demand';
import type { CityDef, SubZoneDef, ZoneDef } from './locations';
import { dutyOn, vehiclesForZoneDate, type Duty, type AgentDef, type World } from './people';
import { makeRng, uuidFor, type Rng } from './rng';
import { DAY_SECONDS, SLOT_SECONDS, SLOTS_PER_DAY, dateRange, dayStart, localDate, parseClock, secondsOfDay, yymmdd } from './time';

export const CASE_TYPES = ['Standard case', 'Police attended', 'Unlisted'] as const;
export type CaseTypeName = (typeof CASE_TYPES)[number];
export type Handling = 'field' | 'remote_inferred';
export type Severity = 'minor' | 'moderate' | 'severe';

export interface PlannedCase {
  readonly date: string;
  /** Position in registration order within the day, from 0. */
  readonly index: number;
  readonly case_number: string;
  readonly id: string;
  readonly external_id: string;
  readonly registered: number;
  readonly city: CityDef;
  readonly zone: ZoneDef;
  readonly sub_zone: SubZoneDef;
  readonly location: LatLng;
  readonly case_type: CaseTypeName;
  readonly parties: number;
  readonly injury: boolean;
  readonly damage_sar: number;
  readonly severity: Severity;
  readonly channel: string;
  readonly handling: Handling;
  // field cases
  readonly assigned: number | null;
  readonly assigned_before_registration: boolean;
  readonly depart: number | null;
  readonly arrived: number | null;
  readonly on_scene_completed: number | null;
  readonly agent: AgentDef | null;
  readonly vehicle_id: string | null;
  readonly origin: LatLng | null;
  readonly road_km: number | null;
  readonly speed_kmh: number | null;
  readonly returning_until: number | null;
  readonly overlapped: boolean;
  // remote cases
  readonly remote_review_at: number | null;
  // both
  readonly closed: number;
}

/** State handed from one day to the next so a job or a review queue that runs past midnight stays consistent. */
export interface LastJob {
  readonly location: LatLng;
  readonly closed: number;
  /** Seconds the drive back to the waiting spot takes. */
  readonly back_seconds: number;
}

export interface PlanCarry {
  /** Agent id to the instant they closed their latest case (dispatchable again from then; they drive back meanwhile). */
  readonly busy_until: ReadonlyMap<string, number>;
  /** Agent id to the latest finished job, so the drive back and the next origin stay consistent across midnight. */
  readonly last_job: ReadonlyMap<string, LastJob>;
  /** City id to the instants each remote reviewer becomes free. */
  readonly reviewer_free: ReadonlyMap<string, readonly number[]>;
}

export interface DayPlan {
  readonly date: string;
  readonly cases: readonly PlannedCase[];
  readonly carry_out: PlanCarry;
}

export const EMPTY_CARRY: PlanCarry = { busy_until: new Map(), last_job: new Map(), reviewer_free: new Map() };

// ---------------------------------------------------------------------------------------------------------------------
// Distributions taken from calibration.json
// ---------------------------------------------------------------------------------------------------------------------

const t = calibration.targets;
const tm = calibration.timing_model;
const hm = calibration.handling_model;
const mv = calibration.movement;
const rq = calibration.remote_queue;

function timingDistributions(): { d1: Lognormal; d3: Lognormal } {
  return {
    d1: lognormalFromMedianP90(t.registered_to_assigned_median_min.value, t.registered_to_assigned_p90_min.value),
    d3: lognormalFromMedianP90(t.arrived_to_closed_median_min.value, tm.arrived_to_closed_p90_min.value),
  };
}

const TYPE_FIELD_SHARE: Record<CaseTypeName, number> = {
  'Standard case': t.field_share_customer.value,
  'Police attended': t.field_share_customer_and_police.value,
  Unlisted: t.field_share_unlisted.value,
};

const TYPE_MIX = calibration.targets.extra_figures.case_type_mix.value as Record<CaseTypeName, number>;

// ---------------------------------------------------------------------------------------------------------------------
// Memoised duty lookups (dutyOn parses dates, and planning asks thousands of times)
// ---------------------------------------------------------------------------------------------------------------------

const dutyMemo = new Map<string, Duty | null>();
function dutyOnMemo(s: AgentDef, date: string): Duty | null {
  const key = `${s.id}|${date}`;
  let d = dutyMemo.get(key);
  if (d === undefined) {
    d = dutyOn(s, date);
    dutyMemo.set(key, d);
  }
  return d;
}

function dutyAtMemo(s: AgentDef, epoch: number): Duty | null {
  const date = localDate(epoch);
  const today = dutyOnMemo(s, date);
  if (today !== null && epoch >= today.start && epoch < today.end) return today;
  const yesterday = dutyOnMemo(s, localDate(epoch - DAY_SECONDS));
  if (yesterday !== null && epoch >= yesterday.start && epoch < yesterday.end) return yesterday;
  return null;
}

// ---------------------------------------------------------------------------------------------------------------------
// The plan for one day
// ---------------------------------------------------------------------------------------------------------------------

interface Draft {
  index: number;
  registered: number;
  city: CityDef;
  zone: ZoneDef;
  sub_zone: SubZoneDef;
  location: LatLng;
  case_type: CaseTypeName;
  parties: number;
  injury: boolean;
  damage_sar: number;
  severity: Severity;
  channel: string;
  handling: Handling;
  forcedField: boolean;
}

function sampleDisc(rng: Rng, radiusKm: number): { dx: number; dy: number } {
  const r = radiusKm * Math.sqrt(rng.next());
  const theta = rng.float(0, 2 * Math.PI);
  return { dx: r * Math.cos(theta), dy: r * Math.sin(theta) };
}

/** Labels that appear exactly in proportion to `weights` (largest remainder), in random order. */
function quotaLabels(rng: Rng, total: number, weights: readonly number[]): number[] {
  const counts = apportion(total, weights);
  const labels: number[] = [];
  counts.forEach((c, label) => {
    for (let i = 0; i < c; i += 1) labels.push(label);
  });
  return rng.shuffle(labels);
}

export function planDay(world: World, seed: string, date: string, carryIn: PlanCarry): DayPlan {
  const rng = makeRng(seed, `day/${date}`);
  const midnight = dayStart(date);
  const total = casesForDate(date);
  const { cities, zones, subZones } = world.locations;

  // 1. Registration times: slot counts (shape times noise, apportioned), then seconds within each slot.
  const counts = slotCountsForDay(rng.fork('slots'), total);
  const secRng = rng.fork('seconds');
  const registered: number[] = [];
  for (let slot = 0; slot < SLOTS_PER_DAY; slot += 1) {
    const n = counts[slot] as number;
    const offsets: number[] = [];
    for (let i = 0; i < n; i += 1) offsets.push(secRng.int(0, SLOT_SECONDS - 1));
    offsets.sort((a, b) => a - b);
    for (const o of offsets) registered.push(midnight + slot * SLOT_SECONDS + o);
  }

  // 2. Attributes. City, type and parties come as exact quotas; the rest are drawn.
  const cityLabels = quotaLabels(rng.fork('city'), total, cities.map((c) => c.share));
  const typeLabels = quotaLabels(rng.fork('type'), total, CASE_TYPES.map((n) => TYPE_MIX[n]));
  const partyKeys = Object.keys(hm.parties_distribution.value).map(Number);
  const partyLabels = quotaLabels(rng.fork('parties'), total, partyKeys.map((k) => (hm.parties_distribution.value as Record<string, number>)[String(k)] as number));

  const zoneRng = rng.fork('zone');
  const subRng = rng.fork('subzone');
  const locRng = rng.fork('location');
  const miscRng = rng.fork('misc');
  const channelKeys = Object.keys(hm.channel_mix.value);
  const channelWeights = channelKeys.map((k) => (hm.channel_mix.value as Record<string, number>)[k] as number);

  const drafts: Draft[] = registered.map((reg, index) => {
    const city = cities[cityLabels[index] as number] as CityDef;
    const cityZones = zones.filter((z) => z.city_id === city.id);
    const zone = cityZones[zoneRng.weightedIndex(cityZones.map((z) => z.demand_weight))] as ZoneDef;
    const zoneSubs = subZones.filter((s) => s.zone_id === zone.id);
    const sub = zoneSubs[subRng.weightedIndex(zoneSubs.map((s) => s.demand_weight))] as SubZoneDef;
    const { dx, dy } = sampleDisc(locRng, mv.case_scatter_radius_km.value);
    const location = offsetKm(sub.center, dx, dy);
    const injury = miscRng.chance(hm.injury_share.value);
    const damageRaw = hm.damage_sar_median.value * Math.exp(hm.damage_sar_sigma.value * miscRng.normal()) * (injury ? 2.5 : 1);
    const damage = Math.max(300, Math.round(damageRaw / 50) * 50);
    const parties = partyKeys[partyLabels[index] as number] as number;
    const severity: Severity = injury ? (damage >= 15000 ? 'severe' : 'moderate') : damage >= 8000 ? 'moderate' : 'minor';
    return {
      index,
      registered: reg,
      city,
      zone,
      sub_zone: sub,
      location,
      case_type: CASE_TYPES[typeLabels[index] as number] as CaseTypeName,
      parties,
      injury,
      damage_sar: damage,
      severity,
      channel: channelKeys[miscRng.weightedIndex(channelWeights)] as string,
      handling: 'remote_inferred',
      // Cases the active rules send to the field whatever the case type: injury, damage of SAR 10,000 or more, four or more parties.
      forcedField: injury || damage >= 10000 || parties >= 4,
    };
  });

  // 3. Handling: an exact field quota per case type. Forced cases first, then three-party cases (boosted), then the rest.
  const handlingRng = rng.fork('handling');
  for (const type of CASE_TYPES) {
    const ofType = drafts.filter((d) => d.case_type === type);
    const quota = Math.round(TYPE_FIELD_SHARE[type] * ofType.length);
    const scored = ofType.map((d) => ({ d, score: d.forcedField ? -1 : handlingRng.next() - (d.parties === 3 ? hm.three_party_field_boost.value : 0) }));
    scored.sort((a, b) => a.score - b.score || a.d.index - b.d.index);
    scored.slice(0, quota).forEach((s) => {
      s.d.handling = 'field';
    });
  }

  // 4. Timing draws for field cases, stratified so sample quantiles sit on the targets.
  const dist = timingDistributions();
  const fieldDrafts = drafts.filter((d) => d.handling === 'field');
  const n = fieldDrafts.length;
  const u1 = stratifiedUniforms(rng.fork('d1'), n);
  const u3 = stratifiedUniforms(rng.fork('d3'), n);
  const leadRng = rng.fork('lead');

  // Which Unlisted field cases were assigned before they were registered: an exact share.
  const unlistedField = fieldDrafts.filter((d) => d.case_type === 'Unlisted');
  const preCount = Math.round(calibration.demand.assigned_before_registration.share_of_unlisted_field_cases.value * unlistedField.length);
  const preSet = new Set<number>(leadRng.shuffle(unlistedField.map((d) => d.index)).slice(0, preCount));

  interface FieldTiming {
    draft: Draft;
    assigned: number;
    d3: number;
    pre: boolean;
  }
  const timings: FieldTiming[] = fieldDrafts.map((draft, i) => {
    const pre = preSet.has(draft.index);
    let assigned: number;
    if (pre) {
      const lead = clamp(calibration.demand.assigned_before_registration.lead_minutes_median.value * Math.exp(0.5 * leadRng.normal()), 1, calibration.demand.assigned_before_registration.lead_minutes_max.value);
      assigned = draft.registered - Math.round(lead * 60);
    } else {
      const d1 = Math.min(tm.registered_to_assigned_cap_min.value, lognormalQuantile(u1[i] as number, dist.d1));
      assigned = draft.registered + Math.round(d1 * 60);
    }
    const d3 = clamp(lognormalQuantile(u3[i] as number, dist.d3), tm.arrived_to_closed_min_min.value, tm.arrived_to_closed_cap_min.value);
    return { draft, assigned, d3: Math.round(d3 * 60), pre };
  });
  timings.sort((a, b) => a.assigned - b.assigned || a.draft.index - b.draft.index);

  const fieldByZone = new Map<string, AgentDef[]>();
  const fieldByCity = new Map<string, AgentDef[]>();
  for (const s of world.agents) {
    if (s.work_mode !== 'field') continue;
    fieldByZone.set(s.zone_id, [...(fieldByZone.get(s.zone_id) ?? []), s]);
    fieldByCity.set(s.city_id, [...(fieldByCity.get(s.city_id) ?? []), s]);
  }

  // 5. Agent choice: shortest expected drive.
  const busy = new Map<string, number>(carryIn.busy_until);
  const lastJob = new Map<string, LastJob>(carryIn.last_job);
  const assignRng = rng.fork('assign');
  const vehicleMaps = new Map<string, Map<string, string>>();
  const vehiclesFor = (zoneId: string, rosterDate: string): Map<string, string> => {
    const key = `${zoneId}|${rosterDate}`;
    let m = vehicleMaps.get(key);
    if (m === undefined) {
      m = vehiclesForZoneDate(world, zoneId, rosterDate);
      vehicleMaps.set(key, m);
    }
    return m;
  };

  /** Where an agent is when dispatched at `at`: driving back from the last job, or at the waiting spot. */
  const originAt = (sv: AgentDef, at: number): LatLng => {
    const home = sv.home_spot as LatLng;
    const last = lastJob.get(sv.id);
    if (last !== undefined && at >= last.closed && at < last.closed + last.back_seconds) {
      const f = (at - last.closed) / last.back_seconds;
      return { lat: last.location.lat + (home.lat - last.location.lat) * f, lng: last.location.lng + (home.lng - last.location.lng) * f };
    }
    return home;
  };

  interface FieldResult {
    assigned: number;
    depart: number;
    arrived: number;
    on_scene_completed: number;
    closed: number;
    agent: AgentDef;
    vehicle_id: string | null;
    origin: LatLng;
    road_km: number;
    speed_kmh: number;
    returning_until: number;
    overlapped: boolean;
    pre: boolean;
  }
  const fieldResults = new Map<number, FieldResult>();
  const ackMin = tm.dispatch_ack_seconds.min;
  const ackMax = tm.dispatch_ack_seconds.max;

  const dm = mv.drive_model;
  const driveRng = rng.fork('drive');
  const zoneFactor = dm.zone_speed_factor.value as Record<string, number>;
  // Expected road seconds, no noise.
  const driveSeconds = (km: number, at: number, zone: ZoneDef): number => {
    const hour = Math.floor(secondsOfDay(at) / 3600);
    const v = dm.reference_speed_kmh.value * (dm.speed_factor_by_hour.value[hour] as number) * (zoneFactor[zone.code] ?? 1);
    return (km / v) * 3600;
  };

  for (const ft of timings) {
    const { draft } = ft;
    const at = ft.assigned;
    const ack = assignRng.int(ackMin, ackMax);
    type Pick = { s: AgentDef; duty: Duty };
    const search = (pool: readonly AgentDef[]): { best: (Pick & { score: number }) | undefined; fallback: (Pick & { busyUntil: number }) | undefined } => {
      let best: (Pick & { score: number }) | undefined;
      let fallback: (Pick & { busyUntil: number }) | undefined;
      for (const s of pool) {
        const duty = dutyAtMemo(s, at);
        if (duty === null || s.home_spot === null) continue;
        const until = busy.get(s.id) ?? 0;
        const onBreak = at >= duty.break_start && at < duty.break_end;
        if (until > at || onBreak) {
          if (fallback === undefined || until < fallback.busyUntil) fallback = { s, duty, busyUntil: onBreak ? Math.max(until, duty.break_end) : until };
          continue;
        }
        const roadKm = mv.road_distance_factor.value * haversineKm(originAt(s, at), draft.location);
        let score = driveSeconds(roadKm, at, draft.zone);
        if (duty.end - at < 20 * 60) score += dm.shift_end_penalty_seconds.value; // shift about to end
        if (best === undefined || score < best.score) best = { s, duty, score };
      }
      return { best, fallback };
    };
    // Own zone first; if nobody there is free, a free agent of a neighbouring zone in the same city; only then double-book.
    const own = search(fieldByZone.get(draft.zone.id) ?? []);
    let chosen: (Pick & { overlapped: boolean }) | undefined;
    if (own.best !== undefined) chosen = { s: own.best.s, duty: own.best.duty, overlapped: false };
    else {
      const city = search((fieldByCity.get(draft.city.id) ?? []).filter((s) => s.zone_id !== draft.zone.id));
      if (city.best !== undefined) chosen = { s: city.best.s, duty: city.best.duty, overlapped: false };
      else if (own.fallback !== undefined) chosen = { s: own.fallback.s, duty: own.fallback.duty, overlapped: true };
    }
    if (chosen === undefined) throw new Error(`No agent on duty for zone ${draft.zone.code} at ${at} (${date}). The roster leaves a hole.`);

    const origin = originAt(chosen.s, at);
    const roadKm = mv.road_distance_factor.value * haversineKm(origin, draft.location);
    // Drive: expected time x lognormal noise.
    const fastest = Math.ceil((roadKm / mv.max_speed_kmh.value) * 3600);
    const slowest = Math.ceil((roadKm / mv.min_speed_kmh.value) * 3600);
    const drawn = driveSeconds(roadKm, at, draft.zone) * Math.exp(dm.noise_sigma.value * driveRng.normal());
    const setup = dm.setup_seconds.value;
    const lo = Math.max(60, fastest, tm.assigned_to_arrived_min_min.value * 60 - ack - setup);
    const hi = Math.max(lo, Math.min(slowest, tm.assigned_to_arrived_cap_min.value * 60 - ack - setup));
    const travel = Math.round(clamp(drawn, lo, hi));
    const d2 = ack + setup + travel;
    const arrived = at + d2;
    const speed = roadKm / (travel / 3600);
    const depart = arrived - travel;
    const closed = arrived + ft.d3;
    const frac = assignRng.float(tm.on_scene_completed_fraction_of_closing.min, tm.on_scene_completed_fraction_of_closing.max);
    const onScene = arrived + Math.round(frac * ft.d3);
    const backKm = mv.road_distance_factor.value * haversineKm(draft.location, chosen.s.home_spot as LatLng);
    const back = Math.max(60, Math.round(driveSeconds(backKm, closed, draft.zone) / assignRng.float(0.9, 1.1)));
    const rosterDate = chosen.duty.roster_date;
    busy.set(chosen.s.id, Math.max(busy.get(chosen.s.id) ?? 0, closed));
    lastJob.set(chosen.s.id, { location: draft.location, closed, back_seconds: back });
    fieldResults.set(draft.index, {
      assigned: at,
      depart,
      arrived,
      on_scene_completed: onScene,
      closed,
      agent: chosen.s,
      vehicle_id: vehiclesFor(chosen.s.zone_id, rosterDate).get(chosen.s.id) ?? null,
      origin,
      road_km: roadKm,
      speed_kmh: speed,
      returning_until: closed + back,
      overlapped: chosen.overlapped,
      pre: ft.pre,
    });
  }

  // 6. Remote review: a first-come queue per city. Overnight cases wait for the daytime queue.
  const reviewerFree = new Map<string, number[]>();
  const remoteCountByCity = new Map<string, number>();
  for (const s of world.agents) if (s.work_mode === 'remote') remoteCountByCity.set(s.city_id, (remoteCountByCity.get(s.city_id) ?? 0) + 1);
  for (const city of cities) {
    const servers = Math.max(1, Math.round((remoteCountByCity.get(city.id) ?? 0) * rq.reviewers_per_remote_agent.value));
    const carried = carryIn.reviewer_free.get(city.id);
    const arr: number[] = [];
    for (let i = 0; i < servers; i += 1) arr.push(carried?.[i] ?? midnight);
    reviewerFree.set(city.id, arr);
  }
  const overnightUntil = parseClock(rq.overnight_until.value);
  const opensAt = parseClock(rq.daytime_queue_opens.value);
  const windowFrom = parseClock(rq.working_window.from);
  const windowTo = parseClock(rq.working_window.to);
  const reviewRng = rng.fork('review');
  const remoteDrafts = drafts.filter((d) => d.handling === 'remote_inferred').map((d) => {
    let eligible = d.registered + 180;
    if (secondsOfDay(d.registered) < overnightUntil) eligible = Math.max(eligible, midnight + opensAt);
    return { d, eligible };
  });
  remoteDrafts.sort((a, b) => a.eligible - b.eligible || a.d.index - b.d.index);
  const remoteResults = new Map<number, { review_at: number; closed: number }>();
  for (const { d, eligible } of remoteDrafts) {
    const servers = reviewerFree.get(d.city.id) as number[];
    let k = 0;
    for (let i = 1; i < servers.length; i += 1) if ((servers[i] as number) < (servers[k] as number)) k = i;
    let start = Math.max(eligible, servers[k] as number);
    const sod = secondsOfDay(start);
    const day0 = start - sod;
    if (sod < windowFrom) start = day0 + windowFrom;
    else if (sod >= windowTo) start = day0 + DAY_SECONDS + windowFrom;
    const review = reviewRng.int(rq.review_minutes.min * 60, rq.review_minutes.max * 60);
    const paperwork = reviewRng.int(rq.paperwork_minutes.min * 60, rq.paperwork_minutes.max * 60);
    const closed = start + review + paperwork;
    servers[k] = closed;
    remoteResults.set(d.index, { review_at: start, closed });
  }

  // 7. Numbers and ids, in registration order.
  const seqByCity = new Map<string, number>();
  const dayOffset = dateRange('2026-09-01', date).length - 1;
  const cases: PlannedCase[] = drafts.map((d) => {
    const seq = (seqByCity.get(d.city.code) ?? 0) + 1;
    seqByCity.set(d.city.code, seq);
    const caseNumber = `${d.city.code}-${yymmdd(date)}-${String(seq).padStart(5, '0')}`;
    const f = fieldResults.get(d.index);
    const r = remoteResults.get(d.index);
    return {
      date,
      index: d.index,
      case_number: caseNumber,
      id: uuidFor(seed, 'case', caseNumber),
      external_id: String(6000000 + dayOffset * 2000 + d.index),
      registered: d.registered,
      city: d.city,
      zone: d.zone,
      sub_zone: d.sub_zone,
      location: d.location,
      case_type: d.case_type,
      parties: d.parties,
      injury: d.injury,
      damage_sar: d.damage_sar,
      severity: d.severity,
      channel: d.channel,
      handling: d.handling,
      assigned: f?.assigned ?? null,
      assigned_before_registration: f?.pre ?? false,
      depart: f?.depart ?? null,
      arrived: f?.arrived ?? null,
      on_scene_completed: f?.on_scene_completed ?? null,
      agent: f?.agent ?? null,
      vehicle_id: f?.vehicle_id ?? null,
      origin: f?.origin ?? null,
      road_km: f?.road_km ?? null,
      speed_kmh: f?.speed_kmh ?? null,
      returning_until: f?.returning_until ?? null,
      overlapped: f?.overlapped ?? false,
      remote_review_at: r?.review_at ?? null,
      closed: f?.closed ?? (r as { closed: number }).closed,
    };
  });

  return { date, cases, carry_out: { busy_until: busy, last_job: lastJob, reviewer_free: reviewerFree } };
}

/** Plans every day from the first case day to `lastDate`, chaining the carry-over. Memoised by seed. */
const chainCache = new Map<string, DayPlan[]>();

export function planChain(world: World, seed: string, lastDate: string): readonly DayPlan[] {
  const first = calibration.structure.first_case_day.value;
  const dates = dateRange(first, lastDate);
  const plans = chainCache.get(seed) ?? [];
  chainCache.set(seed, plans);
  while (plans.length < dates.length) {
    const date = dates[plans.length] as string;
    const previous = plans[plans.length - 1];
    plans.push(planDay(world, seed, date, previous?.carry_out ?? EMPTY_CARRY));
  }
  return plans.slice(0, dates.length);
}
