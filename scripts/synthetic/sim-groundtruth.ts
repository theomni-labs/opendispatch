// SPDX-License-Identifier: AGPL-3.0-only
// Simulator ground truth: the synthetic case week as simulator.input requests with the recorded outcomes.
// Reads only the generator (calibration.json). SYNTHETIC: it proves the replay, never real accuracy.
//
//   pnpm synthetic:sim-groundtruth -- --out <dir>   one gzipped simulator.input per day, 14 days

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { calibration } from './gen/calibration';
import { coord, idOf, makeCtx, type Ctx } from './gen/context';
import { dutyOn } from './gen/people';
import { addDays, dateRange, dayStart, DAY_SECONDS, iso } from './gen/time';
import { plannedCasesForDay } from './positions';

export const GROUND_TRUTH_TRAVEL_MODEL = { average_speed_kmh: 40, detour_factor: 1.3 } as const;

/** One case day as a replay_actual request: every case, the recorded field outcomes, the field roster. */
export function groundTruthDay(ctx: Ctx, date: string): Record<string, unknown> {
  const from = dayStart(date);
  const to = from + DAY_SECONDS;
  const cases = plannedCasesForDay(ctx.seed, date).map((c) => {
    const out: Record<string, unknown> = {
      case_id: c.id,
      registered_at: iso(c.registered),
      zone_id: c.zone.id,
      sub_zone_id: c.sub_zone.id,
      latitude: coord(c.location.lat),
      longitude: coord(c.location.lng),
      handling: c.handling,
      parties_involved: c.parties,
    };
    if (c.handling === 'field' && c.assigned !== null && c.arrived !== null && c.agent !== null) {
      out.on_scene_seconds = c.closed - c.arrived;
      out.actual_assigned_at = iso(c.assigned);
      out.actual_agent_id = c.agent.id;
      out.actual_arrived_at = iso(c.arrived);
    }
    return out;
  });
  const assignments: Record<string, unknown>[] = [];
  for (const s of ctx.world.agents) {
    if (s.work_mode !== 'field' || s.home_spot === null) continue;
    for (const d of [addDays(date, -1), date]) {
      const duty = dutyOn(s, d);
      if (duty === null || duty.end <= from || duty.start >= to) continue;
      assignments.push({
        agent_id: s.id,
        shift_pattern_id: idOf(ctx, 'shift_pattern', s.shift_key),
        zone_id: s.zone_id,
        start_at: iso(duty.start),
        end_at: iso(duty.end),
        break_start_at: iso(duty.break_start),
        break_end_at: iso(duty.break_end),
        start_latitude: coord(s.home_spot.lat),
        start_longitude: coord(s.home_spot.lng),
      });
    }
  }
  return {
    schema_version: '1.0',
    request_id: idOf(ctx, 'sim_groundtruth', date),
    requested_at: iso(from),
    data_source: 'SYNTHETIC',
    input_data_sources: ['SYNTHETIC'],
    clock_start_primary: 'assignment',
    threshold_seconds: 600,
    assignment_policy: 'replay_actual',
    travel_model: { ...GROUND_TRUTH_TRAVEL_MODEL },
    seed: 1,
    include_case_outcomes: true,
    cases,
    roster: { roster_ref: `synthetic-${date}`, assignments },
  };
}

/** The fixture week (training) and the week after it (held out). */
export const GROUND_TRUTH_DAYS = 14;

export function groundTruthDays(ctx: Ctx = makeCtx(), days = GROUND_TRUTH_DAYS): { date: string; request: Record<string, unknown> }[] {
  const first = calibration.structure.first_case_day.value;
  return dateRange(first, addDays(first, days - 1)).map((date) => ({ date, request: groundTruthDay(ctx, date) }));
}

export function main(outDir: string): void {
  fs.mkdirSync(outDir, { recursive: true });
  for (const { date, request } of groundTruthDays()) {
    const body = zlib.gzipSync(Buffer.from(`${JSON.stringify(request)}\n`), { level: 9 });
    fs.writeFileSync(path.join(outDir, `${date}.json.gz`), body);
  }
  console.log(`Wrote the simulator ground truth to ${outDir}.`);
}

const invokedDirectly = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  const i = process.argv.indexOf('--out');
  const out = i >= 0 ? process.argv[i + 1] : undefined;
  if (out === undefined) throw new Error('Usage: sim-groundtruth --out <dir>');
  main(path.resolve(out));
}
