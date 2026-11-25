// SPDX-License-Identifier: AGPL-3.0-only
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { InstallMode, Role } from '@/lib/access';
import { listAuditEvents } from '@/lib/data/audit';
import { UnauthenticatedError } from '@/lib/data/errors';
import type { RequestContext } from '@/lib/data/guard';
import { createCity, createZone, deleteStandbyPoint, listCities, listStandbyPoints, listSubZones, listZones } from '@/lib/data/locations';
import { fixtureUsers } from '@/lib/data/go-test-reset';
import type { City, StandbyPoint, SubZone, Zone } from '@/lib/types';
import { deleteStandby, importLocationsCsv, saveLocation } from './actions';
import type { SaveLocationInput } from './types';
import { buildContext, fixtureTenantId } from '@/lib/data/go-test-reset';

// Live: skips, never fakes, if unset.
// Audit log: demo-store, reset per test.
// Locations: live Postgres, never reset.
const hasApi = process.env['OPENDISPATCH_API_URL'] !== undefined && process.env['OPENDISPATCH_API_URL'] !== '';
if (!hasApi) console.log('OPENDISPATCH_API_URL is not set: actions.live.test.ts is skipped, not faked.');

// Must stay top-level: vitest hoists these calls.
const session = vi.hoisted(() => ({ role: 'administrator' as string | null, mode: 'private' as string, revalidate: vi.fn() }));

vi.mock('next/cache', () => ({ revalidatePath: session.revalidate }));
vi.mock('@/lib/data/context', async (original) => {
  const real = await original<typeof import('@/lib/data/context')>();
  return {
    ...real,
    requireRequestContext: async () => {
      if (session.role === null) throw new UnauthenticatedError();
      return contextOf(session.role as Role, session.mode as InstallMode);
    },
  };
});

function contextOf(role: Role, installMode: InstallMode): RequestContext {
  const tenant = fixtureTenantId();
  const built = buildContext({ role, installMode, zoneIds: [] }, fixtureUsers(), tenant);
  if (built === null) throw new Error(`no context for ${role}`);
  return built;
}

