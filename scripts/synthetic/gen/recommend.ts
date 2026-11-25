// SPDX-License-Identifier: AGPL-3.0-only
// The placeholder assignment engine: ranks the agents of a case's zone by estimated travel time from where
// agentStateAt says they are. It stands in for the real engine so the Live Dispatch Board has
// something to show. Every output is illustrative. Node-free.

import { calibration } from './calibration';
import { haversineKm, type LatLng } from './dist';
import type { PlannedCase } from './dayplan';
import { dutyAt, type AgentDef, type World } from './people';
import { hashSeed } from './rng';
import { iso, localDate } from './time';
import { agentStateAt } from '../positions';

export type ReasonCode =
  | 'NEAREST_BY_TRAVEL_TIME'
  | 'SHORTER_TRAVEL_THAN_NEXT'
  | 'HAS_REQUIRED_SKILL'
  | 'VEHICLE_AVAILABLE'
  | 'LOWER_WORKLOAD'
  | 'IN_ROSTER_ZONE'
  | 'AVAILABLE_NOW'
  | 'BREAK_DUE_SOON'
  | 'PRAYER_TIME_SOON'
  | 'SHIFT_ENDING_SOON'
  | 'FINISHING_CURRENT_CASE'
  | 'LONGER_TRAVEL_THAN_BEST'
  | 'HIGHER_WORKLOAD'
  | 'OUTSIDE_ROSTER_ZONE'
  | 'POSITION_NOT_RECENT';

export type ExclusionCode = 'OFFLINE' | 'OFF_SHIFT' | 'ON_BREAK' | 'PRAYER_TIME' | 'NO_VEHICLE' | 'MISSING_SKILL' | 'BUSY' | 'OUT_OF_ZONE' | 'STALE_POSITION';

export interface Ranked {
  readonly rank: number;
  readonly agent_id: string;
  readonly estimated_travel_seconds: number;
  readonly estimated_arrival_at: number;
  readonly score: number;
  readonly reason_codes: readonly ReasonCode[];
  readonly reason_text: string;
}

export interface Excluded {
  readonly agent_id: string;
  readonly exclusion_code: ExclusionCode;
  readonly text: string;
}

export interface Recommendation {
  readonly case_id: string;
  readonly decided_at: number;
  readonly status: 'ranked' | 'no_eligible_agent';
  readonly decision_time_ms: number;
  readonly ranking: readonly Ranked[];
  readonly excluded: readonly Excluded[];
}

const REF_SPEED = calibration.movement.reference_speed_kmh.value;
const ROAD = calibration.movement.road_distance_factor.value;
const PREP_SECONDS = 45;

export function recommendFor(world: World, seed: string, c: PlannedCase, decidedAt: number): Recommendation {
  const date = localDate(decidedAt);
  const pool = world.agents.filter((s) => s.work_mode === 'field' && s.zone_id === c.zone.id);
  const candidates: { s: AgentDef; travel: number; adjusted: number; reasons: ReasonCode[] }[] = [];
  const excluded: Excluded[] = [];

  for (const s of pool) {
    const st = agentStateAt(seed, s.id, iso(decidedAt));
    if (st.status === 'offline') {
      excluded.push({ agent_id: s.id, exclusion_code: 'OFF_SHIFT', text: 'Not on shift.' });
      continue;
    }
    if (st.status === 'on_break') {
      excluded.push({ agent_id: s.id, exclusion_code: 'ON_BREAK', text: 'On the break planned for this shift.' });
      continue;
    }
    if (st.status !== 'available') {
      excluded.push({ agent_id: s.id, exclusion_code: 'BUSY', text: 'Already on a case.' });
      continue;
    }
    if (st.vehicle_id === null) {
      excluded.push({ agent_id: s.id, exclusion_code: 'NO_VEHICLE', text: 'No vehicle rostered for this shift.' });
      continue;
    }
    const from: LatLng = { lat: st.latitude, lng: st.longitude };
    const km = ROAD * haversineKm(from, c.location);
    const travel = Math.round((km / REF_SPEED) * 3600) + PREP_SECONDS;
    let adjusted = travel;
    const reasons: ReasonCode[] = ['AVAILABLE_NOW', 'IN_ROSTER_ZONE', 'VEHICLE_AVAILABLE'];
    if (c.injury) {
      if (s.skills.includes('injury_protocol')) {
        adjusted -= 120;
        reasons.push('HAS_REQUIRED_SKILL');
      } else adjusted += 300;
    } else if (c.parties >= 3 && s.skills.includes('multi_vehicle')) {
      adjusted -= 90;
      reasons.push('HAS_REQUIRED_SKILL');
    }
    const duty = dutyAt(s, decidedAt, date);
    if (duty !== null) {
      if (duty.end - decidedAt < 45 * 60) reasons.push('SHIFT_ENDING_SOON');
      if (duty.break_start > decidedAt && duty.break_start - decidedAt < 30 * 60) reasons.push('BREAK_DUE_SOON');
    }
    if (st.phase === 'returning') reasons.push('FINISHING_CURRENT_CASE');
    candidates.push({ s, travel, adjusted, reasons });
  }

  candidates.sort((a, b) => a.adjusted - b.adjusted || a.s.employee_code.localeCompare(b.s.employee_code));
  const top = candidates.slice(0, 3);
  const bestTravel = top[0]?.travel ?? 0;
  const ranking: Ranked[] = top.map((cand, i) => {
    const reasons = [...cand.reasons];
    const next = top[i + 1];
    let primary: ReasonCode;
    if (i === 0) {
      primary = reasons.includes('HAS_REQUIRED_SKILL') && cand.travel > (top[1]?.travel ?? Infinity) ? 'HAS_REQUIRED_SKILL' : 'NEAREST_BY_TRAVEL_TIME';
      if (primary === 'NEAREST_BY_TRAVEL_TIME' && next !== undefined && next.travel - cand.travel >= 60) reasons.push('SHORTER_TRAVEL_THAN_NEXT');
    } else {
      primary = cand.travel > bestTravel ? 'LONGER_TRAVEL_THAN_BEST' : 'NEAREST_BY_TRAVEL_TIME';
    }
    const codes = [primary, ...reasons.filter((r) => r !== primary)];
    const unique = codes.filter((r, k) => codes.indexOf(r) === k);
    const minutes = Math.max(1, Math.round(cand.travel / 60));
    const text =
      i === 0
        ? `Nearest available agent in the zone, about ${minutes} min away${unique.includes('HAS_REQUIRED_SKILL') ? ', with the skill this case needs' : ''}.`
        : `Available in the zone, about ${minutes} min away, ${Math.max(0, Math.round((cand.travel - bestTravel) / 60))} min longer than the first choice.`;
    return {
      rank: i + 1,
      agent_id: cand.s.id,
      estimated_travel_seconds: cand.travel,
      estimated_arrival_at: decidedAt + cand.travel,
      score: Math.max(0, Math.round((100 - cand.adjusted / 18) * 10) / 10),
      reason_codes: unique,
      reason_text: text,
    };
  });

  return {
    case_id: c.id,
    decided_at: decidedAt,
    status: ranking.length > 0 ? 'ranked' : 'no_eligible_agent',
    decision_time_ms: 60 + (hashSeed(`${c.id}|ms`) % 240),
    ranking,
    excluded: excluded.slice(0, 3),
  };
}
