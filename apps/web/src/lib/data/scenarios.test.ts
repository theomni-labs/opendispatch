// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import type { Scenario } from '@/lib/types';
import { listAuditEvents } from './audit';
import { ForbiddenError, InvalidInputError, NotFoundError } from './errors';
import { isId } from './internal/ids';
import { createScenario, deleteScenario, getScenario, listScenarios, runScenario, updateScenario } from './scenarios';
import { ctxFor, expectJunkIdsForbiddenLive, expectJunkIdsInvalidLive, expectValid, fixtureZoneIds, JUNK_IDS, withTempDemoState } from './test-support';

withTempDemoState();

const [riyadhCentral, riyadhNorth, , , , jeddahNorth] = fixtureZoneIds();
const admin = () => ctxFor('administrator');
const planner = () => ctxFor('planner'); // Reem: Riyadh Central, North, East
const monday = '2026-09-14';

async function fixtureScenario(startsWith: string): Promise<Scenario> {
  const found = (await listScenarios(admin(), { limit: 50 })).items.find((s) => s.name.startsWith(startsWith));
  if (found === undefined) throw new Error(`No scenario ${startsWith}`);
  return found;
}

const baseWrite = (zones: (string | undefined)[], adjustments: Record<string, unknown>) => ({ name: 'What if', base_date: monday, zone_ids: zones, adjustments });

describe('reading scenarios', () => {
  it('lists the committed scenarios and validates against the contract', async () => {
    const list = await listScenarios(admin());
    expect(list.items).toHaveLength(3);
    expectValid('ScenarioList', list);
    expectValid('Scenario', await getScenario(admin(), (await fixtureScenario('Riyadh Central')).id));
    await expect(getScenario(admin(), 'f0f0f0f0-0000-4000-8000-000000000000')).rejects.toThrow(NotFoundError);
  });

  it('shows a Planner only scenarios whose zones are all in their scope', async () => {
    const names = (await listScenarios(planner())).items.map((s) => s.name);
    expect(names).toHaveLength(2);
    expect(names.some((n) => n.startsWith('Remote share'))).toBe(false);
    await expect(getScenario(planner(), (await fixtureScenario('Remote share')).id)).rejects.toThrow(NotFoundError);
    for (const role of ['administrator', 'dispatch_supervisor', 'planner', 'viewer_auditor'] as const) await expect(listScenarios(ctxFor(role))).resolves.toBeDefined();
    for (const role of ['dispatcher', 'remote_team_lead', 'change_approver'] as const) await expect(listScenarios(ctxFor(role))).rejects.toThrow(ForbiddenError);
  });
});

