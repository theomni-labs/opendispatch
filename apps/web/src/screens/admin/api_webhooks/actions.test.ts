// SPDX-License-Identifier: AGPL-3.0-only
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { InstallMode, Role } from '@/lib/access';
import { listAuditEvents } from '@/lib/data/audit';
import { UnauthenticatedError } from '@/lib/data/errors';
import type { RequestContext } from '@/lib/data/guard';
import { getRateLimits, listApiClients, listWebhookDeliveries, listWebhooks } from '@/lib/data/system';
import { createClient, removeHook, retryDelivery, revokeClient, rotateClient, saveHook, saveLimits, testHook } from './actions';
import { fixtureUsers, resetGoTestState } from '@/lib/data/go-test-reset';
import { buildContext, fixtureTenantId } from '@/lib/data/go-test-reset';

// The server actions against the real data layer and its seeds, with the demo store in a temp folder. The session is the only thing
// stood in for: requireRequestContext returns the context of the role the test picks.
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
  await resetGoTestState();
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
const events = async (action: string) => (await listAuditEvents(await adminContext(), { action, limit: 200 })).items;
const clients = async () => (await listApiClients(await adminContext(), { limit: 200 })).items;
const hooks = async () => (await listWebhooks(await adminContext(), { limit: 200 })).items;
const hookId = async () => (await hooks())[0]?.id as string;
const failedDelivery = async () => (await listWebhookDeliveries(await adminContext(), await hookId(), { limit: 50 })).items.find((d) => d.status === 'failed') as NonNullable<Awaited<ReturnType<typeof listWebhookDeliveries>>['items'][number]>;

const hook = (change: Record<string, unknown> = {}) => ({ name: 'Rules to the wiki', target_url: 'https://hooks.example.com/opendispatch/rules', event_types: ['rule.approved'], is_enabled: true, ...change });

describe('createClient (the key is returned once)', () => {
  it('creates a client, audits it, refreshes the page in both languages and returns the key in the result and nowhere else', async () => {
    const result = await createClient({ name: 'Planning tool', scopes: ['read', 'write'] });
    expect(result).toMatchObject({ ok: true, data: { name: 'Planning tool', secret: expect.stringMatching(/^opendispatch_[A-Za-z0-9_-]{30,}$/) } });
    if (!result.ok) return;
    const key = result.data.secret;
    const stored = (await clients()).find((client) => client.name === 'Planning tool');
    expect(stored).toMatchObject({ scopes: ['read', 'write'], is_revoked: false, secret_hint: key.slice(-4) });
    // only the last four characters are kept: the key is in no stored record, no audit event, no revalidated path, no log
    expect(JSON.stringify(await clients())).not.toContain(key);
    expect(JSON.stringify((await listAuditEvents(await adminContext(), { limit: 200 })).items)).not.toContain(key);
    expect(JSON.stringify(session.revalidate.mock.calls)).not.toContain(key);
    expect(errorLog.mock.calls.flat().join('\n')).not.toContain(key);
    expect((await events('api_client.created')).at(0)).toMatchObject({ outcome: 'success', entity_id: result.data.id });
    expect(session.revalidate.mock.calls.map((c) => c[0])).toEqual(['/en/admin/api-webhooks', '/ar/admin/api-webhooks']);
  });

  it('gives a different key each time', async () => {
    const one = await createClient({ name: 'One', scopes: ['read'] });
    const two = await createClient({ name: 'Two', scopes: ['read'] });
    if (!one.ok || !two.ok) throw new Error('not created');
    expect(one.data.secret).not.toBe(two.data.secret);
  });

  it.each([
    ['no name', { name: '', scopes: ['read'] }],
    ['a name that is too long', { name: 'x'.repeat(121), scopes: ['read'] }],
    ['no scope', { name: 'x', scopes: [] }],
    ['a scope that does not exist', { name: 'x', scopes: ['admin'] }],
    ['scopes that are not a list', { name: 'x', scopes: 'read' }],
  ])('refuses %s, as `invalid`, and creates nothing', async (_name, input) => {
    const before = (await clients()).length;
    const result = await createClient(input as never);
    expect(result).toMatchObject({ ok: false, code: 'invalid' });
    expect((await clients()).length).toBe(before);
    if (!result.ok) expect(result.message).not.toMatch(/opendispatch_/);
  });

  it('never forwards a field it does not name: a crafted body cannot set the customer, a role or a key', async () => {
    const result = await createClient({ name: 'Crafted', scopes: ['read'], customerId: 'other', role: 'administrator', secret: 'opendispatch_forged', is_revoked: true } as never);
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    expect(result.data.secret).not.toBe('opendispatch_forged');
    expect((await clients()).find((client) => client.name === 'Crafted')?.is_revoked).toBe(false);
  });

  it('is refused for every role but the Administrator (audited as denied), and with no session as `unauthenticated`', async () => {
    for (const role of ['dispatch_supervisor', 'dispatcher', 'planner', 'remote_team_lead', 'viewer_auditor', 'change_approver'] as const) {
      session.role = role;
      expect(await createClient({ name: 'x', scopes: ['read'] }), role).toMatchObject({ ok: false, code: 'forbidden' });
    }
    expect((await events('api_client.created')).every((e) => e.outcome === 'denied')).toBe(true);
    expect((await clients()).some((client) => client.name === 'x')).toBe(false);
    session.role = null;
    expect(await createClient({ name: 'x', scopes: ['read'] })).toMatchObject({ ok: false, code: 'unauthenticated' });
  });
});

