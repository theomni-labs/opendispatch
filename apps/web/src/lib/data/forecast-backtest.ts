// SPDX-License-Identifier: AGPL-3.0-only
// Forecast backtest and forecast vs actual.

import type { ForecastAccuracy, ForecastBacktestState, ForecastExperiment, ForecastExperimentList } from '@/lib/types';
import type { PageQuery } from './context';
import type { RequestContext } from './guard';
import { businessFetch } from './internal/business-client';
import { idSegment } from './internal/ids';

// operationId: getForecastBacktest
export async function getForecastBacktest(ctx: RequestContext): Promise<ForecastBacktestState> {
  return (await businessFetch<ForecastBacktestState>(ctx, '/models/backtest'))!;
}

// operationId: runForecastBacktest
export async function runForecastBacktest(ctx: RequestContext): Promise<ForecastBacktestState> {
  return (await businessFetch<ForecastBacktestState>(ctx, '/models/backtest', { method: 'POST', body: {} }))!;
}

export interface ForecastAccuracyQuery {
  readonly zone_id?: string | undefined;
  readonly date?: string | undefined;
}

// operationId: getForecastAccuracy
export async function getForecastAccuracy(ctx: RequestContext, query: ForecastAccuracyQuery = {}): Promise<ForecastAccuracy> {
  const parts = [query.zone_id === undefined ? '' : `zone_id=${idSegment(query.zone_id)}`, query.date === undefined ? '' : `date=${encodeURIComponent(query.date)}`].filter((p) => p !== '');
  return (await businessFetch<ForecastAccuracy>(ctx, `/forecasts/accuracy${parts.length === 0 ? '' : `?${parts.join('&')}`}`))!;
}

// operationId: listForecastExperiments
export async function listForecastExperiments(ctx: RequestContext, query: PageQuery = {}): Promise<ForecastExperimentList> {
  const qs = [query.limit === undefined ? '' : `limit=${query.limit}`, query.cursor === undefined ? '' : `cursor=${encodeURIComponent(query.cursor)}`].filter((p) => p !== '').join('&');
  return (await businessFetch<ForecastExperimentList>(ctx, `/models/experiments${qs === '' ? '' : `?${qs}`}`))!;
}

// operationId: retrainForecastModel
export async function retrainForecastModel(ctx: RequestContext): Promise<ForecastExperiment> {
  return (await businessFetch<ForecastExperiment>(ctx, '/models/retrain', { method: 'POST', body: {} }))!;
}