describe('creating, changing and deleting', () => {
  it('creates a draft scenario for the Planner’s zones and audits it', async () => {
    const created = await createScenario(planner(), baseWrite([riyadhCentral], { headcount_delta: [{ zone_id: riyadhCentral, field_agents: 2, vehicles: 1 }], remote_share: null }));
    expect(created).toMatchObject({ name: 'What if', status: 'draft', last_run_at: null, base_date: monday, created_by: planner().userId, data_source: 'SYNTHETIC' });
    expectValid('Scenario', created);
    expect((await listAuditEvents(admin(), { action: 'scenario.created' })).items[0]).toMatchObject({ outcome: 'success', entity_type: 'scenario', entity_id: created.id });
  });

  it('refuses input the contract does not allow', async () => {
    const bad = (write: unknown) => createScenario(planner(), write);
    await expect(bad(baseWrite([], {}))).rejects.toThrow(InvalidInputError);
    await expect(bad(baseWrite([riyadhCentral], { remote_share: 1.5 }))).rejects.toThrow(InvalidInputError);
    await expect(bad(baseWrite([riyadhCentral], { headcount_delta: [{ zone_id: riyadhNorth, field_agents: 1 }] }))).rejects.toThrow(InvalidInputError);
    await expect(bad(baseWrite([riyadhCentral], { headcount_delta: [{ zone_id: riyadhCentral, field_agents: 1.5 }] }))).rejects.toThrow(InvalidInputError);
    await expect(bad(baseWrite([riyadhCentral], { shift_pattern_ids: ['f0f0f0f0-0000-4000-8000-000000000000'] }))).rejects.toThrow(InvalidInputError);
    await expect(bad(baseWrite([riyadhCentral], { extra: 1 }))).rejects.toThrow(InvalidInputError);
    await expect(bad({ ...baseWrite([riyadhCentral], {}), role: 'administrator' })).rejects.toThrow(InvalidInputError);
    await expect(bad({ ...baseWrite([riyadhCentral], {}), name: '' })).rejects.toThrow(InvalidInputError);
    await expect(bad({ ...baseWrite([riyadhCentral], {}), base_date: 'monday' })).rejects.toThrow(InvalidInputError);
    await expect(bad(baseWrite(['f0f0f0f0-0000-4000-8000-000000000000'], {}))).rejects.toThrow(ForbiddenError); // outside the scope
  });

  it('refuses a zone outside the scope and roles without edit, and audits the denial', async () => {
    await expect(createScenario(planner(), baseWrite([jeddahNorth], {}))).rejects.toThrow(ForbiddenError);
    await expect(createScenario(planner(), baseWrite([riyadhCentral, jeddahNorth], {}))).rejects.toThrow(ForbiddenError);
    for (const role of ['viewer_auditor', 'dispatch_supervisor', 'administrator'] as const) await expect(createScenario(ctxFor(role), baseWrite([riyadhCentral], {}))).rejects.toThrow(ForbiddenError);
    expect((await listAuditEvents(admin(), { action: 'scenario.created', outcome: 'denied' })).items.length).toBeGreaterThanOrEqual(5);
    await expect(runScenario(ctxFor('viewer_auditor'), (await fixtureScenario('Riyadh Central')).id)).rejects.toThrow(ForbiddenError);
    await expect(deleteScenario(ctxFor('viewer_auditor'), (await fixtureScenario('Riyadh Central')).id)).rejects.toThrow(ForbiddenError);
  });

  it('replaces a scenario (it becomes a draft again) and deletes one', async () => {
    const scenario = await fixtureScenario('Riyadh Central');
    expect(scenario.status).toBe('completed');
    const updated = await updateScenario(planner(), scenario.id, baseWrite([riyadhCentral, riyadhNorth], { remote_share: 0.5 }));
    expect(updated).toMatchObject({ id: scenario.id, status: 'draft', zone_ids: [riyadhCentral, riyadhNorth], name: 'What if' });
    expectValid('Scenario', updated);
    await expect(deleteScenario(planner(), scenario.id)).resolves.toBeUndefined();
    await expect(getScenario(planner(), scenario.id)).rejects.toThrow(NotFoundError);
    expect((await listScenarios(admin())).items).toHaveLength(2);
    await expect(deleteScenario(planner(), scenario.id)).rejects.toThrow(NotFoundError);
    expect((await listAuditEvents(admin(), { action: 'scenario.deleted' })).items).toHaveLength(1);
  });
});

describe('crafted ids (review M4) and guard order (review m2)', () => {
  it('refuses a crafted scenario id up front and changes nothing', async () => {
    await expectJunkIdsInvalidLive((id) => getScenario(admin(), id));
    await expectJunkIdsInvalidLive((id) => updateScenario(planner(), id, baseWrite([riyadhCentral], {})));
    await expectJunkIdsInvalidLive((id) => deleteScenario(planner(), id));
    for (const id of JUNK_IDS) await expect(runScenario(planner(), id as never)).rejects.toThrow(InvalidInputError);
  });

  it('answers forbidden and audits the denial for a caller who may not write, whatever the id or the body', async () => {
    const viewer = () => ctxFor('viewer_auditor');
    await expectJunkIdsForbiddenLive((id) => updateScenario(viewer(), id, 'not an object'));
    await expectJunkIdsForbiddenLive((id) => deleteScenario(viewer(), id));
    await expect(createScenario(viewer(), { name: 12 })).rejects.toThrow(ForbiddenError);
    expect((await listAuditEvents(admin(), { action: 'scenario.created', outcome: 'denied' })).items).toHaveLength(1);
  });

  it('leaves no scenario without an id after a valid create and a refused crafted id', async () => {
    await createScenario(planner(), baseWrite([riyadhCentral], {}));
    await expect(updateScenario(planner(), 'toString', baseWrite([riyadhCentral], {}))).rejects.toThrow(InvalidInputError);
    await expect(deleteScenario(planner(), '__proto__')).rejects.toThrow(InvalidInputError);
    expect((await listScenarios(admin(), { limit: 50 })).items.every((r) => isId(r.id) && typeof r.tenant_id === 'string')).toBe(true);
  });
});
