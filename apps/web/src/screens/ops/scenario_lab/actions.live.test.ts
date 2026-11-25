// SPDX-License-Identifier: AGPL-3.0-only
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { InstallMode, Role } from '@/lib/access';
import { listAuditEvents } from '@/lib/data/audit';
import { UnauthenticatedError } from '@/lib/data/errors';
import { fixtureUsers, resetGoTestState } from '@/lib/data/go-test-reset';
import type { RequestContext } from '@/lib/data/guard';
import { listZones } from '@/lib/data/locations';
import { listScenarios } from '@/lib/data/scenarios';
import { deleteScenarioAction, deleteScenariosAction, duplicateScenarioAction, runScenarioAction, saveScenarioAction } from './actions';
import { buildContext, fixtureTenantId } from '@/lib/data/go-test-reset';

// The server actions vs the real data layer and
// fixtures, demo store in a temp folder.

const session = vi.hoisted(() => ({ role: 'planner' as string | null, mode: 'private' as string, revalidate: vi.fn() }));

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

let zoneIds: string[] = [];
const RD_C = '091ff2b2-f0e1-4b97-bfc9-7cdd0698c32a';

function contextOf(role: Role, installMode: InstallMode): RequestContext {
  const tenant = fixtureTenantId();
  const built = buildContext({ role, installMode, zoneIds }, fixtureUsers(), tenant);
  if (built === null) throw new Error(`no context for ${role}`);
  return built;
}

let errorLog: ReturnType<typeof vi.spyOn>;
beforeEach(async () => {
  await resetGoTestState();
  session.role = 'planner';
  session.mode = 'private';
  session.revalidate.mockReset();
  errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  errorLog.mockRestore();
});

async function ctx(role: Role = 'planner'): Promise<RequestContext> {
  return contextOf(role, 'private');
}

const events = async (action: string) => (await listAuditEvents(await ctx('administrator'), { action, limit: 200 })).items;

// Live: skips, never fakes, if OPENDISPATCH_API_URL unset.
// Zones come from locations.ts.
const hasApi = process.env['OPENDISPATCH_API_URL'] !== undefined && process.env['OPENDISPATCH_API_URL'] !== '';
if (!hasApi) console.log('OPENDISPATCH_API_URL is not set: actions.live.test.ts is skipped, not faked.');

