// SPDX-License-Identifier: AGPL-3.0-only
// Rosters and gap view: thin client of Go.

import type {
  GapSurplusView,
  NetAvailability,
  Override,
  OverrideList,
  PublishResult,
  Roster,
  RosterAssignmentList,
  RosterList,
  RosterWeek,
  RosterWeekResult,
} from '@/lib/types';
import { requireFound, type PageQuery } from './context';
import type { RequestContext } from './guard';
import { businessFetch } from './internal/business-client';
import { idSegment } from './internal/ids';


function qs(params: Readonly<Record<string, string | number | undefined>>): string {
  const parts = Object.entries(params).filter(([, val]) => val !== undefined && val !== '');
  return parts.length === 0 ? '' : `?${parts.map(([k, val]) => `${k}=${encodeURIComponent(String(val))}`).join('&')}`;
}

// ---------------------------------------------------------------------------------------------
// Reading rosters
// ---------------------------------------------------------------------------------------------

// operationId: listRosters
export async function listRosters(
  ctx: RequestContext,
  query: PageQuery & { readonly zone_id?: string | undefined; readonly date?: string | undefined; readonly status?: Roster['status'] | undefined } = {},
): Promise<RosterList> {
  return (await businessFetch<RosterList>(ctx, `/rosters${qs({ limit: query.limit, cursor: query.cursor, zone_id: query.zone_id, date: query.date, status: query.status })}`))!;
}

// operationId: getRoster
export async function getRoster(ctx: RequestContext, id: string): Promise<Roster> {
  return requireFound(await businessFetch<Roster>(ctx, `/rosters/${idSegment(id)}`), 'Roster');
}

// operationId: listRosterAssignments
export async function listRosterAssignments(ctx: RequestContext, id: string, query: PageQuery = {}): Promise<RosterAssignmentList> {
  return requireFound(await businessFetch<RosterAssignmentList>(ctx, `/rosters/${idSegment(id)}/assignments${qs({ limit: query.limit, cursor: query.cursor })}`), 'Roster');
}

// operationId: listRosterOverrides
export async function listRosterOverrides(ctx: RequestContext, id: string, query: PageQuery = {}): Promise<OverrideList> {
  return requireFound(await businessFetch<OverrideList>(ctx, `/rosters/${idSegment(id)}/overrides${qs({ limit: query.limit, cursor: query.cursor })}`), 'Roster');
}

// ---------------------------------------------------------------------------------------------
// Building
// ---------------------------------------------------------------------------------------------

// operationId: buildRoster
export async function buildRoster(ctx: RequestContext, body: unknown): Promise<Roster> {
  return (await businessFetch<Roster>(ctx, '/rosters', { method: 'POST', body }))!;
}

// ---------------------------------------------------------------------------------------------
// A week of rosters
// ---------------------------------------------------------------------------------------------

// operationId: getRosterWeek
export async function getRosterWeek(ctx: RequestContext, weekStart: string): Promise<RosterWeek> {
  return (await businessFetch<RosterWeek>(ctx, `/rosters/week${qs({ week_start: weekStart })}`))!;
}

// operationId: buildRosterWeek
export async function buildRosterWeek(ctx: RequestContext, body: unknown): Promise<RosterWeekResult> {
  return (await businessFetch<RosterWeekResult>(ctx, '/rosters/week/build', { method: 'POST', body }))!;
}

// operationId: submitRosterWeek
export async function submitRosterWeek(ctx: RequestContext, body: unknown): Promise<RosterWeekResult> {
  return (await businessFetch<RosterWeekResult>(ctx, '/rosters/week/submit', { method: 'POST', body }))!;
}

/** LABELLED STUB, as publishRoster: nothing is sent to the customer. */
// operationId: publishRosterWeek
export async function publishRosterWeek(ctx: RequestContext, body: unknown): Promise<RosterWeekResult> {
  return (await businessFetch<RosterWeekResult>(ctx, '/rosters/week/publish', { method: 'POST', body }))!;
}

// operationId: getNetAvailability
export async function getNetAvailability(ctx: RequestContext, query: { readonly week_start: string; readonly zone_id?: string | undefined }): Promise<NetAvailability> {
  return (await businessFetch<NetAvailability>(ctx, `/planning/availability${qs({ week_start: query.week_start, zone_id: query.zone_id })}`))!;
}

// ---------------------------------------------------------------------------------------------
// Approval flow of a roster
// ---------------------------------------------------------------------------------------------

// operationId: submitRoster
export async function submitRoster(ctx: RequestContext, id: string): Promise<Roster> {
  return (await businessFetch<Roster>(ctx, `/rosters/${idSegment(id)}/submit`, { method: 'POST', body: {} }))!;
}

// operationId: approveRoster
export async function approveRoster(ctx: RequestContext, id: string, body: unknown = {}): Promise<Roster> {
  return (await businessFetch<Roster>(ctx, `/rosters/${idSegment(id)}/approve`, { method: 'POST', body }))!;
}

// operationId: rejectRoster
export async function rejectRoster(ctx: RequestContext, id: string, body: unknown = {}): Promise<Roster> {
  return (await businessFetch<Roster>(ctx, `/rosters/${idSegment(id)}/reject`, { method: 'POST', body }))!;
}

/** LABELLED STUB: nothing is sent to the customer. The real publish needs the customer's interfaces. */
// operationId: publishRoster
export async function publishRoster(ctx: RequestContext, id: string): Promise<PublishResult> {
  return (await businessFetch<PublishResult>(ctx, `/rosters/${idSegment(id)}/publish`, { method: 'POST', body: {} }))!;
}

// ---------------------------------------------------------------------------------------------
// Overrides
// ---------------------------------------------------------------------------------------------

// operationId: createOverride
export async function createOverride(ctx: RequestContext, rosterId: string, body: unknown): Promise<Override> {
  return (await businessFetch<Override>(ctx, `/rosters/${idSegment(rosterId)}/overrides`, { method: 'POST', body }))!;
}

// operationId: approveOverride
export async function approveOverride(ctx: RequestContext, id: string, body: unknown = {}): Promise<Override> {
  return (await businessFetch<Override>(ctx, `/overrides/${idSegment(id)}/approve`, { method: 'POST', body }))!;
}

// operationId: rejectOverride
export async function rejectOverride(ctx: RequestContext, id: string, body: unknown = {}): Promise<Override> {
  return (await businessFetch<Override>(ctx, `/overrides/${idSegment(id)}/reject`, { method: 'POST', body }))!;
}

// ---------------------------------------------------------------------------------------------
// Gap and Surplus
// ---------------------------------------------------------------------------------------------

export interface GapQuery {
  readonly roster_id?: string | undefined;
  readonly scenario_id?: string | undefined;
  readonly zone_id?: string | undefined;
  readonly date?: string | undefined;
}

// operationId: getGapSurplus
export async function getGapSurplus(ctx: RequestContext, query: GapQuery = {}): Promise<GapSurplusView> {
  const id = (value: unknown): string | undefined => (value === undefined ? undefined : idSegment(value));
  return requireFound(await businessFetch<GapSurplusView>(ctx, `/gaps${qs({ roster_id: id(query.roster_id), scenario_id: id(query.scenario_id), zone_id: id(query.zone_id), date: query.date })}`), 'Gap view');
}
