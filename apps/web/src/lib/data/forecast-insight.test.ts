// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { ForbiddenError, InvalidInputError } from './errors';
import { getForecastExplanation, getForecastLocations } from './forecast-insight';
import { listSubZones } from './locations';
import { ctxFor, fixtureZoneIds, withTempDemoState } from './test-support';

withTempDemoState();

const admin = () => ctxFor('administrator');
const [riyadhCentral] = fixtureZoneIds();
const monday = '2026-09-14';

describe('why this forecast', () => {
  it('is null when the run carries no explanation (the committed run)', async () => {
    expect(await getForecastExplanation(admin(), { zone_id: riyadhCentral ?? '', date: monday })).toBeNull();
  });

  it('refuses a bad date and a role without the module', async () => {
    await expect(getForecastExplanation(admin(), { zone_id: riyadhCentral ?? '', date: '14/09/2026' })).rejects.toThrow(InvalidInputError);
    await expect(getForecastExplanation(ctxFor('change_approver'), { zone_id: riyadhCentral ?? '', date: monday })).rejects.toThrow(ForbiddenError);
  });
});

describe('micro-cell locations', () => {
  it('is null when no run kept location data, and checks hour and day group', async () => {
    const sub = (await listSubZones(admin(), { zone_id: riyadhCentral, limit: 1 })).items[0];
    expect(sub).toBeDefined();
    expect(await getForecastLocations(admin(), { sub_zone_id: sub?.id ?? '', hour: 8, date: monday })).toBeNull();
    await expect(getForecastLocations(admin(), { sub_zone_id: sub?.id ?? '', hour: 24, day_group: 'weekday' })).rejects.toThrow(InvalidInputError);
    await expect(getForecastLocations(admin(), { sub_zone_id: sub?.id ?? '', hour: 8 })).rejects.toThrow(InvalidInputError);
  });
});
