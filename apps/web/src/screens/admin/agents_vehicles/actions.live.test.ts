// SPDX-License-Identifier: AGPL-3.0-only
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { InstallMode, Role } from '@/lib/access';
import { listAuditEvents } from '@/lib/data/audit';
import { UnauthenticatedError } from '@/lib/data/errors';
import type { RequestContext } from '@/lib/data/guard';
import { listZones } from '@/lib/data/locations';
import { getAgentsImportSample, listAgentSkills, listAgents, listVehicles } from '@/lib/data/people';
import { getSkillVocabulary } from '@/lib/data/settings';
import { fixtureUsers } from '@/lib/data/go-test-reset';
import type { Agent, Vehicle } from '@/lib/types';
import { addSkillToVocabulary, importAgentsCsv, removeSkillFromVocabulary, renameSkill, saveAgent, saveVehicle, setAgentsInactive } from './actions';
import type { SaveAgentInput, SaveVehicleInput } from './types';
import { buildContext, fixtureTenantId } from '@/lib/data/go-test-reset';

// Live: skips, never fakes, if OPENDISPATCH_API_URL unset.
// Agents/vehicles are real Postgres, shared: codes are randomized per call.
const hasApi = process.env['OPENDISPATCH_API_URL'] !== undefined && process.env['OPENDISPATCH_API_URL'] !== '';
const randomCode = (prefix: string): string => `${prefix}-${randomUUID().slice(0, 8).toUpperCase()}`;

// The session is the only thing stood in for: requireRequestContext returns the context of the role the test picks
//. The demo store (audit, settings) is still a temp folder, reset per test.
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

async function adminContext(): Promise<RequestContext> {
  return contextOf('administrator', 'private');
}
const agents = async (): Promise<Agent[]> => {
  const ctx = await adminContext();
  const out: Agent[] = [];
  let cursor: string | undefined;
  do {
    const page = await listAgents(ctx, { limit: 200, ...(cursor === undefined ? {} : { cursor }) });
    out.push(...page.items);
    cursor = page.page.has_more ? (page.page.next_cursor ?? undefined) : undefined;
  } while (cursor !== undefined);
  return out;
};
const agent = async (code: string): Promise<Agent> => (await listAgents(await adminContext(), { q: code, limit: 200 })).items.find((s) => s.code === code) as Agent;
const vehicles = async (): Promise<Vehicle[]> => (await listVehicles(await adminContext(), { limit: 200 })).items;
const events = async (action: string) => (await listAuditEvents(await adminContext(), { action, limit: 200 })).items;
const zone = async (code: string) => (await listZones(await adminContext(), { limit: 200 })).items.find((z) => z.extra?.['code'] === code)!;

// A fresh code every call: Postgres is shared and not reset between tests, unlike the demo store above.
const newAgent = async (): Promise<SaveAgentInput> => ({ name_en: 'Test Agent', code: randomCode('SVR-T'), zone_id: (await zone('RD-C')).id, shift_code: 'day_a', vehicle_id: '', standby_point_id: '', days_off: ['Friday', 'Saturday'], skill_codes: ['heavy_vehicle', 'bilingual_en_ar'], is_active: true });
const newVehicle = async (): Promise<SaveVehicleInput> => ({ code: randomCode('VEH-T'), plate_number: 'SYN 1234', vehicle_type: 'suv', zone_id: (await zone('RD-C')).id, is_active: true });

