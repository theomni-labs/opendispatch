// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { InstallMode, Role } from '@/lib/access';
import { fixtureUsers } from '@/lib/data/go-test-reset';
import { buildContext, fixtureTenantId } from '@/lib/data/go-test-reset';
import type { RequestContext } from '@/lib/data/guard';
import { listAgents, listVehicles } from '@/lib/data/people';
import { loadAgentsView } from './view';

// Live: skips, never fakes, if OPENDISPATCH_API_URL unset.
// Shares Postgres with other live files: counts are floors, not exacts.
const hasApi = process.env['OPENDISPATCH_API_URL'] !== undefined && process.env['OPENDISPATCH_API_URL'] !== '';
// N+1 skills fetch; load() runs a few times.
vi.setConfig({ testTimeout: 180_000 });

afterEach(() => {
});

function ctxOf(role: Role, installMode: InstallMode = 'private'): RequestContext {
  const tenant = fixtureTenantId();
  const built = buildContext({ role, installMode, zoneIds: [] }, fixtureUsers(), tenant);
  if (built === null) throw new Error(`no context for ${role}`);
  return built;
}
const admin = () => ctxOf('administrator');
const load = (query: Parameters<typeof loadAgentsView>[1] = {}, canEdit = true, importOpen = false) => loadAgentsView(admin(), query, canEdit, importOpen);

describe.skipIf(!hasApi)('loadAgentsView (live, real api and Postgres)', () => {
  if (!hasApi) console.log('OPENDISPATCH_API_URL is not set: view.live.test.ts is skipped, not faked.');

  describe('the lists', () => {
    it('counts agents, field and remote, vehicles and skills, with the data source of every record', async () => {
      const view = await load();
      expect(view.totals.agents).toBeGreaterThanOrEqual(336);
      expect(view.totals.field).toBeGreaterThanOrEqual(252);
      expect(view.totals.remote).toBeGreaterThanOrEqual(84);
      expect(view.totals.vehicles).toBeGreaterThanOrEqual(112);
      expect(view.totals.skills).toBeGreaterThanOrEqual(10);
      expect(view.sources).toEqual(['SYNTHETIC']);
      expect(view.agents.length).toBeGreaterThanOrEqual(336);
      expect(view.vehicles.length).toBeGreaterThanOrEqual(112);
      expect(JSON.parse(JSON.stringify(view))).toEqual(view); // plain data: it can cross to the client
    });

    it('gives an agent its zone code, shift name, days off, standby point, vehicle and skills as plain data', async () => {
      const view = await load({ q: 'SVR-RD-C-001' });
      expect(view.agents).toHaveLength(1);
      const talal = view.agents[0];
      expect(talal).toMatchObject({ code: 'SVR-RD-C-001', name: 'Talal Al-Barahi', kind: 'field', zoneCode: 'RD-C', shiftCode: 'day_a', daysOff: ['Sunday', 'Monday'], active: true });
      expect(talal?.shiftName).toMatch(/Day/);
      expect(talal?.standbyPointId).toMatch(/^[0-9a-f-]{36}$/);
      expect(talal?.skills.length).toBeGreaterThan(0);
    });

    it('filters by search, zone code, the remote pool, shift and leave status', async () => {
      expect((await load({ zone: 'RD-C' })).agents.every((s) => s.zoneCode === 'RD-C')).toBe(true);
      const pool = await load({ zone: 'remote' });
      expect(pool.agents.length).toBeGreaterThanOrEqual(84);
      expect(pool.agents.every((s) => s.kind === 'remote' && s.zoneCode === null)).toBe(true);
      expect((await load({ shift: 'night' })).agents.length).toBeGreaterThanOrEqual(56);
      expect((await load({ q: 'talal' })).agents.map((s) => s.name)).toContain('Talal Al-Barahi');
      // LeaveRequest is api-backed: other files add requests.
      const onLeave = await load({ leave: 'requested' });
      expect(onLeave.agents.length).toBeGreaterThanOrEqual(8);
      expect(onLeave.agents.every((s) => s.leave.some((l) => l.status === 'requested'))).toBe(true);
      expect((await load({ zone: 'NOPE' })).agents.length).toBeGreaterThanOrEqual(336);
      expect((await load({ q: 'zzz' })).agents).toHaveLength(0);
    });

    it('lists vehicles with plate, type, zone and the agent whose default vehicle it is, and filters them by zone and search', async () => {
      const view = await load({ zone: 'RD-C' });
      expect(view.vehicles.every((v) => v.zoneCode === 'RD-C')).toBe(true);
      expect(view.vehicles[0]).toMatchObject({ code: 'VEH-RD-C-01', plate: 'SYN 9469', type: 'sedan' });
      expect((await load({ q: 'veh-jd' })).vehicles.every((v) => v.code.startsWith('VEH-JD'))).toBe(true);
      expect((await load({ zone: 'remote' })).vehicles.length).toBeGreaterThanOrEqual(112);
    });

    it('gives the skill vocabulary with how many agents hold each', async () => {
      const view = await load();
      expect(view.skills).toHaveLength(10);
      expect(view.skills[0]).toMatchObject({ code: 'injury_protocol', nameEn: 'Injury protocol', nameAr: 'بروتوكول الإصابات' });
      expect(view.skills.reduce((sum, s) => sum + s.inUse, 0)).toBeGreaterThanOrEqual(1154);
    });

    it('exports the agents on screen, and reads the sample file only while the import dialog is open and the person may edit', async () => {
      const view = await load({ zone: 'remote' });
      expect(view.exportHeader).toEqual(['code', 'name_en', 'kind', 'zone', 'shift', 'vehicle', 'skills', 'status']);
      expect(view.exportRows.length).toBeGreaterThanOrEqual(84);
      expect(view.exportRows[0]?.[3]).toBe('remote');
      expect((await load()).sample).toBeUndefined();
      expect((await load({}, false, true)).sample).toBeUndefined();
      expect((await load({}, true, true)).sample?.fileName).toBe('agents_sample.csv');
    });
  });

  describe('the open record', () => {
    it('opens an agent whatever the filters say, and a vehicle', async () => {
      const one = (await listAgents(admin(), { limit: 1 })).items[0];
      const view = await load({ agent: one?.id, q: 'zzz' });
      expect(view.openAgent?.id).toBe(one?.id);
      expect(view.agents).toHaveLength(0);
      const vehicle = (await listVehicles(admin(), { limit: 1 })).items[0];
      expect((await load({ vehicle: vehicle?.id })).openVehicle?.code).toBe(vehicle?.code);
    });

    it('says an unknown id is unknown (a notice, never an error), and `new` is not a record', async () => {
      const unknown = await load({ agent: '00000000-0000-4000-8000-00000000dead' });
      expect(unknown).toMatchObject({ openAgent: undefined, unknownRecord: true });
      expect(await load({ vehicle: '00000000-0000-4000-8000-00000000dead' })).toMatchObject({ openVehicle: undefined, unknownRecord: true });
      expect(await load({ agent: 'new', vehicle: 'new' })).toMatchObject({ openAgent: undefined, openVehicle: undefined, unknownRecord: false });
    });
  });
});
