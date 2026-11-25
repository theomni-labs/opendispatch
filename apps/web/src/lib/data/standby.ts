// SPDX-License-Identifier: AGPL-3.0-only
// Standby and coverage: thin Go client.

import type { Coverage } from '@/lib/types';
import { requireFound } from './context';
import type { RequestContext } from './guard';
import { businessFetch } from './internal/business-client';

type CoverageQuery = { readonly zone_id?: string | undefined; readonly date?: string | undefined };

function qs(params: Readonly<Record<string, string | undefined>>): string {
  const parts = Object.entries(params).filter(([, val]) => val !== undefined && val !== '');
  return parts.length === 0 ? '' : `?${parts.map(([k, val]) => `${k}=${encodeURIComponent(String(val))}`).join('&')}`;
}

// operationId: getCoverage
export async function getCoverage(ctx: RequestContext, query: CoverageQuery): Promise<Coverage> {
  return requireFound(await businessFetch<Coverage>(ctx, `/coverage${qs({ zone_id: query.zone_id, date: query.date })}`), 'Zone');
}

// ---------------------------------------------------------------------------------------------
// Recommendation move (not in the contract: the shape below belongs to this module)
// ---------------------------------------------------------------------------------------------

export interface StandbyMove {
  readonly from_standby_point_id: string;
  readonly to_standby_point_id: string;
  readonly agents: number;
  readonly newly_covered_sub_zone_ids: readonly string[];
  readonly reason_en: string;
}

export interface StandbyMoveRecommendation {
  readonly zone_id: string;
  readonly roster_date: string;
  readonly roster_id: string | null;
  readonly moves: readonly StandbyMove[];
  readonly uncovered_before: number;
  readonly uncovered_after: number;
  readonly illustrative: true;
  readonly data_source: Coverage['data_source'];
}

/** Suggests up to three moves of one agent from the busiest standby point to an unstaffed point that reaches uncovered sub-zones. */
// operationId: (not in the contract) recommendStandbyMoves
export async function recommendStandbyMoves(ctx: RequestContext, query: CoverageQuery): Promise<StandbyMoveRecommendation> {
  return requireFound(await businessFetch<StandbyMoveRecommendation>(ctx, `/coverage/recommendations${qs({ zone_id: query.zone_id, date: query.date })}`), 'Zone');
}

/** Applies one move to the roster of the zone and day (still a draft): the agents change standby point. Returns the new coverage. */
// operationId: (not in the contract) applyStandbyMove
export async function applyStandbyMove(ctx: RequestContext, body: unknown): Promise<Coverage> {
  return (await businessFetch<Coverage>(ctx, '/coverage/moves', { method: 'POST', body }))!;
}
