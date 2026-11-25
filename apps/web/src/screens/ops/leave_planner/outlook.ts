// SPDX-License-Identifier: AGPL-3.0-only
// Leave outlook view model. SERVER ONLY.

import { getLeaveOutlook } from '@/lib/data/leave';
import { listZones } from '@/lib/data/locations';
import type { RequestContext } from '@/lib/data/guard';
import { date, formatDelta, num } from '@opendispatch/ui/format';
import type { DataSource, LeaveOutlookWeek, Zone } from '@/lib/types';
import type { OutlookHorizon, OutlookStatus } from './outlook-types';

export interface OutlookReasonView {
  readonly code: LeaveOutlookWeek['reasons'][number]['code'];
  readonly effectLabel: string | null;
  readonly label: string | null;
}

export interface OutlookCellView {
  readonly key: string;
  readonly week: number;
  readonly startLabel: string;
  readonly status: OutlookStatus;
  readonly change: number;
  readonly changeLabel: string;
  readonly room: number;
  /** Expected off sick a day. */
  readonly sickLabel: string;
  readonly reasons: readonly OutlookReasonView[];
}

export interface OutlookRowView {
  readonly zoneCode: string;
  readonly cells: readonly OutlookCellView[];
}

export interface OutlookFlagView extends OutlookCellView {
  readonly zoneCode: string;
}

export interface OutlookHeaderView {
  readonly label: string;
  readonly span: number;
}

export interface LeaveOutlookView {
  readonly state: 'filled' | 'empty' | 'error';
  readonly weeks: OutlookHorizon;
  readonly headers: readonly OutlookHeaderView[];
  readonly rows: readonly OutlookRowView[];
  readonly flagged: readonly OutlookFlagView[];
  readonly sources: readonly DataSource[];
  /** Where the sick rate comes from; null: not said. */
  readonly sickSource: 'history' | 'assumed' | null;
}

function zoneCode(zone: Zone): string {
  return typeof zone.extra?.['code'] === 'string' ? zone.extra['code'] : zone.id;
}

/** A share as a signed whole percent. */
export function signedPercent(share: number, locale: 'en' | 'ar'): string {
  const value = Math.round(share * 100);
  return formatDelta(value, 0, locale);
}

function cellOf(week: LeaveOutlookWeek, index: number, locale: 'en' | 'ar'): OutlookCellView {
  return {
    key: week.start_date,
    week: index + 1,
    startLabel: date(week.start_date, { locale }),
    status: week.status,
    change: week.demand_change,
    changeLabel: signedPercent(week.demand_change, locale),
    room: week.leave_room,
    sickLabel: week.expected_sick_absence === undefined ? '—' : num(week.expected_sick_absence, 1, locale),
    reasons: week.reasons.map((r) => ({
      code: r.code,
      effectLabel: r.effect === null ? null : signedPercent(r.effect, locale),
      label: r.label ?? null,
    })),
  };
}

const EMPTY = (weeks: OutlookHorizon, state: LeaveOutlookView['state']): LeaveOutlookView => ({ state, weeks, headers: [], rows: [], flagged: [], sources: [], sickSource: null });

export async function loadLeaveOutlookView(ctx: RequestContext, weeks: OutlookHorizon, locale: 'en' | 'ar'): Promise<LeaveOutlookView> {
  let outlook;
  let zones: Zone[];
  try {
    [outlook, zones] = await Promise.all([getLeaveOutlook(ctx, { weeks }), listZones(ctx, { limit: 200 }).then((page) => page.items)]);
  } catch {
    return EMPTY(weeks, 'error');
  }
  const codeById = new Map(zones.map((z) => [z.id, zoneCode(z)] as const));
  const rows: OutlookRowView[] = outlook.zones
    .filter((z) => z.weeks.length > 0)
    .map((z) => ({ zoneCode: codeById.get(z.zone_id) ?? z.zone_id, cells: z.weeks.map((w, i) => cellOf(w, i, locale)) }));
  if (rows.length === 0) return { ...EMPTY(weeks, 'empty'), sources: outlook.data_sources };

  const step = weeks === 13 ? 1 : 8;
  const headers: OutlookHeaderView[] = [];
  const first = outlook.zones.find((z) => z.weeks.length > 0)?.weeks ?? [];
  for (let i = 0; i < first.length; i += step) {
    const week = first[i] as LeaveOutlookWeek;
    headers.push({ label: date(week.start_date, { locale }), span: Math.min(step, first.length - i) });
  }
  const flagged: OutlookFlagView[] = rows
    .flatMap((row) => row.cells.filter((c) => c.status !== 'normal').map((c) => ({ ...c, zoneCode: row.zoneCode })))
    .sort((a, b) => a.week - b.week || a.zoneCode.localeCompare(b.zoneCode));
  const said = outlook.zones.flatMap((z) => (z.sick_source === undefined ? [] : [z.sick_source]));
  const sickSource = said.length === 0 ? null : said.includes('history') ? 'history' : 'assumed';
  return { state: 'filled', weeks, headers, rows, flagged, sources: outlook.data_sources, sickSource };
}
