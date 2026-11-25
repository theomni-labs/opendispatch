// SPDX-License-Identifier: AGPL-3.0-only
// Live assignment fixtures: the previous day's assignments, events and shadow-mode comparisons, simulation runs and
// results, and the replay day (cases, placeholder recommendations, scripted events). All illustrative.

import { calibration } from './calibration';
import { base, idOf, round, type Ctx, type Rec } from './context';
import { caseRecord } from './build-core';
import { percentile } from './dist';
import type { PlannedCase } from './dayplan';
import { recommendFor, type Recommendation } from './recommend';
import { hashSeed, uuidFor } from './rng';
import { iso, localDate, parseIso } from './time';
import { userByKey, type UserFx } from './build-reference';
import { plannedCasesForDay } from '../positions';
import type { ScenarioFx } from './build-plans';

/** Shares keep 6 decimals: the contract invariant is share = within_count / case_count within 1e-6, and rounding to 6 digits errs by at most 5e-7. */
const SHARE_DIGITS = 6;

const THRESHOLD = calibration.roles_and_settings.assignment_ten_minute_threshold_seconds.value;
const MODEL_VERSION = calibration.fixtures.forecast.model_version.value;

const share = (key: string, salt: string): number => (hashSeed(`${key}|${salt}`) % 10000) / 10000;

const OVERRIDE_REASONS: { code: string; weight: number }[] = [
  { code: 'closer_agent_known', weight: 0.4 },
  { code: 'agent_unavailable', weight: 0.25 },
  { code: 'skills_needed', weight: 0.15 },
  { code: 'dispatcher_judgement', weight: 0.15 },
  { code: 'other', weight: 0.05 },
];

function pickReason(key: string): string {
  let r = share(key, 'reason');
  for (const o of OVERRIDE_REASONS) {
    if (r < o.weight) return o.code;
    r -= o.weight;
  }
  return 'other';
}

export interface LiveFx {
  readonly assignments: Rec[];
  readonly events: Rec[];
  readonly comparisons: Rec[];
  /** Case id to the OpenDispatch pick, for the simulation. */
  readonly recs: Map<string, Recommendation>;
  readonly cases: readonly PlannedCase[];
}

/** The outage that the previous day's recommend zones went through: The customer's dispatch assigned these cases itself. */
const FALLBACK_FROM = '15:40:00';
const FALLBACK_TO = '15:52:00';

