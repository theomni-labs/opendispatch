// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { InstallMode, Role } from '@/lib/access';
import { listAuditEvents } from '@/lib/data/audit';
import { UnauthenticatedError } from '@/lib/data/errors';
import type { RequestContext } from '@/lib/data/guard';
import { getQuietHours, listMyNotifications, listNotificationLog, listNotificationRules } from '@/lib/data/notifications';
import { markAlertsRead, markAllRead, saveQuietHours, saveRule, sendTestAlert, toggleRule } from './actions';
import { fixtureUsers, resetGoTestState } from '@/lib/data/go-test-reset';
import { buildContext, fixtureTenantId } from '@/lib/data/go-test-reset';

// The server actions against the real data layer and the committed fixtures, with the demo store in a temp folder. The session is
// the only thing stood in for: requireRequestContext returns the context of the role the test picks, exactly what a signed cookie
// would give.
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

async function ctx(): Promise<RequestContext> {
  return contextOf('administrator', 'private');
}
const events = async (action: string) => (await listAuditEvents(await ctx(), { action, limit: 200 })).items;
const rules = async () => (await listNotificationRules(await ctx(), { limit: 50 })).items;
const REVALIDATED = ['/en/admin/notifications-alerts', '/ar/admin/notifications-alerts'];
const NIL = '00000000-0000-4000-8000-000000000001';

describe('saveRule', () => {
  it('saves the channels, the recipients, the severity and on or off, audits it, and refreshes the page in both languages', async () => {
    const rule = (await rules()).find((r) => r.event_type === 'model_switched');
    if (rule === undefined) throw new Error('no rule');
    const result = await saveRule({ ruleId: rule.id, channels: ['in_app', 'email'], roles: ['administrator', 'dispatcher'], severity: 'warning', enabled: false });
    expect(result).toEqual({ ok: true, data: { ruleId: rule.id, event: 'model_switched', enabled: false } });
    const stored = (await rules()).find((r) => r.id === rule.id);
    expect(stored).toMatchObject({ channels: ['in_app', 'email'], recipient_roles: ['administrator', 'dispatcher'], severity: 'warning', is_enabled: false });
    const [event] = await events('notification_rule.updated');
    expect(event).toMatchObject({ outcome: 'success', entity_id: rule.id });
    expect(session.revalidate.mock.calls.map((c) => c[0])).toEqual(expect.arrayContaining(REVALIDATED));
  });

  it('refuses a rule with no channel, an unknown channel, role or severity, and a switch that is not a boolean, changing nothing', async () => {
    const before = JSON.stringify(await rules());
    const rule = (await rules())[0];
    const base = { ruleId: rule?.id as string, channels: ['in_app'], roles: ['planner'], severity: 'info', enabled: true };
    for (const bad of [{ channels: [] }, { channels: ['sms'] }, { roles: ['superuser'] }, { severity: 'urgent' }, { enabled: 'yes' }, { channels: 'in_app' }]) {
      expect(await saveRule({ ...base, ...bad } as never), JSON.stringify(bad)).toMatchObject({ ok: false, code: 'invalid' });
    }
    expect(JSON.stringify(await rules())).toBe(before);
    expect(session.revalidate).not.toHaveBeenCalled();
  });

  it('refuses an unknown rule (not found) and hostile ids (invalid), and copies only the fields it names', async () => {
    const ok = { channels: ['in_app'], roles: [], severity: 'info', enabled: true };
    expect(await saveRule({ ruleId: NIL, ...ok } as never)).toMatchObject({ ok: false, code: 'not_found' });
    for (const bad of ['', 'toString', '__proto__', '../etc', 42, null, undefined]) {
      expect(await saveRule({ ruleId: bad, ...ok } as never), String(bad)).toMatchObject({ ok: false, code: 'invalid' });
    }
    const rule = (await rules())[0];
    // Keys that would name a customer, a role or a user are not copied: the rule is saved as if they were not sent.
    const sneaky = { ruleId: rule?.id, ...ok, customerId: 'x', role: 'administrator', tenant_id: 'y', user_id: 'z' };
    expect(await saveRule(sneaky as never)).toMatchObject({ ok: true });
    expect(await saveRule(null as never)).toMatchObject({ ok: false, code: 'invalid' });
    expect(await saveRule([] as never)).toMatchObject({ ok: false, code: 'invalid' });
  });
});

