// SPDX-License-Identifier: AGPL-3.0-only
// Cases and case types: thin Go client.

import type { Case, CaseList, CaseTypeList, DataSource, Handling } from '@/lib/types';
import { requireFound, requirePlatform, type PageQuery } from './context';
import { type RequestContext } from './guard';
import { businessFetch } from './internal/business-client';
import { requireId } from './internal/ids';

function qs(params: Readonly<Record<string, string | number | undefined>>): string {
  const parts = Object.entries(params).filter(([, val]) => val !== undefined && val !== '');
  return parts.length === 0 ? '' : `?${parts.map(([k, val]) => `${k}=${encodeURIComponent(String(val))}`).join('&')}`;
}

export interface CaseFilter extends PageQuery {
  readonly zone_id?: string | undefined;
  readonly sub_zone_id?: string | undefined;
  readonly city_id?: string | undefined;
  readonly date_from?: string | undefined;
  readonly date_to?: string | undefined;
  readonly data_source?: DataSource | undefined;
  /** Free text over the case number and the customer's external id. */
  readonly q?: string | undefined;
  readonly handling?: Handling | undefined;
  readonly case_type_id?: string | undefined;
  /** Only these cases (1 to 200); others still apply. */
  readonly ids?: readonly string[] | undefined;
}

function caseFilterQs(filter: CaseFilter): string {
  return qs({
    limit: filter.limit,
    cursor: filter.cursor,
    zone_id: filter.zone_id,
    sub_zone_id: filter.sub_zone_id,
    city_id: filter.city_id,
    date_from: filter.date_from,
    date_to: filter.date_to,
    data_source: filter.data_source,
    q: filter.q,
    handling: filter.handling,
    case_type_id: filter.case_type_id,
    ids: filter.ids?.join(','),
  });
}

// operationId: listCases
export async function listCases(ctx: RequestContext, filter: CaseFilter = {}): Promise<CaseList> {
  requirePlatform(ctx, 'platform.records');
  // No ids asked: no cases, never every case.
  if (filter.ids?.length === 0) return { items: [], page: { next_cursor: null, has_more: false, total: 0 } };
  return (await businessFetch<CaseList>(ctx, `/cases${caseFilterQs(filter)}`))!;
}

/**
 * Every matching case, unpaginated. `listCases` re-reads and re-filters the whole
 * table on each call (readableCases has no cursor of its own), so a caller that
 * walks every page of a large result (live_dispatch_board, productivity_metrics)
 * must not call listCases in a loop: that refetches the table once per page.
 */
// operationId: (not in the contract) listAllCases
export async function listAllCases(ctx: RequestContext, filter: Omit<CaseFilter, 'limit' | 'cursor'> = {}): Promise<Case[]> {
  requirePlatform(ctx, 'platform.records');
  if (filter.ids?.length === 0) return [];
  return (await businessFetch<Case[]>(ctx, `/cases/all${caseFilterQs(filter)}`))!;
}

// operationId: getCase
export async function getCase(ctx: RequestContext, id: string): Promise<Case> {
  requirePlatform(ctx, 'platform.records');
  requireId(id, 'Case');
  return requireFound(await businessFetch<Case>(ctx, `/cases/${id}`), 'Case');
}

// operationId: listCaseTypes
export async function listCaseTypes(ctx: RequestContext, query: PageQuery = {}): Promise<CaseTypeList> {
  requirePlatform(ctx, 'platform.records');
  return (await businessFetch<CaseTypeList>(ctx, `/case-types${qs({ limit: query.limit, cursor: query.cursor })}`))!;
}