export function buildLiveHistory(ctx: Ctx, users: readonly UserFx[], date: string): LiveFx {
  const dispatcher = userByKey(users, 'dispatcher').id;
  const cases = plannedCasesForDay(ctx.seed, date).filter((c) => c.handling === 'field' && c.agent !== null && c.assigned !== null && c.arrived !== null);
  const assignments: Rec[] = [];
  const events: Rec[] = [];
  const comparisons: Rec[] = [];
  const recs = new Map<string, Recommendation>();
  const outageFrom = parseIso(`${date}T${FALLBACK_FROM}+03:00`);
  const outageTo = parseIso(`${date}T${FALLBACK_TO}+03:00`);

  for (const c of cases) {
    const agent = c.agent as NonNullable<PlannedCase['agent']>;
    const decidedAt = c.registered + 1 + (hashSeed(`${c.id}|latency`) % 3);
    const rec = recommendFor(ctx.world, ctx.seed, c, decidedAt);
    recs.set(c.id, rec);
    const top = rec.ranking[0];
    const stage = c.zone.live_stage;
    const key = c.case_number;

    const addEvent = (n: number, assignmentId: string | null, type: string, at: number, source: string, actor: string | null, extra?: { reason?: string; note?: string | null; detail?: Rec }): void => {
      const rec2: Rec = {
        ...base(ctx, 'assignment_event', `${key}|${n}`, at),
        assignment_id: assignmentId,
        case_id: c.id,
        event_type: type,
        occurred_at: iso(at),
        source,
        actor_user_id: actor,
      };
      if (extra?.reason !== undefined) rec2['reason_code'] = extra.reason;
      rec2['note'] = extra?.note ?? null;
      rec2['detail'] = extra?.detail ?? {};
      events.push(rec2);
    };

    const assignment = (suffix: string, at: number, fields: { agent: string; source: string; state: string; reason: string | null; note: string | null; estArrival: number | null; estTravel: number | null; by: string | null; stageValue: string }): Rec => {
      const rec2: Rec = {
        ...base(ctx, 'assignment', `${key}|${suffix}`, at, at),
        case_id: c.id,
        agent_id: fields.agent,
        decided_at: iso(at),
        source: fields.source,
        stage: fields.stageValue,
        state: fields.state,
        reason_code: fields.reason,
        reason_note: fields.note,
        estimated_arrival_at: fields.estArrival === null ? null : iso(fields.estArrival),
        estimated_travel_seconds: fields.estTravel,
        decided_by_user_id: fields.by,
        model_version: fields.source === 'OPENDISPATCH' ? MODEL_VERSION : null,
        extra: { illustrative: true },
      };
      assignments.push(rec2);
      return rec2;
    };

    if (stage === 'shadow') {
      if (top === undefined) continue;
      const a = assignment('opendispatch', decidedAt, { agent: top.agent_id, source: 'OPENDISPATCH', state: 'shadow', reason: null, note: null, estArrival: top.estimated_arrival_at, estTravel: top.estimated_travel_seconds, by: null, stageValue: 'shadow' });
      addEvent(1, a['id'] as string, 'recommended', decidedAt, 'OPENDISPATCH', null, { detail: { rank: 1, sent: false } });
      const opendispatchFromReg = decidedAt - c.registered + top.estimated_travel_seconds;
      const customerFromAssign = (c.arrived as number) - (c.assigned as number);
      const customerFromReg = (c.arrived as number) - c.registered;
      comparisons.push({
        ...base(ctx, 'assignment_comparison', key, decidedAt, c.arrived as number),
        case_id: c.id,
        zone_id: c.zone.id,
        compared_at: iso(c.arrived as number),
        same_agent: top.agent_id === agent.id,
        opendispatch: {
          agent_id: top.agent_id,
          assigned_at: iso(decidedAt),
          estimated_travel_seconds: top.estimated_travel_seconds,
          actual_travel_seconds: null,
          reading: {
            threshold_seconds: THRESHOLD,
            from_registration_seconds: opendispatchFromReg,
            from_assignment_seconds: top.estimated_travel_seconds,
            within_from_registration: opendispatchFromReg <= THRESHOLD,
            within_from_assignment: top.estimated_travel_seconds <= THRESHOLD,
          },
        },
        customer: {
          agent_id: agent.id,
          assigned_at: iso(c.assigned as number),
          estimated_travel_seconds: null,
          actual_travel_seconds: customerFromAssign,
          reading: {
            threshold_seconds: THRESHOLD,
            from_registration_seconds: customerFromReg,
            from_assignment_seconds: customerFromAssign,
            within_from_registration: customerFromReg <= THRESHOLD,
            within_from_assignment: customerFromAssign <= THRESHOLD,
          },
        },
      });
      continue;
    }

    // Recommend stage.
    if (c.registered >= outageFrom && c.registered < outageTo) {
      const a = assignment('fallback', c.assigned as number, { agent: agent.id, source: 'CUSTOMER_FALLBACK', state: 'assigned', reason: null, note: null, estArrival: c.arrived as number, estTravel: (c.arrived as number) - (c.assigned as number), by: null, stageValue: 'recommend' });
      addEvent(1, a['id'] as string, 'fallback_triggered', c.registered + calibration.roles_and_settings.fallback_timeout_seconds.value, 'CUSTOMER_FALLBACK', null, { detail: { reason: 'opendispatch_timeout' } });
      addEvent(2, a['id'] as string, 'sent', c.assigned as number, 'CUSTOMER_FALLBACK', null);
      continue;
    }
    if (top === undefined) continue;
    const roll = share(c.id, 'decision');
    const dispatcherDelay = 20 + (hashSeed(`${c.id}|delay`) % 70);
    // An override needs a different agent than the recommendation: The customer's own pick when it differs, else the second choice.
    const second = rec.ranking[1];
    const overrideTo: { id: string; arrival: number; travel: number } | undefined =
      agent.id !== top.agent_id
        ? { id: agent.id, arrival: c.arrived as number, travel: (c.arrived as number) - (c.assigned as number) }
        : second === undefined
          ? undefined
          : { id: second.agent_id, arrival: second.estimated_arrival_at, travel: second.estimated_travel_seconds };
    if (roll < 0.84 || overrideTo === undefined) {
      const a = assignment('opendispatch', decidedAt, { agent: top.agent_id, source: 'OPENDISPATCH', state: 'assigned', reason: null, note: null, estArrival: top.estimated_arrival_at, estTravel: top.estimated_travel_seconds, by: dispatcher, stageValue: 'recommend' });
      const id = a['id'] as string;
      addEvent(1, id, 'recommended', decidedAt, 'OPENDISPATCH', null, { detail: { rank: 1 } });
      addEvent(2, id, 'accepted', decidedAt + dispatcherDelay, 'OPENDISPATCH', dispatcher);
      addEvent(3, id, 'sent', decidedAt + dispatcherDelay + 2, 'OPENDISPATCH', null);
      addEvent(4, id, 'acknowledged', decidedAt + dispatcherDelay + 20 + (hashSeed(`${c.id}|ack`) % 40), 'OPENDISPATCH', null);
    } else {
      const reason = pickReason(c.id);
      const note = reason === 'other' ? 'Caller asked for a specific agent who had attended before.' : null;
      const first = assignment('opendispatch', decidedAt, { agent: top.agent_id, source: 'OPENDISPATCH', state: 'overridden', reason, note, estArrival: top.estimated_arrival_at, estTravel: top.estimated_travel_seconds, by: dispatcher, stageValue: 'recommend' });
      const at = decidedAt + dispatcherDelay;
      const manual = assignment('manual', at, { agent: overrideTo.id, source: 'MANUAL', state: 'assigned', reason, note, estArrival: overrideTo.arrival, estTravel: overrideTo.travel, by: dispatcher, stageValue: 'recommend' });
      addEvent(1, first['id'] as string, 'recommended', decidedAt, 'OPENDISPATCH', null, { detail: { rank: 1 } });
      addEvent(2, manual['id'] as string, 'overridden', at, 'MANUAL', dispatcher, { reason, note, detail: { from_agent_id: top.agent_id, to_agent_id: overrideTo.id } });
      addEvent(3, manual['id'] as string, 'sent', at + 2, 'MANUAL', null);
      addEvent(4, manual['id'] as string, 'acknowledged', at + 25, 'MANUAL', null);
    }
  }
  return { assignments, events, comparisons, recs, cases };
}

