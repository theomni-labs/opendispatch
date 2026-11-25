// SPDX-License-Identifier: AGPL-3.0-only
import { beforeEach, describe, expect, it } from 'vitest';
import type { InstallMode, Role } from '@/lib/access';
import { buildContext, fixtureTenantId } from '@/lib/data/go-test-reset';
import { ForbiddenError } from '@/lib/data/errors';
import type { RequestContext } from '@/lib/data/guard';
import { listNotificationRules, updateNotificationRule, updateQuietHours } from '@/lib/data/notifications';
import { EVENT_CATEGORY, EVENT_TYPES } from './types';
import { filterLog, filterRules, loadNotificationsView } from './view';
import { fixtureUsers, resetGoTestState } from '@/lib/data/go-test-reset';

// The server side of the screen against the real data layer and the committed fixtures, with the demo store in a temp folder.
beforeEach(async () => {
  await resetGoTestState();
});

function ctxOf(role: Role = 'administrator', installMode: InstallMode = 'private'): RequestContext {
  const tenant = fixtureTenantId();
  const built = buildContext({ role, installMode, zoneIds: [] }, fixtureUsers(), tenant);
  if (built === null) throw new Error(`no context for ${role}`);
  return built;
}

const nameOf = (event: string) => event.replaceAll('_', ' ');

describe('loadNotificationsView', () => {
  it('reads the 16 rules, the 14 alerts, the quiet hours and the four figures', async () => {
    const view = await loadNotificationsView(ctxOf(), {});
    expect(view.rules).toHaveLength(16);
    expect(view.log).toHaveLength(14);
    expect(view.rulesOn).toBe(16);
    expect(view.unread).toBe(view.log.filter((a) => !a.read).length);
    expect(view.unread).toBeGreaterThan(0);
    expect(view.critical).toBe(2);
    expect(view.quiet).toEqual({ enabled: true, start: '23:00', end: '05:00', appliesTo: 'email' });
    expect(view.sources).toEqual(['SYNTHETIC']);
    expect(view.openRule).toBeUndefined();
    expect(view.unknownRule).toBe(false);
  });

  it('gives every rule its category (a copy of the data layer\'s map, one entry per event) and drops a recipient that is not a role', async () => {
    for (const rule of (await loadNotificationsView(ctxOf(), {})).rules) {
      expect(EVENT_TYPES).toContain(rule.event);
      expect(rule.category).toBe(EVENT_CATEGORY[rule.event]);
      expect(rule.roles.length).toBeGreaterThan(0);
    }
    expect(Object.keys(EVENT_CATEGORY).sort()).toEqual([...EVENT_TYPES].sort());
  });

  it('says whom each alert is addressed to (a role, or a person by name) and which are the caller\'s own', async () => {
    const view = await loadNotificationsView(ctxOf(), {});
    const toPerson = view.log.filter((a) => a.toName !== null);
    expect(toPerson.length).toBeGreaterThan(0);
    expect(toPerson.every((a) => a.toRole === null)).toBe(true);
    const toRole = view.log.filter((a) => a.toRole !== null);
    expect(toRole.length).toBeGreaterThan(0);
    // The Administrator's own: the alerts addressed to their role (and to them by name, when there are any).
    expect(view.log.filter((a) => a.mine && a.toRole !== null).every((a) => a.toRole === 'administrator')).toBe(true);
    expect(view.log.some((a) => a.mine)).toBe(true);
    expect(view.log.some((a) => !a.mine)).toBe(true);
    expect(view.me).not.toBeNull();
  });

  it('finds the rule `?rule=` names; an id that is not a rule, or not an id at all, is an unknown rule, never an error', async () => {
    const rule = (await listNotificationRules(ctxOf(), { limit: 50 })).items[0];
    const known = await loadNotificationsView(ctxOf(), { rule: rule?.id }, rule?.id);
    expect(known.openRule?.id).toBe(rule?.id);
    expect(known.unknownRule).toBe(false);
    const missing = await loadNotificationsView(ctxOf(), { rule: '00000000-0000-4000-8000-000000000001' }, '00000000-0000-4000-8000-000000000001');
    expect([missing.openRule, missing.unknownRule]).toEqual([undefined, true]);
    const malformed = await loadNotificationsView(ctxOf(), {}, 'not-an-id');
    expect([malformed.openRule, malformed.unknownRule]).toEqual([undefined, true]);
    expect((await loadNotificationsView(ctxOf(), {}, '')).unknownRule).toBe(false);
  });

  it('follows the store: a rule switched off lowers the count, a stored window shows, and it reads nothing for a role with no access', async () => {
    const admin = ctxOf();
    const rule = (await listNotificationRules(admin, { limit: 50 })).items[0];
    await updateNotificationRule(admin, rule?.id as string, { channels: ['in_app'], recipient_roles: ['planner'], severity: 'critical', is_enabled: false });
    await updateQuietHours(admin, { enabled: false, start: '21:00', end: '07:00', applies_to: 'email_and_in_app' });
    const view = await loadNotificationsView(admin, {});
    expect(view.rulesOn).toBe(15);
    expect(view.rules.find((r) => r.id === rule?.id)).toMatchObject({ enabled: false, severity: 'critical', channels: ['in_app'], roles: ['planner'] });
    expect(view.quiet).toEqual({ enabled: false, start: '21:00', end: '07:00', appliesTo: 'email_and_in_app' });
    await expect(loadNotificationsView(ctxOf('planner'), {})).rejects.toThrow(ForbiddenError);
    await expect(loadNotificationsView(ctxOf('viewer_auditor'), {})).rejects.toThrow(ForbiddenError);
  });
});