describe('toggleRule', () => {
  it('flips the switch and leaves channels, recipients and severity as they were', async () => {
    const rule = (await rules()).find((r) => r.event_type === 'integration_down');
    if (rule === undefined) throw new Error('no rule');
    expect(await toggleRule({ ruleId: rule.id, enabled: false })).toEqual({ ok: true, data: { ruleId: rule.id, event: 'integration_down', enabled: false } });
    const stored = (await rules()).find((r) => r.id === rule.id);
    expect(stored).toMatchObject({ channels: rule.channels, recipient_roles: rule.recipient_roles, severity: rule.severity, is_enabled: false });
    expect(await toggleRule({ ruleId: rule.id, enabled: true })).toMatchObject({ ok: true });
    expect((await rules()).find((r) => r.id === rule.id)?.is_enabled).toBe(true);
    expect((await events('notification_rule.updated')).length).toBe(2);
  });

  it('refuses a rule that is not there, a switch that is not a boolean and hostile ids', async () => {
    expect(await toggleRule({ ruleId: NIL, enabled: true })).toMatchObject({ ok: false, code: 'not_found' });
    const rule = (await rules())[0];
    expect(await toggleRule({ ruleId: rule?.id as string, enabled: 'yes' as never })).toMatchObject({ ok: false, code: 'invalid' });
    for (const bad of ['', 'toString', '__proto__', '../etc', 42, null, undefined]) expect(await toggleRule({ ruleId: bad as never, enabled: true }), String(bad)).toMatchObject({ ok: false });
  });
});

describe('sendTestAlert', () => {
  it('without a rule sends the test for the first rule that is on, to the person who sent it, and names the rule', async () => {
    const first = (await rules()).find((r) => r.is_enabled);
    const before = (await listMyNotifications(await ctx(), { limit: 200 })).page.total ?? 0;
    const result = await sendTestAlert({});
    expect(result).toMatchObject({ ok: true, data: { ruleId: first?.id, event: first?.event_type } });
    const mine = (await listMyNotifications(await ctx(), { limit: 200 }));
    expect(mine.page.total).toBe(before + 1);
    expect(mine.items[0]?.title_en).toMatch(/^Test: /);
    expect((await events('notification_rule.test_sent'))[0]).toMatchObject({ outcome: 'success', entity_id: first?.id });
  });

  it('with a rule id sends it for that rule, even one that is off; skips rules that are off when none is named', async () => {
    const all = await rules();
    const target = all.find((r) => r.event_type === 'backup_overdue') as (typeof all)[number];
    expect(await toggleRule({ ruleId: target.id, enabled: false })).toMatchObject({ ok: true });
    expect(await sendTestAlert({ ruleId: target.id })).toMatchObject({ ok: true, data: { event: 'backup_overdue' } });
    for (const rule of all) await toggleRule({ ruleId: rule.id, enabled: false });
    expect(await sendTestAlert({})).toMatchObject({ ok: false, code: 'invalid' });
  });

  it('refuses an unknown rule (not found), hostile ids and an id that is not text (invalid)', async () => {
    expect(await sendTestAlert({ ruleId: NIL })).toMatchObject({ ok: false, code: 'not_found' });
    for (const bad of ['', 'toString', '__proto__', '../etc']) expect(await sendTestAlert({ ruleId: bad }), bad).toMatchObject({ ok: false, code: 'invalid' });
    for (const bad of [42, null, {}, []]) expect(await sendTestAlert({ ruleId: bad as never }), JSON.stringify(bad)).toMatchObject({ ok: false, code: 'invalid' });
  });
});