// ---------------------------------------------------------------------------------------------------------------------
// Simulation runs and results (illustrative)
// ---------------------------------------------------------------------------------------------------------------------

interface Reading {
  within_count: number;
  case_count: number;
  share: number | null;
}

interface ZoneStats {
  zoneId: string;
  caseCount: number;
  fieldCount: number;
  remoteCount: number;
  fromRegistration: Reading;
  fromAssignment: Reading;
  medianTravel: number | null;
  p90Travel: number | null;
  medianRegToAssigned: number | null;
  p90RegToAssigned: number | null;
  medianRegToArrived: number | null;
  p90RegToArrived: number | null;
}

function reading(within: number, total: number): Reading {
  return { within_count: within, case_count: total, share: total > 0 ? round(within / total, SHARE_DIGITS) : null };
}

/** Per-zone figures for a set of cases, from either the actual times or the OpenDispatch estimates. */
export function zoneStats(ctx: Ctx, cases: readonly PlannedCase[], recs: Map<string, Recommendation> | null): ZoneStats[] {
  const out: ZoneStats[] = [];
  for (const zone of ctx.world.locations.zones) {
    const all = cases.filter((c) => c.zone.id === zone.id);
    const field = all.filter((c) => c.handling === 'field' && c.assigned !== null && c.arrived !== null);
    const regToAssigned: number[] = [];
    const travel: number[] = [];
    const regToArrived: number[] = [];
    let withinReg = 0;
    let withinAssign = 0;
    let counted = 0;
    for (const c of field) {
      let toAssigned: number;
      let trav: number;
      if (recs === null) {
        toAssigned = (c.assigned as number) - c.registered;
        trav = (c.arrived as number) - (c.assigned as number);
      } else {
        const rec = recs.get(c.id)?.ranking[0];
        if (rec === undefined) continue;
        toAssigned = (recs.get(c.id)?.decided_at ?? c.registered) - c.registered;
        trav = rec.estimated_travel_seconds;
      }
      counted += 1;
      regToAssigned.push(toAssigned);
      travel.push(trav);
      regToArrived.push(toAssigned + trav);
      if (toAssigned + trav <= THRESHOLD) withinReg += 1;
      if (trav <= THRESHOLD) withinAssign += 1;
    }
    const sorted = (a: number[]): number[] => [...a].sort((x, y) => x - y);
    const pct = (a: number[], p: number): number | null => (a.length === 0 ? null : Math.round(percentile(sorted(a), p)));
    out.push({
      zoneId: zone.id,
      caseCount: all.length,
      fieldCount: counted,
      remoteCount: all.length - all.filter((c) => c.handling === 'field').length,
      fromRegistration: reading(withinReg, counted),
      fromAssignment: reading(withinAssign, counted),
      medianTravel: pct(travel, 50),
      p90Travel: pct(travel, 90),
      medianRegToAssigned: pct(regToAssigned, 50),
      p90RegToAssigned: pct(regToAssigned, 90),
      medianRegToArrived: pct(regToArrived, 50),
      p90RegToArrived: pct(regToArrived, 90),
    });
  }
  return out;
}

