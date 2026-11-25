// SPDX-License-Identifier: AGPL-3.0-only
// Forecast Explorer: why, and where.

import type { ForecastExplanation, ForecastLocationDistribution, LocationDayGroup } from '@/lib/types';
import type { RequestContext } from './guard';
import { businessFetch } from './internal/business-client';
import { idSegment } from './internal/ids';

function qs(params: Readonly<Record<string, string | number | undefined>>): string {
  const parts = Object.entries(params).filter(([, val]) => val !== undefined && val !== '');
  return parts.length === 0 ? '' : `?${parts.map(([k, val]) => `${k}=${encodeURIComponent(String(val))}`).join('&')}`;
}

// operationId: getForecastExplanation
/** Null: no explanation for this zone-day. */
export async function getForecastExplanation(
  ctx: RequestContext,
  query: { readonly zone_id: string; readonly date: string; readonly run_id?: string | undefined },
): Promise<ForecastExplanation | null> {
  const path = `/forecasts/explanation${qs({ zone_id: idSegment(query.zone_id), date: query.date, run_id: query.run_id === undefined ? undefined : idSegment(query.run_id) })}`;
  return (await businessFetch<ForecastExplanation>(ctx, path)) ?? null;
}

export interface ForecastLocationsQuery {
  readonly sub_zone_id: string;
  readonly hour: number;
  readonly day_group?: LocationDayGroup | undefined;
  /** Instead of day_group. */
  readonly date?: string | undefined;
  readonly forecast_run_id?: string | undefined;
}

// operationId: getForecastLocations
/** Null: no location data for the sub-zone. */
export async function getForecastLocations(ctx: RequestContext, query: ForecastLocationsQuery): Promise<ForecastLocationDistribution | null> {
  const path = `/forecasts/locations${qs({
    sub_zone_id: idSegment(query.sub_zone_id),
    hour: query.hour,
    day_group: query.day_group,
    date: query.date,
    forecast_run_id: query.forecast_run_id === undefined ? undefined : idSegment(query.forecast_run_id),
  })}`;
  return (await businessFetch<ForecastLocationDistribution>(ctx, path)) ?? null;
}
