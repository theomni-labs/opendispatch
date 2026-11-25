// SPDX-License-Identifier: AGPL-3.0-only
// Leave planner: thin Go client.

import type { LeaveCoverageEffect, LeaveOutlook, LeaveRequest, LeaveRequestList, LeaveWindowList } from '@/lib/types';
import type { RequestContext } from './guard';
import { businessFetch } from './internal/business-client';
import { pathSegment } from './internal/path-segment';
import { requireFound, type PageQuery } from './context';

function qs(params: Readonly<Record<string, string | number | undefined>>): string {
  const parts = Object.entries(params).filter(([, val]) => val !== undefined && val !== '');
  return parts.length === 0 ? '' : `?${parts.map(([k, val]) => `${k}=${encodeURIComponent(String(val))}`).join('&')}`;
}

// operationId: listLeaveRequests
export async function listLeaveRequests(
  ctx: RequestContext,
  query: PageQuery & {
    readonly zone_id?: string | undefined;
    readonly date_from?: string | undefined;
    readonly date_to?: string | undefined;
    readonly status?: LeaveRequest['status'] | undefined;
    readonly agent_id?: string | undefined;
  } = {},
): Promise<LeaveRequestList> {
  return (
    await businessFetch<LeaveRequestList>(
      ctx,
      `/leave-requests${qs({ limit: query.limit, cursor: query.cursor, zone_id: query.zone_id, date_from: query.date_from, date_to: query.date_to, status: query.status, agent_id: query.agent_id })}`,
    )
  )!;
}

// operationId: getLeaveRequest
export async function getLeaveRequest(ctx: RequestContext, id: string): Promise<LeaveRequest> {
  return requireFound(await businessFetch<LeaveRequest>(ctx, `/leave-requests/${pathSegment(id)}`), 'Leave request');
}

// operationId: createLeaveRequest
export async function createLeaveRequest(ctx: RequestContext, body: unknown): Promise<LeaveRequest> {
  return (await businessFetch<LeaveRequest>(ctx, '/leave-requests', { method: 'POST', body }))!;
}

// operationId: getLeaveCoverageEffect
export async function getLeaveCoverageEffect(ctx: RequestContext, id: string): Promise<LeaveCoverageEffect> {
  return requireFound(await businessFetch<LeaveCoverageEffect>(ctx, `/leave-requests/${pathSegment(id)}/coverage-effect`), 'Leave request');
}

/** Batch form of getLeaveCoverageEffect: one shared loadPlan server-side instead of one per request. */
// operationId: (not in the contract) getLeaveCoverageEffects
export async function getLeaveCoverageEffects(ctx: RequestContext, ids: readonly string[]): Promise<readonly LeaveCoverageEffect[]> {
  return (await businessFetch<readonly LeaveCoverageEffect[]>(ctx, '/leave-requests/coverage-effects', { method: 'POST', body: { ids } }))!;
}

// operationId: approveLeaveRequest
export async function approveLeaveRequest(ctx: RequestContext, id: string, body: unknown = {}): Promise<LeaveRequest> {
  return (await businessFetch<LeaveRequest>(ctx, `/leave-requests/${pathSegment(id)}/approve`, { method: 'POST', body }))!;
}

// operationId: declineLeaveRequest
export async function declineLeaveRequest(ctx: RequestContext, id: string, body: unknown = {}): Promise<LeaveRequest> {
  return (await businessFetch<LeaveRequest>(ctx, `/leave-requests/${pathSegment(id)}/decline`, { method: 'POST', body }))!;
}

// operationId: getLeaveOutlook
export async function getLeaveOutlook(ctx: RequestContext, query: { readonly zone_id?: string | undefined; readonly weeks?: 13 | 52 | undefined } = {}): Promise<LeaveOutlook> {
  return requireFound(await businessFetch<LeaveOutlook>(ctx, `/leave/outlook${qs({ zone_id: query.zone_id, weeks: query.weeks })}`), 'Zone');
}

// operationId: listLeaveWindows
export async function listLeaveWindows(
  ctx: RequestContext,
  query: PageQuery & { readonly zone_id?: string | undefined; readonly date_from?: string | undefined; readonly date_to?: string | undefined } = {},
): Promise<LeaveWindowList> {
  return requireFound(
    await businessFetch<LeaveWindowList>(ctx, `/leave/windows${qs({ limit: query.limit, cursor: query.cursor, zone_id: query.zone_id, date_from: query.date_from, date_to: query.date_to })}`),
    'Zone',
  );
}
