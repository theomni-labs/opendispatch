// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { calibration, countSources, findBadSources } from './calibration';
import { baseSlotLevels, checkDayMultipliersAverageOne, slotWeights } from './demand';

describe('calibration.json', () => {
  it('marks every source as exactly "assumption" (every value is invented)', () => {
    expect(findBadSources(calibration)).toEqual([]);
    const counts = countSources(calibration);
    expect(Object.keys(counts).sort()).toEqual(['assumption']);
  });

  it('gives every number an ancestor that names its source (each value carries a source)', () => {
    const missing: string[] = [];
    const walk = (node: unknown, covered: boolean, path: string): void => {
      if (typeof node === 'number') {
        if (!covered) missing.push(path);
      } else if (Array.isArray(node)) {
        node.forEach((n, i) => walk(n, covered, `${path}[${i}]`));
      } else if (node !== null && typeof node === 'object') {
        const o = node as Record<string, unknown>;
        const here = covered || typeof o['source'] === 'string';
        for (const [k, v] of Object.entries(o)) if (k !== 'source') walk(v, here, `${path}.${k}`);
      }
    };
    const { meta, ...rest } = calibration as Record<string, unknown>;
    void meta;
    walk(rest, false, '$');
    expect(missing).toEqual([]);
  });

  it('marks all structural parameters as assumptions', () => {
    const walk = (node: unknown, path: string): string[] => {
      const out: string[] = [];
      if (node !== null && typeof node === 'object') {
        const o = node as Record<string, unknown>;
        if ('source' in o && o['source'] !== 'assumption') out.push(path);
        for (const [k, v] of Object.entries(o)) out.push(...walk(v, `${path}.${k}`));
      }
      return out;
    };
    expect(walk(calibration.structure, 'structure')).toEqual([]);
    expect(calibration.structure.cases_per_day.value).toBe(1500);
    expect(calibration.structure.agents_per_zone.value).toBe(42);
    expect(calibration.structure.vehicles_per_zone.value).toBe(14);
  });

  it('gives every numeric target a value, a source and a tolerance', () => {
    const targets = calibration.targets as Record<string, unknown>;
    for (const [key, entry] of Object.entries(targets)) {
      if (key === 'note' || key === 'extra_figures') continue;
      const e = entry as { value: unknown; source: string; tolerance: { kind: string } };
      expect(e.value, key).not.toBeUndefined();
      expect(['assumption'], key).toContain(e.source);
      expect(['points', 'relative', 'ceiling', 'exact'], key).toContain(e.tolerance.kind);
    }
    expect(calibration.targets.remote_share.value).toBe(0.38);
    expect(calibration.targets.assigned_to_arrived_median_min.value).toBe(10.5);
    expect(calibration.targets.registered_to_assigned_p90_min.value).toBe(14);
  });

  it('keeps the tolerances at +/-10% relative and +/-3 points', () => {
    const t = calibration.targets;
    expect(t.registered_to_assigned_median_min.tolerance).toEqual({ kind: 'relative', value: 0.1 });
    expect(t.remote_share.tolerance).toEqual({ kind: 'points', value: 3 });
  });

  it('has the shape the two daily-shape targets need', () => {
    const w = slotWeights();
    expect(w).toHaveLength(96);
    expect(w.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10);
    const hour = (h: number): number => w.slice(h * 4, h * 4 + 4).reduce((a, b) => a + b, 0);
    expect(hour(0) / hour(6)).toBeCloseTo(0.6, 6);
    expect((w[28] as number) / (w[24] as number)).toBeCloseTo(3.2, 6);
    const quietest = Array.from({ length: 24 }, (_, h) => hour(h)).reduce((best, x, h, all) => (x < (all[best] as number) ? h : best), 0);
    expect(quietest).toBe(3);
    // afternoon peak
    expect(Math.max(...baseSlotLevels().slice(52, 68))).toBeGreaterThan(6.5);
    expect(checkDayMultipliersAverageOne()).toBeCloseTo(1, 10);
  });
});
