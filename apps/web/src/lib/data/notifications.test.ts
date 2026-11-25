// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, vi } from 'vitest';
import type { Approval, Notification, NotificationRule } from '@/lib/types';
import { listAuditEvents } from './audit';
import { resetDemoData } from './demo';
import { ForbiddenError, InvalidInputError, NotFoundError } from './errors';
import { fixtureRecords } from './internal/fixtures';
import {
  countUnreadNotifications,
  getQuietHours,
  listApprovals,
  listMyNotifications,
  listNotificationLog,
  listNotificationRules,
  markAllNotificationsRead,
  markNotificationRead,
  sendTestNotification,
  updateNotificationRule,
  updateQuietHours,
} from './notifications';
import { auditCount, ctxFor, resetGoTestState, dataSnapshot, expectValid, expectValidItems, raiseNotificationForTest, withTempDemoState } from './test-support';

withTempDemoState();

const admin = () => ctxFor('administrator');

describe('own notifications and the bell', () => {
  it('lists the notifications addressed to the person or their role, newest first, and counts the unread', async () => {
    const ctx = ctxFor('dispatch_supervisor');
    const list = (await listMyNotifications(ctx));
    expectValid('NotificationList', list);
    expect(list.items.length).toBeGreaterThan(0);
    for (const n of list.items) expect(n.recipient_user_id === ctx.userId || n.recipient_role === ctx.role).toBe(true);
    const unread = list.items.filter((n) => !n.is_read).length;
    expect((await countUnreadNotifications(ctx))).toBe(unread);
    expect((await listMyNotifications(ctx, { unread_only: true })).items).toHaveLength(unread);
    const times = list.items.map((n) => Date.parse(n.created_at));
    expect([...times].sort((a, b) => b - a)).toEqual(times);
  });

  it('marks one and all as read, and only your own', async () => {
    const ctx = ctxFor('administrator');
    const before = (await countUnreadNotifications(ctx));
    expect(before).toBeGreaterThan(1);
    const first = (await listMyNotifications(ctx, { unread_only: true })).items[0]!;
    const read = (await markNotificationRead(ctx, first.id));
    expectValid('Notification', read);
    expect(read.is_read).toBe(true);
    expect((await countUnreadNotifications(ctx))).toBe(before - 1);
    const someoneElses = fixtureRecords<Notification>('Notification').find((n) => n.recipient_role === 'planner')!;
    await expect(markNotificationRead(ctx, someoneElses.id)).rejects.toThrow(NotFoundError);
    await markAllNotificationsRead(ctx);
    expect((await countUnreadNotifications(ctx))).toBe(0);
    expect((await countUnreadNotifications(ctxFor('planner')))).toBeGreaterThan(0);
  });

  it('is open to every role that exists in the install mode', async () => {
    for (const role of ['administrator', 'dispatch_supervisor', 'dispatcher', 'planner', 'remote_team_lead', 'viewer_auditor', 'change_approver'] as const) {
      await expect(listMyNotifications(ctxFor(role))).resolves.toBeTruthy();
    }
    await expect(countUnreadNotifications(ctxFor('change_approver', { installMode: 'shared' }))).rejects.toThrow(ForbiddenError);
  });

  it('persists reads across a fresh module instance and resets to the fixtures', async () => {
    const ctx = ctxFor('administrator');
    await markAllNotificationsRead(ctx);
    vi.resetModules();
    const fresh = await import('./notifications');
    expect(await fresh.countUnreadNotifications(ctx)).toBe(0);
    await resetGoTestState();
    expect((await countUnreadNotifications(ctx))).toBeGreaterThan(0);
  });
});

