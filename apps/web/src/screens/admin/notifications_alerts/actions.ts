'use server';
// SPDX-License-Identifier: AGPL-3.0-only

// The writes of the Notifications and Alerts screen: exactly the data functions named here.
//
//   saveRule, toggleRule    updateNotificationRule         (channels, recipients, severity, on or off; audited)
//   sendTestAlert           sendTestNotification           (an in-app alert to the person who sent it; the rule is the first one that is on)
//   markAlertsRead          markNotificationRead           (once per alert; only the caller's own can be marked; not audited: personal)
//   markAllRead             markAllNotificationsRead       (the caller's own alerts; not audited: personal)
//   saveQuietHours          updateQuietHours               (STORED, NOT APPLIED: nothing in demo mode holds an alert back)
//
// Only in-app notifications exist: no e-mail is sent. Rule 2: no action takes a context, customer, user, role, zone scope or
// install mode from the browser. Each builds its own context with requireRequestContext() inside runAction, and the data
// function authorises, validates and audits. A rule is a `ruleId`, an alert an id from the list; the recipients of a rule are
// data (`roles` of the rule), never the caller's own. A caller who may not write is refused, and audited as denied, by the
// write's own check, also where the action reads first. (tools/rules/context-rules.test.ts scans this file for those names.)

import { pickFields, pickText, pickTextList } from '@/lib/actions/pick';
import { runAction } from '@/lib/actions/run-action';
import type { ActionResult } from '@/lib/actions/types';
import { DataError, ForbiddenError, InvalidInputError, NotFoundError } from '@/lib/data/errors';
import { canAccess, type RequestContext } from '@/lib/data/guard';
import { listMyNotifications, listNotificationRules, markAllNotificationsRead, markNotificationRead, sendTestNotification, updateNotificationRule, updateQuietHours } from '@/lib/data/notifications';
import type { MarkRead, MarkedRead, QuietInput, RuleInput, RuleSaved, RuleToggle, TestInput, TestSent } from './types';

const REVALIDATE = '/admin/notifications-alerts';
/** An id that names nothing: it stands in when the caller may not write, so the write refuses and audits itself. */
const NO_ID = '00000000-0000-4000-8000-000000000000';
/** The bulk bar marks at most this many alerts in one call. */
const MAX_BULK = 200;

const savedOf = (rule: { id: string; event_type: string; is_enabled: boolean }): RuleSaved => ({ ruleId: rule.id, event: rule.event_type as RuleSaved['event'], enabled: rule.is_enabled });

/** Mark-read has no audited write: refused here. */
function refuseUnlessEditor(ctx: RequestContext): void {
  if (canAccess(ctx, 'admin.notifications_alerts', 'edit')) return;
  throw new ForbiddenError('Notifications and Alerts: your role cannot change this screen.');
}

/** The read; a Go refusal denies the write. */
async function readOrDeny<T>(read: () => Promise<T>, deny: () => Promise<unknown>): Promise<T> {
  try {
    return await read();
  } catch (error) {
    if (error instanceof ForbiddenError) await deny();
    throw error;
  }
}

/** Saves a rule: at least one channel, any recipients, a severity, on or off. */
export async function saveRule(input: RuleInput): Promise<ActionResult<RuleSaved>> {
  return runAction(
    async (ctx) => {
      const picked = pickFields(input, ['ruleId', 'channels', 'roles', 'severity', 'enabled']);
      const rule = await updateNotificationRule(ctx, typeof picked.ruleId === 'string' ? picked.ruleId : '', { channels: picked.channels, recipient_roles: picked.roles, severity: picked.severity, is_enabled: picked.enabled });
      return savedOf(rule);
    },
    { revalidate: REVALIDATE },
  );
}

/** The switch in the table: the rule as it is, on or off. The rule is read first; the write refuses a caller who may not edit. */
export async function toggleRule(input: RuleToggle): Promise<ActionResult<RuleSaved>> {
  return runAction(
    async (ctx) => {
      const ruleId = pickText(input, 'ruleId') ?? '';
      const rules = await readOrDeny(() => listNotificationRules(ctx, { limit: 200 }), () => updateNotificationRule(ctx, NO_ID, {}));
      const existing = rules.items.find((rule) => rule.id === ruleId);
      if (existing === undefined) {
        // Not there (or not an id at all): the data function answers `invalid` or `not_found`, and audits it.
        return savedOf(await updateNotificationRule(ctx, ruleId, {}));
      }
      const rule = await updateNotificationRule(ctx, ruleId, { channels: existing.channels, recipient_roles: existing.recipient_roles, severity: existing.severity, is_enabled: pickFields(input, ['enabled']).enabled });
      return savedOf(rule);
    },
    { revalidate: REVALIDATE },
  );
}

