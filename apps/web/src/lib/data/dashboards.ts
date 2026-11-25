// SPDX-License-Identifier: AGPL-3.0-only
// Dashboards: thin client; Go computes.

import type { DashboardRollupList, OverCapacityReport, OverrideRateReport, ProductivityDurations, ProductivityRollupList, RollupLevel, ScheduleAdherenceReport, UtilizationReport } from '@/lib/types';
import type { PageQuery } from './context';
import type { RequestContext } from './guard';
import { businessFetch } from './internal/business-client';

function qs(params: Readonly<Record<string, string | number | undefined>>): string {
  const parts = Object.entries(params).filter(([, val]) => val !== undefined && val !== '');
  return parts.length === 0 ? '' : `?${parts.map(([k, val]) => `${k}=${encodeURIComponent(String(val))}`).join('&')}`;
}

// operationId: listDashboardRollups
export async function listDashboardRollups(
  ctx: RequestContext,
  query: PageQuery & { readonly level: RollupLevel; readonly scope_id?: string | undefined; readonly date_from?: string | undefined; readonly date_to?: string | undefined },
): Promise<DashboardRollupList> {
  return (await businessFetch<DashboardRollupList>(
    ctx,
    `/dashboards/rollups${qs({ limit: query.limit, cursor: query.cursor, level: query.level, scope_id: query.scope_id, date_from: query.date_from, date_to: query.date_to })}`,
  ))!;
}

// operationId: listProductivityRollups
export async function listProductivityRollups(
  ctx: RequestContext,
  query: PageQuery & {
    readonly zone_id?: string | undefined;
    readonly date_from?: string | undefined;
    readonly date_to?: string | undefined;
    readonly agent_id?: string | undefined;
    readonly group_by?: 'agent' | 'zone' | undefined;
  } = {},
): Promise<ProductivityRollupList> {
  return (await businessFetch<ProductivityRollupList>(
    ctx,
    `/metrics/productivity${qs({ limit: query.limit, cursor: query.cursor, zone_id: query.zone_id, agent_id: query.agent_id, date_from: query.date_from, date_to: query.date_to, group_by: query.group_by ?? 'zone' })}`,
  ))!;
}

// operationId: getProductivityDurations
export async function getProductivityDurations(
  ctx: RequestContext,
  query: { readonly date_from: string; readonly date_to: string; readonly agent_id?: string | undefined },
): Promise<ProductivityDurations> {
  return (await businessFetch<ProductivityDurations>(ctx, `/metrics/productivity/durations${qs({ date_from: query.date_from, date_to: query.date_to, agent_id: query.agent_id })}`))!;
}

/** A period of Riyadh dates, optionally one zone. */
export interface PeriodQuery {
  readonly date_from: string;
  readonly date_to: string;
  readonly zone_id?: string | undefined;
}

// operationId: getOverCapacity
export async function getOverCapacity(ctx: RequestContext, query: PeriodQuery): Promise<OverCapacityReport> {
  return (await businessFetch<OverCapacityReport>(ctx, `/metrics/over-capacity${qs({ date_from: query.date_from, date_to: query.date_to, zone_id: query.zone_id })}`))!;
}

// operationId: getOverrideRate
export async function getOverrideRate(ctx: RequestContext, query: PeriodQuery): Promise<OverrideRateReport> {
  return (await businessFetch<OverrideRateReport>(ctx, `/metrics/override-rate${qs({ date_from: query.date_from, date_to: query.date_to, zone_id: query.zone_id })}`))!;
}

// operationId: getUtilization
export async function getUtilization(ctx: RequestContext, query: PeriodQuery): Promise<UtilizationReport> {
  return (await businessFetch<UtilizationReport>(ctx, `/metrics/utilization${qs({ date_from: query.date_from, date_to: query.date_to, zone_id: query.zone_id })}`))!;
}

// operationId: getScheduleAdherence
export async function getScheduleAdherence(ctx: RequestContext, query: PeriodQuery): Promise<ScheduleAdherenceReport> {
  return (await businessFetch<ScheduleAdherenceReport>(ctx, `/metrics/schedule-adherence${qs({ date_from: query.date_from, date_to: query.date_to, zone_id: query.zone_id })}`))!;
}
