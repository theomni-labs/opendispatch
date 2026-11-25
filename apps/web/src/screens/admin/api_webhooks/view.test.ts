// SPDX-License-Identifier: AGPL-3.0-only
import { beforeEach, describe, expect, it } from 'vitest';
import type { InstallMode, Role } from '@/lib/access';
import { buildContext, fixtureTenantId } from '@/lib/data/go-test-reset';
import { ForbiddenError } from '@/lib/data/errors';
import type { RequestContext } from '@/lib/data/guard';
import { createApiClient, createWebhook, retryWebhookDelivery, testWebhook, updateRateLimits } from '@/lib/data/system';
import { loadApiView } from './view';
import { fixtureUsers, resetGoTestState } from '@/lib/data/go-test-reset';

// The server side of the screen against the real data layer and its seeds (3 clients, 1 webhook, 3 deliveries, 3 rate limits),
// with the demo store in a temp folder.
beforeEach(async () => {
  await resetGoTestState();
});

function ctxOf(role: Role, installMode: InstallMode = 'private'): RequestContext {
  const tenant = fixtureTenantId();
  const built = buildContext({ role, installMode, zoneIds: [] }, fixtureUsers(), tenant);
  if (built === null) throw new Error(`no context for ${role}`);
  return built;
}
const admin = () => ctxOf('administrator');

describe('loadApiView: clients, webhooks, deliveries, limits', () => {
  it('counts the active clients, the webhooks and the failed deliveries', async () => {
    const view = await loadApiView(admin(), {});
    expect(view.counts).toEqual({ activeClients: 2, hooks: 1, failed: 1 });
    expect(view.sources).toEqual(['SYNTHETIC']);
  });

  it('gives each client as plain data: scopes, the last four characters of the key only, last use, revoked', async () => {
    const view = await loadApiView(admin(), {});
    expect(view.clients.map((client) => [client.name, client.scopes, client.hint, client.revoked])).toEqual([
      ['Reporting export (read only)', ['read'], 'x7q2', false],
      ['Feed gateway (simulator)', ['feeds'], 'm4c9', false],
      ['Old export client', ['read', 'write'], 'r1b8', true],
    ]);
    expect(view.clients[0]?.lastUsedAt).toBe('2026-09-12T23:00:00+03:00');
    for (const client of view.clients) expect(Object.keys(client)).not.toContain('secret');
  });

  it('never carries a key, not even for a client created now', async () => {
    const ctx = admin();
    const created = await createApiClient(ctx, { name: 'New client', scopes: ['read'] });
    const view = await loadApiView(ctx, {});
    expect(view.clients.some((client) => client.name === 'New client' && client.hint === created.secret.slice(-4))).toBe(true);
    expect(JSON.stringify(view)).not.toContain(created.secret);
  });

  it('lists the webhooks and every delivery of every webhook, newest first, with the webhook\'s name', async () => {
    const view = await loadApiView(admin(), {});
    expect(view.hooks).toHaveLength(1);
    expect(view.hooks[0]).toMatchObject({ name: 'Roster approved to the planning tool', url: 'https://hooks.example.com/opendispatch/roster', events: ['roster.approved'], enabled: true, lastStatus: 'succeeded' });
    expect(view.deliveries.map((delivery) => [delivery.status, delivery.httpStatus, delivery.attempts])).toEqual([
      ['succeeded', 200, 1],
      ['succeeded', 200, 1],
      ['failed', 503, 3],
    ]);
    expect(view.deliveries.every((delivery) => delivery.hookName === 'Roster approved to the planning tool')).toBe(true);
    const times = view.deliveries.map((delivery) => Date.parse(delivery.at));
    expect([...times].sort((a, b) => b - a)).toEqual(times);
  });

  it('merges the deliveries of several webhooks and follows a test and a retry', async () => {
    const ctx = admin();
    const second = await createWebhook(ctx, { name: 'Second', target_url: 'https://fail.example.com/hook', event_types: ['rule.approved'], is_enabled: true });
    await testWebhook(ctx, second.id);
    const view = await loadApiView(ctx, {});
    expect(view.hooks).toHaveLength(2);
    expect(view.deliveries).toHaveLength(4);
    expect(view.deliveries[0]).toMatchObject({ hookName: 'Second', status: 'failed', httpStatus: 500 });
    expect(view.counts.failed).toBe(2);
    await retryWebhookDelivery(ctx, view.deliveries[0]?.id as string);
    const after = await loadApiView(ctx, {});
    expect(after.deliveries.find((delivery) => delivery.hookName === 'Second')?.attempts).toBe(2);
  });

  it('filters the log by status and by search over the webhook name and the event, and keeps the figures', async () => {
    const ctx = admin();
    expect((await loadApiView(ctx, { status: 'failed' })).shownDeliveries).toHaveLength(1);
    expect((await loadApiView(ctx, { status: 'succeeded' })).shownDeliveries).toHaveLength(2);
    expect((await loadApiView(ctx, { q: 'ROSTER' })).shownDeliveries).toHaveLength(3);
    expect((await loadApiView(ctx, { q: 'roster.approved', status: 'failed' })).shownDeliveries).toHaveLength(1);
    const none = await loadApiView(ctx, { q: 'zzz' });
    expect(none.shownDeliveries).toEqual([]);
    expect(none.deliveries).toHaveLength(3);
    expect(none.counts.failed).toBe(1);
  });

  it('reads the rate limits with the number of active clients that have each scope', async () => {
    const view = await loadApiView(admin(), {});
    expect(view.limits).toEqual([
      { scope: 'read', requestsPerMinute: 120, burst: 20, clients: 1 },
      { scope: 'write', requestsPerMinute: 30, burst: 5, clients: 0 },
      { scope: 'feeds', requestsPerMinute: 600, burst: 100, clients: 1 },
    ]);
    await updateRateLimits(admin(), { limits: [{ scope: 'read', requests_per_minute: 200, burst: 20 }, { scope: 'write', requests_per_minute: 30, burst: 5 }, { scope: 'feeds', requests_per_minute: 600, burst: 100 }] });
    expect((await loadApiView(admin(), {})).limits[0]?.requestsPerMinute).toBe(200);
  });

  it('opens a webhook by id or `new`, and says so for an id that names none', async () => {
    const ctx = admin();
    const id = (await loadApiView(ctx, {})).hooks[0]?.id as string;
    expect((await loadApiView(ctx, { hook: id })).openHook).toMatchObject({ id });
    expect((await loadApiView(ctx, { hook: 'new' })).openHook).toBe('new');
    const missing = await loadApiView(ctx, { hook: '00000000-0000-4000-8000-00000000dead' });
    expect(missing.openHook).toBeUndefined();
    expect(missing.unknownHook).toBe(true);
    expect((await loadApiView(ctx, {})).unknownHook).toBe(false);
  });
});

describe('roles', () => {
  it('reads for the Administrator in every install mode and refuses every other role', async () => {
    for (const mode of ['private', 'dedicated', 'shared'] as const) await expect(loadApiView(ctxOf('administrator', mode), {}), mode).resolves.toBeDefined();
    for (const role of ['dispatch_supervisor', 'dispatcher', 'planner', 'remote_team_lead', 'viewer_auditor', 'change_approver'] as const) await expect(loadApiView(ctxOf(role), {}), role).rejects.toBeInstanceOf(ForbiddenError);
  });
});