describe('revokeClient', () => {
  it('revokes a client, returns its name for the toast, and audits it', async () => {
    const target = (await clients())[0] as NonNullable<Awaited<ReturnType<typeof clients>>[number]>;
    expect(await revokeClient({ clientId: target.id })).toMatchObject({ ok: true, data: { id: target.id, name: target.name } });
    expect((await clients()).find((client) => client.id === target.id)?.is_revoked).toBe(true);
    expect((await events('api_client.revoked')).at(0)).toMatchObject({ outcome: 'success', entity_id: target.id });
  });

  it('refuses a client that is already revoked (`conflict`), one that does not exist, and an id that is not one', async () => {
    const revoked = (await clients()).find((client) => client.is_revoked) as NonNullable<Awaited<ReturnType<typeof clients>>[number]>;
    expect(await revokeClient({ clientId: revoked.id })).toMatchObject({ ok: false, code: 'conflict' });
    expect(await revokeClient({ clientId: '00000000-0000-4000-8000-00000000dead' })).toMatchObject({ ok: false, code: 'not_found' });
    for (const bad of ['', 'toString', '__proto__', '../x', 42, null, undefined]) expect(await revokeClient({ clientId: bad as never }), String(bad)).toMatchObject({ ok: false, code: 'invalid' });
  });

  it('is refused for a role that cannot even read the clients, audited as denied, and changes nothing', async () => {
    const target = (await clients())[0] as NonNullable<Awaited<ReturnType<typeof clients>>[number]>;
    session.role = 'planner';
    expect(await revokeClient({ clientId: target.id })).toMatchObject({ ok: false, code: 'forbidden' });
    expect((await clients()).find((client) => client.id === target.id)?.is_revoked).toBe(false);
    expect((await events('api_client.revoked')).map((e) => e.outcome)).toEqual(['denied']);
  });
});