describe.skipIf(!hasApi)('agents_vehicles actions (live, real api and Postgres)', () => {
  if (!hasApi) console.log('OPENDISPATCH_API_URL is not set: actions.live.test.ts is skipped, not faked.');

  describe('saveAgent', () => {
    it('adds a field agent with its shift, days off and skills, audits both writes, and refreshes the page in both languages', async () => {
      const input = await newAgent();
      expect(await saveAgent(input)).toMatchObject({ ok: true, data: { name: 'Test Agent', created: true } });
      const created = await agent(input.code);
      expect(created).toMatchObject({ kind: 'field', name_en: 'Test Agent', name_ar: null, is_active: true, data_source: 'SYNTHETIC' });
      expect(created.extra).toEqual({ home_shift: 'day_a', days_off: ['Friday', 'Saturday'] });
      expect((await listAgentSkills(await adminContext(), created.id)).items.map((s) => s.skill_code).sort()).toEqual(['bilingual_en_ar', 'heavy_vehicle']);
      expect((await events('agent.created')).at(0)).toMatchObject({ outcome: 'success', entity_id: created.id });
      expect((await events('agent.skills_set')).at(0)?.outcome).toBe('success');
      expect(session.revalidate.mock.calls.map((c) => c[0])).toEqual(['/en/admin/agents-vehicles', '/ar/admin/agents-vehicles']);
    });

    it('adds a remote agent when no zone is chosen, with no vehicle or standby point', async () => {
      const input = await newAgent();
      expect(await saveAgent({ ...input, zone_id: '', shift_code: 'remote_block_1' })).toMatchObject({ ok: true });
      expect(await agent(input.code)).toMatchObject({ kind: 'remote', home_zone_id: null });
    });

    it('keeps what the person did not touch when it changes one: the code, the Arabic name and the other `extra` keys, and changes the skills only when they differ', async () => {
      // A disposable agent, not a fixture one: other live files read SVR-RD-C-001 as a stable reference.
      const seed = await newAgent();
      expect(await saveAgent({ ...seed, standby_point_id: 'sp-placeholder' })).toMatchObject({ ok: true });
      const before = await agent(seed.code);
      const same = before.extra?.['standby_point_id'] as string;
      const skills = (await listAgentSkills(await adminContext(), before.id)).items.map((s) => s.skill_code);
      // The creation above already fired one skills_set event: compare against that, not zero.
      const skillsSetAfterCreate = (await events('agent.skills_set')).length;
      const result = await saveAgent({ targetId: before.id, name_en: 'Test Agent Renamed', code: 'HACKED', zone_id: before.home_zone_id ?? '', shift_code: 'night', vehicle_id: '', standby_point_id: same, days_off: ['Tuesday'], skill_codes: skills, is_active: false });
      expect(result).toMatchObject({ ok: true, data: { name: 'Test Agent Renamed', created: false } });
      const after = await agent(seed.code);
      expect(after).toMatchObject({ id: before.id, name_en: 'Test Agent Renamed', is_active: false, name_ar: before.name_ar });
      expect(after.extra).toEqual({ home_shift: 'night', days_off: ['Tuesday'], standby_point_id: same });
      expect((await events('agent.skills_set')).length).toBe(skillsSetAfterCreate);
      expect(await saveAgent({ targetId: before.id, name_en: 'Test Agent Renamed', code: '', zone_id: before.home_zone_id ?? '', shift_code: 'night', vehicle_id: '', standby_point_id: same, days_off: [], skill_codes: ['heavy_vehicle'], is_active: true })).toMatchObject({ ok: true });
      expect((await listAgentSkills(await adminContext(), before.id)).items.map((s) => s.skill_code)).toEqual(['heavy_vehicle']);
      expect((await events('agent.skills_set')).length).toBe(skillsSetAfterCreate + 1);
    });

    it.each([
      ['an empty name', { name_en: '' }, 'invalid'],
      ['a staff code that is used', { code: 'SVR-RD-C-001' }, 'conflict'],
      ['an empty staff code', { code: '' }, 'invalid'],
      ['a zone that does not exist', { zone_id: '00000000-0000-4000-8000-00000000dead' }, 'not_found'],
      ['a day that is not a day', { days_off: ['Funday'] }, 'invalid'],
      ['skills that are not a list of text', { skill_codes: [1, 2] }, 'invalid'],
    ] as const)('refuses %s, with the data layer\'s English message, and adds nothing', async (_name, change, code) => {
      const before = (await agents()).length;
      const result = await saveAgent({ ...(await newAgent()), ...change } as never);
      expect(result).toMatchObject({ ok: false, code });
      if (!result.ok) expect(result.message).toMatch(/[A-Za-z]/);
      expect((await agents()).length).toBe(before);
    });

    it('answers `not_found` for an agent that does not exist and `invalid` for an id that is not one', async () => {
      expect(await saveAgent({ ...(await newAgent()), targetId: '00000000-0000-4000-8000-00000000dead' })).toMatchObject({ ok: false, code: 'not_found' });
      for (const bad of ['toString', '__proto__', '../etc']) expect(await saveAgent({ ...(await newAgent()), targetId: bad }), bad).toMatchObject({ ok: false, code: 'invalid' });
    });

    it('is refused for every role that is not an Administrator, adding and changing, audited as denied', async () => {
      const one = await agent('SVR-RD-C-001');
      for (const role of ['dispatch_supervisor', 'dispatcher', 'planner', 'remote_team_lead', 'viewer_auditor', 'change_approver'] as const) {
        session.role = role;
        expect(await saveAgent(await newAgent()), `${role} adds`).toMatchObject({ ok: false, code: 'forbidden' });
        expect(await saveAgent({ ...(await newAgent()), targetId: one.id }), `${role} changes`).toMatchObject({ ok: false, code: 'forbidden' });
      }
      expect([...(await events('agent.created')), ...(await events('agent.updated'))].every((e) => e.outcome === 'denied')).toBe(true);
      expect((await events('agent.created')).length + (await events('agent.updated')).length).toBe(12);
    });
  });

  describe('setAgentsInactive (the bulk bar: one data call per agent)', () => {
    // The bulk action really deactivates them.
    async function disposableAgents(count: number): Promise<Agent[]> {
      const out: Agent[] = [];
      for (let i = 0; i < count; i += 1) {
        const input = await newAgent();
        await saveAgent(input);
        out.push(await agent(input.code));
      }
      return out;
    }

    it('sets the agents inactive and keeps their extra, counts the ones already inactive out, and audits each', async () => {
      const two = await disposableAgents(2);
      const result = await setAgentsInactive({ targetIds: two.map((s) => s.id) });
      expect(result).toMatchObject({ ok: true, data: { changed: 2, failed: 0 } });
      for (const s of two) expect(await agent(s.code)).toMatchObject({ is_active: false, extra: s.extra });
      expect((await events('agent.updated')).filter((e) => e.outcome === 'success')).toHaveLength(2);
      expect(await setAgentsInactive({ targetIds: two.map((s) => s.id) })).toMatchObject({ ok: true, data: { changed: 0 } });
    });

    it('counts an agent that does not exist and reports the first problem, and stops for a viewer with one denied event', async () => {
      const [one] = await disposableAgents(1);
      const result = await setAgentsInactive({ targetIds: [(one as Agent).id, '00000000-0000-4000-8000-00000000dead'] });
      expect(result).toMatchObject({ ok: true, data: { changed: 1, failed: 1 } });
      session.role = 'viewer_auditor';
      const others = (await listAgents(await adminContext(), { limit: 5, is_active: true })).items.map((s) => s.id);
      expect(await setAgentsInactive({ targetIds: others })).toMatchObject({ ok: false, code: 'forbidden' });
      expect((await events('agent.updated')).filter((e) => e.outcome === 'denied')).toHaveLength(1);
    });

    it('refuses an empty list, more than 100, and a list that is not text', async () => {
      for (const bad of [[], Array.from({ length: 101 }, (_, i) => String(i)), [1], 'a', null, undefined]) expect(await setAgentsInactive({ targetIds: bad as never }), JSON.stringify(bad)?.slice(0, 20)).toMatchObject({ ok: false, code: 'invalid' });
    });
  });

  describe('saveVehicle', () => {
    it('adds a vehicle with its plate and type (in `extra`), and changes it keeping the code and the other keys', async () => {
      const input = await newVehicle();
      expect(await saveVehicle(input)).toMatchObject({ ok: true, data: { name: input.code, created: true } });
      const created = (await vehicles()).find((v) => v.code === input.code) as Vehicle;
      expect(created).toMatchObject({ plate_number: 'SYN 1234', is_active: true, extra: { vehicle_type: 'suv' } });
      expect(await saveVehicle({ ...input, targetId: created.id, code: 'HACKED', plate_number: 'SYN 9999', vehicle_type: 'pickup', is_active: false })).toMatchObject({ ok: true, data: { created: false } });
      expect((await vehicles()).find((v) => v.id === created.id)).toMatchObject({ code: input.code, plate_number: 'SYN 9999', is_active: false, extra: { vehicle_type: 'pickup' } });
      expect((await events('vehicle.updated')).at(0)?.outcome).toBe('success');
    });

    it.each([
      ['a code that is used', { code: 'VEH-RD-C-01' }, 'conflict'],
      ['a plate over 16 characters', { plate_number: 'x'.repeat(17) }, 'invalid'],
      ['a type that is not one', { vehicle_type: 'tank' }, 'invalid'],
      ['a zone that does not exist', { zone_id: '00000000-0000-4000-8000-00000000dead' }, 'not_found'],
    ] as const)('refuses %s and adds nothing', async (_name, change, code) => {
      const before = (await vehicles()).length;
      expect(await saveVehicle({ ...(await newVehicle()), ...change })).toMatchObject({ ok: false, code });
      expect((await vehicles()).length).toBe(before);
    });

    it('is refused for a viewer and audited as denied', async () => {
      const one = (await vehicles())[0] as Vehicle;
      session.role = 'viewer_auditor';
      expect(await saveVehicle(await newVehicle())).toMatchObject({ ok: false, code: 'forbidden' });
      expect(await saveVehicle({ ...(await newVehicle()), targetId: one.id })).toMatchObject({ ok: false, code: 'forbidden' });
      expect((await events('vehicle.created')).map((e) => e.outcome)).toEqual(['denied']);
    });
  });

  describe('addSkillToVocabulary and importAgentsCsv', () => {
    it('adds a skill to the vocabulary, once (the code is unique), and refuses a bad code', async () => {
      expect(await addSkillToVocabulary({ code: 'night_driving', name_en: 'Night driving', name_ar: 'قيادة ليلية' })).toMatchObject({ ok: true, data: { code: 'night_driving' } });
      expect((await getSkillVocabulary(await adminContext())).find((k) => k.code === 'night_driving')).toMatchObject({ name_en: 'Night driving', name_ar: 'قيادة ليلية' });
      expect(await addSkillToVocabulary({ code: 'night_driving', name_en: 'Again', name_ar: '' })).toMatchObject({ ok: false, code: 'conflict' });
      expect(await addSkillToVocabulary({ code: 'Bad Code', name_en: 'x', name_ar: '' })).toMatchObject({ ok: false, code: 'invalid' });
      session.role = 'viewer_auditor';
      expect(await addSkillToVocabulary({ code: 'other_skill', name_en: 'Other', name_ar: '' })).toMatchObject({ ok: false, code: 'forbidden' });
      const outcomes = (await events('skill.added')).map((e) => e.outcome);
      expect(outcomes).toContain('denied');
      expect(outcomes).toContain('success');
    });

    it('names a skill in Arabic, refuses to remove a held one, and removes it once free, audited', async () => {
      const code = `act_${randomUUID().slice(0, 8)}`;
      expect(await addSkillToVocabulary({ code, name_en: 'Action skill', name_ar: '' })).toMatchObject({ ok: true });
      expect(await renameSkill({ code, name_ar: ' مهارة ' })).toMatchObject({ ok: true, data: { code } });
      expect((await getSkillVocabulary(await adminContext())).find((k) => k.code === code)).toMatchObject({ name_en: 'Action skill', name_ar: 'مهارة' });
      expect(await renameSkill({ code: 'no_such_skill', name_ar: 'x' })).toMatchObject({ ok: false, code: 'not_found' });
      const holder = (await listAgents(await adminContext(), { limit: 1 })).items[0]!;
      const held = (await listAgentSkills(await adminContext(), holder.id)).items[0]!.skill_code;
      expect(await removeSkillFromVocabulary({ code: held })).toMatchObject({ ok: false, code: 'conflict' });
      expect(await removeSkillFromVocabulary({ code })).toMatchObject({ ok: true, data: { code } });
      expect((await getSkillVocabulary(await adminContext())).map((k) => k.code)).not.toContain(code);
      session.role = 'planner';
      expect(await renameSkill({ code: held, name_ar: 'x' })).toMatchObject({ ok: false, code: 'forbidden' });
      expect(await removeSkillFromVocabulary({ code: held })).toMatchObject({ ok: false, code: 'forbidden' });
      expect((await events('skill.updated')).map((e) => e.outcome)).toEqual(expect.arrayContaining(['success', 'denied']));
      expect((await events('skill.removed')).map((e) => e.outcome)).toEqual(expect.arrayContaining(['success', 'denied']));
    });

    it('imports the sample file in one audited call and counts what it added; a second import says the codes exist', async () => {
      const sample = getAgentsImportSample(await adminContext()).text;
      // Avoid SVR-SMP-: a sibling file searches by it.
      const prefix = randomUUID().slice(0, 8).toUpperCase();
      const text = sample.replaceAll('SVR-SMP-', `SVR-${prefix}-`);
      const before = (await agents()).length;
      const result = await importAgentsCsv({ file: text });
      expect(result).toMatchObject({ ok: true });
      if (result.ok) expect(result.data.agents).toBeGreaterThan(0);
      expect((await events('agent.imported')).at(0)?.outcome).toBe('success');
      expect(await importAgentsCsv({ file: text })).toMatchObject({ ok: false, code: 'invalid' });
      expect(before).toBeGreaterThan(0);
    });

    it('refuses a file that is empty or not text, and is refused for a viewer', async () => {
      for (const bad of ['', 42, null, undefined]) expect(await importAgentsCsv({ file: bad as never }), String(bad)).toMatchObject({ ok: false, code: 'invalid' });
      session.role = 'viewer_auditor';
      expect(await importAgentsCsv({ file: 'code,name_en\n' })).toMatchObject({ ok: false, code: 'forbidden' });
    });
  });

  describe('every action', () => {
    it('answers `unauthenticated` with no session, refuses input that is not an object, and leaks no input on an unexpected error', async () => {
      session.role = null;
      expect(await saveAgent(await newAgent())).toMatchObject({ ok: false, code: 'unauthenticated' });
      session.role = 'administrator';
      for (const bad of [null, undefined, 'x', 42, [], {}]) expect(await saveAgent(bad as never), JSON.stringify(bad)).toMatchObject({ ok: false, code: 'invalid' });
      const hostile = new Proxy({}, {
        getOwnPropertyDescriptor() {
          throw new TypeError('boom: password=hunter2 name=secret-person');
        },
      });
      const result = await saveAgent(hostile as never);
      expect(result).toMatchObject({ ok: false, code: 'unexpected' });
      if (result.ok) throw new Error('unreachable');
      expect(result.reference).toMatch(/^ODP-[0-9A-F]{8}$/);
      expect(JSON.stringify(result) + errorLog.mock.calls.flat().join('\n')).not.toMatch(/hunter2|secret-person|boom/);
    });

    it('never forwards a field it does not name, and names the caller in the audit event whatever the input claims', async () => {
      const input = await newAgent();
      expect(await saveAgent({ ...input, role: 'administrator', tenant_id: 'x', created_by: 'forged', actor_user_id: 'forged', kind: 'remote' } as never)).toMatchObject({ ok: true });
      const created = await agent(input.code);
      expect(created).toMatchObject({ kind: 'field', tenant_id: (await adminContext()).customerId });
      expect((await events('agent.created'))[0]?.actor_user_id).toBe((await adminContext()).userId);
    });
  });

  describe('the server-built context rule in this file', () => {
    const source = fs.readFileSync(path.join(import.meta.dirname, 'actions.ts'), 'utf8');
    const types = fs.readFileSync(path.join(import.meta.dirname, 'types.ts'), 'utf8');

    it('is a use-server file whose exports are all async functions', () => {
      expect(source.trimStart().startsWith("'use server';")).toBe(true);
      const exported = [...source.matchAll(/^export\s+(\w+)/gm)].map((m) => m[1]);
      expect([...new Set(exported)]).toEqual(['async']);
      expect(exported).toHaveLength(7);
    });

    it('names no parameter or field called ctx, context, customer, tenant, userId, role, zoneScope or installMode', () => {
      const inputTypes = types.slice(types.indexOf('What the browser sends'));
      const fields = [...inputTypes.matchAll(/readonly\s+(\w+)\??:/g)].map((m) => (m[1] as string).toLowerCase().replaceAll('_', ''));
      expect(fields.length).toBeGreaterThan(15);
      for (const field of fields) expect(['ctx', 'context', 'customer', 'customerid', 'tenant', 'tenantid', 'userid', 'role', 'zonescope', 'installmode']).not.toContain(field);
      for (const signature of [...source.matchAll(/^export async function \w+\(([^)]*)\)/gm)].map((m) => m[1] as string)) expect(signature).not.toMatch(/\b(ctx|context|customer|customerId|tenantId|userId|role|zoneScope|installMode)\b/);
    });
  });
});
