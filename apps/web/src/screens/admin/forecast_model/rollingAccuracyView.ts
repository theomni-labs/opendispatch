// SPDX-License-Identifier: AGPL-3.0-only
// Accuracy card read: server side, through lib/data.

import { weekdayNames } from '@opendispatch/ui/format';
import { ForbiddenError } from '@/lib/data/errors';
import { getRollingForecastAccuracy } from '@/lib/data/forecast-accuracy';
import type { RequestContext } from '@/lib/data/guard';
import { listZones } from '@/lib/data/locations';
import type { RollingAccuracyCardData } from './rollingAccuracy';

/** The stored window and the zone names; never throws. */
export async function loadRollingAccuracyCard(ctx: RequestContext, locale: 'en' | 'ar'): Promise<RollingAccuracyCardData> {
  const weekdays = weekdayNames({ locale, length: 'long' });
  let state;
  try {
    state = await getRollingForecastAccuracy(ctx);
  } catch (error) {
    return { state: null, error: !(error instanceof ForbiddenError), zoneNames: {}, weekdays };
  }
  const zoneNames: Record<string, string> = {};
  if (state.zones.length > 0) {
    try {
      for (const zone of (await listZones(ctx, { limit: 200 })).items) {
        const ar = zone.name_ar?.trim() ?? '';
        zoneNames[zone.id] = locale === 'ar' && ar !== '' ? ar : zone.name_en;
      }
    } catch {
      // ids show without names
    }
  }
  return { state, error: false, zoneNames, weekdays };
}