describe('rotateClient (the new key is returned once)', () => {
  it('rotates a key, keeps only its hint, audits it, and leaves the key nowhere else', async () => {
    const target = (await clients()).find((client) => !client.is_revoked) as NonNullable<Awaited<ReturnType<typeof clients>>[number]>;
    const result = await rotateClient({ clientId: target.id });
    expect(result).toMatchObject({ ok: true, data: { id: target.id, name: target.name, secret: expect.stringMatching(/^opendispatch_[A-Za-z0-9_-]{30,}$/) } });
    if (!result.ok) return;
    const key = result.data.secret;
    expect((await clients()).find((client) => client.id === target.id)?.secret_hint).toBe(key.slice(-4));
    expect(JSON.stringify(await clients())).not.toContain(key);
    expect(JSON.stringify((await listAuditEvents(await adminContext(), { limit: 200 })).items)).not.toContain(key);
    expect(JSON.stringify(session.revalidate.mock.calls)).not.toContain(key);
    expect((await events('api_client.rotated')).at(0)).toMatchObject({ outcome: 'success', entity_id: target.id });
  });

  it('refuses a revoked client, a missing one, and a role without edit (audited)', async () => {
    const revoked = (await clients()).find((client) => client.is_revoked) as NonNullable<Awaited<ReturnType<typeof clients>>[number]>;
    expect(await rotateClient({ clientId: revoked.id })).toMatchObject({ ok: false, code: 'conflict' });
    expect(await rotateClient({ clientId: '00000000-0000-4000-8000-00000000dead' })).toMatchObject({ ok: false, code: 'not_found' });
    session.role = 'planner';
    expect(await rotateClient({ clientId: revoked.id })).toMatchObject({ ok: false, code: 'forbidden' });
    expect((await events('api_client.rotated')).map((e) => e.outcome)).toContain('denied');
  });
});

describe('saveHook and removeHook', () => {
  it('adds a webhook, audits it, and changes it keeping its identity', async () => {
    const added = await saveHook(hook() as never);
    expect(added).toMatchObject({ ok: true, data: { name: 'Rules to the wiki' } });
    if (!added.ok) return;
    expect((await hooks()).find((h) => h.id === added.data.id)).toMatchObject({ target_url: 'https://hooks.example.com/opendispatch/rules', event_types: ['rule.approved'], is_enabled: true });
    const changed = await saveHook({ ...hook({ name: 'Renamed', is_enabled: false, event_types: ['rule.approved', 'import.completed'] }), hookId: added.data.id } as never);
    expect(changed).toMatchObject({ ok: true, data: { id: added.data.id, name: 'Renamed' } });
    expect((await hooks()).find((h) => h.id === added.data.id)).toMatchObject({ is_enabled: false, event_types: ['rule.approved', 'import.completed'] });
    expect((await events('webhook.created')).at(0)?.outcome).toBe('success');
    expect((await events('webhook.updated')).at(0)?.outcome).toBe('success');
  });

  it.each([
    ['plain http to another host', { target_url: 'http://hooks.example.com/x' }],
    ['an address that is not a URL', { target_url: 'not a url' }],
    ['no event', { event_types: [] }],
    ['an event that does not exist', { event_types: ['user.created'] }],
    ['no name', { name: '' }],
  ])('refuses %s, as `invalid`, and adds nothing', async (_name, change) => {
    const before = (await hooks()).length;
    expect(await saveHook(hook(change) as never)).toMatchObject({ ok: false, code: 'invalid' });
    expect((await hooks()).length).toBe(before);
  });

  it('accepts plain http only for localhost', async () => {
    expect(await saveHook(hook({ target_url: 'http://localhost:8080/hook' }) as never)).toMatchObject({ ok: true });
  });

  it('answers `not_found` for a webhook that does not exist, and refuses an id that is not one', async () => {
    expect(await saveHook({ ...hook(), hookId: '00000000-0000-4000-8000-00000000dead' } as never)).toMatchObject({ ok: false, code: 'not_found' });
    expect(await removeHook({ hookId: '00000000-0000-4000-8000-00000000dead' })).toMatchObject({ ok: false, code: 'not_found' });
    for (const bad of ['', '__proto__', 42, null]) expect(await removeHook({ hookId: bad as never }), String(bad)).toMatchObject({ ok: false, code: 'invalid' });
  });

  it('removes a webhook and audits it', async () => {
    const id = await hookId();
    expect(await removeHook({ hookId: id })).toMatchObject({ ok: true, data: { removed: true } });
    expect((await hooks()).some((h) => h.id === id)).toBe(false);
    expect((await events('webhook.deleted')).at(0)).toMatchObject({ outcome: 'success', entity_id: id });
  });

  it('is refused for other roles and audited as denied, changing nothing', async () => {
    const before = JSON.stringify(await hooks());
    session.role = 'viewer_auditor';
    expect(await saveHook(hook() as never)).toMatchObject({ ok: false, code: 'forbidden' });
    expect(await removeHook({ hookId: await hookId() })).toMatchObject({ ok: false, code: 'forbidden' });
    expect(JSON.stringify(await hooks())).toBe(before);
    expect((await events('webhook.created')).map((e) => e.outcome)).toEqual(['denied']);
    expect((await events('webhook.deleted')).map((e) => e.outcome)).toEqual(['denied']);
  });
});