describe.skipIf(!hasApi)('scenario_lab actions (live, real api and Postgres)', () => {
  describe('saveScenarioAction', () => {
    it('creates a scenario, audits it and revalidates the route', async () => {
      const admin = await ctx('administrator');
      zoneIds = (await listZones(admin, { limit: 200 })).items.map((z) => z.id);
      const before = (await listScenarios(await ctx(), { limit: 200 })).items.length;

      const result = await saveScenarioAction({
        id: null,
        name: 'Test: two more field agents',
        baseDate: '2026-09-14',
        zoneIds: [RD_C],
        field: 2,
        remote: 0,
        remoteMode: 'company' as const,
        remoteByZone: {},
        veh: 1,
        sharePercent: null,
        patternIds: [],
      });

      expect(result).toMatchObject({ ok: true, data: { name: 'Test: two more field agents', status: 'draft' } });
      expect((await listScenarios(await ctx(), { limit: 200 })).items.length).toBe(before + 1);
      expect((await events('scenario.created')).at(0)).toMatchObject({ outcome: 'success' });
      expect(session.revalidate.mock.calls.map((c) => c[0])).toEqual(['/en/ops/scenario-lab', '/ar/ops/scenario-lab']);
    });

    it('saves remote changes as one company-wide change or per zone', async () => {
      const admin = await ctx('administrator');
      zoneIds = (await listZones(admin, { limit: 200 })).items.map((z) => z.id);
      const other = zoneIds.find((z) => z !== RD_C) ?? RD_C;
      const base = { id: null, baseDate: '2026-09-14', zoneIds: [RD_C, other], field: 2, veh: 0, sharePercent: null, patternIds: [] };
      const company = await saveScenarioAction({ ...base, name: 'Test: remote pool', remote: 3, remoteMode: 'company', remoteByZone: { [other]: 9 } });
      const perZone = await saveScenarioAction({ ...base, name: 'Test: remote per zone', remote: 9, remoteMode: 'zone', remoteByZone: { [RD_C]: 1, [other]: -2 } });
      if (!company.ok || !perZone.ok) throw new Error('save failed');
      const remoteOf = (d: typeof company.data.adjustments.headcount_delta) => (d ?? []).map((e) => [e.zone_id, e.field_agents ?? 0, e.remote_agents ?? 0]);
      expect(remoteOf(company.data.adjustments.headcount_delta)).toEqual([
        [RD_C, 2, 3],
        [other, 2, 0],
      ]);
      expect(remoteOf(perZone.data.adjustments.headcount_delta)).toEqual([
        [RD_C, 2, 1],
        [other, 2, -2],
      ]);
    });

    it('updates an existing scenario back to draft', async () => {
      const admin = await ctx('administrator');
      zoneIds = (await listZones(admin, { limit: 200 })).items.map((z) => z.id);
      const created = await saveScenarioAction({
        id: null,
        name: 'Test: to update',
        baseDate: '2026-09-14',
        zoneIds: [RD_C],
        field: 1,
        remote: 0,
        remoteMode: 'company' as const,
        remoteByZone: {},
        veh: 0,
        sharePercent: null,
        patternIds: [],
      });
      if (!created.ok) throw new Error('setup failed');

      const updated = await saveScenarioAction({
        id: created.data.id,
        name: 'Test: updated name',
        baseDate: '2026-09-14',
        zoneIds: [RD_C],
        field: 3,
        remote: 0,
        remoteMode: 'company' as const,
        remoteByZone: {},
        veh: 0,
        sharePercent: 40,
        patternIds: [],
      });
      expect(updated).toMatchObject({ ok: true, data: { id: created.data.id, name: 'Test: updated name', status: 'draft' } });
      if (!updated.ok) throw new Error('unreachable');
      expect(updated.data.adjustments.headcount_delta?.[0]).toMatchObject({ field_agents: 3 });
      expect(updated.data.adjustments.remote_share).toBeCloseTo(0.4);
    });

    it('refuses an invalid base date and a role with no edit access', async () => {
      const admin = await ctx('administrator');
      zoneIds = (await listZones(admin, { limit: 200 })).items.map((z) => z.id);
      const bad = await saveScenarioAction({ id: null, name: 'Bad date', baseDate: 'not-a-date', zoneIds: [RD_C], field: 0, remote: 0, remoteMode: 'company' as const, remoteByZone: {}, veh: 0, sharePercent: null, patternIds: [] });
      expect(bad).toMatchObject({ ok: false, code: 'invalid' });

      session.role = 'dispatcher';
      const forbidden = await saveScenarioAction({ id: null, name: 'Nope', baseDate: '2026-09-14', zoneIds: [RD_C], field: 0, remote: 0, remoteMode: 'company' as const, remoteByZone: {}, veh: 0, sharePercent: null, patternIds: [] });
      expect(forbidden).toMatchObject({ ok: false, code: 'forbidden' });
    });
  });

  describe('runScenarioAction and deleteScenarioAction', () => {
    it('runs a saved scenario and reports gap/surplus counts', async () => {
      const admin = await ctx('administrator');
      zoneIds = (await listZones(admin, { limit: 200 })).items.map((z) => z.id);
      const created = await saveScenarioAction({
        id: null,
        name: 'Test: to run',
        baseDate: '2026-09-14',
        zoneIds: [RD_C],
        field: 2,
        remote: 0,
        remoteMode: 'company' as const,
        remoteByZone: {},
        veh: 1,
        sharePercent: null,
        patternIds: [],
      });
      if (!created.ok) throw new Error('setup failed');

      const run = await runScenarioAction({ id: created.data.id });
      expect(run).toMatchObject({ ok: true, data: { id: created.data.id } });
      if (!run.ok) throw new Error('unreachable');
      expect(run.data.gaps).toBeGreaterThanOrEqual(0);
      expect(run.data.surplus).toBeGreaterThanOrEqual(0);
      expect((await events('scenario.run')).at(0)).toMatchObject({ outcome: 'success' });
    });

    it('deletes a scenario, audits it and revalidates', async () => {
      const admin = await ctx('administrator');
      zoneIds = (await listZones(admin, { limit: 200 })).items.map((z) => z.id);
      const created = await saveScenarioAction({
        id: null,
        name: 'Test: to delete',
        baseDate: '2026-09-14',
        zoneIds: [RD_C],
        field: 0,
        remote: 0,
        remoteMode: 'company' as const,
        remoteByZone: {},
        veh: 0,
        sharePercent: null,
        patternIds: [],
      });
      if (!created.ok) throw new Error('setup failed');
      session.revalidate.mockReset();

      const removed = await deleteScenarioAction({ id: created.data.id });
      expect(removed).toMatchObject({ ok: true, data: { id: created.data.id, name: 'Test: to delete' } });
      expect((await listScenarios(await ctx(), { limit: 200 })).items.some((s) => s.id === created.data.id)).toBe(false);
      expect((await events('scenario.deleted')).at(0)).toMatchObject({ outcome: 'success' });
      expect(session.revalidate.mock.calls.map((c) => c[0])).toEqual(['/en/ops/scenario-lab', '/ar/ops/scenario-lab']);
    });

    it('deletes several, counting an unknown id as failed, each audited', async () => {
      const admin = await ctx('administrator');
      zoneIds = (await listZones(admin, { limit: 200 })).items.map((z) => z.id);
      const blank = { id: null, baseDate: '2026-09-14', zoneIds: [RD_C], field: 0, remote: 0, remoteMode: 'company' as const, remoteByZone: {}, veh: 0, sharePercent: null, patternIds: [] };
      const a = await saveScenarioAction({ ...blank, name: 'Test: bulk A' });
      const b = await saveScenarioAction({ ...blank, name: 'Test: bulk B' });
      if (!a.ok || !b.ok) throw new Error('setup failed');

      const removed = await deleteScenariosAction({ ids: [a.data.id, b.data.id, '00000000-0000-0000-0000-000000000000'] });
      expect(removed).toMatchObject({ ok: true, data: { deleted: 2, failed: 1 } });
      const left = (await listScenarios(await ctx(), { limit: 200 })).items.map((s) => s.id);
      expect(left).not.toContain(a.data.id);
      expect(left).not.toContain(b.data.id);
      expect((await events('scenario.deleted')).filter((e) => e.outcome === 'success').length).toBeGreaterThanOrEqual(2);
    });

    it('refuses a bulk delete to a view-only role, and an empty list', async () => {
      session.role = 'viewer_auditor';
      zoneIds = [RD_C];
      expect(await deleteScenariosAction({ ids: [RD_C] })).toMatchObject({ ok: false, code: 'forbidden' });
      session.role = 'planner';
      expect(await deleteScenariosAction({ ids: [] })).toMatchObject({ ok: false, code: 'invalid' });
    });

    it('refuses to run an unknown scenario id (not_found)', async () => {
      const admin = await ctx('administrator');
      zoneIds = (await listZones(admin, { limit: 200 })).items.map((z) => z.id);
      expect(await runScenarioAction({ id: '00000000-0000-0000-0000-000000000000' })).toMatchObject({ ok: false, code: 'not_found' });
    });
  });

  describe('duplicateScenarioAction', () => {
    it('copies a scenario into a new draft named "(2)"', async () => {
      const admin = await ctx('administrator');
      zoneIds = (await listZones(admin, { limit: 200 })).items.map((z) => z.id);
      const created = await saveScenarioAction({
        id: null,
        name: 'Test: to duplicate',
        baseDate: '2026-09-14',
        zoneIds: [RD_C],
        field: 5,
        remote: 0,
        remoteMode: 'company' as const,
        remoteByZone: {},
        veh: 0,
        sharePercent: null,
        patternIds: [],
      });
      if (!created.ok) throw new Error('setup failed');

      const dup = await duplicateScenarioAction({ id: created.data.id });
      expect(dup).toMatchObject({ ok: true, data: { name: 'Test: to duplicate (2)', status: 'draft' } });
      if (!dup.ok) throw new Error('unreachable');
      expect(dup.data.id).not.toBe(created.data.id);
      expect(dup.data.adjustments.headcount_delta?.[0]).toMatchObject({ field_agents: 5 });
    });
  });
});

