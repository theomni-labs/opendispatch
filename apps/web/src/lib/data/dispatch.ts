// SPDX-License-Identifier: AGPL-3.0-only
// Live Dispatch Board: thin Go client.

import type {
  Assignment,
  AssignmentComparisonList,
  AssignmentEngineOutput,
  AssignmentEventList,
  AssignmentList,
  AssignmentSource,
  FallbackState,
  LiveBoard,
  LiveCase,
  LiveCaseList,
  ReplayState,
  ShadowComparisonSummary,
  AgentPositionList,
  AgentStatus,
  AgentStatusList,
  UnmetDemandList,
  WaitingSpots,
  ZoneStageList,
} from '@/lib/types';
import { requireFound, type PageQuery } from './context';
import { requireAccess, type RequestContext } from './guard';
import { businessFetch } from './internal/business-client';
import { requireId } from './internal/ids';

const MODULE = 'ops.live_dispatch_board' as const;

// Case id as one safe path segment.
function caseSegment(caseId: string): string {
  if (typeof caseId !== 'string' || caseId === '' || caseId === '.' || caseId === '..') return '-';
  try {
    return encodeURIComponent(caseId);
  } catch {
    return '-';
  }
}

function qs(params: Readonly<Record<string, string | number | undefined>>): string {
  const parts = Object.entries(params).filter(([, val]) => val !== undefined && val !== '');
  return parts.length === 0 ? '' : `?${parts.map(([k, val]) => `${k}=${encodeURIComponent(String(val))}`).join('&')}`;
}

// operationId: getLiveBoard
export async function getLiveBoard(ctx: RequestContext, query: PageQuery & { readonly zone_id?: string | undefined } = {}): Promise<LiveBoard> {
  requireAccess(ctx, MODULE, 'view');
  return (await businessFetch<LiveBoard>(ctx, `/live/board${qs({ limit: query.limit, cursor: query.cursor, zone_id: query.zone_id })}`))!;
}

// operationId: listLiveCases
export async function listLiveCases(ctx: RequestContext, query: PageQuery & { readonly zone_id?: string | undefined; readonly state?: LiveCase['state'] | undefined } = {}): Promise<LiveCaseList> {
  requireAccess(ctx, MODULE, 'view');
  return (await businessFetch<LiveCaseList>(ctx, `/live/cases${qs({ limit: query.limit, cursor: query.cursor, zone_id: query.zone_id, state: query.state })}`))!;
}

// operationId: getCaseRecommendation
export async function getCaseRecommendation(ctx: RequestContext, caseId: string): Promise<AssignmentEngineOutput> {
  requireAccess(ctx, MODULE, 'view');
  requireId(caseId, 'Case');
  return requireFound(await businessFetch<AssignmentEngineOutput>(ctx, `/live/cases/${caseId}/recommendation`), 'Recommendation');
}

// operationId: getFallbackState
export async function getFallbackState(ctx: RequestContext): Promise<FallbackState> {
  requireAccess(ctx, MODULE, 'view');
  return (await businessFetch<FallbackState>(ctx, '/live/fallback'))!;
}

// operationId: getReplayState
export async function getReplayState(ctx: RequestContext): Promise<ReplayState> {
  requireAccess(ctx, MODULE, 'view');
  return (await businessFetch<ReplayState>(ctx, '/live/replay'))!;
}

// operationId: listWaitingSpots (advisory)
export async function listWaitingSpots(ctx: RequestContext, query: { readonly zone_id?: string | undefined } = {}): Promise<WaitingSpots> {
  requireAccess(ctx, MODULE, 'view');
  if (query.zone_id !== undefined) requireId(query.zone_id, 'Zone');
  return (await businessFetch<WaitingSpots>(ctx, `/live/waiting-spots${qs({ zone_id: query.zone_id })}`))!;
}

// operationId: listZoneStages
export async function listZoneStages(ctx: RequestContext, query: PageQuery = {}): Promise<ZoneStageList> {
  requireAccess(ctx, MODULE, 'view');
  return (await businessFetch<ZoneStageList>(ctx, `/live/stages${qs({ limit: query.limit, cursor: query.cursor })}`))!;
}

// operationId: listAgentStatuses
export async function listAgentStatuses(
  ctx: RequestContext,
  query: PageQuery & { readonly zone_id?: string | undefined; readonly status?: AgentStatus['status'] | undefined } = {},
): Promise<AgentStatusList> {
  requireAccess(ctx, MODULE, 'view');
  return (await businessFetch<AgentStatusList>(ctx, `/live/agents${qs({ limit: query.limit, cursor: query.cursor, zone_id: query.zone_id, status: query.status })}`))!;
}

// operationId: listAgentPositions
export async function listAgentPositions(
  ctx: RequestContext,
  agentId: string,
  query: PageQuery & { readonly from?: string | undefined; readonly to?: string | undefined } = {},
): Promise<AgentPositionList> {
  requireAccess(ctx, MODULE, 'view');
  requireId(agentId, 'Agent');
  return requireFound(
    await businessFetch<AgentPositionList>(ctx, `/live/agents/${agentId}/positions${qs({ limit: query.limit, cursor: query.cursor, from: query.from, to: query.to })}`),
    'Agent',
  );
}

