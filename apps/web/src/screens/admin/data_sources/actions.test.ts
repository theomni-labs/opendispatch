// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { InstallMode, Role } from '@/lib/access';
import { listAuditEvents } from '@/lib/data/audit';
import { UnauthenticatedError } from '@/lib/data/errors';
import type { RequestContext } from '@/lib/data/guard';
import { getFallbackState, listZoneStages } from '@/lib/data/dispatch';
import { getSettingsSnapshot } from '@/lib/data/settings';
import { listIntegrations } from '@/lib/data/system';
import { fixtureUsers } from '@/lib/data/go-test-reset';
import { allToShadow, changeStage, saveFallback, sendSignal, setMaintenance, switchFeed, testAllFeeds, testFeed } from './actions';
import { buildContext, fixtureTenantId } from '@/lib/data/go-test-reset';

// The server actions against the real data layer and the committed fixtures, with the demo store in a temp folder. The session
// is the only thing stood in for: requireRequestContext returns the context of the role the test picks, exactly what a signed
// cookie would give.
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
  await fetch(`${process.env['OPENDISPATCH_API_URL']}/_internal/test/reset`, { method: 'POST' });
  session.role = 'administrator';
  session.mode = 'private';
  session.revalidate.mockReset();
  errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  errorLog.mockRestore();
});

async function ctx(): Promise<RequestContext> {
  return contextOf('administrator', 'private');
}
const events = async (action: string) => (await listAuditEvents(await ctx(), { action, limit: 200 })).items;
const feeds = async () => (await listIntegrations(await ctx(), { limit: 50 })).items;
const feed = async (kind: string) => (await feeds()).find((f) => f.kind === kind) as Awaited<ReturnType<typeof feeds>>[number];
const stages = async () => (await listZoneStages(await ctx(), { limit: 50 })).items;
const REVALIDATED = ['/en/admin/data-sources', '/ar/admin/data-sources'];

describe('testFeed and testAllFeeds (LABELLED STUBS: nothing is sent)', () => {
  it('tests one feed, audits it, and refreshes the page in both languages', async () => {
    const target = await feed('case_feed');
    const result = await testFeed({ integrationId: target.id });
    expect(result).toMatchObject({ ok: true, data: { integrationId: target.id, ok: true } });
    if (!result.ok) throw new Error('unreachable');
    expect(result.data.latencyMs).toBeGreaterThan(0);
    expect((await events('integration.tested')).at(0)).toMatchObject({ outcome: 'success', entity_id: target.id });
    expect(session.revalidate.mock.calls.map((c) => c[0])).toEqual(REVALIDATED);
  });

  it('a switched-off feed answers not ok with no latency; a degraded one answers slowly', async () => {
    const off = (await feeds()).find((f) => !f.is_enabled) as Awaited<ReturnType<typeof feeds>>[number];
    expect(await testFeed({ integrationId: off.id })).toMatchObject({ ok: true, data: { ok: false, latencyMs: null } });
    const degraded = (await feeds()).find((f) => f.health === 'degraded' && f.is_enabled);
    if (degraded !== undefined) {
      const slow = await testFeed({ integrationId: degraded.id });
      expect(slow).toMatchObject({ ok: true, data: { ok: true } });
      if (slow.ok) expect(slow.data.latencyMs ?? 0).toBeGreaterThanOrEqual(1000);
    }
  });

  it('Test all tests every feed that is switched on, one audited call each, and counts the answers', async () => {
    const on = (await feeds()).filter((f) => f.is_enabled);
    const before = (await events('integration.tested')).length;
    const result = await testAllFeeds();
    expect(result).toMatchObject({ ok: true, data: { tested: on.length } });
    if (!result.ok) throw new Error('unreachable');
    expect(result.data.answered + result.data.slow + result.data.failed).toBe(on.length);
    expect((await events('integration.tested')).length - before).toBe(on.length);
  });

  it('refuses an id that is not one, and a feed that does not exist', async () => {
    for (const bad of ['', 'toString', '__proto__', '../etc', 42, null, undefined]) expect(await testFeed({ integrationId: bad as never }), String(bad)).toMatchObject({ ok: false, code: 'invalid' });
    expect(await testFeed({ integrationId: '00000000-0000-4000-8000-000000000001' })).toMatchObject({ ok: false, code: 'not_found' });
  });
});

