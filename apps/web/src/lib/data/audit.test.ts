// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, vi } from 'vitest';
import { listAuditEvents, getAuditEvent } from './audit';
import { applyUpdate } from './updates';
import { ForbiddenError, InvalidInputError, NotFoundError } from './errors';
import { fixtureRecords } from './internal/fixtures';
import { ctxFor, expectValid, expectValidItems, recordAuditForTest as recordAudit, withTempDemoState } from './test-support';
import type { AuditEvent } from '@/lib/types';

withTempDemoState();

describe('audit log', () => {
  it('records a full contract event and lists it first', async () => {
    const ctx = ctxFor('administrator');
    const event = await recordAudit(ctx, { action: 'rule.approved', entity_type: 'rule_version', entity_id: 'RULE-001', summary_en: 'Approved.', detail: { version: 2 } });
    expectValid('AuditEvent', event);
    expect(event).toMatchObject({ data_source: 'SYNTHETIC', actor_type: 'user', actor_user_id: ctx.userId, outcome: 'success', tenant_id: ctx.customerId });
    const list = await listAuditEvents(ctx);
    expect(list.items[0]?.id).toBe(event.id);
    expect(list.page.total).toBe(fixtureRecords<AuditEvent>('AuditEvent').length + 1);
    expectValid('AuditEventList', list);
    expect(await getAuditEvent(ctx, event.id)).toEqual(event);
  });

  it('returns the seeded fixtures too, newest first, in pages', async () => {
    const ctx = ctxFor('viewer_auditor');
    const seeded = fixtureRecords<AuditEvent>('AuditEvent');
    const all = await listAuditEvents(ctx, { limit: 200 });
    expect(all.items).toHaveLength(seeded.length);
    const times = all.items.map((e) => Date.parse(e.occurred_at));
    expect([...times].sort((a, b) => b - a)).toEqual(times);
    const first = await listAuditEvents(ctx, { limit: 5 });
    const second = await listAuditEvents(ctx, { limit: 5, cursor: first.page.next_cursor as string });
    expect([...first.items, ...second.items].map((e) => e.id)).toEqual(all.items.slice(0, 10).map((e) => e.id));
    expectValidItems('AuditEvent', all.items);
  });

  it('filters by action, outcome, actor and time', async () => {
    const ctx = ctxFor('administrator');
    await recordAudit(ctx, { action: 'user.created', entity_type: 'user', entity_id: 'u1', summary_en: 'Created.' });
    await recordAudit(ctx, { action: 'user.created', entity_type: 'user', entity_id: 'u2', summary_en: 'Denied.', outcome: 'denied' });
    expect((await listAuditEvents(ctx, { action: 'user.created' })).items).toHaveLength(2);
    expect((await listAuditEvents(ctx, { action: 'user.created', outcome: 'denied' })).items).toHaveLength(1);
    expect((await listAuditEvents(ctx, { entity_id: 'u1' })).items).toHaveLength(1);
    expect((await listAuditEvents(ctx, { actor_user_id: ctx.userId })).items.length).toBeGreaterThanOrEqual(2);
    expect((await listAuditEvents(ctx, { from: '2100-01-01T00:00:00+03:00' })).items).toHaveLength(0);
  });

  it('is visible to the Administrator, Viewer / Auditor and Change Approver only', async () => {
    await expect(listAuditEvents(ctxFor('viewer_auditor'))).resolves.not.toThrow();
    await expect(listAuditEvents(ctxFor('change_approver'))).resolves.not.toThrow();
    await expect(listAuditEvents(ctxFor('change_approver', { installMode: 'shared' }))).rejects.toThrow(ForbiddenError);
    for (const role of ['dispatch_supervisor', 'dispatcher', 'planner', 'remote_team_lead'] as const) {
      await expect(listAuditEvents(ctxFor(role))).rejects.toThrow(ForbiddenError);
    }
    await expect(getAuditEvent(ctxFor('planner'), 'x')).rejects.toThrow(ForbiddenError);
    await expect(getAuditEvent(ctxFor('administrator'), '00000000-0000-4000-8000-000000000000')).rejects.toThrow(NotFoundError);
  });

  it('rejects an action that is not a lower case dotted name', async () => {
    await expect(recordAudit(ctxFor('administrator'), { action: 'Bad Action', entity_type: 'x', summary_en: 'x' })).rejects.toThrow(InvalidInputError);
  });

  it('shows a write Go refused as a denied event of the caller', async () => {
    const planner = ctxFor('planner');
    await expect(applyUpdate(planner, '1.2.0')).rejects.toThrow(ForbiddenError);
    await expect(applyUpdate(planner, 123 as never)).rejects.toThrow(ForbiddenError);
    const denied = (await listAuditEvents(ctxFor('administrator'), { action: 'update.apply', outcome: 'denied' })).items;
    expect(denied.map((e) => e.entity_id).sort()).toEqual(['1.2.0', '123']);
    expect(denied[0]).toMatchObject({ actor_user_id: planner.userId });
    expectValidItems('AuditEvent', denied);
  });

  it('exports only the two read operations: writing an event is internal (review M2)', async () => {
    const mod = await import('./audit');
    expect(Object.keys(mod).sort()).toEqual(['getAuditEvent', 'listAuditEvents']);
  });

  it('persists across a fresh module instance', async () => {
    const admin = ctxFor('administrator');
    const event = await recordAudit(admin, { action: 'demo.test', entity_type: 'demo', summary_en: 'Persisted.' });
    vi.resetModules();
    const fresh = await import('./audit');
    expect((await fresh.getAuditEvent(admin, event.id)).summary_en).toBe('Persisted.');
  });
});