describe('every action', () => {
  it('answers `unauthenticated` with no session, and leaks no input on an unexpected error', async () => {
    session.role = null;
    expect(await saveScenarioAction({ id: null, name: 'x', baseDate: 'x', zoneIds: [], field: 0, remote: 0, remoteMode: 'company' as const, remoteByZone: {}, veh: 0, sharePercent: null, patternIds: [] })).toMatchObject({ ok: false, code: 'unauthenticated' });
    session.role = 'planner';
    const hostile = new Proxy(
      {},
      {
        getOwnPropertyDescriptor() {
          throw new TypeError('boom: password=hunter2');
        },
      },
    );
    const result = await saveScenarioAction(hostile as never);
    expect(result).toMatchObject({ ok: false, code: 'unexpected' });
    if (result.ok) throw new Error('unreachable');
    expect(result.reference).toMatch(/^ODP-[0-9A-F]{8}$/);
    expect(JSON.stringify(result) + errorLog.mock.calls.flat().join('\n')).not.toMatch(/hunter2|boom/);
  });
});

describe('the server-built context rule in this file', () => {
  const source = fs.readFileSync(path.join(import.meta.dirname, 'actions.ts'), 'utf8');
  const types = fs.readFileSync(path.join(import.meta.dirname, 'types.ts'), 'utf8');

  it('is a use-server file whose exports are all async functions', () => {
    expect(source.trimStart().startsWith("'use server';")).toBe(true);
    const exported = [...source.matchAll(/^export\s+(\w+)/gm)].map((m) => m[1]);
    expect([...new Set(exported)]).toEqual(['async']);
  });

  it('names no parameter or field called ctx, context, customer, tenant, userId, role, zoneScope or installMode', () => {
    for (const signature of [...source.matchAll(/^export async function \w+\(([^)]*)\)/gm)].map((m) => m[1] as string)) {
      expect(signature).not.toMatch(/\b(ctx|context|customer|customerId|tenantId|userId|role|zoneScope|installMode)\b/);
    }
    const fields = [...types.matchAll(/readonly\s+(\w+)\??:/g)].map((m) => (m[1] as string).toLowerCase().replaceAll('_', ''));
    expect(fields.length).toBeGreaterThan(0);
    for (const field of fields) expect(['ctx', 'context', 'customer', 'customerid', 'tenant', 'tenantid', 'userid', 'role', 'zonescope', 'installmode']).not.toContain(field);
  });

  it('types.ts imports nothing from lib/data: a client file may import its values safely', () => {
    expect(types).not.toMatch(/from ['"]@\/lib\/data/);
  });
});
