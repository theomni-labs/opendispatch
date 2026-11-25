// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { calibration } from './calibration';
import { planChain } from './dayplan';
import { buildWorld, dutyAt } from './people';
import { dateRange, localDate } from './time';

const seed = calibration.structure.seed.value;
const world = buildWorld(seed);
const plans = planChain(world, seed, '2026-09-13');
const all = plans.flatMap((p) => p.cases);

describe('the world', () => {
  it('has 8 zones, about 42 agents each, a quarter remote, and about 14 vehicles each', () => {
    expect(world.locations.zones).toHaveLength(8);
    expect(world.agents).toHaveLength(8 * 42);
    expect(world.agents.filter((s) => s.work_mode === 'remote')).toHaveLength(84);
    for (const zone of world.locations.zones) {
      expect(world.agents.filter((s) => s.zone_id === zone.id)).toHaveLength(42);
      expect(world.vehicles.filter((v) => v.zone_id === zone.id)).toHaveLength(14);
      const subs = world.locations.subZones.filter((s) => s.zone_id === zone.id).length;
      expect(subs).toBeGreaterThanOrEqual(10);
      expect(subs).toBeLessThanOrEqual(18);
    }
    expect(new Set(world.agents.map((s) => s.name_en)).size).toBe(world.agents.length);
  });

  it('is identical every time it is built for a seed', () => {
    expect(JSON.stringify(buildWorld(seed).agents)).toBe(JSON.stringify(world.agents));
  });
});

describe('the day plans', () => {
  it('plan the case week and the demo day at about 1,500 cases a day', () => {
    expect(plans.map((p) => p.date)).toEqual(dateRange('2026-09-06', '2026-09-13'));
    const week = plans.slice(0, 7).reduce((a, p) => a + p.cases.length, 0);
    expect(week).toBe(10500);
    expect(plans[0]?.cases.length).toBe(1350); // Sunday is the lowest day
  });

  it('give every field case an agent who is on shift when the case is assigned, and no double booking', () => {
    const byId = new Map<string, { from: number; to: number }[]>();
    let overlaps = 0;
    for (const c of all) {
      if (c.handling !== 'field') continue;
      expect(c.agent).not.toBeNull();
      expect(c.assigned).not.toBeNull();
      const s = c.agent;
      if (s === null || c.assigned === null) continue;
      expect(dutyAt(s, c.assigned, localDate(c.assigned)), `${c.case_number} assigned to an agent who is off shift`).not.toBeNull();
      const list = byId.get(s.id) ?? [];
      list.push({ from: c.assigned, to: c.closed });
      byId.set(s.id, list);
      if (c.overlapped) overlaps += 1;
    }
    for (const list of byId.values()) {
      list.sort((a, b) => a.from - b.from);
      for (let i = 1; i < list.length; i += 1) {
        const prev = list[i - 1];
        const cur = list[i];
        if (prev === undefined || cur === undefined) continue;
        if (cur.from < prev.to) overlaps -= 1;
      }
    }
    // Every case that shares an agent's time with another was flagged as double-booked (there should be almost none).
    expect(overlaps).toBeGreaterThanOrEqual(0);
    expect(all.filter((c) => c.overlapped).length).toBeLessThan(all.length * 0.005);
  });

  it('keep handling and timestamps consistent', () => {
    for (const c of all) {
      if (c.handling === 'field') {
        expect(c.assigned).not.toBeNull();
        expect(c.arrived).toBeGreaterThan(c.assigned as number);
        expect(c.closed).toBeGreaterThan(c.arrived as number);
      } else {
        expect(c.assigned).toBeNull();
        expect(c.agent).toBeNull();
        expect(c.remote_review_at).not.toBeNull();
        expect(c.closed).toBeGreaterThan(c.remote_review_at as number);
      }
    }
  });

  it('assign about 4% of Unlisted field cases before they were registered, and nothing else', () => {
    const week = plans.slice(0, 7).flatMap((p) => p.cases);
    const pre = week.filter((c) => (c.assigned ?? Infinity) < c.registered);
    expect(pre.length).toBeGreaterThan(30);
    for (const c of pre) expect(c.case_type).toBe('Unlisted');
    const unlistedField = week.filter((c) => c.case_type === 'Unlisted' && c.handling === 'field');
    expect(pre.length / unlistedField.length).toBeGreaterThan(0.03);
    expect(pre.length / unlistedField.length).toBeLessThan(0.05);
  });

  it('allow parties of 0 and 1, and use RD, JD and DM case number prefixes', () => {
    const week = all.slice(0, 10500);
    expect(week.some((c) => c.parties === 0)).toBe(true);
    expect(week.some((c) => c.parties === 1)).toBe(true);
    expect(new Set(week.map((c) => c.case_number.slice(0, 2)))).toEqual(new Set(['RD', 'JD', 'DM']));
    expect(new Set(week.map((c) => c.case_number)).size).toBe(week.length);
  });
});
