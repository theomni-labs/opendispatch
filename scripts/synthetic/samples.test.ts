// SPDX-License-Identifier: AGPL-3.0-only
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildSamples } from './gen/build-samples';
import { makeCtx } from './gen/context';
import { haversineKm } from './gen/dist';

// A tiny CSV reader for these tests only (quotes are needed only for commas inside a name).
function parseCsvForTest(text: string): string[][] {
  return text
    .trim()
    .split('\n')
    .map((line) => {
      const cells: string[] = [];
      let cell = '';
      let quoted = false;
      for (let i = 0; i < line.length; i += 1) {
        const ch = line[i] as string;
        if (quoted) {
          if (ch === '"' && line[i + 1] === '"') {
            cell += '"';
            i += 1;
          } else if (ch === '"') quoted = false;
          else cell += ch;
        } else if (ch === '"') quoted = true;
        else if (ch === ',') {
          cells.push(cell);
          cell = '';
        } else cell += ch;
      }
      cells.push(cell);
      return cells;
    });
}

const here = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(here, '..', '..', 'apps', 'web', 'public');

describe('the sample import files (synthetic only, made from calibration.json)', () => {
  const ctx = makeCtx();
  const samples = buildSamples(ctx);
  const byName = (name: string): string => samples.find((s) => s.path === `samples/${name}`)?.text ?? '';

  it('makes the locations and the agents sample, byte for byte the same on every run', () => {
    expect(samples.map((s) => s.path)).toEqual(['samples/locations_sample.csv', 'samples/agents_sample.csv']);
    expect(buildSamples(makeCtx())).toEqual(samples);
    for (const sample of samples) expect(sample.text.endsWith('\n')).toBe(true);
  });

  it('are the files committed under apps/web/public/samples (run pnpm generate:fixtures when the generator changes)', () => {
    for (const sample of samples) expect(fs.readFileSync(path.join(publicDir, sample.path), 'utf8'), sample.path).toBe(sample.text);
  });

  it('locations sample: one new city, two zones, six sub-zones and four standby points, each parent named before it is used, coordinates invented near a city anchor', () => {
    const rows = parseCsvForTest(byName('locations_sample.csv'));
    expect(rows[0]).toEqual(['kind', 'code', 'parent_code', 'name_en', 'name_ar', 'latitude', 'longitude', 'coverage_radius_m', 'sub_zone_code']);
    const data = rows.slice(1).map((r) => Object.fromEntries((rows[0] as string[]).map((h, i) => [h, r[i] ?? ''])));
    const count = (kind: string): number => data.filter((r) => r['kind'] === kind).length;
    expect([count('city'), count('zone'), count('sub_zone'), count('standby_point')]).toEqual([1, 2, 6, 4]);
    const existingCityCodes = new Set(ctx.world.locations.cities.map((c) => c.code));
    const city = data.find((r) => r['kind'] === 'city')!;
    expect(city['code']).toMatch(/^[A-Z]{2}$/);
    expect(existingCityCodes.has(city['code'] as string)).toBe(false); // importable into a fresh demo store
    const codes = new Set<string>();
    for (const r of data) {
      expect(codes.has(`${r['kind']}:${r['code']}`), `${r['kind']} ${r['code']} twice`).toBe(false);
      codes.add(`${r['kind']}:${r['code']}`);
      expect(r['name_en']).not.toBe('');
      expect(r['name_ar']).toBe(''); // Arabic names stay empty
      if (r['kind'] !== 'city') expect(codes.has(`${r['kind'] === 'zone' ? 'city' : 'zone'}:${r['parent_code']}`), `${r['code']} parent`).toBe(true);
      if (r['kind'] === 'standby_point') {
        expect(Number(r['coverage_radius_m'])).toBeGreaterThanOrEqual(100);
        expect(codes.has(`sub_zone:${r['sub_zone_code']}`)).toBe(true);
      }
    }
    // no real coordinates: every point is within 80 km of the calibration anchor it was offset from, and not equal to it
    const anchors = ctx.world.locations.cities.map((c) => c.anchor);
    for (const r of data.filter((x) => x['latitude'] !== '')) {
      const point = { lat: Number(r['latitude']), lng: Number(r['longitude']) };
      const near = Math.min(...anchors.map((a) => haversineKm(a, point)));
      expect(near).toBeLessThan(80);
      expect(anchors.some((a) => a.lat === point.lat && a.lng === point.lng)).toBe(false);
    }
  });

  it('agents sample: twelve agents (ten field, two remote) with codes that are not in the fixtures, zones and vehicles that are', () => {
    const rows = parseCsvForTest(byName('agents_sample.csv'));
    expect(rows[0]).toEqual(['code', 'name_en', 'name_ar', 'kind', 'home_zone_code', 'default_vehicle_code', 'is_active', 'skill_codes']);
    const data = rows.slice(1).map((r) => Object.fromEntries((rows[0] as string[]).map((h, i) => [h, r[i] ?? ''])));
    expect(data).toHaveLength(12);
    expect(data.filter((r) => r['kind'] === 'field')).toHaveLength(10);
    expect(data.filter((r) => r['kind'] === 'remote')).toHaveLength(2);
    const fixtureCodes = new Set(ctx.world.agents.map((s) => s.employee_code));
    const zoneCodes = new Set(ctx.world.locations.zones.map((z) => z.code));
    const vehicleCodes = new Set(ctx.world.vehicles.map((v) => v.code));
    const skills = new Set(ctx.world.agents.flatMap((s) => s.skills));
    expect(new Set(data.map((r) => r['code'])).size).toBe(12);
    for (const r of data) {
      expect(fixtureCodes.has(r['code'] as string)).toBe(false);
      expect(r['name_en']).not.toBe('');
      if (r['kind'] === 'field') expect(zoneCodes.has(r['home_zone_code'] as string)).toBe(true);
      else expect(r['home_zone_code']).toBe('');
      if (r['default_vehicle_code'] !== '') expect(vehicleCodes.has(r['default_vehicle_code'] as string)).toBe(true);
      expect(['true', 'false']).toContain(r['is_active']);
      for (const skill of (r['skill_codes'] as string).split(';').filter((c) => c !== '')) expect(skills.has(skill), skill).toBe(true);
    }
    expect(data.some((r) => r['is_active'] === 'false')).toBe(true);
    expect(data.some((r) => r['default_vehicle_code'] !== '')).toBe(true);
  });
});
