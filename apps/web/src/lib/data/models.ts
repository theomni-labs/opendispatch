// SPDX-License-Identifier: AGPL-3.0-only
// Forecast model admin: thin Go client.

import type { ForecastModelSettings, ForecastRun, ModelState, ModelVersionList, WorkingAssumptions } from '@/lib/types';
import { requireFound, type PageQuery } from './context';
import type { RequestContext } from './guard';
import { businessFetch } from './internal/business-client';
import { idSegment } from './internal/ids';

// operationId: updateClockStart
// operationId: updatePlanningLevel
export { updateClockStart, updatePlanningLevel } from './settings';

// operationId: listModelVersions
export async function listModelVersions(ctx: RequestContext, query: PageQuery = {}): Promise<ModelVersionList> {
  const qs = [query.limit === undefined ? '' : `limit=${query.limit}`, query.cursor === undefined ? '' : `cursor=${encodeURIComponent(query.cursor)}`].filter((p) => p !== '').join('&');
  return (await businessFetch<ModelVersionList>(ctx, `/models${qs === '' ? '' : `?${qs}`}`))!;
}

// operationId: getModelState
export async function getModelState(ctx: RequestContext): Promise<ModelState> {
  return (await businessFetch<ModelState>(ctx, '/models/state'))!;
}

// operationId: getWorkingAssumptions
export async function getWorkingAssumptions(ctx: RequestContext): Promise<WorkingAssumptions> {
  return (await businessFetch<WorkingAssumptions>(ctx, '/models/assumptions'))!;
}

// operationId: switchModelVersion
export async function switchModelVersion(ctx: RequestContext, id: string, body: unknown): Promise<ModelState> {
  return requireFound(await businessFetch<ModelState>(ctx, `/models/${idSegment(id)}/activate`, { method: 'POST', body }), 'Model version');
}

// operationId: pauseModel
export async function pauseModel(ctx: RequestContext, body: unknown): Promise<ModelState> {
  return (await businessFetch<ModelState>(ctx, '/models/pause', { method: 'POST', body }))!;
}

// operationId: resumeModel
export async function resumeModel(ctx: RequestContext, body: unknown): Promise<ModelState> {
  return (await businessFetch<ModelState>(ctx, '/models/resume', { method: 'POST', body }))!;
}

// operationId: updateRetrainingSchedule
export async function updateRetrainingSchedule(ctx: RequestContext, body: unknown): Promise<ModelState> {
  return (await businessFetch<ModelState>(ctx, '/models/retraining-schedule', { method: 'PUT', body }))!;
}

// operationId: getForecastModelSettings
export async function getForecastModelSettings(ctx: RequestContext): Promise<ForecastModelSettings> {
  return (await businessFetch<ForecastModelSettings>(ctx, '/models/settings'))!;
}

// operationId: updateForecastModelSettings
export async function updateForecastModelSettings(ctx: RequestContext, body: unknown): Promise<ForecastModelSettings> {
  return (await businessFetch<ForecastModelSettings>(ctx, '/models/settings', { method: 'PUT', body }))!;
}

// operationId: createForecastRun
export async function createForecastRun(ctx: RequestContext, body: unknown): Promise<ForecastRun> {
  return (await businessFetch<ForecastRun>(ctx, '/forecasts/runs', { method: 'POST', body }))!;
}