describe('notification rules and the log (Admin 12)', () => {
  it('lists the rules and the whole log for the Administrator', async () => {
    const ctx = admin();
    const rules = (await listNotificationRules(ctx));
    expect(rules.items).toHaveLength(fixtureRecords<NotificationRule>('NotificationRule').length);
    expectValid('NotificationRuleList', rules);
    const log = (await listNotificationLog(ctx, { limit: 200 }));
    expect(log.page.total).toBe(fixtureRecords<Notification>('Notification').length);
    expectValidItems('Notification', log.items);
    expect((await listNotificationLog(ctx, { category: 'fallback' })).items.every((n) => n.category === 'fallback')).toBe(true);
    expect((await listNotificationLog(ctx, { severity: 'critical' })).items.every((n) => n.severity === 'critical')).toBe(true);
  });

  it('updates a rule and sends a test notification, audited, and a raised alert follows the rule', async () => {
    const ctx = admin();
    const rule = (await listNotificationRules(ctx)).items.find((r) => r.event_type === 'model_paused')!;
    const updated = (await updateNotificationRule(ctx, rule.id, { channels: ['in_app'], recipient_roles: ['administrator', 'planner', 'viewer_auditor'], severity: 'critical', is_enabled: true }));
    expectValid('NotificationRule', updated);
    expect(updated).toMatchObject({ severity: 'critical', channels: ['in_app'] });
    const test = (await sendTestNotification(ctx, rule.id));
    expectValid('Notification', test);
    expect(test).toMatchObject({ category: 'model', recipient_user_id: ctx.userId });
    await raiseNotificationForTest(ctx, 'model_paused', { title_en: 'Model paused', body_en: 'Paused by the Administrator.' });
    const raised = (await listNotificationLog(ctx, { limit: 200 })).items.filter((n) => n.title_en === 'Model paused');
    expect(raised.map((n) => n.recipient_role).sort()).toEqual(['administrator', 'planner', 'viewer_auditor']);
    expect((await countUnreadNotifications(ctxFor('viewer_auditor')))).toBeGreaterThan(0);
    await updateNotificationRule(ctx, rule.id, { channels: ['email'], recipient_roles: ['administrator'], severity: 'info', is_enabled: true });
    await raiseNotificationForTest(ctx, 'model_paused', { title_en: 'x' });
    expect((await listNotificationLog(ctx, { limit: 200 })).items.filter((n) => n.title_en === 'x')).toEqual([]);
    expect((await listAuditEvents(ctx, { action: 'notification_rule.updated' })).items).toHaveLength(2);
    expect((await listAuditEvents(ctx, { action: 'notification_rule.test_sent' })).items).toHaveLength(1);
  });

  it('validates rule input and is for the Administrator only', async () => {
    const ctx = admin();
    const rule = (await listNotificationRules(ctx)).items[0]!;
    await expect(updateNotificationRule(ctx, rule.id, { channels: [], recipient_roles: [], severity: 'info', is_enabled: true })).rejects.toThrow(InvalidInputError);
    await expect(updateNotificationRule(ctx, rule.id, { channels: ['sms'], recipient_roles: [], severity: 'info', is_enabled: true })).rejects.toThrow(InvalidInputError);
    for (const role of ['dispatch_supervisor', 'planner', 'viewer_auditor', 'change_approver'] as const) {
      await expect(listNotificationRules(ctxFor(role))).rejects.toThrow(ForbiddenError);
      await expect(sendTestNotification(ctxFor(role), rule.id)).rejects.toThrow(ForbiddenError);
    }
    expect((await listAuditEvents(ctx, { outcome: 'denied', action: 'notification_rule.test_sent' })).items).toHaveLength(4);
  });
});

describe('approvals inbox', () => {
  it('shows a supervisor the requests they may approve and everyone their own', async () => {
    const approvals = fixtureRecords<Approval>('Approval');
    const supervisor = await listApprovals(ctxFor('dispatch_supervisor'), { limit: 200 });
    expectValid('ApprovalList', supervisor);
    expect(supervisor.items.length).toBeGreaterThan(0);
    expect((await listApprovals(ctxFor('administrator'), { limit: 200 })).page.total).toBe(approvals.length);
    expect((await listApprovals(ctxFor('viewer_auditor'), { limit: 200 })).page.total).toBe(approvals.length);
    expect((await listApprovals(ctxFor('remote_team_lead'))).items).toHaveLength(0);
    expect((await listApprovals(ctxFor('dispatch_supervisor'), { status: 'pending' })).items.every((a) => a.status === 'pending')).toBe(true);
    expect((await listApprovals(ctxFor('dispatch_supervisor'), { subject_type: 'rule_version', limit: 200 })).items.every((a) => a.subject_type === 'rule_version')).toBe(true);
  });

  it('leaves out requests of zones the role cannot read', async () => {
    const all = (await listApprovals(ctxFor('dispatch_supervisor'), { limit: 200 })).page.total ?? 0;
    const none = await listApprovals(ctxFor('dispatch_supervisor', { zones: [] }), { limit: 200 });
    expect(none.items.every((a) => a.subject_type === 'rule_version' || a.created_by !== null)).toBe(true);
    expect(none.page.total ?? 0).toBeLessThan(all);
  });
});