export interface SimFx {
  readonly runs: Rec[];
  readonly results: Rec[];
  readonly statsByRun: Map<string, ZoneStats[]>;
  readonly runIds: { actual: string; nearest: string; scenario: string };
}

export function buildSimulations(ctx: Ctx, users: readonly UserFx[], live: LiveFx, scenarios: readonly ScenarioFx[], forecastZoneTotals: Map<string, number[]>): SimFx {
  const planner = userByKey(users, 'planner').id;
  const date = localDate(live.cases[0]?.registered ?? parseIso(`${ctx.lastCaseDay}T12:00:00+03:00`));
  const allCases = plannedCasesForDay(ctx.seed, date);
  const actual = zoneStats(ctx, allCases, null);
  const nearest = zoneStats(ctx, allCases, live.recs);
  const scenario = scenarios.find((s) => s.key === 'riyadh_plus_four') as ScenarioFx;

  // The scenario run predicts tomorrow from the forecast: more agents shorten the drive a little. Illustrative only.
  const scen: ZoneStats[] = nearest.map((n) => {
    const total = (forecastZoneTotals.get(n.zoneId) ?? []).reduce((a, b) => a + b, 0);
    const caseCount = Math.round(total);
    const fieldCount = Math.round(caseCount * 0.575);
    const boost = scenario.zoneIds.includes(n.zoneId) ? 0.05 : 0.01;
    const shareA = Math.min(0.99, (n.fromAssignment.share ?? 0) + boost);
    const shareR = Math.min(0.99, (n.fromRegistration.share ?? 0) + boost);
    const factor = scenario.zoneIds.includes(n.zoneId) ? 0.9 : 0.98;
    return {
      ...n,
      caseCount,
      fieldCount,
      remoteCount: caseCount - fieldCount,
      fromAssignment: reading(Math.round(shareA * fieldCount), fieldCount),
      fromRegistration: reading(Math.round(shareR * fieldCount), fieldCount),
      medianTravel: n.medianTravel === null ? null : Math.round(n.medianTravel * factor),
      p90Travel: n.p90Travel === null ? null : Math.round(n.p90Travel * factor),
    };
  });

  const finished = parseIso('2026-09-12T23:50:00+03:00');
  const defs = [
    { key: 'actual', roster: null, scenario: null, runDate: date, policy: 'replay_actual', stats: actual, at: finished },
    { key: 'nearest', roster: null, scenario: null, runDate: date, policy: 'nearest', stats: nearest, at: finished + 300 },
    { key: 'scenario', roster: null, scenario: scenario.id, runDate: '2026-09-14', policy: 'scorer', stats: scen, at: parseIso('2026-09-11T10:20:00+03:00') },
  ] as const;

  const runs: Rec[] = [];
  const results: Rec[] = [];
  const statsByRun = new Map<string, ZoneStats[]>();
  const runIds = { actual: '', nearest: '', scenario: '' };
  for (const d of defs) {
    const id = idOf(ctx, 'simulation_run', d.key);
    runIds[d.key] = id;
    statsByRun.set(id, d.stats as ZoneStats[]);
    runs.push({
      ...base(ctx, 'simulation_run', d.key, d.at - 120, d.at, planner),
      roster_id: d.roster,
      scenario_id: d.scenario,
      run_date: d.runDate,
      assignment_policy: d.policy,
      primary_clock_start: calibration.roles_and_settings.ten_minute_clock_start.value,
      threshold_seconds: THRESHOLD,
      status: 'succeeded',
      illustrative: true,
      engine_version: '0.1.0',
      finished_at: iso(d.at),
    });
    for (const z of d.stats) {
      results.push({
        ...base(ctx, 'simulation_result', `${d.key}|${z.zoneId}`, d.at, d.at),
        simulation_run_id: id,
        zone_id: z.zoneId,
        interval_start: null,
        case_count: z.caseCount,
        field_case_count: z.fieldCount,
        from_registration: z.fromRegistration,
        from_assignment: z.fromAssignment,
        median_assigned_to_arrived_seconds: z.medianTravel,
        p90_assigned_to_arrived_seconds: z.p90Travel,
      });
    }
  }
  return { runs, results, statsByRun, runIds };
}

