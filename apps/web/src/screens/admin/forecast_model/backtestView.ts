// SPDX-License-Identifier: AGPL-3.0-only
// Backtest card read: server side, through lib/data.

import { ForbiddenError } from '@/lib/data/errors';
import { getForecastBacktest } from '@/lib/data/forecast-backtest';
import type { RequestContext } from '@/lib/data/guard';
import { listZones } from '@/lib/data/locations';
import type { BacktestCardData } from './backtest';

/** The latest backtest and the zone names; never throws. */
export async function loadBacktestCard(ctx: RequestContext, locale: 'en' | 'ar'): Promise<BacktestCardData> {
  let state;
  try {
    state = await getForecastBacktest(ctx);
  } catch (error) {
    if (error instanceof ForbiddenError) return { state: null, error: false, zoneNames: {} };
    return { state: null, error: true, zoneNames: {} };
  }
  const zoneNames: Record<string, string> = {};
  if ((state.latest?.weakest_zones.length ?? 0) > 0) {
    try {
      for (const zone of (await listZones(ctx, { limit: 200 })).items) {
        const ar = zone.name_ar?.trim() ?? '';
        zoneNames[zone.id] = locale === 'ar' && ar !== '' ? ar : zone.name_en;
      }
    } catch {
      // ids show without names
    }
  }
  return { state, error: false, zoneNames };
}
