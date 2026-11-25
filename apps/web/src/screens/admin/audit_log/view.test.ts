// SPDX-License-Identifier: AGPL-3.0-only
import { beforeEach, describe, expect, it } from 'vitest';
import type { InstallMode, Role } from '@/lib/access';
import { fixtureUsers } from '@/lib/data/go-test-reset';
import { buildContext, fixtureTenantId } from '@/lib/data/go-test-reset';
import { ForbiddenError } from '@/lib/data/errors';
import type { RequestContext } from '@/lib/data/guard';
import { listUsers } from '@/lib/data/users';
import { CATEGORY_PREFIXES, PAGE_SIZE, entityLabel, eventJson, filterOf, loadAuditView, readEvents, rowOf, sourceOf } from './view';
import { AUDIT_CATEGORIES } from './types';

// The server side of the screen against the real data layer and the committed fixtures (23 seeded events), with the demo store
// in a temp folder.
beforeEach(async () => {
  // Go audit events; no server is fine.
  const url = process.env['OPENDISPATCH_API_URL'];
  if (url) await fetch(`${url}/_internal/test/reset`, { method: 'POST' }).catch(() => undefined);
});

function ctxOf(role: Role, installMode: InstallMode = 'private'): RequestContext {
  const tenant = fixtureTenantId();
  const built = buildContext({ role, installMode, zoneIds: [] }, fixtureUsers(), tenant);
  if (built === null) throw new Error(`no context for ${role}`);
  return built;
}
const admin = () => ctxOf('administrator');
/** A time after every seeded event (12 Sep 2026) by a few hours, so "the last 24 hours" is empty until a write happens. */
const NOW = Date.parse('2026-09-13T06:12:00+03:00');

describe('loadAuditView: the counts and the list', () => {
  it('counts every event, the last 24 hours, the sign-ins and the denied ones, whatever the filters', async () => {
    const view = await loadAuditView(admin(), { q: 'nothing matches this' }, undefined, NOW);
    expect(view.counts.all).toBe(23);
    expect(view.total).toBe(23);
    expect(view.counts.signIns).toBe(9);
    expect(view.counts.denied).toBe(1);
    expect(view.matching).toBe(0);
    expect(view.rows).toEqual([]);
    expect(view.sources).toEqual(['SYNTHETIC']);
  });

  it('lists the newest events first, ten to a page, with the page count', async () => {
    const view = await loadAuditView(admin(), {}, undefined, NOW);
    expect(PAGE_SIZE).toBe(10);
    expect(view.rows).toHaveLength(10);
    expect(view.pageCount).toBe(3);
    const times = view.rows.map((row) => Date.parse(row.occurredAt));
    expect([...times].sort((a, b) => b - a)).toEqual(times);
    const third = await loadAuditView(admin(), { page: 3 }, undefined, NOW);
    expect(third.rows).toHaveLength(3);
    const ids = [...view.rows, ...(await loadAuditView(admin(), { page: 2 }, undefined, NOW)).rows, ...third.rows].map((row) => row.id);
    expect(new Set(ids).size).toBe(23);
  });

  it('puts a page number that is too high on the last page, and one that is too low on the first', async () => {
    expect((await loadAuditView(admin(), { page: 99 }, undefined, NOW)).page).toBe(3);
    expect((await loadAuditView(admin(), { page: 0 }, undefined, NOW)).page).toBe(1);
  });

  it('counts the last 24 hours from the server clock', async () => {
    const view = await loadAuditView(admin(), {}, undefined, NOW);
    // Two seeded events are within a day before 13 Sep 06:12 (the fallback and the feed health change of 12 Sep).
    expect(view.counts.last24h).toBeGreaterThanOrEqual(1);
    const later = await loadAuditView(admin(), {}, undefined, NOW + 30 * 24 * 60 * 60 * 1000);
    expect(later.counts.last24h).toBe(0);
  });

  it('gives each row plain data: names of people, the actor type, the action code, the entity, the English summary, the source', async () => {
    const view = await loadAuditView(admin(), { cat: 'rules' }, undefined, NOW);
    expect(view.rows).toHaveLength(4);
    const row = view.rows[0];
    expect(row).toMatchObject({ action: 'rule.approved', actorName: 'Fahad Al-Musari', actorType: 'user', entityType: 'rule_version', outcome: 'success', source: 'admin' });
    expect(row?.summary).toMatch(/approved\.$/);
    expect(row?.entityLabel).toMatch(/^[0-9a-f]{8}$/);
    expect(JSON.stringify(view)).not.toMatch(/"role"|customerId|tenantId/);
  });

  it('names actors for a role that cannot read the users list (Viewer / Auditor and Change Approver)', async () => {
    for (const role of ['viewer_auditor', 'change_approver'] as const) {
      const view = await loadAuditView(ctxOf(role), { cat: 'rules' }, undefined, NOW);
      expect(view.rows[0]?.actorName, role).toBe('Fahad Al-Musari');
    }
    await expect(listUsers(ctxOf('viewer_auditor'), { limit: 1 })).rejects.toThrow(ForbiddenError);
  });

  it('leaves a person without a name for an event with no user, and knows the system and the demo tooling', async () => {
    const view = await loadAuditView(admin(), { page: 2 }, undefined, NOW);
    const all = (await readEvents(admin(), {}, 0, 100)).events;
    expect(all.some((event) => event.actor_user_id === null && event.actor_type === 'system')).toBe(true);
    expect(view.rows.filter((row) => row.actorName === null).length).toBeGreaterThan(0);
  });
});