export function simulatorOutput(ctx: Ctx, sim: SimFx): Record<string, unknown> {
  const id = sim.runIds.nearest;
  const stats = sim.statsByRun.get(id) as ZoneStats[];
  const level = (z: ZoneStats[]): Record<string, unknown> => {
    const field = z.reduce((a, s) => a + s.fieldCount, 0);
    const wr = z.reduce((a, s) => a + s.fromRegistration.within_count, 0);
    const wa = z.reduce((a, s) => a + s.fromAssignment.within_count, 0);
    const mid = (pick: (s: ZoneStats) => number | null): number | null => {
      const values = z.map(pick).filter((v): v is number => v !== null);
      return values.length === 0 ? null : Math.round(values.reduce((a, b) => a + b, 0) / values.length);
    };
    return {
      case_count: z.reduce((a, s) => a + s.caseCount, 0),
      field_case_count: field,
      remote_case_count: z.reduce((a, s) => a + s.remoteCount, 0),
      from_registration: { within_count: wr, case_count: field, share: field > 0 ? round(wr / field, SHARE_DIGITS) : null },
      from_assignment: { within_count: wa, case_count: field, share: field > 0 ? round(wa / field, SHARE_DIGITS) : null },
      registered_to_assigned: { median_seconds: mid((s) => s.medianRegToAssigned), p90_seconds: mid((s) => s.p90RegToAssigned) },
      assigned_to_arrived: { median_seconds: mid((s) => s.medianTravel), p90_seconds: mid((s) => s.p90Travel) },
      registered_to_arrived: { median_seconds: mid((s) => s.medianRegToArrived), p90_seconds: mid((s) => s.p90RegToArrived) },
    };
  };
  return {
    schema_version: '1.0',
    request_id: uuidFor(ctx.seed, 'engine_request', 'simulator|nearest'),
    engine: { name: 'simulator', version: '0.1.0' },
    model_version: MODEL_VERSION,
    generated_at: iso(parseIso('2026-09-12T23:55:00+03:00')),
    data_source: 'SYNTHETIC',
    input_data_sources: ['SYNTHETIC'],
    illustrative: true,
    roster_ref: `actual-${ctx.lastCaseDay}`,
    assignment_policy: 'nearest',
    primary_clock_start: calibration.roles_and_settings.ten_minute_clock_start.value,
    threshold_seconds: THRESHOLD,
    overall: level(stats),
    zones: stats.map((z) => ({ zone_id: z.zoneId, service_level: level([z]) })),
    unserved_cases: 0,
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Replay: the demo day's new field cases, placeholder recommendations, scripted events
// ---------------------------------------------------------------------------------------------------------------------

export interface ReplayFx {
  readonly cases: Rec[];
  readonly recommendations: Rec[];
  readonly script: Rec;
}

export function buildReplay(ctx: Ctx): ReplayFx {
  const cfg = calibration.fixtures.replay;
  const date = cfg.day.value;
  const planned = plannedCasesForDay(ctx.seed, date).filter((c) => c.handling === 'field' && c.agent !== null && c.assigned !== null);
  const recs: Rec[] = [];
  const recByCase = new Map<string, Recommendation>();
  for (const c of planned) {
    const decidedAt = c.registered + 1 + (hashSeed(`${c.id}|latency`) % 3);
    const rec = recommendFor(ctx.world, ctx.seed, c, decidedAt);
    recByCase.set(c.id, rec);
    recs.push({
      schema_version: '1.0',
      request_id: uuidFor(ctx.seed, 'engine_request', `assignment|${c.case_number}`),
      engine: { name: 'assignment', version: '0.1.0' },
      model_version: MODEL_VERSION,
      generated_at: iso(decidedAt),
      data_source: 'SYNTHETIC',
      input_data_sources: ['SYNTHETIC'],
      illustrative: true,
      case_id: c.id,
      status: rec.status,
      decision_time_ms: rec.decision_time_ms,
      ranking: rec.ranking.map((r) => ({
        rank: r.rank,
        agent_id: r.agent_id,
        estimated_travel_seconds: r.estimated_travel_seconds,
        estimated_arrival_at: iso(r.estimated_arrival_at),
        score: r.score,
        reason_codes: r.reason_codes,
        reason_text: r.reason_text,
      })),
      ...(rec.excluded.length > 0 ? { excluded: rec.excluded.map((e) => ({ agent_id: e.agent_id, exclusion_code: e.exclusion_code, text: e.text })) } : {}),
    });
  }

  // One reassignment: a Riyadh Central case around 10:30 where the dispatcher prefers the second choice.
  const from = cfg.scripted_reassignment_zone_code.value;
  const candidate = planned.find((c) => {
    const rec = recByCase.get(c.id);
    return c.zone.code === from && c.registered >= parseIso(`${date}T10:30:00+03:00`) && (rec?.ranking.length ?? 0) >= 2;
  });
  const events: Rec[] = [];
  if (candidate !== undefined) {
    const rec = recByCase.get(candidate.id) as Recommendation;
    events.push({
      at: iso((rec.decided_at) + 150),
      kind: 'reassignment',
      case_id: candidate.id,
      case_number: candidate.case_number,
      from_agent_id: (rec.ranking[0] as { agent_id: string }).agent_id,
      request: { agent_id: (rec.ranking[1] as { agent_id: string }).agent_id, reason_code: 'closer_agent_known', note: null },
    });
  }
  events.push({ at: iso(parseIso(`${date}T${cfg.scripted_feed_outage.from}+03:00`)), kind: 'feed_outage', request: { feed: 'case_feed', active: true } });
  events.push({ at: iso(parseIso(`${date}T${cfg.scripted_feed_outage.to}+03:00`)), kind: 'feed_outage', request: { feed: 'case_feed', active: false } });
  events.sort((a, b) => String(a['at']).localeCompare(String(b['at'])));

  const script: Rec = {
    replay_date: date,
    default_start_at: iso(parseIso(`${date}T07:00:00+03:00`)),
    total_cases: planned.length,
    data_source: 'SYNTHETIC',
    note: 'Cases carry the operator\'s actual agent (agent_id) and times for shadow-mode comparison; reveal them only as the replay clock passes them. Agent positions come from agentStateAt(seed, agentId, isoTimestamp) in scripts/synthetic/positions.ts.',
    events,
  };

  return { cases: planned.map((c) => caseRecord(ctx, c)), recommendations: recs, script };
}

