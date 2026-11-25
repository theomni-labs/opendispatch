// SPDX-License-Identifier: AGPL-3.0-only
// The server side of the Notifications and Alerts screen: reads through lib/data with the request context and returns plain data
//. Not a Server Component and not an action: `Screen.tsx` calls it, the tests call it directly.
//
// Reads: listNotificationRules, listNotificationLog (every alert, filtered here: the list is small and the stats need the whole
// log), getQuietHours, and listUsers for the names of the people an alert is addressed to (the Administrator may read them; for a
// role that may not, the name is left out). Only in-app notifications exist; the quiet-hours window is stored, not applied.

import { ROLES, type Role } from '@/lib/access';
import { ForbiddenError } from '@/lib/data/errors';
import type { RequestContext } from '@/lib/data/guard';
import { listNotificationLog, listNotificationRules, getQuietHours } from '@/lib/data/notifications';
import { listUsers } from '@/lib/data/users';
import type { DataSource } from '@/lib/types';
import { EVENT_CATEGORY, type AlertRow, type Category, type Channel, type EventType, type NotificationsView, type ReadState, type RuleRow, type Severity } from './types';

const PAGE = 200;

/** What the address bar may ask for (already validated by parseSearchParams). */
export interface NotificationsQuery {
  readonly q?: string | undefined;
  readonly severity?: Severity | undefined;
  readonly channel?: Channel | undefined;
  readonly category?: Category | undefined;
  readonly read?: ReadState | undefined;
  readonly rule?: string | undefined;
}

async function tryOrAsync<T>(read: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await read();
  } catch (error) {
    if (error instanceof ForbiddenError) return fallback;
    throw error;
  }
}

const isRole = (value: string | null | undefined): value is Role => value !== null && value !== undefined && (ROLES as readonly string[]).includes(value);

/** The rules that match the filters; the search box looks at the event's name in the reader's language (`nameOf`). */
export function filterRules(rules: readonly RuleRow[], query: NotificationsQuery, nameOf: (event: EventType) => string): RuleRow[] {
  const wanted = query.q?.toLowerCase();
  return rules.filter((rule) => (query.severity === undefined || rule.severity === query.severity) && (query.channel === undefined || rule.channels.includes(query.channel)) && (wanted === undefined || nameOf(rule.event).toLowerCase().includes(wanted)));
}

/** The alerts that match the filters; the search box looks at the title (both languages) and the body. */
export function filterLog(log: readonly AlertRow[], query: NotificationsQuery): AlertRow[] {
  const wanted = query.q?.toLowerCase();
  return log.filter(
    (alert) =>
      (query.severity === undefined || alert.severity === query.severity) &&
      (query.category === undefined || alert.category === query.category) &&
      (query.read === undefined || alert.read === (query.read === 'read')) &&
      (wanted === undefined || `${alert.title} ${alert.titleAr ?? ''} ${alert.body ?? ''}`.toLowerCase().includes(wanted)),
  );
}

export async function loadNotificationsView(ctx: RequestContext, query: NotificationsQuery, rawRule?: string | undefined): Promise<NotificationsView> {
  const rawRules = (await listNotificationRules(ctx, { limit: PAGE })).items;
  const rawLog = (await listNotificationLog(ctx, { limit: PAGE })).items;
  const quiet = await getQuietHours(ctx);
  const people = new Map((await tryOrAsync(async () => (await listUsers(ctx, { limit: PAGE })).items, [])).map((user) => [user.id, user.display_name] as const));

  const rules: RuleRow[] = rawRules.map((rule) => ({
    id: rule.id,
    event: rule.event_type,
    category: EVENT_CATEGORY[rule.event_type],
    channels: rule.channels,
    roles: rule.recipient_roles.filter(isRole),
    severity: rule.severity,
    enabled: rule.is_enabled,
  }));

  const log: AlertRow[] = rawLog.map((n) => {
    const role = isRole(n.recipient_role) ? n.recipient_role : null;
    const toUser = n.recipient_user_id ?? null;
    return {
      id: n.id,
      at: n.created_at,
      title: n.title_en,
      titleAr: n.title_ar ?? null,
      body: n.body_en ?? null,
      category: n.category,
      severity: n.severity,
      read: n.is_read,
      toRole: toUser === null ? role : null,
      toName: toUser === null ? null : (people.get(toUser) ?? null),
      // An alert is the person's own when it is addressed to them, or to their role and to no one in particular.
      mine: toUser === null ? role === ctx.role : toUser === ctx.userId,
    };
  });

  const openRule = query.rule === undefined ? undefined : rules.find((r) => r.id === query.rule);
  const sources = [...new Set<DataSource>([...rawRules.map((r) => r.data_source), ...rawLog.map((n) => n.data_source)])];
  return {
    rules,
    log,
    quiet: { enabled: quiet.enabled, start: quiet.start, end: quiet.end, appliesTo: quiet.applies_to },
    rulesOn: rules.filter((r) => r.enabled).length,
    unread: log.filter((a) => !a.read).length,
    critical: log.filter((a) => a.severity === 'critical').length,
    openRule,
    unknownRule: rawRule !== undefined && rawRule !== '' && openRule === undefined,
    me: people.get(ctx.userId) ?? null,
    sources,
  };
}
