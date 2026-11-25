// SPDX-License-Identifier: AGPL-3.0-only
// Forecast Explorer reads: thin Go client.

import type { ForecastRun, ForecastRunList, ForecastSplit, ForecastTimeline, ForecastValueList } from '@/lib/types';
import { requireFound, type PageQuery } from './context';
import type { RequestContext } from './guard';
import { businessFetch } from './internal/business-client';
import { idSegment } from './internal/ids';

/** An id filter Go validates. */
function idParam(value: unknown): string | undefined {
  return value === undefined ? undefined : idSegment(value);
}

function qs(params: Readonly<Record<string, string | number | undefined>>): string {
  const parts = Object.entries(params).filter(([, val]) => val !== undefined && val !== '');
  return parts.length === 0 ? '' : `?${parts.map(([k, val]) => `${k}=${encodeURIComponent(String(val))}`).join('&')}`;
}

// ---------------------------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------------------------

// operationId: listForecastRuns
export async function listForecastRuns(ctx: RequestContext, query: PageQuery & { readonly status?: ForecastRun['status'] | undefined } = {}): Promise<ForecastRunList> {
  return (await businessFetch<ForecastRunList>(ctx, `/forecasts/runs${qs({ limit: query.limit, cursor: query.cursor, status: query.status })}`))!;
}

// operationId: getForecastRun
export async function getForecastRun(ctx: RequestContext, id: string): Promise<ForecastRun> {
  return requireFound(await businessFetch<ForecastRun>(ctx, `/forecasts/runs/${idSegment(id)}`), 'Forecast run');
}

export interface ForecastValueQuery extends PageQuery {
  readonly run_id?: string | undefined;
  readonly zone_id?: string | undefined;
  readonly sub_zone_id?: string | undefined;
  /** Default: the first day of the run. */
  readonly date?: string | undefined;
  readonly interval_start?: string | undefined;
}

// operationId: listForecastValues
export async function listForecastValues(ctx: RequestContext, query: ForecastValueQuery = {}): Promise<ForecastValueList> {
  return (await businessFetch<ForecastValueList>(
    ctx,
    `/forecasts/values${qs({ limit: query.limit, cursor: query.cursor, run_id: idParam(query.run_id), zone_id: query.zone_id, sub_zone_id: query.sub_zone_id, date: query.date, interval_start: query.interval_start })}`,
  ))!;
}

// operationId: getForecastTimeline
export async function getForecastTimeline(ctx: RequestContext, query: { readonly zone_id?: string | undefined; readonly date?: string | undefined; readonly run_id?: string | undefined }): Promise<ForecastTimeline> {
  return requireFound(await businessFetch<ForecastTimeline>(ctx, `/forecasts/timeline${qs({ zone_id: idParam(query.zone_id), date: query.date, run_id: idParam(query.run_id) })}`), 'Zone');
}

// operationId: getForecastSplit
export async function getForecastSplit(
  ctx: RequestContext,
  query: { readonly zone_id?: string | undefined; readonly date?: string | undefined; readonly rule_version_id?: string | undefined } = {},
): Promise<ForecastSplit> {
  return (await businessFetch<ForecastSplit>(ctx, `/forecasts/split${qs({ zone_id: idParam(query.zone_id), date: query.date, rule_version_id: query.rule_version_id })}`))!;
}
