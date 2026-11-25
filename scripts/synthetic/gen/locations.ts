// SPDX-License-Identifier: AGPL-3.0-only
// Invented locations: cities, zones, sub-zones and standby points. Every coordinate is an invented offset
// from a city anchor point. Arabic names are empty (PURE TypeScript, no Node imports.

import { calibration } from './calibration';
import { haversineKm, offsetKm, type LatLng } from './dist';
import { makeRng, uuidFor } from './rng';

export type LiveStage = 'shadow' | 'recommend' | 'automatic';

export interface CityDef {
  readonly id: string;
  readonly code: string;
  readonly name_en: string;
  readonly name_ar: string;
  readonly anchor: LatLng;
  readonly share: number;
}

export interface ZoneDef {
  readonly id: string;
  readonly city_id: string;
  readonly city_code: string;
  readonly code: string;
  readonly name_en: string;
  readonly name_ar: string;
  readonly center: LatLng;
  readonly radius_km: number;
  /** Share of the city's cases that fall in this zone (sums to 1 within a city). */
  readonly demand_weight: number;
  readonly live_stage: LiveStage;
  readonly sort_order: number;
}

export interface SubZoneDef {
  readonly id: string;
  readonly zone_id: string;
  readonly city_id: string;
  readonly code: string;
  readonly name_en: string;
  readonly name_ar: string;
  readonly center: LatLng;
  /** Share of the zone's cases that fall in this sub-zone (sums to 1 within a zone). */
  readonly demand_weight: number;
}

export interface StandbyPointDef {
  readonly id: string;
  readonly zone_id: string;
  readonly sub_zone_id: string;
  readonly code: string;
  readonly name_en: string;
  readonly name_ar: string;
  readonly position: LatLng;
  readonly coverage_radius_m: number;
}

export interface Locations {
  readonly cities: readonly CityDef[];
  readonly zones: readonly ZoneDef[];
  readonly subZones: readonly SubZoneDef[];
  readonly standbyPoints: readonly StandbyPointDef[];
}

const loc = calibration.locations;
const structure = calibration.structure;

function sampleInDisc(rng: ReturnType<typeof makeRng>, radiusKm: number): { dx: number; dy: number } {
  const r = radiusKm * Math.sqrt(rng.next());
  const theta = rng.float(0, 2 * Math.PI);
  return { dx: r * Math.cos(theta), dy: r * Math.sin(theta) };
}

export function buildLocations(seed: string): Locations {
  const root = makeRng(seed, 'locations');

  // Names: unique prefix + suffix pairs, shuffled once.
  const names: string[] = [];
  for (const p of loc.sub_zone_names.prefixes) for (const s of loc.sub_zone_names.suffixes) names.push(`${p} ${s}`);
  root.fork('names').shuffle(names);
  let nameCursor = 0;

  const cities: CityDef[] = [];
  const zones: ZoneDef[] = [];
  const subZones: SubZoneDef[] = [];
  const standbyPoints: StandbyPointDef[] = [];

  let zoneOrder = 0;
  for (const cityCfg of loc.cities) {
    const city: CityDef = {
      id: uuidFor(seed, 'city', cityCfg.code),
      code: cityCfg.code,
      name_en: cityCfg.name_en,
      name_ar: '',
      anchor: cityCfg.anchor,
      share: cityCfg.share.value,
    };
    cities.push(city);
    const weightSum = cityCfg.zones.reduce((a, z) => a + z.demand_weight, 0);

    for (const zoneCfg of cityCfg.zones) {
      zoneOrder += 1;
      const zone: ZoneDef = {
        id: uuidFor(seed, 'zone', zoneCfg.code),
        city_id: city.id,
        city_code: city.code,
        code: zoneCfg.code,
        name_en: zoneCfg.name_en,
        name_ar: '',
        center: offsetKm(city.anchor, zoneCfg.offset_km[0] as number, zoneCfg.offset_km[1] as number),
        radius_km: zoneCfg.radius_km,
        demand_weight: zoneCfg.demand_weight / weightSum,
        live_stage: zoneCfg.live_stage as LiveStage,
        sort_order: zoneOrder,
      };
      zones.push(zone);

      // Sub-zone centres: jittered disc sampling with a minimum separation that relaxes if the zone is crowded.
      const rng = root.fork(`zone/${zone.code}`);
      const count = rng.int(structure.sub_zones_per_zone.min, structure.sub_zones_per_zone.max);
      const centres: LatLng[] = [];
      let minSep = structure.sub_zone_min_separation_km.value;
      for (let attempt = 0; centres.length < count; attempt += 1) {
        if (attempt > 0 && attempt % 200 === 0) minSep *= 0.9;
        const { dx, dy } = sampleInDisc(rng, zone.radius_km);
        const candidate = offsetKm(zone.center, dx, dy);
        if (centres.every((c) => haversineKm(c, candidate) >= minSep)) centres.push(candidate);
      }
      // Number them west to east so the codes read sensibly on a map.
      centres.sort((a, b) => a.lng - b.lng || a.lat - b.lat);

      // Demand weights: lognormal heterogeneity, heavier near the zone centre.
      const raw = centres.map((c) => {
        const closeness = 1.3 - 0.6 * Math.min(1, haversineKm(c, zone.center) / zone.radius_km);
        return Math.exp(loc.sub_zone_demand_sigma.value * rng.normal()) * closeness;
      });
      const rawSum = raw.reduce((a, b) => a + b, 0);

      const zoneSubZones: SubZoneDef[] = centres.map((center, i) => {
        const code = `${zone.code}-${String(i + 1).padStart(2, '0')}`;
        const name = names[nameCursor];
        nameCursor += 1;
        if (name === undefined) throw new Error('Ran out of invented sub-zone names.');
        return {
          id: uuidFor(seed, 'sub_zone', code),
          zone_id: zone.id,
          city_id: city.id,
          code,
          name_en: name,
          name_ar: '',
          center,
          demand_weight: (raw[i] as number) / rawSum,
        };
      });
      subZones.push(...zoneSubZones);

      // Standby points: farthest-point picks over the sub-zone centres, so the points spread across the zone.
      const k = rng.int(structure.standby_points_per_zone.min, structure.standby_points_per_zone.max);
      const first = zoneSubZones.reduce((best, s) => (s.demand_weight > best.demand_weight ? s : best), zoneSubZones[0] as SubZoneDef);
      const chosen: SubZoneDef[] = [first];
      while (chosen.length < Math.min(k, zoneSubZones.length)) {
        let best: SubZoneDef | undefined;
        let bestDist = -1;
        for (const s of zoneSubZones) {
          if (chosen.includes(s)) continue;
          const nearest = Math.min(...chosen.map((c) => haversineKm(c.center, s.center)));
          if (nearest > bestDist) {
            bestDist = nearest;
            best = s;
          }
        }
        if (best === undefined) break;
        chosen.push(best);
      }
      chosen.forEach((sub, i) => {
        const code = `${zone.code}-SP${i + 1}`;
        const jitter = sampleInDisc(rng, 0.35);
        standbyPoints.push({
          id: uuidFor(seed, 'standby_point', code),
          zone_id: zone.id,
          sub_zone_id: sub.id,
          code,
          name_en: `${sub.name_en} standby`,
          name_ar: '',
          position: offsetKm(sub.center, jitter.dx, jitter.dy),
          coverage_radius_m: Math.round(structure.standby_coverage_radius_km.value * 1000),
        });
      });
    }
  }

  return { cities, zones, subZones, standbyPoints };
}