describe('testHook and retryDelivery (labelled stubs: nothing is sent)', () => {
  it('sends a scripted test delivery, returns the webhook name and answer, and audits it as a stub', async () => {
    const result = await testHook({ hookId: await hookId() });
    expect(result).toMatchObject({ ok: true, data: { name: 'Roster approved to the planning tool', delivered: true, httpStatus: 200 } });
    const audit = (await events('webhook.tested')).at(0);
    expect(audit?.summary_en).toContain('stub: nothing was sent');
    expect(audit?.detail).toMatchObject({ stub: true });
    expect((await listWebhookDeliveries(await adminContext(), await hookId(), { limit: 50 })).items).toHaveLength(4);
  });

  it('fails by script for an address with "fail" in it', async () => {
    const added = await saveHook(hook({ target_url: 'https://fail.example.com/x' }) as never);
    if (!added.ok) throw new Error('not added');
    expect(await testHook({ hookId: added.data.id })).toMatchObject({ ok: true, data: { delivered: false, httpStatus: 500 } });
  });

  it('answers `not_found` and `invalid` for a webhook that does not exist and an id that is not one', async () => {
    expect(await testHook({ hookId: '00000000-0000-4000-8000-00000000dead' })).toMatchObject({ ok: false, code: 'not_found' });
    expect(await testHook({ hookId: '__proto__' })).toMatchObject({ ok: false, code: 'invalid' });
  });

  it('retries a failed delivery: the attempts go up, it says stub, and only a failed one can be retried', async () => {
    const failed = await failedDelivery();
    expect(await retryDelivery({ deliveryId: failed.id })).toMatchObject({ ok: true, data: { delivered: true, httpStatus: 200, attempts: 4 } });
    const audit = (await events('webhook.delivery_retried')).at(0);
    expect(audit?.summary_en).toContain('stub: nothing was sent');
    expect(audit?.detail).toMatchObject({ stub: true });
    expect(await retryDelivery({ deliveryId: failed.id })).toMatchObject({ ok: false, code: 'conflict' });
    expect(await retryDelivery({ deliveryId: '00000000-0000-4000-8000-00000000dead' })).toMatchObject({ ok: false, code: 'not_found' });
    expect(await retryDelivery({ deliveryId: 'nope' })).toMatchObject({ ok: false, code: 'invalid' });
  });

  it('are refused for other roles and audited as denied', async () => {
    const failed = await failedDelivery();
    const id = await hookId();
    session.role = 'planner';
    expect(await testHook({ hookId: id })).toMatchObject({ ok: false, code: 'forbidden' });
    expect(await retryDelivery({ deliveryId: failed.id })).toMatchObject({ ok: false, code: 'forbidden' });
    expect((await events('webhook.tested')).map((e) => e.outcome)).toEqual(['denied']);
    expect((await events('webhook.delivery_retried')).map((e) => e.outcome)).toEqual(['denied']);
  });
});