describe('switchFeed', () => {
  it('switches a feed on and off, audits it, and a feed switched on that was off starts as unknown', async () => {
    const off = (await feeds()).find((f) => !f.is_enabled) as Awaited<ReturnType<typeof feeds>>[number];
    expect(await switchFeed({ integrationId: off.id, enabled: true })).toMatchObject({ ok: true, data: { enabled: true } });
    expect((await feeds()).find((f) => f.id === off.id)).toMatchObject({ is_enabled: true, health: 'unknown' });
    expect((await events('integration.updated')).at(0)).toMatchObject({ outcome: 'success', entity_id: off.id });
    expect(await switchFeed({ integrationId: off.id, enabled: false })).toMatchObject({ ok: true, data: { enabled: false } });
    expect((await feeds()).find((f) => f.id === off.id)?.health).toBe('disabled');
  });

  it('refuses anything but true or false', async () => {
    const target = await feed('case_feed');
    for (const enabled of ['yes', 1, 'true']) expect(await switchFeed({ integrationId: target.id, enabled: enabled as never }), String(enabled)).toMatchObject({ ok: false, code: 'invalid' });
  });
});

describe('changeStage and allToShadow', () => {
  it('sets the stage of one zone with an optional reason, audits it, and accepts automatic (guardrail 11 is not enforced yet)', async () => {
    const zone = (await stages())[0] as Awaited<ReturnType<typeof stages>>[number];
    expect(await changeStage({ zoneId: zone.zone_id, stage: 'recommend', reason: '' })).toMatchObject({ ok: true, data: { zoneId: zone.zone_id, stage: 'recommend' } });
    expect((await stages()).find((s) => s.zone_id === zone.zone_id)?.stage).toBe('recommend');
    const audit = (await events('settings.zone_stage_changed')).at(0);
    expect(audit).toMatchObject({ outcome: 'success', entity_id: zone.zone_id });
    expect(await changeStage({ zoneId: zone.zone_id, stage: 'automatic', reason: 'Shadow results look right' })).toMatchObject({ ok: true, data: { stage: 'automatic' } });
    expect(JSON.stringify((await events('settings.zone_stage_changed')).at(0)?.detail)).toContain('Shadow results look right');
  });

  it('refuses a stage that does not exist, an unknown zone, hostile ids, and a reason over 300 characters', async () => {
    const zone = (await stages())[0] as Awaited<ReturnType<typeof stages>>[number];
    expect(await changeStage({ zoneId: zone.zone_id, stage: 'autopilot', reason: '' })).toMatchObject({ ok: false, code: 'invalid' });
    expect(await changeStage({ zoneId: zone.zone_id, stage: 'recommend', reason: 'x'.repeat(301) })).toMatchObject({ ok: false, code: 'invalid' });
    expect(await changeStage({ zoneId: '00000000-0000-4000-8000-000000000001', stage: 'recommend', reason: '' })).toMatchObject({ ok: false, code: 'not_found' });
    for (const bad of ['', 'toString', '__proto__', '../etc', 42, null, undefined]) expect(await changeStage({ zoneId: bad as never, stage: 'recommend', reason: '' }), String(bad)).toMatchObject({ ok: false, code: 'invalid' });
  });

  it('All zones to shadow changes only the zones that are not in shadow, one audited call each', async () => {
    const [first, second] = await stages();
    if (first === undefined || second === undefined) throw new Error('no zones');
    await changeStage({ zoneId: first.zone_id, stage: 'recommend', reason: '' });
    await changeStage({ zoneId: second.zone_id, stage: 'automatic', reason: '' });
    const before = (await events('settings.zone_stage_changed')).length;
    expect(await allToShadow({ reason: 'Back to shadow' })).toMatchObject({ ok: true, data: { changed: 2, failed: 0 } });
    expect((await stages()).every((s) => s.stage === 'shadow')).toBe(true);
    expect((await events('settings.zone_stage_changed')).length - before).toBe(2);
    expect(await allToShadow({ reason: '' })).toMatchObject({ ok: true, data: { changed: 0, failed: 0 } });
  });
});

describe('saveFallback', () => {
  it('stores the timeout (1 to 300 s) and the decision deadline (50 to 30,000 ms) and audits the change', async () => {
    expect(await saveFallback({ timeoutSeconds: 8, deadlineMs: 2500 })).toMatchObject({ ok: true, data: { timeoutSeconds: 8, deadlineMs: 2500 } });
    expect(await getSettingsSnapshot(await ctx())).toMatchObject({ fallback_timeout_seconds: 8, decision_deadline_ms: 2500 });
    expect((await events('settings.live_assignment_changed')).at(0)).toMatchObject({ outcome: 'success' });
    for (const bad of [{ timeoutSeconds: 0, deadlineMs: 2000 }, { timeoutSeconds: 301, deadlineMs: 2000 }, { timeoutSeconds: 5, deadlineMs: 49 }, { timeoutSeconds: 5, deadlineMs: 30001 }, { timeoutSeconds: 1.5, deadlineMs: 2000 }, { timeoutSeconds: '5', deadlineMs: 2000 }]) {
      expect(await saveFallback(bad as never), JSON.stringify(bad)).toMatchObject({ ok: false, code: 'invalid' });
    }
  });
});

