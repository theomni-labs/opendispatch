// SPDX-License-Identifier: AGPL-3.0-only
// Break Planner (ops.break_planner); Go places.

import type { BreakPlan, BreakSlot } from '@/lib/types';
import type { RequestContext } from './guard';
import { businessFetch } from './internal/business-client';
import { idSegment } from './internal/ids';
import { requireFound } from './context';


function qs(params: Readonly<Record<string, string | number | undefined>>): string {
  const parts = Object.entries(params).filter(([, val]) => val !== undefined && val !== '');
  return parts.length === 0 ? '' : `?${parts.map(([k, val]) => `${k}=${encodeURIComponent(String(val))}`).join('&')}`;
}

// ---------------------------------------------------------------------------------------------
// Pure helpers (no data)
// ---------------------------------------------------------------------------------------------

/** @pure The ISO date-time (+03:00) that lies `minute` minutes after 00:00 of `date`; 1440 and more roll into the next days. */
export function isoAtMinute(date: string, minute: number): string {
  const ms = Date.parse(`${date}T00:00:00+03:00`) + minute * 60_000 + 3 * 3_600_000;
  return `${new Date(ms).toISOString().slice(0, 19)}+03:00`;
}

// ---------------------------------------------------------------------------------------------
// Operations. Go's job now: access, validation, audit, and the roster read/write the plan needs.
// ---------------------------------------------------------------------------------------------

// operationId: getBreakPlan
export async function getBreakPlan(ctx: RequestContext, query: { readonly zone_id?: string | undefined; readonly date?: string | undefined }): Promise<BreakPlan> {
  return requireFound(await businessFetch<BreakPlan>(ctx, `/breaks${qs({ zone_id: query.zone_id, date: query.date })}`), 'Zone');
}

// operationId: generateBreakPlan
export async function generateBreakPlan(ctx: RequestContext, body: unknown): Promise<BreakPlan> {
  return (await businessFetch<BreakPlan>(ctx, '/breaks', { method: 'POST', body }))!;
}

// operationId: updateBreakSlot
export async function updateBreakSlot(ctx: RequestContext, id: string, body: unknown): Promise<BreakSlot> {
  return (await businessFetch<BreakSlot>(ctx, `/breaks/${idSegment(id)}`, { method: 'PUT', body }))!;
}
