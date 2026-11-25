// SPDX-License-Identifier: AGPL-3.0-only
// Scenario Lab: thin Go client.

import type { Scenario, ScenarioList, ScenarioRunResult } from '@/lib/types';
import { requireFound, type PageQuery } from './context';
import type { RequestContext } from './guard';
import { businessFetch } from './internal/business-client';
import { idSegment } from './internal/ids';

function qs(params: Readonly<Record<string, string | number | undefined>>): string {
  const parts = Object.entries(params).filter(([, val]) => val !== undefined && val !== '');
  return parts.length === 0 ? '' : `?${parts.map(([k, val]) => `${k}=${encodeURIComponent(String(val))}`).join('&')}`;
}

// operationId: listScenarios
export async function listScenarios(ctx: RequestContext, query: PageQuery = {}): Promise<ScenarioList> {
  return (await businessFetch<ScenarioList>(ctx, `/scenarios${qs({ limit: query.limit, cursor: query.cursor })}`))!;
}

// operationId: getScenario
export async function getScenario(ctx: RequestContext, id: string): Promise<Scenario> {
  return requireFound(await businessFetch<Scenario>(ctx, `/scenarios/${idSegment(id)}`), 'Scenario');
}

// operationId: createScenario
export async function createScenario(ctx: RequestContext, body: unknown): Promise<Scenario> {
  return (await businessFetch<Scenario>(ctx, '/scenarios', { method: 'POST', body }))!;
}

// operationId: updateScenario
export async function updateScenario(ctx: RequestContext, id: string, body: unknown): Promise<Scenario> {
  return (await businessFetch<Scenario>(ctx, `/scenarios/${idSegment(id)}`, { method: 'PUT', body }))!;
}

// operationId: deleteScenario
export async function deleteScenario(ctx: RequestContext, id: string): Promise<void> {
  await businessFetch<void>(ctx, `/scenarios/${idSegment(id)}`, { method: 'DELETE' });
}

// operationId: runScenario
export async function runScenario(ctx: RequestContext, id: string): Promise<ScenarioRunResult> {
  return (await businessFetch<ScenarioRunResult>(ctx, `/scenarios/${idSegment(id)}/run`, { method: 'POST' }))!;
}
