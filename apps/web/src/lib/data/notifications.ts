// SPDX-License-Identifier: AGPL-3.0-only
// Notifications and rules: thin Go client.

import type { Approval, ApprovalList, Notification, NotificationList, NotificationRule, NotificationRuleList, QuietHours } from '@/lib/types';
import { requirePlatform, type PageQuery } from './context';
import type { RequestContext } from './guard';
import { businessFetch } from './internal/business-client';
import { pathSegment } from './internal/path-segment';

function qs(params: Readonly<Record<string, string | number | undefined>>): string {
  const parts = Object.entries(params).filter(([, val]) => val !== undefined && val !== '');
  return parts.length === 0 ? '' : `?${parts.map(([k, val]) => `${k}=${encodeURIComponent(String(val))}`).join('&')}`;
}

type Category = Notification['category'];
type Severity = Notification['severity'];

// operationId: listMyNotifications
export async function listMyNotifications(ctx: RequestContext, query: PageQuery & { readonly unread_only?: boolean | undefined } = {}): Promise<NotificationList> {
  requirePlatform(ctx, 'platform.session');
  return (await businessFetch<NotificationList>(ctx, `/notifications${qs({ limit: query.limit, cursor: query.cursor, unread_only: query.unread_only === true ? 'true' : undefined })}`))!;
}

/** The number on the AppShell bell. */
// operationId: (not in the contract) countUnreadNotifications
export async function countUnreadNotifications(ctx: RequestContext): Promise<number> {
  requirePlatform(ctx, 'platform.session');
  return (await businessFetch<{ count: number }>(ctx, '/notifications/unread-count'))!.count;
}

// operationId: markNotificationRead
// assumption: marking a notification read is a personal preference, not an audited change (it would flood the log).
export async function markNotificationRead(ctx: RequestContext, id: string): Promise<Notification> {
  requirePlatform(ctx, 'platform.session');
  return (await businessFetch<Notification>(ctx, `/notifications/${pathSegment(id)}/read`, { method: 'POST' }))!;
}

// operationId: markAllNotificationsRead
export async function markAllNotificationsRead(ctx: RequestContext): Promise<void> {
  requirePlatform(ctx, 'platform.session');
  await businessFetch<undefined>(ctx, '/notifications/read-all', { method: 'POST' });
}

// ---------------------------------------------------------------------------------------------
// Rules and log (admin.notifications_alerts)
// ---------------------------------------------------------------------------------------------

// operationId: listNotificationRules
export async function listNotificationRules(ctx: RequestContext, query: PageQuery = {}): Promise<NotificationRuleList> {
  return (await businessFetch<NotificationRuleList>(ctx, `/notification-rules${qs({ limit: query.limit, cursor: query.cursor })}`))!;
}

// operationId: updateNotificationRule
export async function updateNotificationRule(ctx: RequestContext, id: string, body: unknown): Promise<NotificationRule> {
  return (await businessFetch<NotificationRule>(ctx, `/notification-rules/${pathSegment(id)}`, { method: 'PUT', body }))!;
}

/** Sends one in-app test notification to the caller. */
// operationId: sendTestNotification
export async function sendTestNotification(ctx: RequestContext, ruleId: string): Promise<Notification> {
  return (await businessFetch<Notification>(ctx, `/notification-rules/${pathSegment(ruleId)}/test`, { method: 'POST' }))!;
}

// operationId: listNotificationLog
export async function listNotificationLog(
  ctx: RequestContext,
  filter: PageQuery & { readonly from?: string | undefined; readonly to?: string | undefined; readonly category?: Category | undefined; readonly severity?: Severity | undefined } = {},
): Promise<NotificationList> {
  return (await businessFetch<NotificationList>(ctx, `/notifications/log${qs({ limit: filter.limit, cursor: filter.cursor, from: filter.from, to: filter.to, category: filter.category, severity: filter.severity })}`))!;
}

// ---------------------------------------------------------------------------------------------
// Quiet hours (DG8): STORED, NOT APPLIED. Nothing in demo mode holds a notification back; the screen labels the window.
// ---------------------------------------------------------------------------------------------

// operationId: getQuietHours
export async function getQuietHours(ctx: RequestContext): Promise<QuietHours> {
  return (await businessFetch<QuietHours>(ctx, '/notification-quiet-hours'))!;
}

// operationId: updateQuietHours
export async function updateQuietHours(ctx: RequestContext, body: unknown): Promise<QuietHours> {
  return (await businessFetch<QuietHours>(ctx, '/notification-quiet-hours', { method: 'PUT', body }))!;
}

// ---------------------------------------------------------------------------------------------
// Approvals inbox (platform.session). Go's job now: access, visibility filtering (own request,
// approvable kind, or a whole-install read role) and the roster/override zone lookup.
// ---------------------------------------------------------------------------------------------

// operationId: listApprovals
export async function listApprovals(ctx: RequestContext, query: PageQuery & { readonly status?: Approval['status'] | undefined; readonly subject_type?: Approval['subject_type'] | undefined } = {}): Promise<ApprovalList> {
  requirePlatform(ctx, 'platform.session');
  return (await businessFetch<ApprovalList>(ctx, `/approvals${qs({ limit: query.limit, cursor: query.cursor, status: query.status, subject_type: query.subject_type })}`))!;
}