/** One in-app test alert to the caller. Without a rule id it is for the first rule that is switched on, and the answer names it. */
export async function sendTestAlert(input: TestInput): Promise<ActionResult<TestSent>> {
  return runAction(
    async (ctx) => {
      const rules = (await readOrDeny(() => listNotificationRules(ctx, { limit: 200 }), () => sendTestNotification(ctx, NO_ID))).items;
      const named = pickFields(input, ['ruleId']).ruleId;
      if (named !== undefined && typeof named !== 'string') throw new InvalidInputError('Notification rule: the id must be text.');
      const wanted = named;
      const rule = wanted === undefined ? rules.find((r) => r.is_enabled) : rules.find((r) => r.id === wanted);
      if (rule === undefined) {
        if (wanted === undefined) throw new InvalidInputError('Notification rule: no rule is switched on to test.');
        // An id that is not a rule: the data function answers `invalid` or `not_found`, and audits it.
        await sendTestNotification(ctx, wanted);
        throw new NotFoundError('Notification rule was not found.');
      }
      const sent = await sendTestNotification(ctx, rule.id);
      return { ruleId: rule.id, event: rule.event_type, notificationId: sent.id } satisfies TestSent;
    },
    { revalidate: REVALIDATE },
  );
}

/**
 * Marks the named alerts read, once each. An alert is the caller's own when it is addressed to them or to their role; the data
 * function finds no other, so an alert for someone else (or one that is gone) is counted as skipped and the rest go on. A
 * refusal that concerns the caller (no session, no permission) stops at once.
 */
export async function markAlertsRead(input: MarkRead): Promise<ActionResult<MarkedRead>> {
  return runAction(
    async (ctx) => {
      refuseUnlessEditor(ctx);
      const ids = pickTextList(input, 'ids', MAX_BULK);
      if (ids === undefined || ids.length === 0) throw new InvalidInputError(`Alerts: name 1 to ${MAX_BULK} alerts.`);
      const unread = new Set((await listMyNotifications(ctx, { unread_only: true, limit: 200 })).items.map((n) => n.id));
      let marked = 0;
      let skipped = 0;
      for (const id of [...new Set(ids)]) {
        try {
          await markNotificationRead(ctx, id);
          if (unread.has(id)) marked += 1;
        } catch (error) {
          if (!(error instanceof DataError) || error.code === 'forbidden' || error.code === 'unauthenticated') throw error;
          skipped += 1;
        }
      }
      return { marked, skipped } satisfies MarkedRead;
    },
    { revalidate: REVALIDATE },
  );
}

/** Marks every alert addressed to the caller read. */
export async function markAllRead(): Promise<ActionResult<MarkedRead>> {
  return runAction(
    async (ctx) => {
      refuseUnlessEditor(ctx);
      const unread = (await listMyNotifications(ctx, { unread_only: true, limit: 1 })).page.total ?? 0;
      await markAllNotificationsRead(ctx);
      return { marked: unread, skipped: 0 } satisfies MarkedRead;
    },
    { revalidate: REVALIDATE },
  );
}

/** The quiet-hours window. STORED, NOT APPLIED: nothing holds an alert back yet. The end may not equal the start. */
export async function saveQuietHours(input: QuietInput): Promise<ActionResult<QuietInput>> {
  return runAction(
    async (ctx) => {
      const picked = pickFields(input, ['enabled', 'start', 'end', 'appliesTo']);
      const stored = await updateQuietHours(ctx, { enabled: picked.enabled, start: picked.start, end: picked.end, applies_to: picked.appliesTo });
      return { enabled: stored.enabled, start: stored.start, end: stored.end, appliesTo: stored.applies_to } satisfies QuietInput;
    },
    { revalidate: REVALIDATE },
  );
}
