// SPDX-License-Identifier: AGPL-3.0-only
// The server side of the API and Webhooks screen: reads through lib/data with the request context and returns plain data.
// Not a Server Component and not an action: `Screen.tsx` calls it, and the tests call it directly.
//
// Reads: listApiClients, listWebhooks, listWebhookDeliveries (once for each webhook: the log is all of them, newest first),
// getRateLimits. No key is ever read: the data layer keeps only the last four characters (`secret_hint`).

import type { RequestContext } from '@/lib/data/guard';
import { listApiClients, listWebhookDeliveries, listWebhooks, getRateLimits } from '@/lib/data/system';
import type { ApiClient, DataSource, PageInfo, Webhook, WebhookDelivery } from '@/lib/types';
import type { ClientRow, DeliveryRow, DeliveryStatus, HookRow, LimitRow, Scope } from './types';

/** What the address bar may ask for (already validated by parseSearchParams). */
export interface ApiQuery {
  readonly q?: string | undefined;
  readonly status?: 'succeeded' | 'failed' | undefined;
  /** A webhook id, or `new`: opens the webhook drawer. */
  readonly hook?: string | undefined;
}

export interface ApiView {
  readonly sources: readonly DataSource[];
  readonly clients: readonly ClientRow[];
  readonly hooks: readonly HookRow[];
  /** Every delivery of every webhook, newest first (the Delivery log tab filters them below). */
  readonly deliveries: readonly DeliveryRow[];
  /** The deliveries the search and status filter leave. */
  readonly shownDeliveries: readonly DeliveryRow[];
  readonly limits: readonly LimitRow[];
  readonly counts: { readonly activeClients: number; readonly hooks: number; readonly failed: number };
  /** The webhook `?hook=` opens: a webhook, or `new`. */
  readonly openHook: HookRow | 'new' | undefined;
  /** `?hook=` named a webhook that does not exist. */
  readonly unknownHook: boolean;
}

const PAGE = 200;

async function listAll<T>(fetch: (cursor: string | undefined) => { items: T[]; page: PageInfo } | Promise<{ items: T[]; page: PageInfo }>): Promise<T[]> {
  const out: T[] = [];
  let cursor: string | undefined;
  do {
    const page = await fetch(cursor);
    out.push(...page.items);
    cursor = page.page.has_more ? (page.page.next_cursor ?? undefined) : undefined;
  } while (cursor !== undefined);
  return out;
}

export const clientRow = (client: ApiClient): ClientRow => ({
  id: client.id,
  name: client.name,
  scopes: [...client.scopes],
  hint: client.secret_hint,
  createdAt: client.created_at,
  lastUsedAt: client.last_used_at ?? null,
  revoked: client.is_revoked,
});

export const hookRow = (hook: Webhook): HookRow => ({
  id: hook.id,
  name: hook.name,
  url: hook.target_url,
  events: [...hook.event_types],
  enabled: hook.is_enabled,
  lastDeliveryAt: hook.last_delivery_at ?? null,
  lastStatus: hook.last_status ?? null,
});

const deliveryRow = (delivery: WebhookDelivery, hookName: string): DeliveryRow => ({
  id: delivery.id,
  hookId: delivery.webhook_id,
  hookName,
  event: delivery.event_type,
  status: delivery.status as DeliveryStatus,
  httpStatus: delivery.http_status ?? null,
  attempts: delivery.attempt_count,
  at: delivery.attempted_at,
});

export async function loadApiView(ctx: RequestContext, query: ApiQuery): Promise<ApiView> {
  const clientList = await listAll((cursor) => listApiClients(ctx, { limit: PAGE, ...(cursor === undefined ? {} : { cursor }) }));
  const clients = clientList.map(clientRow);
  const hookList = await listAll((cursor) => listWebhooks(ctx, { limit: PAGE, ...(cursor === undefined ? {} : { cursor }) }));
  const hooks = hookList.map(hookRow);
  const deliveries: DeliveryRow[] = [];
  const deliverySources: DataSource[] = [];
  for (const hook of hookList) {
    const own = await listAll((cursor) => listWebhookDeliveries(ctx, hook.id, { limit: PAGE, ...(cursor === undefined ? {} : { cursor }) }));
    deliveries.push(...own.map((delivery) => deliveryRow(delivery, hook.name)));
    deliverySources.push(...own.map((delivery) => delivery.data_source));
  }
  deliveries.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));

  const term = query.q?.toLowerCase();
  const shownDeliveries = deliveries.filter((delivery) => (query.status === undefined || delivery.status === query.status) && (term === undefined || `${delivery.hookName} ${delivery.event}`.toLowerCase().includes(term)));

  const active = clients.filter((client) => !client.revoked);
  const stored = (await getRateLimits(ctx)).limits;
  const limits: LimitRow[] = stored.map((limit) => ({ scope: limit.scope as Scope, requestsPerMinute: limit.requests_per_minute, burst: limit.burst, clients: active.filter((client) => client.scopes.includes(limit.scope)).length }));

  const openHook: HookRow | 'new' | undefined = query.hook === undefined ? undefined : query.hook === 'new' ? 'new' : hooks.find((hook) => hook.id === query.hook);

  return {
    sources: [...new Set([...clientList.map((client) => client.data_source), ...hookList.map((hook) => hook.data_source), ...deliverySources])],
    clients,
    hooks,
    deliveries,
    shownDeliveries,
    limits,
    counts: { activeClients: active.length, hooks: hooks.length, failed: deliveries.filter((delivery) => delivery.status === 'failed').length },
    openHook,
    unknownHook: query.hook !== undefined && openHook === undefined,
  };
}