describe('markAlertsRead and markAllRead', () => {
  const unreadMine = async () => (await listMyNotifications(await ctx(), { unread_only: true, limit: 200 })).items;

  it('marks the alerts that are the caller\'s own, counts the ones for other people as skipped, and leaves those unread', async () => {
    const mine = await unreadMine();
    expect(mine.length).toBeGreaterThan(1);
    const others = (await listNotificationLog(await ctx(), { limit: 200 })).items.filter((n) => !n.is_read && !mine.some((x) => x.id === n.id));
    expect(others.length).toBeGreaterThan(0);
    const auditedBefore = (await listAuditEvents(await ctx(), { limit: 200 })).page.total;
    const result = await markAlertsRead({ ids: [mine[0]?.id as string, others[0]?.id as string] });
    expect(result).toEqual({ ok: true, data: { marked: 1, skipped: 1 } });
    expect((await unreadMine()).length).toBe(mine.length - 1);
    expect((await listNotificationLog(await ctx(), { limit: 200 })).items.find((n) => n.id === others[0]?.id)?.is_read).toBe(false);
    // Personal, so not audited.
    expect((await listAuditEvents(await ctx(), { limit: 200 })).page.total).toBe(auditedBefore);
    expect(session.revalidate.mock.calls.map((c) => c[0])).toEqual(expect.arrayContaining(REVALIDATED));
  });

  it('counts an alert already read as neither marked nor skipped, and one that is not there as skipped', async () => {
    const [one] = await unreadMine();
    expect(await markAlertsRead({ ids: [one?.id as string] })).toEqual({ ok: true, data: { marked: 1, skipped: 0 } });
    expect(await markAlertsRead({ ids: [one?.id as string, one?.id as string] })).toEqual({ ok: true, data: { marked: 0, skipped: 0 } });
    expect(await markAlertsRead({ ids: [NIL] })).toEqual({ ok: true, data: { marked: 0, skipped: 1 } });
  });

  it('refuses a list that is not 1 to 200 names, and counts hostile ids as skipped', async () => {
    for (const bad of [[], 'a', null, 42, undefined, {}, [1, 2], Array.from({ length: 201 }, () => NIL)]) expect(await markAlertsRead({ ids: bad as never }), JSON.stringify(bad)?.slice(0, 40)).toMatchObject({ ok: false, code: 'invalid' });
    expect(await markAlertsRead({ ids: ['', 'toString', '__proto__', '../etc'] })).toEqual({ ok: true, data: { marked: 0, skipped: 4 } });
  });

  it('marks all of the caller\'s own alerts and says how many; the alerts for other people stay unread', async () => {
    const mine = await unreadMine();
    const othersBefore = (await listNotificationLog(await ctx(), { limit: 200 })).items.filter((n) => !n.is_read && !mine.some((x) => x.id === n.id)).length;
    expect(await markAllRead()).toEqual({ ok: true, data: { marked: mine.length, skipped: 0 } });
    expect(await unreadMine()).toEqual([]);
    expect((await listNotificationLog(await ctx(), { limit: 200 })).items.filter((n) => !n.is_read).length).toBe(othersBefore);
    expect(await markAllRead()).toEqual({ ok: true, data: { marked: 0, skipped: 0 } });
  });
});