describe('loadAuditView: search and filters (DG2)', () => {
  it('filters by outcome', async () => {
    const view = await loadAuditView(admin(), { outcome: 'denied' }, undefined, NOW);
    expect(view.matching).toBe(1);
    expect(view.rows[0]).toMatchObject({ action: 'auth.sign_in', outcome: 'denied', actorName: null });
    expect((await loadAuditView(admin(), { outcome: 'success' }, undefined, NOW)).matching).toBe(22);
  });

  it('filters by category through the action prefixes: each category is a list of at most 8 valid prefixes', async () => {
    for (const category of AUDIT_CATEGORIES) {
      const prefixes = CATEGORY_PREFIXES[category];
      expect(prefixes.length, category).toBeGreaterThan(0);
      expect(prefixes.length, category).toBeLessThanOrEqual(8);
      for (const prefix of prefixes) expect(prefix, category).toMatch(/^[a-z][a-z0-9_.]*$/);
    }
    const counts: Record<string, number> = {};
    for (const category of AUDIT_CATEGORIES) counts[category] = (await loadAuditView(admin(), { cat: category }, undefined, NOW)).matching;
    expect(counts).toMatchObject({ signin: 9, rules: 4, rosters: 3, settings: 2, imports: 1, model: 1 });
    expect(counts['system']).toBeGreaterThanOrEqual(3);
  });

  it('searches the action, the summary, the entity and the name of the actor, without regard to case', async () => {
    expect((await loadAuditView(admin(), { q: 'RULE-002' }, undefined, NOW)).rows.map((row) => row.action)).toEqual(['rule.approved']);
    expect((await loadAuditView(admin(), { q: 'refused' }, undefined, NOW)).matching).toBe(1);
    expect((await loadAuditView(admin(), { q: 'AUTH.EMERGENCY' }, undefined, NOW)).rows.map((row) => row.action)).toEqual(['auth.emergency_sign_in']);
    expect((await loadAuditView(admin(), { q: 'omar al-fadani' }, undefined, NOW)).matching).toBeGreaterThanOrEqual(1);
    expect((await loadAuditView(admin(), { q: 'stage' }, undefined, NOW)).rows.map((row) => row.action)).toContain('setting.update');
  });

  it('filters by period and combines filters', async () => {
    const week = await loadAuditView(admin(), { period: '7d' }, undefined, NOW);
    const day = await loadAuditView(admin(), { period: '24h' }, undefined, NOW);
    expect(day.matching).toBeLessThanOrEqual(week.matching);
    expect(week.matching).toBeLessThan(23);
    const both = await loadAuditView(admin(), { period: '7d', cat: 'signin', outcome: 'success' }, undefined, NOW);
    expect(both.rows.every((row) => row.source === 'signin' && row.outcome === 'success')).toBe(true);
  });

  it('builds the data layer filter from the address, never anything else', () => {
    expect(filterOf({}, NOW)).toEqual({});
    expect(filterOf({ q: 'x', outcome: 'denied', cat: 'rules', period: '24h' }, NOW)).toEqual({ q: 'x', outcome: 'denied', action_prefix: 'rule.', from: new Date(NOW - 24 * 3600 * 1000).toISOString() });
  });

  // 'sees events that a write appends...' needs a
  // live zone id now: see view.live.test.ts.
});

describe('loadAuditView: the open event', () => {
  it('opens an event by id with its record as JSON', async () => {
    const list = await loadAuditView(admin(), { cat: 'rules' }, undefined, NOW);
    const id = list.rows[0]?.id as string;
    const view = await loadAuditView(admin(), { id }, id, NOW);
    expect(view.open?.row.id).toBe(id);
    expect(view.unknownId).toBe(false);
    const json = JSON.parse(view.open?.json ?? '{}') as Record<string, unknown>;
    expect(Object.keys(json)).toEqual(['id', 'tenant_id', 'occurred_at', 'actor_type', 'actor_user_id', 'action', 'entity_type', 'entity_id', 'outcome', 'summary_en', 'correlation_id', 'detail', 'data_source']);
    expect(json).toMatchObject({ action: 'rule.approved', data_source: 'SYNTHETIC' });
  });

  it('says so for an id that names no event, and for one that is not an id (the list still loads)', async () => {
    const missing = await loadAuditView(admin(), { id: '00000000-0000-4000-8000-00000000dead' }, '00000000-0000-4000-8000-00000000dead', NOW);
    expect(missing.open).toBeUndefined();
    expect(missing.unknownId).toBe(true);
    expect(missing.rows).toHaveLength(10);
    const malformed = await loadAuditView(admin(), {}, 'nonsense', NOW);
    expect(malformed.unknownId).toBe(true);
  });
});

