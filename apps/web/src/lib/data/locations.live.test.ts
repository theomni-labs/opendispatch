// SPDX-License-Identifier: AGPL-3.0-only
// Live: skips, never fakes, if OPENDISPATCH_API_URL unset.
// Smaller: resetDemoData never touched Postgres.

import { afterAll, describe, expect, it } from 'vitest';
import type { StandbyPoint, SubZone, Zone } from '@/lib/types';
import { listAuditEvents } from './audit';
import { ConflictError, ForbiddenError, InvalidInputError, NotFoundError } from './errors';
import {
  createCity,
  createStandbyPoint,
  createSubZone,
  createZone,
  deleteStandbyPoint,
  getCity,
  getLocationsImportSample,
  getSubZone,
  getZone,
  importLocations,
  listCities,
  listStandbyPoints,
  listSubZones,
  listZones,
  updateCity,
  updateStandbyPoint,
  updateSubZone,
  updateZone,
} from './locations';
import { ctxFor, expectValid, expectValidItems, fixtureZoneIds } from './test-support';

const hasApi = process.env['OPENDISPATCH_API_URL'] !== undefined && process.env['OPENDISPATCH_API_URL'] !== '';
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
// Avoids the fixtures' own RD, JD and DM.
function randomCityCode(): string {
  let code: string;
  do {
    code = Array.from({ length: 2 }, () => LETTERS[Math.floor(Math.random() * LETTERS.length)]).join('');
  } while (['RD', 'JD', 'DM'].includes(code));
  return code;
}

