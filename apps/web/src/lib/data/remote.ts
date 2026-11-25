// SPDX-License-Identifier: AGPL-3.0-only
// Remote queue and scheduling: Go client.

import type { RemoteCapacity, RemoteProductivity, RemoteQueueItem, RemoteQueueItemList, RemoteRoster, RemoteStaffing } from '@/lib/types';
import { requireFound, type PageQuery } from './context';
import type { RequestContext } from './guard';
import { businessFetch } from './internal/business-client';
import { idSegment } from './internal/ids';

function qs(params: Readonly<Record<string, string | number | undefined>>): string {
  const parts = Object.entries(params).filter(([, val]) => val !== undefined && val !== '');
  return parts.length === 0 ? '' : `?${parts.map(([k, val]) => `${k}=${encodeURIComponent(String(val))}`).join('&')}`;
}

// operationId: listRemoteQueue
export async function listRemoteQueue(
  ctx: RequestContext,
  query: PageQuery & { readonly zone_id?: string | undefined; readonly status?: RemoteQueueItem['status'] | undefined } = {},
): Promise<RemoteQueueItemList> {
  return (await businessFetch<RemoteQueueItemList>(ctx, `/remote/queue${qs({ limit: query.limit, cursor: query.cursor, zone_id: query.zone_id, status: query.status })}`))!;
}

export interface RemoteQueueClock {
  /** The queue's own day (the latest date with a remote case). */
  readonly date: string;
  /** The demo replay clock's moment, as of that day. */
  readonly as_of: string;
  /** The Live Dispatch Board's clock: the "as of" of a reported case the rules routed here. */
  readonly live_as_of?: string | undefined;
}

/** The queue's "as of" moment, readable by a role with no access to the Live Dispatch Board (phase A demo tooling). */
// operationId: (not in the contract) getRemoteQueueClock
export async function getRemoteQueueClock(ctx: RequestContext): Promise<RemoteQueueClock | null> {
  return (await businessFetch<RemoteQueueClock | null>(ctx, '/remote/clock')) ?? null;
}

/** Assigns a remote reviewer to a waiting case (the id is the case id). The review starts at the demo clock. */
// operationId: assignRemoteReviewer
export async function assignRemoteReviewer(ctx: RequestContext, id: string, body: unknown): Promise<RemoteQueueItem> {
  return requireFound(await businessFetch<RemoteQueueItem>(ctx, `/remote/queue/${idSegment(id)}/assign`, { method: 'POST', body }), 'Queued case');
}

/** Remote staffing for one date: expected remote cases, required and planned reviewers per 15-minute interval. */
// operationId: getRemoteStaffing
export async function getRemoteStaffing(ctx: RequestContext, query: { readonly date: string }): Promise<RemoteStaffing> {
  return requireFound(await businessFetch<RemoteStaffing>(ctx, `/remote/staffing${qs({ date: query.date })}`), 'Forecast');
}

/** Remote agents' shifts on one date (roster lines, else home shifts), per-shift demand and capacity. */
// operationId: getRemoteRoster
export async function getRemoteRoster(ctx: RequestContext, query: { readonly date: string }): Promise<RemoteRoster> {
  return requireFound(await businessFetch<RemoteRoster>(ctx, `/remote/roster${qs({ date: query.date })}`), 'Forecast');
}

/** Remote capacity and demand per date (1 to 31) and per 7-day run. */
// operationId: getRemoteCapacity
export async function getRemoteCapacity(ctx: RequestContext, query: { readonly date_from: string; readonly date_to: string }): Promise<RemoteCapacity> {
  return requireFound(await businessFetch<RemoteCapacity>(ctx, `/remote/capacity${qs({ date_from: query.date_from, date_to: query.date_to })}`), 'Forecast');
}

/** Remote queue handling and time to complete for cases registered in a period (1 to 31 dates). */
// operationId: getRemoteProductivity
export async function getRemoteProductivity(ctx: RequestContext, query: { readonly date_from: string; readonly date_to: string }): Promise<RemoteProductivity> {
  return (await businessFetch<RemoteProductivity>(ctx, `/remote/productivity${qs({ date_from: query.date_from, date_to: query.date_to })}`))!;
}