// ---------------------------------------------------------------------------------------------
// DG8: quiet hours (stored, not applied)
// ---------------------------------------------------------------------------------------------

describe('quiet hours (DG8)', () => {
  const OTHERS = ['dispatch_supervisor', 'dispatcher', 'planner', 'remote_team_lead', 'viewer_auditor', 'change_approver'] as const;
  const defaults = { enabled: true, start: '23:00', end: '05:00', applies_to: 'email' };

  it('starts with the window of the mockup (23:00 to 05:00, e-mail only) and validates against the contract', async () => {
    const hours = await getQuietHours(admin());
    expectValid('QuietHours', hours);
    expect(hours).toEqual(defaults);
  });

  it('replaces the window, keeps it, and audits the old and the new', async () => {
    const ctx = admin();
    const saved = await updateQuietHours(ctx, { enabled: false, start: '22:30', end: '06:15', applies_to: 'email_and_in_app' });
    expectValid('QuietHours', saved);
    expect(await getQuietHours(ctx)).toEqual({ enabled: false, start: '22:30', end: '06:15', applies_to: 'email_and_in_app' });
    const event = (await listAuditEvents(ctx, { action: 'quiet_hours.updated' })).items[0]!;
    expect(event).toMatchObject({ outcome: 'success', actor_user_id: ctx.userId, entity_type: 'setting' });
    expect(JSON.stringify(event.detail)).toContain('22:30');
    expect(JSON.stringify(event.detail)).toContain('23:00');
    await resetDemoData(ctx);
    await resetGoTestState();
    expect(await getQuietHours(ctx)).toEqual(defaults);
  });

  it('is stored, not applied: a notification raised inside the window is still delivered', async () => {
    const ctx = admin();
    await updateQuietHours(ctx, { enabled: true, start: '00:00', end: '23:59', applies_to: 'email_and_in_app' });
    const unread = (await countUnreadNotifications(ctx));
    await raiseNotificationForTest(ctx, 'model_paused', { title_en: 'Paused' });
    expect((await listNotificationLog(ctx, { limit: 200 })).items.some((n) => n.title_en === 'Paused')).toBe(true);
    expect((await countUnreadNotifications(ctx))).toBeGreaterThanOrEqual(unread);
  });

  it('checks the times, the scope and the switch, refuses an empty window and any other field', async () => {
    const ctx = admin();
    for (const bad of [
      { ...defaults, start: '24:00' },
      { ...defaults, end: '5:00' },
      { ...defaults, start: '23:60' },
      { ...defaults, start: '23:00', end: '23:00' },
      { ...defaults, applies_to: 'sms' },
      { ...defaults, enabled: 'yes' },
      { ...defaults, extra: 1 },
      { ...defaults, role: 'administrator' },
      { enabled: true, start: '23:00', end: '05:00' },
      {},
      null,
      'all night',
    ]) {
      await expect(updateQuietHours(ctx, bad), JSON.stringify(bad)).rejects.toThrow(InvalidInputError);
    }
    expect(await getQuietHours(ctx)).toEqual(defaults);
    expect((await listAuditEvents(ctx, { action: 'quiet_hours.updated' })).items).toEqual([]);
    // a window that crosses midnight and one that does not are both fine
    expect((await updateQuietHours(ctx, { ...defaults, start: '01:00', end: '04:00' })).start).toBe('01:00');
  });

  it('is the Administrator only: reads and writes are forbidden to every other role, a refused write is audited and changes nothing', async () => {
    for (const role of OTHERS) {
      await expect(getQuietHours(ctxFor(role)), role).rejects.toThrow(ForbiddenError);
      const before = dataSnapshot();
      const audits = await auditCount();
      await expect(updateQuietHours(ctxFor(role), defaults), role).rejects.toThrow(ForbiddenError);
      expect(dataSnapshot()).toBe(before);
      expect(await auditCount()).toBe(audits + 1);
    }
    await expect(updateQuietHours(ctxFor('planner'), 'nonsense')).rejects.toThrow(ForbiddenError); // the role check comes first
    expect((await listAuditEvents(admin(), { action: 'quiet_hours.updated', outcome: 'denied', limit: 200 })).items).toHaveLength(OTHERS.length + 1);
    expect(await getQuietHours(ctxFor('administrator', { installMode: 'shared' }))).toEqual(defaults);
  });
});