describe('roles', () => {
  it('reads for the Administrator, the Viewer / Auditor and the Change Approver; refuses every other role', async () => {
    for (const role of ['administrator', 'viewer_auditor', 'change_approver'] as const) expect((await loadAuditView(ctxOf(role), {}, undefined, NOW)).total, role).toBe(23);
    for (const role of ['dispatch_supervisor', 'dispatcher', 'planner', 'remote_team_lead'] as const) await expect(loadAuditView(ctxOf(role), {}, undefined, NOW), role).rejects.toBeInstanceOf(ForbiddenError);
    await expect(loadAuditView(ctxOf('administrator', 'shared'), {}, undefined, NOW)).resolves.toMatchObject({ total: 23 });
  });
});

describe('the helpers', () => {
  it('shortens an entity id: a name stays, a UUID becomes its first eight characters, a long one is cut', () => {
    expect(entityLabel('live_assignment.stage.rd_c')).toBe('live_assignment.stage.rd_c');
    expect(entityLabel('2c77d82a-2e44-404c-8882-e55eee8368f3')).toBe('13e077b3');
    expect(entityLabel('x'.repeat(60))).toBe(`${'x'.repeat(39)}…`);
    expect(entityLabel(null)).toBeNull();
    expect(entityLabel('')).toBeNull();
  });

  it('gives the source of an event: sign-in, the Ops Console, system jobs and demo tooling, else the Admin Console', () => {
    expect(sourceOf('auth.sign_out', 'user')).toBe('signin');
    expect(sourceOf('sign_in.denied', 'user')).toBe('signin');
    expect(sourceOf('roster.approved', 'user')).toBe('ops');
    expect(sourceOf('assignment.fallback_triggered', 'system')).toBe('system');
    expect(sourceOf('demo.data_loaded', 'demo')).toBe('system');
    expect(sourceOf('user.created', 'user')).toBe('admin');
    expect(sourceOf('break_rule.created', 'user')).toBe('admin');
  });

  it('shows the worker fixed user id as a system actor, and a deleted user as a user', () => {
    const base = { id: 'a', tenant_id: 't', created_at: 'x', updated_at: 'x', created_by: null, data_source: 'SYNTHETIC', occurred_at: '2026-09-12T10:00:00+03:00', actor_type: 'user', action: 'forecast.run_created', entity_type: 'forecast_run', outcome: 'success', summary_en: 'S' } as const;
    const worker = rowOf({ ...base, actor_user_id: '00000000-0000-4000-9000-000000000002' }, {});
    expect(worker).toMatchObject({ actorName: null, actorType: 'system', source: 'system' });
    const gone = rowOf({ ...base, actor_user_id: '7d0c1a52-3e4b-4f6a-8b9c-0d1e2f3a4b5c' }, {});
    expect(gone).toMatchObject({ actorName: null, actorType: 'user', source: 'admin' });
  });

  it('carries the actor role and the summary values when the server gives them', () => {
    const base = { id: 'a', tenant_id: 't', created_at: 'x', updated_at: 'x', created_by: null, data_source: 'SYNTHETIC', occurred_at: '2026-09-12T10:00:00+03:00', actor_type: 'user', action: 'webhook.created', entity_type: 'webhook', outcome: 'success', summary_en: 'Webhook X created.' } as const;
    const id = '7d0c1a52-3e4b-4f6a-8b9c-0d1e2f3a4b5c';
    expect(rowOf({ ...base, actor_user_id: id, summary_params: { name: 'X' } }, { [id]: { name: 'Nadia', role: 'administrator' } })).toMatchObject({ actorName: 'Nadia', actorRole: 'administrator', summaryParams: { name: 'X' } });
    expect(rowOf({ ...base, actor_user_id: id }, { [id]: { name: 'Nadia', role: null } })).toMatchObject({ actorName: 'Nadia', actorRole: null, summaryParams: null });
  });

  it('writes the record as the mockup does, with null for what is missing', () => {
    const json = JSON.parse(eventJson({ id: 'a', tenant_id: 't', created_at: 'x', updated_at: 'x', created_by: null, data_source: 'SYNTHETIC', occurred_at: '2026-09-12T10:00:00+03:00', actor_type: 'system', action: 'x.y', entity_type: 'thing', outcome: 'success', summary_en: 'S' })) as Record<string, unknown>;
    expect(json).toMatchObject({ actor_user_id: null, entity_id: null, correlation_id: null, detail: {} });
  });
});