// operationId: listAssignments
export async function listAssignments(
  ctx: RequestContext,
  query: PageQuery & {
    readonly zone_id?: string | undefined;
    readonly from?: string | undefined;
    readonly to?: string | undefined;
    readonly case_id?: string | undefined;
    readonly agent_id?: string | undefined;
    readonly source?: AssignmentSource | undefined;
  } = {},
): Promise<AssignmentList> {
  requireAccess(ctx, MODULE, 'view');
  return (
    await businessFetch<AssignmentList>(
      ctx,
      `/assignments${qs({ limit: query.limit, cursor: query.cursor, zone_id: query.zone_id, from: query.from, to: query.to, case_id: query.case_id, agent_id: query.agent_id, source: query.source })}`,
    )
  )!;
}

// operationId: getAssignment
export async function getAssignment(ctx: RequestContext, id: string): Promise<Assignment> {
  requireAccess(ctx, MODULE, 'view');
  requireId(id, 'Assignment');
  return requireFound(await businessFetch<Assignment>(ctx, `/assignments/${id}`), 'Assignment');
}

// operationId: listAssignmentEvents
export async function listAssignmentEvents(ctx: RequestContext, id: string, query: PageQuery = {}): Promise<AssignmentEventList> {
  requireAccess(ctx, MODULE, 'view');
  requireId(id, 'Assignment');
  return requireFound(await businessFetch<AssignmentEventList>(ctx, `/assignments/${id}/events${qs({ limit: query.limit, cursor: query.cursor })}`), 'Assignment');
}

// operationId: listShadowComparisons
export async function listShadowComparisons(
  ctx: RequestContext,
  query: PageQuery & { readonly zone_id?: string | undefined; readonly from?: string | undefined; readonly to?: string | undefined } = {},
): Promise<AssignmentComparisonList> {
  requireAccess(ctx, MODULE, 'view');
  return (await businessFetch<AssignmentComparisonList>(ctx, `/live/shadow-comparisons${qs({ limit: query.limit, cursor: query.cursor, zone_id: query.zone_id, from: query.from, to: query.to })}`))!;
}

// operationId: listUnmetDemand
export async function listUnmetDemand(
  ctx: RequestContext,
  query: PageQuery & { readonly zone_id?: string | undefined; readonly date?: string | undefined; readonly cause?: UnmetDemandList['items'][number]['cause'] | undefined } = {},
): Promise<UnmetDemandList> {
  requireAccess(ctx, MODULE, 'view');
  return (await businessFetch<UnmetDemandList>(ctx, `/live/unmet-demand${qs({ limit: query.limit, cursor: query.cursor, zone_id: query.zone_id, date: query.date, cause: query.cause })}`))!;
}

// operationId: getShadowComparisonSummary
export async function getShadowComparisonSummary(
  ctx: RequestContext,
  query: { readonly zone_id?: string | undefined; readonly from?: string | undefined; readonly to?: string | undefined } = {},
): Promise<ShadowComparisonSummary> {
  requireAccess(ctx, MODULE, 'view');
  return (await businessFetch<ShadowComparisonSummary>(ctx, `/live/shadow-comparisons/summary${qs({ zone_id: query.zone_id, from: query.from, to: query.to })}`))!;
}

// operationId: acceptRecommendation
export async function acceptRecommendation(ctx: RequestContext, caseId: string, body: unknown): Promise<Assignment> {
  return (await businessFetch<Assignment>(ctx, `/live/cases/${caseSegment(caseId)}/accept`, { method: 'POST', body }))!;
}

// operationId: overrideAssignment
export async function overrideAssignment(ctx: RequestContext, caseId: string, body: unknown): Promise<Assignment> {
  return (await businessFetch<Assignment>(ctx, `/live/cases/${caseSegment(caseId)}/override`, { method: 'POST', body }))!;
}

// operationId: controlReplay
export async function controlReplay(ctx: RequestContext, body: unknown): Promise<ReplayState> {
  return (await businessFetch<ReplayState>(ctx, '/live/replay', { method: 'POST', body }))!;
}

/** Demo only: a feed goes down (or comes back). Cases registered while it is down are assigned by the customer's dispatch. */
// operationId: simulateFeedOutage
export async function simulateFeedOutage(ctx: RequestContext, body: unknown): Promise<FallbackState> {
  const state = (await businessFetch<FallbackState>(ctx, '/live/replay/outage', { method: 'POST', body }))!;
  return state;
}

/** Maintenance mode on or off (DG6, admin.data_sources); the customer's own dispatch assigns while it is on. */
// operationId: setMaintenanceMode
export async function setMaintenanceMode(ctx: RequestContext, body: unknown): Promise<FallbackState> {
  const state = (await businessFetch<FallbackState>(ctx, '/settings/maintenance-mode', { method: 'PUT', body }))!;
  return state;
}

/** Tells the customer's system to use its own assignment until told otherwise, or to hand control back (admin.data_sources). */
// operationId: sendFallbackSignal
export async function sendFallbackSignal(ctx: RequestContext, body: unknown): Promise<FallbackState> {
  const state = (await businessFetch<FallbackState>(ctx, '/live/fallback/signal', { method: 'POST', body }))!;
  return state;
}
