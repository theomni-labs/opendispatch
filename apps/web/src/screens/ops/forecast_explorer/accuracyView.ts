// SPDX-License-Identifier: AGPL-3.0-only
// Forecast against actual: server read via lib/data.

import { date as formatDate, weekday } from '@opendispatch/ui/format';
import { moduleAccess } from '@/lib/access';
import { getForecastRun } from '@/lib/data/forecast';
import { getForecastAccuracy, getForecastBacktest } from '@/lib/data/forecast-backtest';
import type { RequestContext } from '@/lib/data/guard';
import type { AccuracyCardData, AccuracyZoneName } from './accuracy';
import { accuracySources } from './sources';

/** Never throws: a failed read is the error state. */
export async function loadAccuracyCard(ctx: RequestContext, query: { readonly zoneId: string; readonly past?: string | undefined }, zones: readonly AccuracyZoneName[], locale: 'en' | 'ar'): Promise<AccuracyCardData> {
  const canRun = moduleAccess(ctx.role, 'admin.forecast_model', ctx.installMode).access === 'edit';
  let running = false;
  if (canRun) {
    try {
      running = (await getForecastBacktest(ctx)).run.state === 'running';
    } catch {
      running = false;
    }
  }
  try {
    const accuracy = await getForecastAccuracy(ctx, { zone_id: query.zoneId, date: query.past });
    const days = accuracy.dates.map((value) => ({ value, label: `${weekday(value, { locale, timeZone: 'Asia/Riyadh' })} ${formatDate(value, { locale })}` }));
    const run = accuracy.run === null ? undefined : await getForecastRun(ctx, accuracy.run.id);
    return { error: false, accuracy, days, zones, canRun, running, ...accuracySources(accuracy, run) };
  } catch {
    return { error: true, accuracy: null, days: [], zones, canRun, running, sources: [], mixed: false };
  }
}