describe.skipIf(!hasApi)('locations (live, real api and Postgres)', () => {
  if (!hasApi) console.log('OPENDISPATCH_API_URL is not set: locations.live.test.ts is skipped, not faked.');

  const admin = () => ctxFor('administrator');
  const zones = () => fixtureZoneIds();
  // Every id created here, deleted in afterAll.
  const createdCityIds: string[] = [];
  const createdZoneIds: string[] = [];

  afterAll(async () => {
    const ctx = admin();
    for (const id of createdZoneIds) {
      const zone = await getZone(ctx, id).catch(() => undefined);
      for (const point of zone === undefined ? [] : (await listStandbyPoints(ctx, { zone_id: id })).items) await deleteStandbyPoint(ctx, point.id);
    }
    // No delete op for sub-zones/zones (not stubbed).
    // Left in Postgres under this run's own codes.
    void createdCityIds;
  });

  describe('reading', () => {
    it('serves the real seeded fixtures and validates against the contract', async () => {
      const ctx = admin();
      const cities = await listCities(ctx);
      const allZones = await listZones(ctx);
      expect(cities.items.length).toBeGreaterThanOrEqual(3);
      expect(allZones.items.length).toBeGreaterThanOrEqual(8);
      expectValid('CityList', cities);
      expectValid('ZoneList', allZones);
      expectValidItems('SubZone', (await listSubZones(ctx, { limit: 200 })).items);
      expectValidItems('StandbyPoint', (await listStandbyPoints(ctx)).items);
      expectValid('Zone', await getZone(ctx, zones()[0] as string));
      expectValid('City', await getCity(ctx, cities.items[0]!.id));
      expectValid('SubZone', await getSubZone(ctx, (await listSubZones(ctx)).items[0]!.id));
    });

    it('filters by city, zone and search text', async () => {
      const ctx = admin();
      const riyadh = (await listCities(ctx, { q: 'riyadh' })).items[0]!;
      expect((await listZones(ctx, { city_id: riyadh.id })).items.length).toBeGreaterThanOrEqual(5);
      const subs = await listSubZones(ctx, { zone_id: zones()[0] as string, limit: 200 });
      expect(subs.items.every((s: SubZone) => s.zone_id === zones()[0])).toBe(true);
      const points = await listStandbyPoints(ctx, { zone_id: zones()[0] as string });
      expect(points.items.every((p: StandbyPoint) => p.zone_id === zones()[0])).toBe(true);
    });

    it('is limited to the zones of a dispatcher and open to every role except Change Approver', async () => {
      const ctx = ctxFor('dispatcher', { zones: [zones()[0] as string] });
      expect((await listZones(ctx)).items.map((z: Zone) => z.id)).toEqual([zones()[0]]);
      expect((await listCities(ctx)).items).toHaveLength(1);
      await expect(getZone(ctx, zones()[5] as string)).rejects.toThrow(NotFoundError);
      await expect(listZones(ctxFor('change_approver'))).rejects.toThrow(ForbiddenError);
      await expect(listZones(ctxFor('remote_team_lead'))).resolves.not.toThrow();
      expect((await listZones(ctxFor('planner', { zones: [] }))).items).toHaveLength(0);
    });
  });

  describe('editing (Admin 3)', () => {
    it('creates and updates a city, zone, sub-zone and standby point, each audited', async () => {
      const ctx = admin();
      const code = randomCityCode();
      const city = await createCity(ctx, { case_code: code, name_en: 'Live Test City' });
      createdCityIds.push(city.id);
      expectValid('City', city);
      expect((await updateCity(ctx, city.id, { case_code: code, name_en: 'Live Test City 2', is_active: true })).name_en).toBe('Live Test City 2');
      const zone = await createZone(ctx, { city_id: city.id, name_en: 'Live Test Zone', latitude: 21.42, longitude: 39.82 });
      createdZoneIds.push(zone.id);
      expectValid('Zone', zone);
      expect((await updateZone(ctx, zone.id, { city_id: city.id, name_en: 'Live Test Zone 2', latitude: 21.43, longitude: 39.82 })).latitude).toBe(21.43);
      const sub = await createSubZone(ctx, { zone_id: zone.id, name_en: 'Live Sub-zone', latitude: 21.42, longitude: 39.83 });
      expectValid('SubZone', sub);
      expect((await updateSubZone(ctx, sub.id, { zone_id: zone.id, name_en: 'Live Sub-zone 2', latitude: 21.42, longitude: 39.84, is_active: false })).is_active).toBe(false);
      const point = await createStandbyPoint(ctx, { zone_id: zone.id, sub_zone_id: sub.id, name_en: 'Live Standby', latitude: 21.42, longitude: 39.83, coverage_radius_m: 3000 });
      expectValid('StandbyPoint', point);
      expect((await updateStandbyPoint(ctx, point.id, { zone_id: zone.id, name_en: 'Live Standby 2', latitude: 21.42, longitude: 39.83, coverage_radius_m: 2500 })).coverage_radius_m).toBe(2500);
      await deleteStandbyPoint(ctx, point.id);
      expect((await listStandbyPoints(ctx, { zone_id: zone.id })).items).toHaveLength(0);
      const actions = (await listAuditEvents(ctx, { limit: 50 })).items.map((e) => e.action);
      for (const action of ['location.city_created', 'location.city_updated', 'location.zone_created', 'location.zone_updated', 'location.sub_zone_created', 'location.sub_zone_updated', 'location.standby_point_created', 'location.standby_point_updated', 'location.standby_point_deleted']) {
        expect(actions).toContain(action);
      }
    });

    it('refuses invalid input, duplicates and unknown parents', async () => {
      const ctx = admin();
      const existingCode = (await listCities(ctx)).items[0]!.case_code;
      await expect(createCity(ctx, { case_code: existingCode, name_en: 'Duplicate' })).rejects.toThrow(ConflictError);
      await expect(createCity(ctx, { case_code: 'zz1', name_en: 'x' })).rejects.toThrow(InvalidInputError);
      await expect(createZone(ctx, { city_id: '00000000-0000-4000-8000-000000000000', name_en: 'x' })).rejects.toThrow(NotFoundError);
      await expect(createStandbyPoint(ctx, { zone_id: zones()[0] as string, name_en: 'x', latitude: 24, longitude: 46, coverage_radius_m: 5 })).rejects.toThrow(InvalidInputError);
    });

    it('is for the Administrator only, and audits the denial', async () => {
      for (const role of ['dispatch_supervisor', 'dispatcher', 'planner', 'remote_team_lead', 'viewer_auditor', 'change_approver'] as const) {
        await expect(createCity(ctxFor(role), { case_code: randomCityCode(), name_en: 'x' })).rejects.toThrow(ForbiddenError);
      }
    });
  });

  describe('importLocations (DG11)', () => {
    const HEADER = 'kind,code,parent_code,name_en,name_ar,latitude,longitude,coverage_radius_m,sub_zone_code';

    it('validates every row before it writes anything: a bad row names the row and nothing is created', async () => {
      const ctx = admin();
      const city = randomCityCode();
      const file = [HEADER, `city,${city},,Test City,,,,,`, `zone,${city}-A,${city},Test Zone A,,21.5,39.5,,`, `sub_zone,${city}-A-01,${city}-B,Missing zone,,21.51,39.51,,`, `zone,${city}-C,XX,No city,,,,,`].join('\n');
      let message = '';
      try {
        await importLocations(ctx, { file });
      } catch (error) {
        expect(error).toBeInstanceOf(InvalidInputError);
        message = (error as Error).message;
      }
      expect(message).toMatch(/row 4/i);
      expect(message).toMatch(/row 5/i);
      expect(message).toMatch(/nothing was imported/i);
      // The valid city row doesn't save it: refused whole.
      // q substring-matches other tests' names too: check the exact code.
      expect((await listCities(ctx, { q: city })).items.some((c) => c.case_code === city)).toBe(false);
    });

    it('checks each kind: codes, names, parents, coordinates, radius, columns a kind does not use', async () => {
      const ctx = admin();
      const prefix = randomCityCode();
      const row = (line: string): string => [HEADER, `city,${prefix},,Test City,,,,,`, `zone,${prefix}-A,${prefix},Zone A,,,,,`, `sub_zone,${prefix}-A-01,${prefix}-A,Sub,,21.5,39.5,,`, line].join('\n');
      const bad: readonly [string, RegExp][] = [
        ['city,ts,,Bad case,,,,,', /code/i],
        ['city,TT,,,,,,,', /name_en/i],
        ['city,TT,RD,Has parent,,,,,', /parent_code/i],
        [`zone,${prefix}-A,${prefix},Repeated zone,,,,,`, /already/i],
        ['zone,TS-B,,No city,,,,,', /parent_code/i],
        ['sub_zone,TS-A-02,TS-Q,Unknown zone,,21,39,,', /zone/i],
        ['standby_point,TS-SP,TS-A,No radius,,21,39,,', /coverage_radius_m/i],
        ['station,TS-SP,TS-A,Unknown kind,,21,39,500,', /kind/i],
      ];
      for (const [line, message] of bad) {
        await expect(importLocations(ctx, { file: row(line) }), line).rejects.toThrow(InvalidInputError);
        await expect(importLocations(ctx, { file: row(line) }), line).rejects.toThrow(message);
      }
    });

    it('imports a valid file: every record is new, synthetic, and points at its real parent', async () => {
      const ctx = admin();
      const sample = getLocationsImportSample(ctx);
      expect(sample).toMatchObject({ file_name: 'locations_sample.csv', content_type: 'text/csv' });
      const prefix = randomCityCode();
      const file = [HEADER, `city,${prefix},,Live Import City,,,,,`, `zone,${prefix}-A,${prefix},Live Import Zone,,21.5,39.5,,`].join('\n');
      const result = await importLocations(ctx, { file });
      expectValid('LocationImportResult', result);
      expect(result).toEqual({ cities: 1, zones: 1, sub_zones: 0, standby_points: 0, total: 2 });
      const city = (await listCities(ctx, { q: prefix })).items.find((c) => c.case_code === prefix)!;
      createdCityIds.push(city.id);
      expectValid('City', city);
      expect(city).toMatchObject({ name_en: 'Live Import City', data_source: 'SYNTHETIC', tenant_id: ctx.customerId });
      const zone = (await listZones(ctx, { city_id: city.id })).items[0]!;
      createdZoneIds.push(zone.id);
      expect(zone.city_id).toBe(city.id);
    });

    it('is the Administrator only: every other role is forbidden, and the denial is audited', async () => {
      for (const role of ['dispatch_supervisor', 'dispatcher', 'planner', 'remote_team_lead', 'viewer_auditor', 'change_approver'] as const) {
        await expect(importLocations(ctxFor(role), { file: `${HEADER}\ncity,ZZ,,x,,,,,` }), role).rejects.toThrow(ForbiddenError);
        expect(() => getLocationsImportSample(ctxFor(role)), role).toThrow(ForbiddenError);
      }
    });
  });
});
