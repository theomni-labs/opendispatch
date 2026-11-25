// SPDX-License-Identifier: AGPL-3.0-only
import { beforeEach, describe, expect, it } from 'vitest';
import type { InstallMode, Role } from '@/lib/access';
import { buildContext, fixtureTenantId } from '@/lib/data/go-test-reset';
import { ForbiddenError } from '@/lib/data/errors';
import type { RequestContext } from '@/lib/data/guard';
import { createCity, listZones, updateCity } from '@/lib/data/locations';
import { updateLocalizationSettings } from '@/lib/data/system';
import { DEFAULT_SETTINGS } from './types';
import { loadLocalizationView } from './view';
import { fixtureUsers, resetGoTestState } from '@/lib/data/go-test-reset';

// Live: skips, never fakes, if OPENDISPATCH_API_URL unset.
// Shared with other live files: exact counts of
// locations/shifts/breaks/holidays become floors.
const hasApi = process.env['OPENDISPATCH_API_URL'] !== undefined && process.env['OPENDISPATCH_API_URL'] !== '';
if (!hasApi) console.log('OPENDISPATCH_API_URL is not set: view.live.test.ts is skipped, not faked.');

// The server side of the screen against the real data layer and the committed fixtures (3 cities, 8 zones, 124 sub-zones, 32 standby
// points, 3 case types, 6 shift patterns, 2 break rules, 7 holidays), with the demo store in a temp folder.
beforeEach(async () => {
  await resetGoTestState();
});

function ctxOf(role: Role, installMode: InstallMode = 'private'): RequestContext {
  const tenant = fixtureTenantId();
  const built = buildContext({ role, installMode, zoneIds: [] }, fixtureUsers(), tenant);
  if (built === null) throw new Error(`no context for ${role}`);
  return built;
}
const admin = () => ctxOf('administrator');
// A random two-letter case_code: avoids collisions with fixtures.
function randomCityCode(): string {
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let code: string;
  do {
    code = `${letters[Math.floor(Math.random() * 26)]}${letters[Math.floor(Math.random() * 26)]}`;
  } while (['RD', 'JD', 'DM'].includes(code));
  return code;
}

describe.skipIf(!hasApi)('loadLocalizationView (live, real api and Postgres)', () => {
  describe('the settings and the coverage', () => {
    it('reads the stored settings: the defaults of the fixtures', async () => {
      const view = await loadLocalizationView(admin());
      expect(view.settings).toEqual(DEFAULT_SETTINGS);
      expect(view.sources).toEqual(['SYNTHETIC']);
    });

    it('follows a change of the settings', async () => {
      const ctx = admin();
      await updateLocalizationSettings(ctx, { default_locale: 'ar', digit_system: 'arabic_indic', primary_calendar: 'hijri', show_secondary_calendar: false, time_zone: 'Asia/Riyadh', first_day_of_week: 'saturday' });
      expect((await loadLocalizationView(ctx)).settings).toEqual({ default_locale: 'ar', digit_system: 'arabic_indic', primary_calendar: 'hijri', show_secondary_calendar: false, first_day_of_week: 'saturday' });
    });

    it('counts the records of the eight kinds and how many have an Arabic name (the fixtures have Arabic for the holidays and the shift patterns)', async () => {
      const { coverage } = await loadLocalizationView(admin());
      // api-backed schemas are shared: floors, not exacts.
      const locationRows = coverage.slice(0, 4);
      expect(locationRows.map((row) => row.kind)).toEqual(['cities', 'zones', 'subzones', 'standby']);
      for (const [row, min] of [[locationRows[0], 3], [locationRows[1], 8], [locationRows[2], 124], [locationRows[3], 32]] as const) {
        expect(row?.records ?? 0).toBeGreaterThanOrEqual(min);
      }
      const other = new Map(coverage.slice(4).map((row) => [row.kind, row] as const));
      expect([...other.keys()]).toEqual(['casetypes', 'shifts', 'breaks', 'holidays']);
      expect(other.get('casetypes')).toMatchObject({ records: 3, arabic: 0 });
      expect(other.get('shifts')?.records).toBeGreaterThanOrEqual(6);
      expect(other.get('shifts')?.arabic).toBe(6); // amendment: shift patterns carry a draft Arabic name
      expect(other.get('breaks')?.records).toBeGreaterThanOrEqual(2);
      expect(other.get('breaks')?.arabic).toBe(0);
      expect(other.get('holidays')?.records).toBeGreaterThanOrEqual(7);
      expect(other.get('holidays')?.arabic).toBeGreaterThanOrEqual(7);
    });

    it('counts an Arabic name added through the Locations module, and ignores a blank one', async () => {
      const ctx = admin();
      const before = (await loadLocalizationView(ctx)).coverage[0]!;
      const codeA = randomCityCode();
      const codeB = randomCityCode();
      const city = await createCity(ctx, { case_code: codeA, name_en: 'Tabuk', name_ar: 'تبوك' });
      await createCity(ctx, { case_code: codeB, name_en: 'Hail', name_ar: '   ' });
      let view = await loadLocalizationView(ctx);
      expect(view.coverage[0]).toMatchObject({ kind: 'cities', records: before.records + 2, arabic: before.arabic + 1 });
      await updateCity(ctx, city.id, { case_code: codeA, name_en: 'Tabuk', name_ar: null });
      view = await loadLocalizationView(ctx);
      expect(view.coverage[0]).toMatchObject({ records: before.records + 2, arabic: before.arabic });
    });

    it('samples a zone, a case type and a holiday for the fallback preview: English where Arabic is empty, Arabic where it exists', async () => {
      const { samples } = await loadLocalizationView(admin());
      expect(samples).toHaveLength(3);
      // The zone sample is the first with no Arabic name.
      const zones = (await listZones(admin(), { limit: 200 })).items;
      expect(zones.map((z) => z.name_en)).toContain(samples[0]?.english);
      expect(samples[0]?.arabic).toBeNull();
      expect(samples[1]?.arabic).toBeNull();
      expect(samples[2]?.arabic).toMatch(/[؀-ۿ]/);
    });
  });

  describe('roles', () => {
    it('reads for the Administrator in every install mode and refuses every other role', async () => {
      for (const mode of ['private', 'dedicated', 'shared'] as const) await expect(loadLocalizationView(ctxOf('administrator', mode)), mode).resolves.toBeDefined();
      for (const role of ['dispatch_supervisor', 'dispatcher', 'planner', 'remote_team_lead', 'viewer_auditor', 'change_approver'] as const) await expect(loadLocalizationView(ctxOf(role)), role).rejects.toBeInstanceOf(ForbiddenError);
    });
  });
});