describe('saveLimits (stored, not enforced)', () => {
  const limits = (change: Record<string, number> = {}) => ({ limits: [{ scope: 'read', requests_per_minute: change['read'] ?? 200, burst: 20 }, { scope: 'write', requests_per_minute: 30, burst: 5 }, { scope: 'feeds', requests_per_minute: 600, burst: 100 }] });

  it('stores the figures, audits them as "stored, not enforced", and returns them', async () => {
    const result = await saveLimits(limits());
    expect(result).toMatchObject({ ok: true, data: { limits: [{ scope: 'read', requestsPerMinute: 200, burst: 20 }, { scope: 'write', requestsPerMinute: 30, burst: 5 }, { scope: 'feeds', requestsPerMinute: 600, burst: 100 }] } });
    expect((await getRateLimits(await adminContext())).limits[0]?.requests_per_minute).toBe(200);
    expect((await events('api_rate_limits.updated')).at(0)?.summary_en).toContain('not enforced');
  });

  it.each([
    ['zero', { read: 0 }],
    ['more than 100,000', { read: 100_001 }],
    ['a fraction', { read: 1.5 }],
  ])('refuses %s requests per minute, as `invalid`', async (_name, change) => {
    expect(await saveLimits(limits(change))).toMatchObject({ ok: false, code: 'invalid' });
    expect((await getRateLimits(await adminContext())).limits[0]?.requests_per_minute).toBe(120);
  });

  it('refuses a list that is missing a scope, repeats one or is not a list', async () => {
    expect(await saveLimits({ limits: limits().limits.slice(0, 2) })).toMatchObject({ ok: false, code: 'invalid' });
    expect(await saveLimits({ limits: [...limits().limits.slice(0, 2), limits().limits[0]] as never })).toMatchObject({ ok: false, code: 'invalid' });
    for (const bad of [null, undefined, 'x', 7, [null, null, null]]) expect(await saveLimits({ limits: bad as never }), JSON.stringify(bad)).toMatchObject({ ok: false, code: 'invalid' });
  });

  it('is refused for other roles and audited as denied', async () => {
    session.role = 'viewer_auditor';
    expect(await saveLimits(limits())).toMatchObject({ ok: false, code: 'forbidden' });
    expect((await events('api_rate_limits.updated')).map((e) => e.outcome)).toEqual(['denied']);
  });
});

describe('an unexpected error', () => {
  it('returns a reference ODP- and 8 hex characters, logs only that reference and the error name, and leaks no input', async () => {
    const hostile = new Proxy({}, {
      getOwnPropertyDescriptor() {
        throw new TypeError('boom: token=hunter2');
      },
    });
    for (const call of [() => createClient(hostile as never), () => saveHook(hostile as never)]) {
      const result = await call();
      expect(result).toMatchObject({ ok: false, code: 'unexpected' });
      if (result.ok) throw new Error('unreachable');
      expect(result.reference).toMatch(/^ODP-[0-9A-F]{8}$/);
      expect(JSON.stringify(result)).not.toMatch(/hunter2|boom/);
    }
    expect(errorLog.mock.calls.flat().join('\n')).not.toMatch(/hunter2|boom/);
  });
});

describe('the server-built context rule in this file', () => {
  const source = fs.readFileSync(path.join(import.meta.dirname, 'actions.ts'), 'utf8');
  const types = fs.readFileSync(path.join(import.meta.dirname, 'types.ts'), 'utf8');

  it('is a use-server file whose exports are all async functions', () => {
    expect(source.trimStart().startsWith("'use server';")).toBe(true);
    const exported = [...source.matchAll(/^export\s+(\w+)/gm)].map((m) => m[1]);
    expect(exported.length).toBe(8);
    expect([...new Set(exported)]).toEqual(['async']);
  });

  it('names no parameter or field called ctx, context, customer, tenant, userId, role, zoneScope or installMode', () => {
    const inputTypes = types.slice(types.indexOf('What the browser sends'), types.indexOf('What the actions give back'));
    const fields = [...inputTypes.matchAll(/readonly\s+(\w+)\??:/g)].map((m) => (m[1] as string).toLowerCase().replaceAll('_', ''));
    expect(fields.length).toBeGreaterThan(8);
    for (const field of fields) expect(['ctx', 'context', 'customer', 'customerid', 'tenant', 'tenantid', 'userid', 'role', 'zonescope', 'installmode']).not.toContain(field);
    for (const signature of [...source.matchAll(/^export async function \w+\(([^)]*)\)/gm)].map((m) => m[1] as string)) expect(signature).not.toMatch(/\b(ctx|context|customer|customerId|tenantId|userId|role|zoneScope|installMode)\b/);
  });
});
