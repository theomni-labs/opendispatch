// SPDX-License-Identifier: AGPL-3.0-only
// Builds the customer plan file for one zone. SERVER ONLY.
import { date as formatDate } from '@opendispatch/ui/format';
import { getTranslations } from 'next-intl/server';
import { getForecastTimeline, listForecastRuns, listForecastValues } from '@/lib/data/forecast';
import { listZones } from '@/lib/data/locations';
import type { RequestContext } from '@/lib/data/guard';
import { CSV_MIME, toCsv } from '@/lib/export/csv';
import type { ExportFile } from '@/lib/export/download';
import { horizonDates } from './days';
import type { ForecastValue } from '@/lib/types';
import { buildPlan, planTable, spreadOf, type DayValues } from './planFormat';
import { localName } from './view';

/** Every sub-zone value of one zone and day, page by page. */
async function subZoneRows(ctx: RequestContext, zoneId: string, date: string): Promise<ForecastValue[]> {
  const rows: ForecastValue[] = [];
  let cursor: string | undefined;
  do {
    const page = await listForecastValues(ctx, { zone_id: zoneId, date, limit: 200, cursor });
    rows.push(...page.items);
    cursor = page.page.next_cursor ?? undefined;
  } while (cursor !== undefined);
  return rows;
}

/** Per horizon day: the timeline and its sub-zone pages (a known N+1: no batch endpoint). */
async function loadDays(ctx: RequestContext, zoneId: string, dates: readonly string[]): Promise<DayValues[]> {
  return Promise.all(
    dates.map(async (date) => {
      const [{ intervals }, rows] = await Promise.all([getForecastTimeline(ctx, { zone_id: zoneId, date }), subZoneRows(ctx, zoneId, date)]);
      const expected = new Array<number>(96).fill(0);
      for (const interval of intervals) expected[interval.interval_index] = interval.expected;
      return { date, expected, spread: spreadOf(rows) };
    }),
  );
}

export async function buildPlanExport(ctx: RequestContext, zoneId: string, locale: 'en' | 'ar'): Promise<ExportFile> {
  const m = await getTranslations({ locale, namespace: 'ops.forecast_explorer' });
  const zone = (await listZones(ctx, { limit: 200 })).items.find((z) => z.id === zoneId);
  const run = (await listForecastRuns(ctx, { status: 'succeeded', limit: 1 })).items[0];
  const zoneName = zone === undefined ? '' : localName(zone, locale).name;
  const dates = run === undefined ? [] : horizonDates(run.horizon_start_date, run.horizon_days);
  const plan = zone === undefined ? [] : buildPlan(await loadDays(ctx, zone.id, dates));
  const days = plan.reduce((n, s) => n + s.days, 0);
  const table = planTable(plan, {
    zoneLabel: m('plan.zone'),
    zoneName,
    empty: m('plan.empty'),
    notes: [
      m('plan.noteSegments'),
      m('plan.noteStaff'),
      m('plan.noteWindows', { days }),
      m('plan.noteIllustrative', { model: run?.model_version ?? '', date: run === undefined ? '' : formatDate(run.created_at, { locale, timeZone: 'Asia/Riyadh' }) }),
    ],
  });
  const code = typeof zone?.extra?.['code'] === 'string' ? zone.extra['code'] : 'zone';
  return { filename: `customer-plan-${code}-${run?.horizon_start_date ?? 'none'}.csv`, mime: CSV_MIME, text: toCsv(table) };
}