describe('saveQuietHours', () => {
  it('stores the window (not applied), audits it and refreshes the page', async () => {
    const result = await saveQuietHours({ enabled: true, start: '22:30', end: '06:15', appliesTo: 'email_and_in_app' });
    expect(result).toEqual({ ok: true, data: { enabled: true, start: '22:30', end: '06:15', appliesTo: 'email_and_in_app' } });
    expect(await getQuietHours(await ctx())).toEqual({ enabled: true, start: '22:30', end: '06:15', applies_to: 'email_and_in_app' });
    const [event] = await events('quiet_hours.updated');
    expect(event?.outcome).toBe('success');
    expect(JSON.stringify(event)).toMatch(/not applied/);
    expect(session.revalidate.mock.calls.map((c) => c[0])).toEqual(expect.arrayContaining(REVALIDATED));
    expect(await saveQuietHours({ enabled: false, start: '23:00', end: '05:00', appliesTo: 'email' })).toMatchObject({ ok: true });
  });

  it('refuses a window whose start equals its end, a time that is not HH:MM, an unknown scope and a switch that is not a boolean', async () => {
    const before = JSON.stringify(await getQuietHours(await ctx()));
    const base = { enabled: true, start: '23:00', end: '05:00', appliesTo: 'email' };
    for (const bad of [{ end: '23:00' }, { start: '25:00' }, { end: 'late' }, { start: '' }, { appliesTo: 'sms' }, { enabled: 1 }]) {
      expect(await saveQuietHours({ ...base, ...bad } as never), JSON.stringify(bad)).toMatchObject({ ok: false, code: 'invalid' });
    }
    expect(JSON.stringify(await getQuietHours(await ctx()))).toBe(before);
    expect(session.revalidate).not.toHaveBeenCalled();
  });
});

describe('who may write, and what is audited', () => {
  const rule = async () => (await rules())[0]?.id as string;
  const writes: readonly [string, () => Promise<{ ok: boolean; code?: string }>, string | null][] = [
    ['saveRule', async () => saveRule({ ruleId: await rule(), channels: ['in_app'], roles: [], severity: 'info', enabled: true }), 'notification_rule.updated'],
    ['toggleRule', async () => toggleRule({ ruleId: await rule(), enabled: false }), 'notification_rule.updated'],
    ['sendTestAlert', () => sendTestAlert({}), 'notification_rule.test_sent'],
    ['saveQuietHours', () => saveQuietHours({ enabled: true, start: '22:00', end: '06:00', appliesTo: 'email' }), 'quiet_hours.updated'],
    // Marking alerts read is a personal preference: refused for a role that cannot edit the screen, and not audited.
    ['markAlertsRead', () => markAlertsRead({ ids: [NIL] }), null],
    ['markAllRead', () => markAllRead(), null],
  ];

  it.each(writes)('%s is refused for a role with no edit access%s, and changes nothing', async (_name, call, action) => {
    const rulesBefore = JSON.stringify(await rules());
    const quietBefore = JSON.stringify(await getQuietHours(await ctx()));
    const unreadBefore = (await listNotificationLog(await ctx(), { limit: 200 })).items.filter((n) => !n.is_read).length;
    for (const role of ['planner', 'viewer_auditor', 'dispatch_supervisor', 'change_approver'] as const) {
      session.role = role;
      expect(await call(), role).toMatchObject({ ok: false, code: 'forbidden' });
    }
    if (action !== null) expect((await events(action)).some((e) => e.outcome === 'denied')).toBe(true);
    expect(session.revalidate).not.toHaveBeenCalled();
    expect(JSON.stringify(await rules())).toBe(rulesBefore);
    expect(JSON.stringify(await getQuietHours(await ctx()))).toBe(quietBefore);
    expect((await listNotificationLog(await ctx(), { limit: 200 })).items.filter((n) => !n.is_read).length).toBe(unreadBefore);
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
        throw new TypeError('boom: rule=secret-rule token=hunter2');
      },
    });
    const result = await saveRule(hostile as never);
    expect(result).toMatchObject({ ok: false, code: 'unexpected' });
    if (result.ok) throw new Error('unreachable');
    expect(result.reference).toMatch(/^ODP-[0-9A-F]{8}$/);
    expect(JSON.stringify(result)).not.toMatch(/secret-rule|hunter2|boom/);
    const logged = errorLog.mock.calls.flat().join('\n');
    expect(logged).toContain(result.reference);
    expect(logged).not.toMatch(/secret-rule|hunter2|boom|token/);
    expect(session.revalidate).not.toHaveBeenCalled();
  });
});
