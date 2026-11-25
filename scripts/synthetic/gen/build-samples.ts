// SPDX-License-Identifier: AGPL-3.0-only
// The two sample files of the Admin import screens (Locations: "Use a sample file"; Agents: import). SYNTHETIC ONLY (CONTRIBUTING.md
// the no-real-data and calibration-only generator rules): made from calibration.json alone, through the same invented world as the fixtures. Every coordinate is an invented
// offset from a city anchor, every name is invented, Arabic names are empty. The files are importable into a fresh demo
// store: the city code is new, the agent codes are new, and the zones, vehicles and skills they name exist in the fixtures.
// PURE TypeScript, no Node imports.

import { calibration } from './calibration';
import type { Ctx } from './context';
import { offsetKm, type LatLng } from './dist';
import { makeRng } from './rng';

export interface SampleFile {
  /** Relative to the fixtures directory, forward slashes. */
  readonly path: string;
  readonly text: string;
}

const quote = (cell: string): string => (/[",\n\r]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell);
const csv = (rows: readonly (readonly string[])[]): string => `${rows.map((row) => row.map(quote).join(',')).join('\n')}\n`;
const coordinate = (value: number): string => value.toFixed(6);

const LOCATION_HEADER = ['kind', 'code', 'parent_code', 'name_en', 'name_ar', 'latitude', 'longitude', 'coverage_radius_m', 'sub_zone_code'] as const;
const AGENT_HEADER = ['code', 'name_en', 'name_ar', 'kind', 'home_zone_code', 'default_vehicle_code', 'is_active', 'skill_codes'] as const;

/** A new city (code SC), two zones, three sub-zones and two standby points in each zone. Offsets from the Jeddah anchor, 25 to 45 km east. */
function locationsSample(ctx: Ctx): SampleFile {
  const rng = makeRng(ctx.seed, 'samples/locations');
  const anchor: LatLng = (ctx.world.locations.cities.find((c) => c.code === 'JD') ?? (ctx.world.locations.cities[0] as { readonly anchor: LatLng })).anchor;
  const names: string[] = [];
  for (const prefix of calibration.locations.sub_zone_names.prefixes) for (const suffix of calibration.locations.sub_zone_names.suffixes) names.push(`${prefix} ${suffix}`);
  rng.fork('names').shuffle(names);
  let nameCursor = 0;

  const rows: string[][] = [LOCATION_HEADER.slice() as string[]];
  rows.push(['city', 'SC', '', 'Sample City', '', '', '', '', '']);
  const zones = [
    { code: 'SC-N', name: 'Sample North', dy: 4 },
    { code: 'SC-S', name: 'Sample South', dy: -4 },
  ];
  zones.forEach((zone, zoneIndex) => {
    const zrng = rng.fork(`zone/${zone.code}`);
    const center = offsetKm(anchor, 25 + zrng.float(0, 20), zone.dy * 3 + zrng.float(-2, 2));
    rows.push(['zone', zone.code, 'SC', zone.name, '', coordinate(center.lat), coordinate(center.lng), '', '']);
    const subs: { code: string; name: string; center: LatLng }[] = [];
    for (let i = 1; i <= 3; i += 1) {
      const name = names[nameCursor] ?? `Sample Area ${zoneIndex + 1}${i}`;
      nameCursor += 1;
      const at = offsetKm(center, zrng.float(-3, 3), zrng.float(-3, 3));
      const code = `${zone.code}-${String(i).padStart(2, '0')}`;
      subs.push({ code, name, center: at });
      rows.push(['sub_zone', code, zone.code, name, '', coordinate(at.lat), coordinate(at.lng), '', '']);
    }
    for (let i = 1; i <= 2; i += 1) {
      const sub = subs[i - 1] as { code: string; name: string; center: LatLng };
      const at = offsetKm(sub.center, zrng.float(-0.8, 0.8), zrng.float(-0.8, 0.8));
      rows.push(['standby_point', `${zone.code}-SP${i}`, zone.code, `${sub.name} standby`, '', coordinate(at.lat), coordinate(at.lng), String(zrng.int(6, 10) * 500), sub.code]);
    }
  });
  return { path: 'samples/locations_sample.csv', text: csv(rows) };
}

/** Twelve agents: ten field in the fixture zones, two remote. Codes SVR-SMP-001 to 012 are not in the fixtures. */
function agentsSample(ctx: Ctx): SampleFile {
  const rng = makeRng(ctx.seed, 'samples/agents');
  const people = calibration.people;
  const familyNames: string[] = [];
  for (const stem of people.person_names.family_name_stems) for (const ending of people.person_names.family_name_endings) familyNames.push(`Al-${stem}${ending}`);
  const used = new Set(ctx.world.agents.map((s) => s.name_en));
  const pairs: string[] = [];
  for (const given of people.person_names.given_names) for (const family of familyNames) if (!used.has(`${given} ${family}`)) pairs.push(`${given} ${family}`);
  rng.fork('names').shuffle(pairs);

  const skillCodes = people.skills_vocabulary.value.map((s) => s.code);
  const fieldSkills = skillCodes.filter((c) => c !== 'remote_review' && c !== 'senior_agent' && c !== 'night_operations');
  const zones = ctx.world.locations.zones;
  const rows: string[][] = [AGENT_HEADER.slice() as string[]];
  for (let i = 0; i < 12; i += 1) {
    const code = `SVR-SMP-${String(i + 1).padStart(3, '0')}`;
    const remote = i >= 10;
    const zone = zones[i % zones.length] as { readonly id: string; readonly code: string };
    const vehicle = !remote && i < 4 ? ctx.world.vehicles.find((v) => v.zone_id === zone.id) : undefined;
    const pool = [...fieldSkills];
    rng.fork(`skills/${code}`).shuffle(pool);
    const skills = remote ? ['remote_review'] : pool.slice(0, 2 + (i % 3));
    rows.push([code, pairs[i] ?? `Sample Agent ${i + 1}`, '', remote ? 'remote' : 'field', remote ? '' : zone.code, vehicle?.code ?? '', i === 7 ? 'false' : 'true', skills.join(';')]);
  }
  return { path: 'samples/agents_sample.csv', text: csv(rows) };
}

export function buildSamples(ctx: Ctx): SampleFile[] {
  return [locationsSample(ctx), agentsSample(ctx)];
}
