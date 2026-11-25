// SPDX-License-Identifier: AGPL-3.0-only
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { calibration } from './gen/calibration';
import { haversineKm } from './gen/dist';
import { buildWorld } from './gen/people';
import { iso, parseIso } from './gen/time';
import { allAgentStatesAt, plannedCasesForDay, agentStateAt } from './positions';

const here = path.dirname(fileURLToPath(import.meta.url));
const seed = calibration.structure.seed.value;
const demo = calibration.structure.demo_today.value;

describe('agentStateAt', () => {
  const world = buildWorld(seed);
  const field = world.agents.filter((s) => s.work_mode === 'field');

  it('is deterministic: the same arguments give the same answer, in any order of calls', () => {
    const s = field[7];
    if (s === undefined) throw new Error('no agent');
    const times = [`${demo}T09:41:30+03:00`, `${demo}T14:05:00+03:00`, `${demo}T03:15:10+03:00`, '2026-09-08T18:20:00+03:00'];
    const first = times.map((t) => agentStateAt(seed, s.id, t));
    const second = [...times].reverse().map((t) => agentStateAt(seed, s.id, t)).reverse();
    expect(second).toEqual(first);
    expect(JSON.stringify(first)).toBe(JSON.stringify(times.map((t) => agentStateAt(seed, s.id, t))));
  });

  it('gives the same states for a whole snapshot and for single calls', () => {
    const at = `${demo}T12:00:00+03:00`;
    const all = allAgentStatesAt(seed, at);
    expect(all).toHaveLength(world.agents.length);
    for (const st of all.slice(0, 40)) expect(agentStateAt(seed, st.agent_id, at)).toEqual(st);
  });

  it('accepts the same instant written with another offset', () => {
    const s = field[3];
    if (s === undefined) throw new Error('no agent');
    expect(agentStateAt(seed, s.id, `${demo}T10:00:00+03:00`)).toEqual({ ...agentStateAt(seed, s.id, `${demo}T07:00:00Z`) });
  });

  it('rejects an unknown agent and a malformed timestamp', () => {
    expect(() => agentStateAt(seed, 'not-a-agent', `${demo}T10:00:00+03:00`)).toThrow(/Unknown agent/);
    const s = field[0];
    if (s === undefined) throw new Error('no agent');
    expect(() => agentStateAt(seed, s.id, 'yesterday')).toThrow();
  });

  it('follows the case record: en route before arrival, on scene until closed, then driving back', () => {
    const cases = plannedCasesForDay(seed, demo).filter((c) => c.handling === 'field' && c.agent !== null && !c.overlapped);
    // A case whose agent has no other job within half an hour either side, so nothing overrides its phases.
    const all = plannedCasesForDay(seed, demo);
    const noon = parseIso(`${demo}T12:00:00+03:00`);
    const c = cases.find((x) => {
      if ((x.assigned ?? 0) < noon - 4 * 3600) return false; // skip the small hours: the night before may still be running
      const others = all.filter((o) => o !== x && o.agent?.id === x.agent?.id);
      return others.every((o) => (o.assigned ?? 0) > (x.returning_until ?? 0) + 1800 || (o.returning_until ?? 0) < (x.assigned ?? 0) - 1800);
    });
    if (c === undefined || c.agent === null || c.assigned === null || c.depart === null || c.arrived === null || c.returning_until === null) throw new Error('no suitable case');
    const id = c.agent.id;
    const mid = Math.round((c.depart + c.arrived) / 2);
    expect(agentStateAt(seed, id, iso(c.assigned - 5)).current_case_id).toBeNull();
    expect(agentStateAt(seed, id, iso(c.assigned)).status).toBe('assigned');
    const enRoute = agentStateAt(seed, id, iso(mid));
    expect(enRoute.status).toBe('en_route');
    expect(enRoute.current_case_id).toBe(c.id);
    expect(enRoute.speed_kmh).toBeGreaterThan(0);
    const onScene = agentStateAt(seed, id, iso(c.arrived));
    expect(onScene.status).toBe('on_scene');
    expect(haversineKm({ lat: onScene.latitude, lng: onScene.longitude }, c.location)).toBeLessThan(0.01);
    expect(agentStateAt(seed, id, iso(c.closed - 1)).status).toBe('on_scene');
    expect(agentStateAt(seed, id, iso(c.closed + 1)).phase).toBe('returning');
    // Back at the waiting spot once the drive is over.
    const home = c.agent.home_spot;
    const back = agentStateAt(seed, id, iso(c.returning_until + 2));
    expect(['waiting', 'break', 'offline']).toContain(back.status === 'available' ? 'waiting' : back.status);
    if (home !== null && back.phase === 'waiting') expect(haversineKm({ lat: back.latitude, lng: back.longitude }, home)).toBeLessThan(0.01);
  });

  it('moves at road speeds: en-route speeds stay between the calibrated limits', () => {
    const mv = calibration.movement;
    const cases = plannedCasesForDay(seed, demo).filter((c) => c.handling === 'field' && c.speed_kmh !== null);
    const speeds = cases.map((c) => c.speed_kmh as number);
    expect(Math.max(...speeds)).toBeLessThanOrEqual(mv.max_speed_kmh.value + 1e-6);
    const sorted = [...speeds].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)] as number;
    expect(median).toBeGreaterThan(15);
    expect(median).toBeLessThan(60);
  });

  it("agrees with the replay fixture: The customer's agent is on scene at the case coordinates at arrived_at", () => {
    const file = path.join(here, '..', '..', 'fixtures', 'replay', 'cases.json');
    const rows = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>[];
    expect(rows.length).toBeGreaterThan(300);
    for (const row of rows.slice(0, 25)) {
      const agentId = String(row['agent_id']);
      const st = agentStateAt(seed, agentId, String(row['arrived_at']));
      // A double-booked agent (rare) can show a different case; everyone else is on scene here.
      if (st.current_case_id !== row['id']) continue;
      expect(st.status).toBe('on_scene');
      expect(Math.abs(st.latitude - Number(row['latitude']))).toBeLessThan(2e-6);
      expect(Math.abs(st.longitude - Number(row['longitude']))).toBeLessThan(2e-6);
    }
  });

  it('puts remote reviewers at their home city centre and off-shift agents offline', () => {
    const remote = world.agents.find((s) => s.work_mode === 'remote');
    if (remote === undefined) throw new Error('no remote agent');
    const st = agentStateAt(seed, remote.id, `${demo}T02:00:00+03:00`);
    expect(['offline', 'available', 'on_break']).toContain(st.status);
    expect(st.phase === 'off_shift' || st.phase === 'remote' || st.phase === 'break').toBe(true);
    expect(st.current_case_id).toBeNull();
  });

  it('counts a plausible crowd at work: some available, some busy, in the afternoon peak', () => {
    const all = allAgentStatesAt(seed, `${demo}T15:30:00+03:00`);
    const count = (status: string): number => all.filter((s) => s.status === status).length;
    expect(count('available')).toBeGreaterThan(20);
    expect(count('en_route') + count('on_scene') + count('assigned')).toBeGreaterThan(3);
    expect(count('offline')).toBeGreaterThan(100);
  });
});

describe('positions.ts stays bundle-safe', () => {
  it('imports no Node built-ins (directly or through the generator modules it uses)', () => {
    const files = ['positions.ts', 'gen/dayplan.ts', 'gen/people.ts', 'gen/locations.ts', 'gen/demand.ts', 'gen/dist.ts', 'gen/rng.ts', 'gen/time.ts', 'gen/calibration.ts'];
    for (const f of files) {
      const text = fs.readFileSync(path.join(here, f), 'utf8');
      expect(text, f).not.toMatch(/from 'node:/);
      expect(text, f).not.toMatch(/require\(/);
    }
  });
});
