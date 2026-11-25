// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, describe, expect, it } from 'vitest';
import type { InstallMode, Role } from '@/lib/access';
import { fixtureUsers } from '@/lib/data/go-test-reset';
import { buildContext, fixtureTenantId } from '@/lib/data/go-test-reset';
import type { RequestContext } from '@/lib/data/guard';
import { listStandbyPoints, listSubZones, listZones } from '@/lib/data/locations';
import { loadLocationsView } from './view';

// Live: skips, never fakes, if OPENDISPATCH_API_URL unset.
const hasApi = process.env['OPENDISPATCH_API_URL'] !== undefined && process.env['OPENDISPATCH_API_URL'] !== '';

// The server side of the screen against the real data layer: the committed fixtures (3 cities, 8 zones, 124
// sub-zones, 32 standby points, 250 agents). Other live tests may add their own cities and zones (never
// touching the fixture ones), so totals below check "at least"; counts scoped to a fixture zone stay exact.
describe.skipIf(!hasApi)('loadLocationsView (live, real api and Postgres)', () => {
  if (!hasApi) console.log('OPENDISPATCH_API_URL is not set: view.live.test.ts is skipped, not faked.');

  afterEach(() => {
  });

  function ctxOf(role: Role, zoneIds: string[] = [], installMode: InstallMode = 'private'): RequestContext {
    const tenant = fixtureTenantId();
    const built = buildContext({ role, installMode, zoneIds }, fixtureUsers(), tenant);
    if (built === null) throw new Error(`no context for ${role}`);
    return built;
  }
  const admin = () => ctxOf('administrator');
  const zoneId = async (code: string): Promise<string> => (await listZones(admin(), { limit: 200 })).items.find((z) => z.extra?.['code'] === code)?.id as string;

  describe('loadLocationsView: the lists', () => {
    it('counts at least the fixture records and gives the data source of every one', async () => {
      const view = await loadLocationsView(admin(), {}, true, false);
      expect(view.totals.cities).toBeGreaterThanOrEqual(3);
      expect(view.totals.zones).toBeGreaterThanOrEqual(8);
      expect(view.totals.subZones).toBeGreaterThanOrEqual(124);
      expect(view.totals.standbyPoints).toBeGreaterThanOrEqual(32);
      expect(view.cities.map((c) => c.code)).toEqual(expect.arrayContaining(['RD', 'JD', 'DM']));
      expect(view.sources).toContain('SYNTHETIC');
      expect(view.subZones.length).toBeGreaterThanOrEqual(124);
      expect(view.standby.length).toBeGreaterThanOrEqual(32);
    });

    it('gives each zone its code, city, position, radius, stage, counts and agents as plain data', async () => {
      const view = await loadLocationsView(admin(), {}, true, false);
      const central = view.zones.find((z) => z.code === 'RD-C');
      expect(central).toMatchObject({ name: 'Riyadh Central', cityCode: 'RD', latitude: 24.71, longitude: 46.68, radiusKm: 6, stage: 'recommend', subZones: 16, standbyPoints: 3, active: true, nameAr: null });
      expect(central?.agents).toBeGreaterThan(0);
      // Api zone order is unstable: compare as a set.
      expect(view.zones.filter((z) => z.stage === 'recommend').map((z) => z.code).sort()).toEqual(['RD-C', 'RD-N']);
      expect(view.zones.find((z) => z.code === 'RD-E')?.stage).toBe('shadow');
      expect(JSON.parse(JSON.stringify(view))).toEqual(view); // plain data: it can cross to the client
    });

    it('gives a sub-zone its code and zone code and a standby point its radius and sub-zone name', async () => {
      // Api order is unstable: find by code, not position.
      const view = await loadLocationsView(admin(), {}, true, false);
      expect(view.subZones.find((s) => s.code === 'RD-C-01')).toMatchObject({ name: 'Juniper Square', zoneCode: 'RD-C', active: true });
      expect(view.standby.find((p) => p.code === 'RD-C-SP1')).toMatchObject({ name: 'Garnet Terrace standby', zoneCode: 'RD-C', radiusM: 4500, subZoneName: 'Garnet Terrace' });
    });

    it('filters sub-zones and standby points by zone code and by search over name, code and Arabic name', async () => {
      const c = admin();
      expect((await loadLocationsView(c, { zone: 'RD-C' }, true, false)).subZones).toHaveLength(16);
      expect((await loadLocationsView(c, { zone: 'RD-C' }, true, false)).standby).toHaveLength(3);
      expect((await loadLocationsView(c, { q: 'juniper square' }, true, false)).subZones.map((s) => s.code)).toEqual(['RD-C-01']);
      expect((await loadLocationsView(c, { q: 'rd-n-0' }, true, false)).subZones).toHaveLength(9);
      expect((await loadLocationsView(c, { q: 'SP2' }, true, false)).standby.length).toBeGreaterThan(3);
      expect((await loadLocationsView(c, { zone: 'NOPE' }, true, false)).subZones.length).toBeGreaterThanOrEqual(124);
      expect((await loadLocationsView(c, { q: 'zzz' }, true, false)).subZones).toHaveLength(0);
    });

    it('keeps the totals and the tree whole while a list is filtered', async () => {
      const view = await loadLocationsView(admin(), { q: 'zzz', zone: 'RD-C' }, true, false);
      expect(view.totals.subZones).toBeGreaterThanOrEqual(124);
      expect(view.zones.length).toBeGreaterThanOrEqual(8);
      expect(view.mapStandby.length).toBeGreaterThanOrEqual(32);
    });
  });

  describe('loadLocationsView: the open record', () => {
    it('resolves ?edit= for each kind, with what the form needs', async () => {
      const c = admin();
      const city = (await loadLocationsView(c, {}, true, false)).cities.find((row) => row.code === 'RD');
      expect((await loadLocationsView(c, { edit: { kind: 'city', id: city?.id as string } }, true, false)).open).toMatchObject({ kind: 'city', code: 'RD', name: 'Riyadh', parentId: null, latitude: null });
      const zone = await zoneId('RD-C');
      expect((await loadLocationsView(c, { edit: { kind: 'zone', id: zone } }, true, false)).open).toMatchObject({ kind: 'zone', code: 'RD-C', radius: 6, stage: 'recommend', parentId: city?.id });
      // Api order is unstable: find by code, not position.
      const sub = (await listSubZones(c, { zone_id: zone, limit: 200 })).items.find((s) => s.extra?.['code'] === 'RD-C-01');
      expect((await loadLocationsView(c, { edit: { kind: 'sub_zone', id: sub?.id as string } }, true, false)).open).toMatchObject({ kind: 'sub_zone', code: 'RD-C-01', parentId: zone });
      const point = (await listStandbyPoints(c, { zone_id: zone, limit: 200 })).items.find((p) => p.extra?.['code'] === 'RD-C-SP1');
      expect((await loadLocationsView(c, { edit: { kind: 'standby', id: point?.id as string } }, true, false)).open).toMatchObject({ kind: 'standby', code: 'RD-C-SP1', radius: 4500, subZoneId: point?.sub_zone_id });
    });

    it('says an unknown id is unknown (a notice, never an error), and `new` is not a record', async () => {
      const c = admin();
      const unknown = await loadLocationsView(c, { edit: { kind: 'zone', id: '00000000-0000-4000-8000-00000000dead' } }, true, false);
      expect(unknown.open).toBeUndefined();
      expect(unknown.unknownEdit).toBe(true);
      const fresh = await loadLocationsView(c, { edit: { kind: 'zone', id: 'new' } }, true, false);
      expect(fresh.open).toBeUndefined();
      expect(fresh.unknownEdit).toBe(false);
      // an id of another kind is not found under this one
      expect((await loadLocationsView(c, { edit: { kind: 'city', id: await zoneId('RD-C') } }, true, false)).unknownEdit).toBe(true);
    });
  });

  describe('loadLocationsView: the import sample and the export', () => {
    it('reads the sample file only while the import dialog is open and the person may edit', async () => {
      const c = admin();
      expect((await loadLocationsView(c, {}, true, false)).sample).toBeUndefined();
      expect((await loadLocationsView(c, {}, false, true)).sample).toBeUndefined();
      const open = await loadLocationsView(c, {}, true, true);
      expect(open.sample?.fileName).toBe('locations_sample.csv');
      expect(open.sample?.text.split('\n')[0]).toBe('kind,code,parent_code,name_en,name_ar,latitude,longitude,coverage_radius_m,sub_zone_code');
    });

    it('exports every record in the import\'s own columns, so an export can be imported again', async () => {
      const view = await loadLocationsView(admin(), {}, true, false);
      expect(view.exportHeader).toEqual(['kind', 'code', 'parent_code', 'name_en', 'name_ar', 'latitude', 'longitude', 'coverage_radius_m', 'sub_zone_code']);
      expect(view.exportRows.length).toBeGreaterThanOrEqual(3 + 8 + 124 + 32);
      expect(view.exportRows.every((row) => row.length === view.exportHeader.length)).toBe(true);
      // "Garnet Terrace" is not a unique name: use the id.
      const point = view.standby.find((p) => p.code === 'RD-C-SP1');
      const garnet = view.subZones.find((sub) => sub.id === point?.subZoneId)?.code as string;
      expect(view.exportRows.find((row) => row[1] === 'RD-C-SP1')).toEqual(['standby_point', 'RD-C-SP1', 'RD-C', 'Garnet Terrace standby', '', '24.738023', '46.721697', '4500', garnet]);
    });
  });

  describe('loadLocationsView: what a zone-scoped role can read', () => {
    it('reads only its zones (the data layer applies the scope; the screen adds nothing)', async () => {
      const central = await zoneId('RD-C');
      const view = await loadLocationsView(ctxOf('dispatcher', [central]), {}, false, false);
      expect(view.zones.map((z) => z.code)).toEqual(['RD-C']);
      expect(view.cities.map((c) => c.code)).toEqual(['RD']);
      expect(view.totals.zones).toBe(1);
    });
  });
});
