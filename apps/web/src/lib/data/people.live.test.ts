// SPDX-License-Identifier: AGPL-3.0-only
// Live: skips, never fakes, if OPENDISPATCH_API_URL unset.
// No delete op for agents/vehicles: left in Postgres under this run's own codes.

import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { listAuditEvents } from './audit';
import { ConflictError, ForbiddenError, InvalidInputError, NotFoundError } from './errors';
import { listZones } from './locations';
import { addSkill, createAgent, createVehicle, getAgent, getAgentsImportSample, getVehicle, importAgents, listAllAgentSkills, listAgentSkills, listAgents, listVehicles, removeSkill, setAgentSkills, updateSkill, updateAgent, updateVehicle } from './people';
import { getSkillVocabulary } from './settings';
import type { AgentSkill } from '@/lib/types';
import { ctxFor, expectValid, expectValidItems, fixtureZoneIds } from './test-support';

const hasApi = process.env['OPENDISPATCH_API_URL'] !== undefined && process.env['OPENDISPATCH_API_URL'] !== '';
const randomCode = (prefix: string): string => `${prefix}-${randomUUID().slice(0, 8).toUpperCase()}`;

describe.skipIf(!hasApi)('people (live, real api and Postgres)', () => {
  if (!hasApi) console.log('OPENDISPATCH_API_URL is not set: people.live.test.ts is skipped, not faked.');

  const admin = () => ctxFor('administrator');
  const zones = () => fixtureZoneIds();

  describe('reading', () => {
    it('serves the real seeded fixtures and validates against the contract', async () => {
      const ctx = admin();
      const agents = await listAgents(ctx, { limit: 200 });
      expect(agents.page.total).toBeGreaterThan(0);
      expectValidItems('Agent', agents.items);
      expectValid('AgentList', agents);
      const vehicles = await listVehicles(ctx, { limit: 200 });
      expect(vehicles.page.total).toBeGreaterThan(0);
      expectValidItems('Vehicle', vehicles.items);
      const first = agents.items[0]!;
      expectValid('Agent', await getAgent(ctx, first.id));
      expectValid('AgentSkillList', await listAgentSkills(ctx, first.id));
      expectValid('Vehicle', await getVehicle(ctx, vehicles.items[0]!.id));
    });

    it('serves every agent\'s skills in one batch, the same as one call each', async () => {
      for (const ctx of [admin(), ctxFor('dispatcher', { zones: [zones()[0] as string] })]) {
        const agents: { readonly id: string }[] = [];
        const batch: AgentSkill[] = [];
        for (let cursor: string | undefined, more = true; more; ) {
          const page = await listAgents(ctx, { limit: 200, ...(cursor === undefined ? {} : { cursor }) });
          agents.push(...page.items);
          cursor = page.page.next_cursor ?? undefined;
          more = page.page.has_more;
        }
        for (let cursor: string | undefined, more = true; more; ) {
          const page = await listAllAgentSkills(ctx, { limit: 200, ...(cursor === undefined ? {} : { cursor }) });
          expectValid('AgentSkillList', page);
          batch.push(...page.items);
          cursor = page.page.next_cursor ?? undefined;
          more = page.page.has_more;
        }
        const one = (await Promise.all(agents.map(async (s) => (await listAgentSkills(ctx, s.id, { limit: 200 })).items))).flat();
        const byId = (rows: readonly AgentSkill[]) => new Map(rows.map((k) => [k.id, k] as const));
        expect(byId(batch)).toEqual(byId(one));
        const some = agents.slice(0, 5).map((s) => s.id);
        const picked = await listAllAgentSkills(ctx, { agent_ids: some, limit: 200 });
        expect(byId(picked.items)).toEqual(byId(one.filter((k) => some.includes(k.agent_id))));
      }
      const outside = (await listAgents(admin(), { zone_id: zones()[5] as string, limit: 1 })).items[0]!;
      expect((await listAllAgentSkills(ctxFor('dispatcher', { zones: [zones()[0] as string] }), { agent_ids: [outside.id] })).items).toEqual([]);
      expect((await listAllAgentSkills(admin(), { agent_ids: [] })).items).toEqual([]);
      await expect(listAllAgentSkills(admin(), { agent_ids: ['nope'] })).rejects.toThrow(InvalidInputError);
      await expect(listAllAgentSkills(ctxFor('change_approver'))).rejects.toThrow(ForbiddenError);
    });

    it('filters by zone, kind, activity and search', async () => {
      const ctx = admin();
      const byZone = await listAgents(ctx, { zone_id: zones()[0] as string, limit: 200 });
      expect(byZone.items.every((s) => s.home_zone_id === zones()[0])).toBe(true);
      const remote = await listAgents(ctx, { kind: 'remote', limit: 200 });
      expect(remote.items.length).toBeGreaterThan(0);
      expect(remote.items.every((s) => s.kind === 'remote')).toBe(true);
      const any = (await listAgents(ctx, { limit: 1 })).items[0]!;
      expect((await listAgents(ctx, { q: any.code })).items.some((s) => s.code === any.code)).toBe(true);
      const byVehicleZone = await listVehicles(ctx, { zone_id: zones()[1] as string, limit: 200 });
      expect(byVehicleZone.items.every((v) => v.zone_id === zones()[1])).toBe(true);
    });

    it('shows a dispatcher only the agents and vehicles of their zones', async () => {
      const ctx = ctxFor('dispatcher', { zones: [zones()[0] as string] });
      const list = await listAgents(ctx, { limit: 200 });
      expect(list.items.length).toBeGreaterThan(0);
      expect(list.items.every((s) => s.home_zone_id === zones()[0])).toBe(true);
      expect((await listVehicles(ctx, { limit: 200 })).items.every((v) => v.zone_id === zones()[0])).toBe(true);
      const outside = (await listAgents(admin(), { zone_id: zones()[5] as string, limit: 1 })).items[0]!;
      await expect(getAgent(ctx, outside.id)).rejects.toThrow(NotFoundError);
      await expect(listAgentSkills(ctx, outside.id)).rejects.toThrow(NotFoundError);
      const remoteLead = ctxFor('remote_team_lead');
      expect((await listAgents(remoteLead, { kind: 'remote', limit: 200 })).items.length).toBeGreaterThan(0);
      await expect(listAgents(ctxFor('change_approver'))).rejects.toThrow(ForbiddenError);
    });
  });

  describe('editing (Admin 4)', () => {
    it('creates and updates a vehicle and an agent, sets skills, audited', async () => {
      const ctx = admin();
      const vehicle = await createVehicle(ctx, { code: randomCode('VEH-LIVE'), plate_number: 'SYN 0001', zone_id: zones()[0] as string });
      expectValid('Vehicle', vehicle);
      expect((await updateVehicle(ctx, vehicle.id, { code: vehicle.code, zone_id: zones()[0] as string, is_active: false })).is_active).toBe(false);
      const agent = await createAgent(ctx, { code: randomCode('SVR-LIVE'), name_en: 'Live Test Agent', kind: 'field', home_zone_id: zones()[0] as string, default_vehicle_id: vehicle.id });
      expectValid('Agent', agent);
      expect((await updateAgent(ctx, agent.id, { code: agent.code, name_en: 'Live Test Agent B', kind: 'field', home_zone_id: zones()[0] as string, is_active: false })).is_active).toBe(false);
      const skills = await setAgentSkills(ctx, agent.id, { skill_codes: ['injury_protocol', 'night_operations', 'injury_protocol'] });
      expectValid('AgentSkillList', skills);
      expect(skills.items.map((s) => s.skill_code)).toEqual(['injury_protocol', 'night_operations']);
      expect((await setAgentSkills(ctx, agent.id, { skill_codes: ['heavy_vehicle'] })).items).toHaveLength(1);
      expect((await listAgentSkills(ctx, agent.id)).items.map((s) => s.skill_code)).toEqual(['heavy_vehicle']);
      const actions = (await listAuditEvents(ctx, { limit: 50 })).items.map((e) => e.action);
      for (const action of ['vehicle.created', 'vehicle.updated', 'agent.created', 'agent.updated', 'agent.skills_set']) expect(actions).toContain(action);
    });

    it('refuses duplicates, a field agent without a zone, unknown vehicles and unknown fields', async () => {
      const ctx = admin();
      const existing = (await listAgents(ctx, { limit: 1 })).items[0]!;
      await expect(createAgent(ctx, { code: existing.code, name_en: 'Dup', kind: 'field', home_zone_id: zones()[0] as string })).rejects.toThrow(ConflictError);
      await expect(createAgent(ctx, { code: randomCode('SVR-LIVE'), name_en: 'No zone', kind: 'field' })).rejects.toThrow(InvalidInputError);
      await expect(createAgent(ctx, { code: randomCode('SVR-LIVE'), name_en: 'Remote', kind: 'remote', default_vehicle_id: '00000000-0000-4000-8000-000000000000' })).rejects.toThrow(NotFoundError);
      expect((await createAgent(ctx, { code: randomCode('SVR-LIVE'), name_en: 'Remote', kind: 'remote' })).home_zone_id).toBeNull();
      await expect(createVehicle(ctx, { code: randomCode('VEH-LIVE'), zone_id: zones()[0] as string, colour: 'red' })).rejects.toThrow(InvalidInputError);
      await expect(setAgentSkills(ctx, '00000000-0000-4000-8000-000000000000', { skill_codes: [] })).rejects.toThrow(NotFoundError);
    });

    it('is for the Administrator only', async () => {
      for (const role of ['dispatch_supervisor', 'dispatcher', 'planner', 'remote_team_lead', 'viewer_auditor', 'change_approver'] as const) {
        await expect(createVehicle(ctxFor(role), { code: randomCode('VEH-LIVE'), zone_id: zones()[0] as string })).rejects.toThrow(ForbiddenError);
        await expect(updateSkill(ctxFor(role), 'injury_protocol', { name_ar: 'x' })).rejects.toThrow(ForbiddenError);
        await expect(removeSkill(ctxFor(role), 'injury_protocol')).rejects.toThrow(ForbiddenError);
      }
      expect((await listAuditEvents(admin(), { action: 'skill.removed', outcome: 'denied', limit: 50 })).items.length).toBeGreaterThanOrEqual(6);
    });

    it('renames a skill keeping its code, and removes it only once no agent holds it', async () => {
      const ctx = admin();
      const code = `live_${randomUUID().slice(0, 8)}`;
      await addSkill(ctx, { code, name_en: 'Live skill' });
      const renamed = await updateSkill(ctx, code, { name_en: 'Live skill B', name_ar: 'مهارة' });
      expectValid('SkillVocabularyEntry', renamed);
      expect(renamed).toEqual({ code, name_en: 'Live skill B', name_ar: 'مهارة' });
      expect((await getSkillVocabulary(ctx)).find((s) => s.code === code)).toEqual(renamed);
      await expect(updateSkill(ctx, code, {})).rejects.toThrow(InvalidInputError);
      await expect(updateSkill(ctx, code, { code: 'other' })).rejects.toThrow(InvalidInputError);
      await expect(updateSkill(ctx, 'no_such_skill', { name_en: 'X' })).rejects.toThrow(NotFoundError);
      const agent = await createAgent(ctx, { code: randomCode('SVR-LIVE'), name_en: 'Skill holder', kind: 'remote' });
      await setAgentSkills(ctx, agent.id, { skill_codes: [code] });
      await expect(removeSkill(ctx, code)).rejects.toThrow(ConflictError);
      expect((await listAgentSkills(ctx, agent.id)).items.map((s) => s.skill_code)).toEqual([code]);
      await setAgentSkills(ctx, agent.id, { skill_codes: [] });
      await removeSkill(ctx, code);
      expect((await getSkillVocabulary(ctx)).map((s) => s.code)).not.toContain(code);
      await expect(removeSkill(ctx, code)).rejects.toThrow(NotFoundError);
      const actions = (await listAuditEvents(ctx, { limit: 50 })).items.map((e) => `${e.action}:${e.outcome}`);
      for (const action of ['skill.updated:success', 'skill.removed:success']) expect(actions).toContain(action);
    });
  });

  describe('skill vocabulary and a live agent (DG7)', () => {
    it('a vocabulary skill can be set on a real agent', async () => {
      const ctx = admin();
      const skill = await addSkill(ctx, { code: `live_skill_${randomUUID().slice(0, 8)}`, name_en: 'Live skill' });
      // A disposable agent: setAgentSkills replaces the whole list, so a fixture agent's own skills must stay untouched.
      const agent = await createAgent(ctx, { code: randomCode('SVR-LIVE'), name_en: 'Live Skill Agent', kind: 'remote' });
      expect((await setAgentSkills(ctx, agent.id, { skill_codes: [skill.code] })).items[0]?.skill_code).toBe(skill.code);
    });
  });

  describe('importAgents (DG12)', () => {
    const HEADER = 'code,name_en,name_ar,kind,home_zone_code,default_vehicle_code,is_active,skill_codes';
    const zoneCode = async (id: string): Promise<string> => String((await listZones(admin(), { limit: 200 })).items.find((z) => z.id === id)?.extra?.['code']);

    it('imports the committed sample file into the seeded fixtures: twelve agents, their zones, vehicles and skills, all synthetic', async () => {
      const ctx = admin();
      const sample = getAgentsImportSample(ctx);
      expect(sample).toMatchObject({ file_name: 'agents_sample.csv', content_type: 'text/csv' });
      const result = await importAgents(ctx, { file: sample.text });
      expectValid('AgentImportResult', result);
      expect(result.agents).toBe(12);
      const imported = (await listAgents(ctx, { q: 'SVR-SMP-', limit: 200 })).items;
      expect(imported).toHaveLength(12);
      for (const s of imported) {
        expectValid('Agent', s);
        expect(s).toMatchObject({ data_source: 'SYNTHETIC', created_by: ctx.userId, tenant_id: ctx.customerId, name_ar: null });
        if (s.kind === 'field') expect(s.home_zone_id).not.toBeNull();
        else expect(s.home_zone_id).toBeNull();
      }
      expect(imported.filter((s) => !s.is_active)).toHaveLength(1);
      const first = imported.find((s) => s.code === 'SVR-SMP-001')!;
      expect(first.default_vehicle_id).not.toBeNull();
      const skills = (await listAgentSkills(ctx, first.id)).items.map((k) => k.skill_code);
      expect(skills.length).toBeGreaterThanOrEqual(2);
    });

    it('is one audited call with counts and no names in the log', async () => {
      const ctx = admin();
      const before = (await listAuditEvents(ctx, { action: 'agent.imported', limit: 200 })).items.length;
      await importAgents(ctx, { file: `${HEADER}\nIMP-001-${randomCode('X')},Imported Person,,remote,,,true,remote_review;senior_agent\n` });
      const events = (await listAuditEvents(ctx, { action: 'agent.imported', limit: 200 })).items;
      expect(events).toHaveLength(before + 1);
      expect(events[0]).toMatchObject({ outcome: 'success', entity_type: 'agent_import', actor_user_id: ctx.userId, detail: { agents: 1, skills: 2 } });
      expect(JSON.stringify(events[0])).not.toContain('Imported Person');
    });

    it('defaults is_active to true, drops repeated skills, and reads a zone by its code and a vehicle by its code', async () => {
      const ctx = admin();
      const vehicle = (await listVehicles(ctx, { limit: 200 })).items[0]!;
      const zone = (await listZones(ctx, { limit: 200 })).items.find((z) => z.id === vehicle.zone_id)!;
      const code = randomCode('IMP');
      await importAgents(ctx, { file: `${HEADER}\n${code},Field Person,,field,${String(zone.extra?.['code'])},${vehicle.code},,pedestrian_incident;pedestrian_incident; night_operations \n` });
      const s = (await listAgents(ctx, { q: code })).items.find((x) => x.code === code)!;
      expect(s).toMatchObject({ kind: 'field', is_active: true, home_zone_id: zone.id, default_vehicle_id: vehicle.id });
      expect((await listAgentSkills(ctx, s.id)).items.map((k) => k.skill_code).sort()).toEqual(['night_operations', 'pedestrian_incident']);
    });

    it('validates every row before it writes anything: one bad row means nothing is imported, and the message names the rows', async () => {
      const ctx = admin();
      const good = randomCode('IMP');
      const repeated = randomCode('IMP');
      const file = [HEADER, `${good},Good Person,,remote,,,true,`, ',,,field,RD-C,,true,', `${repeated},Bad Kind,,pilot,RD-C,,true,`, `${randomCode('IMP')},No Zone,,field,,,true,`, `${repeated},Repeated Code,,remote,,,true,`].join('\n');
      let message = '';
      try {
        await importAgents(ctx, { file });
      } catch (error) {
        expect(error).toBeInstanceOf(InvalidInputError);
        message = (error as Error).message;
      }
      expect(message).toMatch(/nothing was imported/i);
      expect(message.length).toBeLessThanOrEqual(500);
      expect((await listAgents(ctx, { q: good })).items).toHaveLength(0);
    });

    it('checks each column: code, names, kind, zone, vehicle, active flag, skills; and a code that exists already', async () => {
      const ctx = admin();
      const existing = (await listAgents(ctx, { limit: 1 })).items[0]!;
      const bad: readonly [string, RegExp][] = [
        [',No code,,remote,,,true,', /code/i],
        [`${'C'.repeat(33)},Long code,,remote,,,true,`, /code/i],
        [`${existing.code},Existing code,,remote,,,true,`, /already/i],
        ['IMP-1,,,remote,,,true,', /name_en/i],
        [`IMP-1,${'n'.repeat(121)},,remote,,,true,`, /name_en/i],
        [`IMP-1,Ok,${'a'.repeat(121)},remote,,,true,`, /name_ar/i],
        ['IMP-1,Ok,,Field,RD-C,,true,', /kind/i],
        ['IMP-1,Ok,,field,,,true,', /home_zone_code/i],
        ['IMP-1,Ok,,field,ZZ-ZZ,,true,', /zone/i],
        ['IMP-1,Ok,,remote,ZZ-ZZ,,true,', /zone/i],
        ['IMP-1,Ok,,remote,,NO-VEHICLE,true,', /vehicle/i],
        ['IMP-1,Ok,,remote,,,maybe,', /is_active/i],
        [`IMP-1,Ok,,remote,,,true,${Array.from({ length: 21 }, (_, i) => `skill${i}`).join(';')}`, /skill/i],
        [`IMP-1,Ok,,remote,,,true,${'x'.repeat(65)}`, /skill/i],
        ['IMP-1,Ok,,remote,,,true,two words', /skill/i],
      ];
      for (const [line, message] of bad) {
        await expect(importAgents(ctx, { file: `${HEADER}\n${line}` }), line).rejects.toThrow(InvalidInputError);
        await expect(importAgents(ctx, { file: `${HEADER}\n${line}` }), line).rejects.toThrow(message);
      }
      const dup = randomCode('IMP');
      await expect(importAgents(ctx, { file: `${HEADER}\n${dup},A,,remote,,,true,\n${dup},B,,remote,,,true,` })).rejects.toThrow(/already/i);
    });

    it('refuses a file whose header or shape is wrong, an empty one, and a body with any other field or size', async () => {
      const ctx = admin();
      for (const file of ['', HEADER, 'code,name_en\nIMP-1,A', `${HEADER}\nIMP-1,A`, HEADER.replace('code', 'staff_code') + '\nIMP-1,A,,remote,,,true,']) await expect(importAgents(ctx, { file }), file).rejects.toThrow(InvalidInputError);
      for (const body of [{}, { file: 5 }, { file: `${HEADER}\nX,Y,,remote,,,true,`, role: 'administrator' }, null, { file: 'a'.repeat(2_000_001) }]) await expect(importAgents(ctx, body), JSON.stringify(body)?.slice(0, 40)).rejects.toThrow(InvalidInputError);
      const rows = Array.from({ length: 5001 }, (_, i) => `IMP-${i},P ${i},,remote,,,true,`);
      await expect(importAgents(ctx, { file: [HEADER, ...rows].join('\n') })).rejects.toThrow(/at most 5000 rows/);
    });

    it('is the Administrator only: every other role is forbidden, whatever the file', async () => {
      const file = `${HEADER}\n${randomCode('IMP')},Person,,remote,,,true,`;
      for (const role of ['dispatch_supervisor', 'dispatcher', 'planner', 'remote_team_lead', 'viewer_auditor', 'change_approver'] as const) {
        await expect(importAgents(ctxFor(role), { file }), role).rejects.toThrow(ForbiddenError);
        expect(() => getAgentsImportSample(ctxFor(role)), role).toThrow(ForbiddenError);
      }
      expect((await importAgents(ctxFor('administrator', { installMode: 'shared' }), { file: `${HEADER}\n${randomCode('IMP')},Person,,remote,,,true,` })).agents).toBe(1);
    });

    // Go signs a fresh token from ctx.role, then re-derives scope from it server-side (matrix.ts:
    // administrator is always whole_install) rather than trusting a locally forged zoneScope. A
    // write this module only ever allows an Administrator to make is therefore never zone-limited,
    // even if the caller's own object claims otherwise — a stricter, more secure property than the
    // old, purely local enforcement this test used to check (which could be fooled by any caller
    // able to build its own RequestContext object).
    it('is not fooled by a locally forged zone restriction (administrator is always whole-install)', async () => {
      const forged = { ...admin(), zoneScope: { kind: 'assigned_zones' as const, zoneIds: [zones()[0] as string] } };
      const outsideCode = await zoneCode(zones()[1] as string);
      expect((await importAgents(forged, { file: `${HEADER}\n${randomCode('IMP')},Person,,field,${outsideCode},,true,` })).agents).toBe(1);
    });
  });
});