describe.skipIf(!hasApi)('locations actions (live, real api and Postgres)', () => {
  let errorLog: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    // Go audit events; no server is fine.
    const goUrl = process.env['OPENDISPATCH_API_URL'];
    if (goUrl) await fetch(`${goUrl}/_internal/test/reset`, { method: 'POST' }).catch(() => undefined);
    session.role = 'administrator';
    session.mode = 'private';
    session.revalidate.mockReset();
    errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => {
    errorLog.mockRestore();
  });

  // Always reads as an administrator.
  async function adminContext(): Promise<RequestContext> {
    return contextOf('administrator', 'private');
  }
  const all = async <T>(read: (ctx: RequestContext) => Promise<{ items: T[] }>): Promise<T[]> => (await read(await adminContext())).items;
  const cities = () => all<City>((ctx) => listCities(ctx, { limit: 200 }));
  const zones = () => all<Zone>((ctx) => listZones(ctx, { limit: 200 }));
  const subZones = (zoneId: string) => all<SubZone>((ctx) => listSubZones(ctx, { zone_id: zoneId, limit: 200 }));
  const standby = (zoneId: string) => all<StandbyPoint>((ctx) => listStandbyPoints(ctx, { zone_id: zoneId, limit: 200 }));
  const events = async (action: string) => (await listAuditEvents(await adminContext(), { action, limit: 200 })).items;
  const zoneByCode = async (code: string) => (await zones()).find((z) => z.extra?.['code'] === code) as Zone;
  const rnd = (prefix: string) => `${prefix}${randomUUID().slice(0, 6).toUpperCase()}`;
  const rndCityCode = () => {
    const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    let code: string;
    do {
      code = `${letters[Math.floor(Math.random() * 26)]}${letters[Math.floor(Math.random() * 26)]}`;
    } while (['RD', 'JD', 'DM'].includes(code));
    return code;
  };

  // Own city: keeps fixture zone counts exact.
  let ownCityId: string | undefined;
  async function ownCity(): Promise<string> {
    if (ownCityId !== undefined) return ownCityId;
    const city = await createCity(await adminContext(), { case_code: rndCityCode(), name_en: 'Actions Live Test City' });
    ownCityId = city.id;
    return ownCityId;
  }

  const createdStandbyIds: string[] = [];
  afterAll(async () => {
    const ctx = await adminContext();
    for (const id of createdStandbyIds) await deleteStandbyPoint(ctx, id).catch(() => undefined);
    // No delete op: these are left in Postgres.
  });

  const blank: SaveLocationInput = { kind: 'zone', name_en: '', name_ar: '', code: '', parent_id: '', sub_zone_id: '', latitude: null, longitude: null, radius: null, is_active: true };
  const newZone = async (): Promise<SaveLocationInput> => ({ ...blank, kind: 'zone', name_en: 'Test Zone', name_ar: 'منطقة اختبار', code: rnd('TZ-'), parent_id: await ownCity(), latitude: 24.5, longitude: 46.5, radius: 3.5 });

  describe('saveLocation: adding', () => {
    it('adds a zone with its code and radius in `extra`, an optional Arabic name, audits it, and refreshes the page in both languages', async () => {
      const input = await newZone();
      const result = await saveLocation(input);
      expect(result).toMatchObject({ ok: true, data: { kind: 'zone', name: 'Test Zone', created: true } });
      const created = await zoneByCode(input.code);
      expect(created).toMatchObject({ name_en: 'Test Zone', name_ar: 'منطقة اختبار', latitude: 24.5, longitude: 46.5, is_active: true, data_source: 'SYNTHETIC' });
      expect(created.extra).toEqual({ code: input.code, radius_km: 3.5 });
      expect((await events('location.zone_created')).at(0)).toMatchObject({ outcome: 'success', entity_id: created.id });
      expect(session.revalidate.mock.calls.map((c) => c[0])).toEqual(['/en/admin/locations', '/ar/admin/locations']);
    });

    it('adds a zone with no position and no Arabic name (null: English is shown)', async () => {
      const input = await newZone();
      const result = await saveLocation({ ...input, name_ar: '', latitude: null, longitude: null, radius: null });
      expect(result).toMatchObject({ ok: true });
      const created = await zoneByCode(input.code);
      expect(created.name_ar).toBeNull();
      // The contract: optional, never null; api omits it.
      expect(created.latitude).toBeUndefined();
      expect(created.extra).toEqual({ code: input.code });
    });

    it('adds a city (two capital letters), a sub-zone and a standby point in a zone and one of its sub-zones', async () => {
      const cityCode = rndCityCode();
      expect(await saveLocation({ ...blank, kind: 'city', name_en: 'Tabuk', code: cityCode })).toMatchObject({ ok: true, data: { kind: 'city', created: true } });
      expect((await cities()).find((c) => c.case_code === cityCode)).toMatchObject({ name_en: 'Tabuk', name_ar: null });
      const zoneInput = await newZone();
      expect((await saveLocation(zoneInput)).ok).toBe(true);
      const parent = await zoneByCode(zoneInput.code);
      const subCode = rnd('TS-');
      expect(await saveLocation({ ...blank, kind: 'sub_zone', name_en: 'Test Sub', code: subCode, parent_id: parent.id, latitude: 24.7, longitude: 46.7 })).toMatchObject({ ok: true });
      const sub = (await subZones(parent.id)).find((s) => s.extra?.['code'] === subCode) as SubZone;
      expect(sub).toMatchObject({ zone_id: parent.id, latitude: 24.7 });
      const standbyCode = rnd('SP-');
      const standbyResult = await saveLocation({ ...blank, kind: 'standby', name_en: 'Test Standby', code: standbyCode, parent_id: parent.id, sub_zone_id: sub.id, latitude: 24.71, longitude: 46.69, radius: 3000 });
      expect(standbyResult).toMatchObject({ ok: true });
      if (standbyResult.ok) createdStandbyIds.push(standbyResult.data.id);
      expect((await standby(parent.id)).find((p) => p.extra?.['code'] === standbyCode)).toMatchObject({ zone_id: parent.id, sub_zone_id: sub.id, coverage_radius_m: 3000 });
      expect((await events('location.standby_point_created')).at(0)?.outcome).toBe('success');
    });

    it.each([
      ['a code that is not a code', { code: 'bad code!' }, 'invalid'],
      ['a code that is already used', { code: 'RD-C' }, 'conflict'],
      ['an empty name', { name_en: '' }, 'invalid'],
      ['a radius of zero', { radius: 0 }, 'invalid'],
      ['a radius above 100 km', { radius: 101 }, 'invalid'],
      ['a latitude with no longitude', { longitude: null }, 'invalid'],
      ['a latitude out of range', { latitude: 91 }, 'invalid'],
      ['a city that does not exist', { parent_id: '00000000-0000-4000-8000-00000000dead' }, 'not_found'],
    ] as const)('refuses %s, with the data layer\'s English message, and adds nothing', async (_name, change, code) => {
      const before = (await zones()).length;
      const result = await saveLocation({ ...(await newZone()), ...change });
      expect(result).toMatchObject({ ok: false, code });
      if (!result.ok) expect(result.message).toMatch(/[A-Za-z]/);
      expect((await zones()).length).toBe(before);
    });

    it('refuses a city code that is used, a standby radius outside 100 to 50,000 m, and a standby sub-zone of another zone', async () => {
      expect(await saveLocation({ ...blank, kind: 'city', name_en: 'Again', code: 'RD' })).toMatchObject({ ok: false, code: 'conflict' });
      const parent = await zoneByCode('RD-C');
      const point = { ...blank, kind: 'standby', name_en: 'P', code: 'P-1', parent_id: parent.id, latitude: 24.7, longitude: 46.7, radius: 50 } as const;
      expect(await saveLocation(point)).toMatchObject({ ok: false, code: 'invalid' });
      // RD-N: a different zone, so a mismatch.
      const otherZone = await zoneByCode('RD-N');
      const otherSub = (await subZones(otherZone.id))[0] as SubZone;
      expect(await saveLocation({ ...point, radius: 500, sub_zone_id: otherSub.id })).toMatchObject({ ok: false, code: 'invalid' });
    });
  });

  describe('saveLocation: changing', () => {
    it('keeps what the person did not touch: Customer\'s id, the code and the radius, and changes the name, position and status', async () => {
      const ctx = await adminContext();
      const code = rnd('TZ-');
      const zone = await createZone(ctx, { city_id: await ownCity(), external_id: 'TEST-EXT-1', name_en: 'Set-up Zone', latitude: 24.1, longitude: 46.1, extra: { code } });
      const result = await saveLocation({ ...blank, kind: 'zone', targetId: zone.id, name_en: 'Riyadh Centre', name_ar: 'وسط الرياض', code: 'ignored', parent_id: zone.city_id, latitude: 24.72, longitude: 46.69, radius: 7, is_active: false });
      expect(result).toMatchObject({ ok: true, data: { name: 'Riyadh Centre', created: false } });
      const after = await zoneByCode(code);
      expect(after).toMatchObject({ id: zone.id, external_id: 'TEST-EXT-1', name_en: 'Riyadh Centre', name_ar: 'وسط الرياض', latitude: 24.72, longitude: 46.69, is_active: false });
      expect(after.extra).toEqual({ code, radius_km: 7 });
      expect((await events('location.zone_updated')).at(0)).toMatchObject({ outcome: 'success', entity_id: zone.id });
    });

    it('clears the radius when it is left empty, and never lets the browser change the code', async () => {
      const input = await newZone();
      await saveLocation(input);
      const zone = await zoneByCode(input.code);
      await saveLocation({ ...blank, kind: 'zone', targetId: zone.id, name_en: zone.name_en, code: 'HACKED', parent_id: zone.city_id, latitude: 24.71, longitude: 46.68, radius: null });
      expect((await zoneByCode(input.code)).extra).toEqual({ code: input.code });
    });

    it('adds an Arabic name to a city and keeps its two-letter code and its Customer id', async () => {
      const cityCode = rndCityCode();
      const created = await saveLocation({ ...blank, kind: 'city', name_en: 'Test City', code: cityCode });
      if (!created.ok) throw new Error('city create failed');
      const cityId = created.data.id;
      const city = (await cities()).find((c) => c.id === cityId) as City;
      expect(await saveLocation({ ...blank, kind: 'city', targetId: city.id, name_en: city.name_en, name_ar: 'الرياض', code: 'ZZ', is_active: true })).toMatchObject({ ok: true });
      expect((await cities()).find((c) => c.id === city.id)).toMatchObject({ name_ar: 'الرياض', case_code: city.case_code, external_id: city.external_id });
    });

    it('changes a sub-zone and a standby point without losing their codes, and can set and clear the standby sub-zone', async () => {
      const zoneInput = await newZone();
      await saveLocation(zoneInput);
      const zone = await zoneByCode(zoneInput.code);
      const subCode = rnd('TS-');
      const subResult = await saveLocation({ ...blank, kind: 'sub_zone', name_en: 'Original Sub', code: subCode, parent_id: zone.id, latitude: 24.7, longitude: 46.7 });
      if (!subResult.ok) throw new Error('sub-zone create failed');
      const sub = (await subZones(zone.id)).find((s) => s.id === subResult.data.id) as SubZone;
      expect(await saveLocation({ ...blank, kind: 'sub_zone', targetId: sub.id, name_en: 'Renamed', name_ar: 'اسم', parent_id: sub.zone_id, latitude: sub.latitude, longitude: sub.longitude })).toMatchObject({ ok: true });
      expect((await subZones(zone.id)).find((s) => s.id === sub.id)).toMatchObject({ name_en: 'Renamed', extra: sub.extra });
      const pointCode = rnd('SP-');
      const pointResult = await saveLocation({ ...blank, kind: 'standby', name_en: 'Original Standby', code: pointCode, parent_id: zone.id, sub_zone_id: sub.id, latitude: 24.71, longitude: 46.69, radius: 3000 });
      if (!pointResult.ok) throw new Error('standby create failed');
      createdStandbyIds.push(pointResult.data.id);
      const point = (await standby(zone.id)).find((p) => p.id === pointResult.data.id) as StandbyPoint;
      const base = { ...blank, kind: 'standby', targetId: point.id, name_en: point.name_en, parent_id: point.zone_id, latitude: point.latitude, longitude: point.longitude, radius: 5000 } as const;
      expect(await saveLocation({ ...base, sub_zone_id: '' })).toMatchObject({ ok: true });
      expect((await standby(zone.id)).find((p) => p.id === point.id)).toMatchObject({ coverage_radius_m: 5000, sub_zone_id: null, extra: point.extra });
    });

    it('answers `not_found` for a record that does not exist and `invalid` for an id that is not one', async () => {
      expect(await saveLocation({ ...(await newZone()), targetId: '00000000-0000-4000-8000-00000000dead' })).toMatchObject({ ok: false, code: 'not_found' });
      for (const bad of ['toString', '__proto__', '../etc']) expect(await saveLocation({ ...(await newZone()), targetId: bad }), bad).toMatchObject({ ok: false, code: 'invalid' });
    });
  });

  describe('saveLocation: who may write', () => {
    it('is refused for every role that is not an Administrator, as `forbidden`, and audited as denied, adding and changing', async () => {
      const input = await newZone();
      const zone = await zoneByCode('RD-C');
      for (const role of ['dispatch_supervisor', 'dispatcher', 'planner', 'remote_team_lead', 'viewer_auditor', 'change_approver'] as const) {
        session.role = role;
        expect(await saveLocation(input), `${role} adds`).toMatchObject({ ok: false, code: 'forbidden' });
        expect(await saveLocation({ ...input, targetId: zone.id }), `${role} changes`).toMatchObject({ ok: false, code: 'forbidden' });
      }
      expect((await zones()).find((z) => z.extra?.['code'] === input.code)).toBeUndefined();
      const created = await events('location.zone_created');
      const updated = await events('location.zone_updated');
      expect(created).toHaveLength(6);
      expect(updated).toHaveLength(6);
      expect([...created, ...updated].every((e) => e.outcome === 'denied')).toBe(true);
      expect(session.revalidate).not.toHaveBeenCalled();
    });

    it('audits the denied change of a role that cannot even read the record (a Change Approver), for a city and a standby point too', async () => {
      session.role = 'change_approver';
      const city = (await cities())[0] as City;
      const zone = await zoneByCode('RD-C');
      const point = (await standby(zone.id))[0] as StandbyPoint;
      expect(await saveLocation({ ...blank, kind: 'city', targetId: city.id, name_en: 'X', code: 'XX' })).toMatchObject({ ok: false, code: 'forbidden' });
      expect(await saveLocation({ ...blank, kind: 'standby', targetId: point.id, name_en: 'X', code: 'X' })).toMatchObject({ ok: false, code: 'forbidden' });
      expect((await events('location.city_updated')).map((e) => e.outcome)).toEqual(['denied']);
      expect((await events('location.standby_point_updated')).map((e) => e.outcome)).toEqual(['denied']);
    });

    it('answers `unauthenticated` with no session, and touches nothing', async () => {
      session.role = null;
      expect(await saveLocation(await newZone())).toMatchObject({ ok: false, code: 'unauthenticated' });
      expect(await events('location.zone_created')).toHaveLength(0);
    });

    it('refuses input that is not an object or has no kind, and never forwards a field it does not name', async () => {
      for (const bad of [null, undefined, 'x', 42, [], {}, { kind: 'planet' }]) expect(await saveLocation(bad as never), JSON.stringify(bad)).toMatchObject({ ok: false, code: 'invalid' });
      const input = await newZone();
      const result = await saveLocation({ ...input, role: 'administrator', tenant_id: 'someone-else', created_by: 'x', external_id: 'forged', extra: { admin: true } } as never);
      expect(result).toMatchObject({ ok: true });
      const created = await zoneByCode(input.code);
      expect(created.external_id).toBeNull();
      expect(created.extra).toEqual({ code: input.code, radius_km: 3.5 });
      expect(created.tenant_id).toBe((await adminContext()).customerId);
    });

    it('names the caller in the audit event, whatever the input claims', async () => {
      await saveLocation({ ...(await newZone()), actor_user_id: 'forged' } as never);
      expect((await events('location.zone_created'))[0]?.actor_user_id).toBe((await adminContext()).userId);
    });

    it('returns a reference ODP- and 8 hex characters for an unexpected error, logs only that, and leaks no input', async () => {
      const hostile = new Proxy({}, {
        getOwnPropertyDescriptor() {
          throw new TypeError('boom: password=hunter2 name=secret-place');
        },
      });
      const result = await saveLocation(hostile as never);
      expect(result).toMatchObject({ ok: false, code: 'unexpected' });
      if (result.ok) throw new Error('unreachable');
      expect(result.reference).toMatch(/^ODP-[0-9A-F]{8}$/);
      expect(JSON.stringify(result)).not.toMatch(/hunter2|secret-place|boom/);
      expect(errorLog.mock.calls.flat().join('\n')).not.toMatch(/hunter2|secret-place|boom/);
    });
  });

  describe('deleteStandby', () => {
    async function ownStandby(): Promise<StandbyPoint> {
      const zoneInput = await newZone();
      await saveLocation(zoneInput);
      const zone = await zoneByCode(zoneInput.code);
      const result = await saveLocation({ ...blank, kind: 'standby', name_en: 'Delete Me', code: rnd('SP-'), parent_id: zone.id, latitude: 24.7, longitude: 46.7, radius: 2000 });
      if (!result.ok) throw new Error('standby create failed');
      return (await standby(zone.id)).find((p) => p.id === result.data.id) as StandbyPoint;
    }

    it('deletes a standby point, audits it, and refreshes the page', async () => {
      const point = await ownStandby();
      expect(await deleteStandby({ targetId: point.id })).toMatchObject({ ok: true, data: { kind: 'standby', id: point.id, name: point.name_en } });
      expect((await standby(point.zone_id)).some((p) => p.id === point.id)).toBe(false);
      expect((await events('location.standby_point_deleted')).at(0)).toMatchObject({ outcome: 'success', entity_id: point.id });
      expect(session.revalidate).toHaveBeenCalled();
    });

    it('answers `not_found` for a point that does not exist, `invalid` for an id that is not one, and is refused and audited for a viewer', async () => {
      expect(await deleteStandby({ targetId: '00000000-0000-4000-8000-00000000dead' })).toMatchObject({ ok: false, code: 'not_found' });
      for (const bad of ['', 'toString', 42, null, undefined]) expect(await deleteStandby({ targetId: bad as never }), String(bad)).toMatchObject({ ok: false, code: 'invalid' });
      const point = await ownStandby();
      createdStandbyIds.push(point.id);
      session.role = 'viewer_auditor';
      expect(await deleteStandby({ targetId: point.id })).toMatchObject({ ok: false, code: 'forbidden' });
      expect((await standby(point.zone_id)).some((p) => p.id === point.id)).toBe(true);
      expect((await events('location.standby_point_deleted')).map((e) => e.outcome)).toContain('denied');
    });
  });

  describe('importLocationsCsv', () => {
    const HEADER = 'kind,code,parent_code,name_en,name_ar,latitude,longitude,coverage_radius_m,sub_zone_code';
    // Random prefix: one city, one zone.
    const csv = (prefix: string) => [HEADER, `city,${prefix},,Import City,,,,,`, `zone,${prefix}-A,${prefix},Import Zone,,21.5,39.5,,`].join('\n');

    it('imports a file in one audited call, counts what it added, and refreshes the page', async () => {
      const prefix = rndCityCode();
      const counts = { cities: (await cities()).length, zones: (await zones()).length };
      const result = await importLocationsCsv({ file: csv(prefix) });
      expect(result).toMatchObject({ ok: true, data: { cities: 1, zones: 1, subZones: 0, standbyPoints: 0, total: 2 } });
      expect((await cities()).length).toBe(counts.cities + 1);
      expect((await zones()).length).toBe(counts.zones + 1);
      const audit = (await events('location.imported')).at(0);
      expect(audit).toMatchObject({ outcome: 'success' });
      expect(JSON.stringify(audit)).not.toContain('Import City');
      expect(session.revalidate.mock.calls.map((c) => c[0])).toEqual(['/en/admin/locations', '/ar/admin/locations']);
    });

    it('imports it once: the second time every code already exists, and nothing more is written', async () => {
      const prefix = rndCityCode();
      await importLocationsCsv({ file: csv(prefix) });
      const before = (await zones()).length;
      expect(await importLocationsCsv({ file: csv(prefix) })).toMatchObject({ ok: false, code: 'invalid' });
      expect((await zones()).length).toBe(before);
    });

    it('refuses a file with a wrong row as `invalid`, names the row in English, and writes nothing (all or nothing)', async () => {
      const prefix = rndCityCode();
      const text = `${csv(prefix)}\nzone,${prefix}-B,NOPE,Bad Zone,,24.1,46.1,,\n`;
      const before = (await zones()).length;
      const result = await importLocationsCsv({ file: text });
      expect(result).toMatchObject({ ok: false, code: 'invalid' });
      if (!result.ok) expect(result.message).toMatch(/Row \d+/);
      expect((await zones()).length).toBe(before);
    });

    it('refuses a file that is empty, not text, or not there, and is refused for a viewer with a denied event', async () => {
      for (const bad of ['', 42, null, undefined, {}]) expect(await importLocationsCsv({ file: bad as never }), String(bad)).toMatchObject({ ok: false, code: 'invalid' });
      const prefix = rndCityCode();
      session.role = 'viewer_auditor';
      expect(await importLocationsCsv({ file: csv(prefix) })).toMatchObject({ ok: false, code: 'forbidden' });
      expect((await events('location.imported')).map((e) => e.outcome)).toContain('denied');
      expect((await zones()).find((z) => z.extra?.['code'] === `${prefix}-A`)).toBeUndefined();
    });
  });
});