describe('sendSignal and setMaintenance', () => {
  it('sends a fallback signal with a reason, then a resume signal; both are audited with their reason', async () => {
    expect(await sendSignal({ signal: 'fallback', reason: 'Testing the fallback' })).toMatchObject({ ok: true, data: { state: 'active' } });
    expect(await getFallbackState(await ctx())).toMatchObject({ state: 'active', last_signal: 'fallback' });
    expect(JSON.stringify((await events('fallback.signal_sent')).at(0)?.detail)).toContain('Testing the fallback');
    expect(await sendSignal({ signal: 'resume', reason: 'Back to OpenDispatch' })).toMatchObject({ ok: true, data: { state: 'armed' } });
  });

  it('a signal needs a reason of 1 to 300 characters and a known kind', async () => {
    expect(await sendSignal({ signal: 'fallback', reason: '' })).toMatchObject({ ok: false, code: 'invalid' });
    expect(await sendSignal({ signal: 'fallback', reason: 'x'.repeat(301) })).toMatchObject({ ok: false, code: 'invalid' });
    expect(await sendSignal({ signal: 'panic', reason: 'x' })).toMatchObject({ ok: false, code: 'invalid' });
  });

  it('maintenance mode puts the state to maintenance and back, audits it, and answers what happened', async () => {
    expect(await setMaintenance({ enabled: true })).toMatchObject({ ok: true, data: { state: 'maintenance' } });
    expect(await getFallbackState(await ctx())).toMatchObject({ state: 'maintenance', reason: 'maintenance' });
    expect(await setMaintenance({ enabled: false })).toMatchObject({ ok: true, data: { state: 'armed' } });
    expect((await events('fallback.maintenance_changed')).length).toBe(2);
    expect(await setMaintenance({ enabled: 'yes' as never })).toMatchObject({ ok: false, code: 'invalid' });
  });
});

describe('who may write, and what is audited', () => {
  const zoneId = '00000000-0000-4000-8000-000000000001';
  const writes: readonly [string, () => Promise<{ ok: boolean; code?: string }>, string][] = [
    ['testFeed', () => testFeed({ integrationId: zoneId }), 'integration.tested'],
    ['testAllFeeds', () => testAllFeeds(), 'integration.tested'],
    ['switchFeed', () => switchFeed({ integrationId: zoneId, enabled: true }), 'integration.updated'],
    ['changeStage', () => changeStage({ zoneId, stage: 'shadow', reason: '' }), 'settings.zone_stage_changed'],
    ['allToShadow', () => allToShadow({ reason: '' }), 'settings.zone_stage_changed'],
    ['saveFallback', () => saveFallback({ timeoutSeconds: 5, deadlineMs: 2000 }), 'settings.live_assignment_changed'],
    ['sendSignal', () => sendSignal({ signal: 'fallback', reason: 'x' }), 'fallback.signal_sent'],
    ['setMaintenance', () => setMaintenance({ enabled: true }), 'fallback.maintenance_changed'],
  ];

  it.each(writes)('%s is refused for a role with no access to Data Sources, audited as denied, and changes nothing', async (_name, call, action) => {
    const stagesBefore = JSON.stringify(await stages());
    const feedsBefore = JSON.stringify(await feeds());
    for (const role of ['planner', 'viewer_auditor', 'dispatch_supervisor', 'change_approver'] as const) {
      session.role = role;
      expect(await call(), role).toMatchObject({ ok: false, code: 'forbidden' });
    }
    expect((await events(action)).some((e) => e.outcome === 'denied')).toBe(true);
    expect(session.revalidate).not.toHaveBeenCalled();
    expect(JSON.stringify(await stages())).toBe(stagesBefore);
    expect(JSON.stringify(await feeds())).toBe(feedsBefore);
    expect((await getFallbackState(await ctx())).state).toBe('armed');
  });

  it('every write answers `unauthenticated` with no session, and touches nothing', async () => {
    session.role = null;
    for (const [, call] of writes) expect(await call()).toMatchObject({ ok: false, code: 'unauthenticated' });
    expect(session.revalidate).not.toHaveBeenCalled();
  });
});

describe('an unexpected error', () => {
  it('returns a reference ODP- and 8 hex characters, logs only that reference and the error name, and leaks no input', async () => {
    const hostile = new Proxy({}, {
      getOwnPropertyDescriptor() {
        throw new TypeError('boom: token=hunter2 reason=secret-note');
      },
    });
    const result = await sendSignal(hostile as never);
    expect(result).toMatchObject({ ok: false, code: 'unexpected' });
    if (result.ok) throw new Error('unreachable');
    expect(result.reference).toMatch(/^ODP-[0-9A-F]{8}$/);
    expect(JSON.stringify(result)).not.toMatch(/hunter2|secret-note|boom/);
    const logged = errorLog.mock.calls.flat().join('\n');
    expect(logged).toContain(result.reference);
    expect(logged).not.toMatch(/hunter2|secret-note|boom|token/);
    expect(session.revalidate).not.toHaveBeenCalled();
  });
});
