// SPDX-License-Identifier: AGPL-3.0-only
// Service-level simulator: thin Go client.

import type { SimulationResultList, SimulationRun, SimulationRunDetail, SimulationRunList } from '@/lib/types';
import { requireFound, type PageQuery } from './context';
import type { RequestContext } from './guard';
import { businessFetch } from './internal/business-client';
import { idSegment } from './internal/ids';

export interface SimulationHistoryRange {
  readonly first: string;
  readonly last: string;
}

function qs(params: Readonly<Record<string, string | number | undefined>>): string {
  const parts = Object.entries(params).filter(([, val]) => val !== undefined && val !== '');
  return parts.length === 0 ? '' : `?${parts.map(([k, val]) => `${k}=${encodeURIComponent(String(val))}`).join('&')}`;
}

/** Days the committed case history covers, for the Service-Level Simulator's "Cases of" picker. Null if none loaded. */
// operationId: (not in the contract) getSimulationHistoryRange
export async function getSimulationHistoryRange(ctx: RequestContext): Promise<SimulationHistoryRange | null> {
  return (await businessFetch<SimulationHistoryRange | null>(ctx, '/simulations/history-range')) ?? null;
}

// operationId: listSimulationRuns
export async function listSimulationRuns(ctx: RequestContext, query: PageQuery & { readonly date?: string | undefined } = {}): Promise<SimulationRunList> {
  return (await businessFetch<SimulationRunList>(ctx, `/simulations${qs({ limit: query.limit, cursor: query.cursor, date: query.date })}`))!;
}

// operationId: getSimulationRun
export async function getSimulationRun(ctx: RequestContext, id: string): Promise<SimulationRunDetail> {
  return requireFound(await businessFetch<SimulationRunDetail>(ctx, `/simulations/${idSegment(id)}`), 'Simulation run');
}

// operationId: listSimulationResults
export async function listSimulationResults(ctx: RequestContext, id: string, query: PageQuery & { readonly zone_id?: string | undefined } = {}): Promise<SimulationResultList> {
  return requireFound(await businessFetch<SimulationResultList>(ctx, `/simulations/${idSegment(id)}/results${qs({ limit: query.limit, cursor: query.cursor, zone_id: query.zone_id })}`), 'Simulation run');
}

// operationId: runSimulation
export async function runSimulation(ctx: RequestContext, body: unknown): Promise<SimulationRun> {
  return (await businessFetch<SimulationRun>(ctx, '/simulations', { method: 'POST', body }))!;
}