describe('filterRules and filterLog', () => {
  const view = async () => await loadNotificationsView(ctxOf(), {});

  it('filter the rules by severity and by channel, and search the event\'s name', async () => {
    const { rules } = await view();
    expect(filterRules(rules, {}, nameOf)).toHaveLength(16);
    const critical = filterRules(rules, { severity: 'critical' }, nameOf);
    expect(critical.length).toBeGreaterThan(0);
    expect(critical.every((r) => r.severity === 'critical')).toBe(true);
    const email = filterRules(rules, { channel: 'email' }, nameOf);
    expect(email.every((r) => r.channels.includes('email'))).toBe(true);
    expect(email.length).toBeLessThan(15);
    expect(filterRules(rules, { q: 'MODEL' }, nameOf).map((r) => r.event)).toEqual(['model_degraded', 'model_paused', 'model_switched']);
    expect(filterRules(rules, { q: 'zzz' }, nameOf)).toEqual([]);
    expect(filterRules(rules, { severity: 'info', channel: 'email', q: 'model' }, nameOf)).toEqual([]);
  });

  it('filter the log by severity, category and read state, and search the title, the Arabic title and the body', async () => {
    const { log } = await view();
    expect(filterLog(log, {})).toHaveLength(14);
    expect(filterLog(log, { severity: 'critical' })).toHaveLength(2);
    expect(filterLog(log, { category: 'fallback' }).every((a) => a.category === 'fallback')).toBe(true);
    const unread = filterLog(log, { read: 'unread' });
    const read = filterLog(log, { read: 'read' });
    expect(unread.length + read.length).toBe(14);
    expect(unread.every((a) => !a.read)).toBe(true);
    expect(filterLog(log, { q: 'BACKUP' }).map((a) => a.title)).toEqual(['Backup overdue']);
    expect(filterLog(log, { q: 'placeholder-0.2' })).toHaveLength(1);
    expect(filterLog([{ ...(log[0] as (typeof log)[number]), titleAr: 'عنوان عربي' }], { q: 'عربي' })).toHaveLength(1);
    expect(filterLog(log, { q: 'zzz' })).toEqual([]);
  });
});