// ---------------------------------------------------------------------------------------------
// DG2: the category chips (action_prefix) and the text search (q) of the Audit Log
// ---------------------------------------------------------------------------------------------

describe('audit filters: action_prefix and q (DG2)', () => {
  const seed = async (ctx = ctxFor('administrator')) => {
    await recordAudit(ctx, { action: 'rule.approved', entity_type: 'rule_version', entity_id: 'RULE-001', summary_en: 'Rule RULE-001 version 2 approved.' });
    await recordAudit(ctx, { action: 'rule.submitted', entity_type: 'rule_version', entity_id: 'RULE-002', summary_en: 'Rule RULE-002 submitted.' });
    await recordAudit(ctx, { action: 'roster.approved', entity_type: 'roster', entity_id: 'r1', summary_en: 'Roster approved.' });
    await recordAudit(ctx, { action: 'auth.mock_sign_in', entity_type: 'user', entity_id: 'x', summary_en: 'Signed in.' });
    await recordAudit(ctx, { action: 'identity_provider.created', entity_type: 'identity_provider', entity_id: 'p1', summary_en: 'Provider added.' });
    return ctx;
  };

  it('matches the action by prefix: rule. finds the seeded and the new rule.approved, not roster.', async () => {
    const ctx = await seed();
    const actions = (await listAuditEvents(ctx, { action_prefix: 'rule.', limit: 200 })).items.map((e) => e.action);
    expect(actions).toEqual(expect.arrayContaining(['rule.approved', 'rule.submitted']));
    expect(actions).not.toContain('rule.approve');
    expect(actions.every((a) => a.startsWith('rule.'))).toBe(true);
    expect(actions).not.toContain('roster.approved');
    expect((await listAuditEvents(ctx, { action_prefix: 'roster.approve', limit: 200 })).items.map((e) => e.action).sort()).toEqual(['roster.approve', 'roster.approved']);
    expect((await listAuditEvents(ctx, { action_prefix: 'nothing.', limit: 200 })).items).toEqual([]);
  });

  it('takes several prefixes separated by commas (a category with more than one family of actions)', async () => {
    const ctx = await seed();
    const actions = new Set((await listAuditEvents(ctx, { action_prefix: 'auth.,identity_provider.', limit: 200 })).items.map((e) => e.action));
    expect([...actions].every((a) => a.startsWith('auth.') || a.startsWith('identity_provider.'))).toBe(true);
    expect([...actions]).toEqual(expect.arrayContaining(['auth.sign_in', 'auth.mock_sign_in', 'identity_provider.created']));
    expect((await listAuditEvents(ctx, { action_prefix: ' rule. , roster. ', limit: 200 })).items.every((e) => e.action.startsWith('rule.') || e.action.startsWith('roster.'))).toBe(true);
  });

  it('treats an empty prefix as no filter, and refuses a prefix that is not a lower case dotted name', async () => {
    const ctx = await seed();
    const all = (await listAuditEvents(ctx, { limit: 200 })).page.total;
    expect((await listAuditEvents(ctx, { action_prefix: '', limit: 200 })).page.total).toBe(all);
    for (const bad of ['Rule.', 'rule approved', '.rule', 'rule.%', '../x', 'a'.repeat(97), 'a,b,c,d,e,f,g,h,i']) await expect(listAuditEvents(ctx, { action_prefix: bad }), bad).rejects.toThrow(InvalidInputError);
  });

  it('searches the text of an event: action, entity, summary and the name of the actor, without regard to case', async () => {
    const ctx = await seed();
    expect((await listAuditEvents(ctx, { q: 'RULE-002 SUBMITTED' })).items.map((e) => e.action)).toEqual(['rule.submitted']);
    expect((await listAuditEvents(ctx, { q: 'rule-001 version 2 approved' })).items.map((e) => e.action)).toEqual(['rule.approved']);
    expect((await listAuditEvents(ctx, { q: 'identity_provider' })).items.length).toBeGreaterThan(0);
    const actor = fixtureRecords<{ id: string; display_name: string; assigned_role: string; is_emergency_admin: boolean }>('User').find((u) => u.id === ctx.userId)!;
    const byName = (await listAuditEvents(ctx, { q: actor.display_name.toUpperCase(), limit: 200 })).items;
    expect(byName.length).toBeGreaterThan(0);
    expect(byName.every((e) => e.actor_user_id === ctx.userId || `${e.action} ${e.entity_type} ${e.entity_id ?? ''} ${e.summary_en}`.toLowerCase().includes(actor.display_name.toLowerCase()))).toBe(true);
    expect((await listAuditEvents(ctx, { q: 'no such text anywhere' })).items).toEqual([]);
    expect((await listAuditEvents(ctx, { q: '   ' , limit: 200 })).page.total).toBe((await listAuditEvents(ctx, { limit: 200 })).page.total);
  });

  it('combines with the other filters and with paging, and keeps the total honest', async () => {
    const ctx = await seed();
    const denied = await recordAudit(ctx, { action: 'rule.rejected', entity_type: 'rule_version', entity_id: 'RULE-003', summary_en: 'Rejected.', outcome: 'denied' });
    expect((await listAuditEvents(ctx, { action_prefix: 'rule.', outcome: 'denied' })).items.map((e) => e.id)).toEqual([denied.id]);
    const first = await listAuditEvents(ctx, { action_prefix: 'rule.', limit: 2 });
    expect(first.items).toHaveLength(2);
    expect(first.page.total).toBe((await listAuditEvents(ctx, { action_prefix: 'rule.', limit: 200 })).items.length);
    const second = await listAuditEvents(ctx, { action_prefix: 'rule.', limit: 2, cursor: first.page.next_cursor as string });
    expect(second.items.every((e) => e.action.startsWith('rule.'))).toBe(true);
  });

  it('is for the roles that may read the log, as before: a Planner is forbidden whatever the filter says, and the filter is checked after the role', async () => {
    await expect(listAuditEvents(ctxFor('planner'), { action_prefix: 'rule.' })).rejects.toThrow(ForbiddenError);
    await expect(listAuditEvents(ctxFor('planner'), { action_prefix: 'NOT VALID' })).rejects.toThrow(ForbiddenError);
    await expect(listAuditEvents(ctxFor('viewer_auditor'), { action_prefix: 'rule.', q: 'x' })).resolves.not.toThrow();
    await expect(listAuditEvents(ctxFor('change_approver'), { action_prefix: 'rule.' })).resolves.not.toThrow();
    await expect(listAuditEvents(ctxFor('viewer_auditor'), { action_prefix: 'NOT VALID' })).rejects.toThrow(InvalidInputError);
  });
});
