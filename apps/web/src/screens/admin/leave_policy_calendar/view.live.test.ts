// SPDX-License-Identifier: AGPL-3.0-only
import { beforeEach, describe, expect, it } from 'vitest';
import type { InstallMode, Role } from '@/lib/access';
import { fixtureUsers } from '@/lib/data/go-test-reset';
import { buildContext, fixtureTenantId } from '@/lib/data/go-test-reset';
import type { RequestContext } from '@/lib/data/guard';
import { getDemoToday } from '@/lib/data/settings';
import { loadCalendarView } from './view';

// Live: skips, never fakes, if OPENDISPATCH_API_URL unset.
// Shared with other live files: counts are
// floors, exact lists are subsets.
const hasApi = process.env['OPENDISPATCH_API_URL'] !== undefined && process.env['OPENDISPATCH_API_URL'] !== '';

beforeEach(async () => {
  // Go audit events; no server is fine.
  const goUrl = process.env['OPENDISPATCH_API_URL'];
  if (goUrl) await fetch(`${goUrl}/_internal/test/reset`, { method: 'POST' }).catch(() => undefined);
});

function ctxOf(role: Role, installMode: InstallMode = 'private'): RequestContext {
  const tenant = fixtureTenantId();
  const built = buildContext({ role, installMode, zoneIds: [] }, fixtureUsers(), tenant);
  if (built === null) throw new Error(`no context for ${role}`);
  return built;
}
const admin = () => ctxOf('administrator');
const SEPTEMBER = new Date('2026-09-13T09:00:00Z');

describe.skipIf(!hasApi)('loadCalendarView (live, real api and Postgres)', () => {
  if (!hasApi) console.log('OPENDISPATCH_API_URL is not set: view.live.test.ts is skipped, not faked.');

  describe('the figures and the holidays', () => {
    it('counts the holidays, the Ramadan days, the days to National Day, and the cities, with the data source', async () => {
      const view = await loadCalendarView(admin(), {}, SEPTEMBER);
      expect(view.counts.holidays).toBeGreaterThanOrEqual(7);
      expect(view.counts).toMatchObject({ ramadanDays: 30, daysToNationalDay: 10 });
      expect(view.counts.cities).toBeGreaterThanOrEqual(3);
      expect(view.sources).toEqual(['SYNTHETIC']);
      expect(view.today).toBe('2026-09-13');
      expect(JSON.parse(JSON.stringify(view))).toEqual(view); // plain data: it can cross to the client
      expect((await loadCalendarView(admin(), {}, new Date('2026-10-01T09:00:00Z'))).counts.daysToNationalDay).toBeNull();
    });

    it('opens on the app today (demo.today), not the real date, when no day is injected', async () => {
      const today = await getDemoToday(admin());
      const view = await loadCalendarView(admin(), {});
      expect(view.today).toBe(today);
      expect(view.month).toMatchObject({ key: today.slice(0, 7), containsToday: true });
      expect(view.prayer.date).toBe(today);
    });

    it('lists the holidays by start date with their days, and filters by type and search over both names', async () => {
      const view = await loadCalendarView(admin(), {}, SEPTEMBER);
      expect(view.holidays.map((h) => h.nameEn)).toEqual(expect.arrayContaining(['Ramadan', 'Founding Day', 'Eid al-Fitr', 'Arafah Day', 'Eid al-Adha', 'Islamic New Year', 'Saudi National Day']));
      expect(view.holidays.find((h) => h.nameEn === 'Eid al-Adha')).toMatchObject({ from: '2026-05-27', to: '2026-05-30', days: 4, kind: 'public', nameAr: 'عيد الأضحى' });
      expect((await loadCalendarView(admin(), { type: 'observance' }, SEPTEMBER)).shownHolidays.map((h) => h.nameEn)).toEqual(expect.arrayContaining(['Ramadan', 'Islamic New Year']));
      expect((await loadCalendarView(admin(), { q: 'عيد' }, SEPTEMBER)).shownHolidays.length).toBeGreaterThanOrEqual(2);
      expect((await loadCalendarView(admin(), { q: 'zzz' }, SEPTEMBER)).shownHolidays).toHaveLength(0);
      expect((await loadCalendarView(admin(), {}, SEPTEMBER)).exportRows.length).toBeGreaterThanOrEqual(7);
    });

    it('opens a holiday by id, says an unknown id is unknown, and `new` is not a holiday', async () => {
      const id = (await loadCalendarView(admin(), {}, SEPTEMBER)).holidays.find((h) => h.nameEn === 'Saudi National Day')?.id;
      expect((await loadCalendarView(admin(), { holiday: id }, SEPTEMBER)).openHoliday?.nameEn).toBe('Saudi National Day');
      expect(await loadCalendarView(admin(), { holiday: '00000000-0000-4000-8000-00000000dead' }, SEPTEMBER)).toMatchObject({ openHoliday: undefined, unknownHoliday: true });
      expect(await loadCalendarView(admin(), { holiday: 'new' }, SEPTEMBER)).toMatchObject({ openHoliday: undefined, unknownHoliday: false });
    });
  });

  describe('the month', () => {
    it('draws the Gregorian month of the demo day by default, with neighbours, and today marked', async () => {
      const { month } = await loadCalendarView(admin(), {}, SEPTEMBER);
      expect(month).toMatchObject({ mode: 'gregorian', key: '2026-09', prev: '2026-08', next: '2026-10', year: 2026, month: 9, containsToday: true, span: { from: '2026-09-01', to: '2026-09-30' } });
      expect(month.weeks.flat().filter((c) => c?.today).map((c) => c?.iso)).toEqual(['2026-09-13']);
      expect(month.weeks.flat().find((c) => c?.iso === '2026-09-23')?.holiday?.name).toBe('Saudi National Day');
    });

    it('draws the month asked for, wraps the year at its ends, and falls back to the demo month for a value that is not a month', async () => {
      expect((await loadCalendarView(admin(), { month: '2026-03' }, SEPTEMBER)).month).toMatchObject({ key: '2026-03', containsToday: false });
      expect((await loadCalendarView(admin(), { month: '2026-01' }, SEPTEMBER)).month.prev).toBe('2025-12');
      expect((await loadCalendarView(admin(), { month: '2026-12' }, SEPTEMBER)).month.next).toBe('2027-01');
      expect((await loadCalendarView(admin(), { month: '2026-13' }, SEPTEMBER)).month.key).toBe('2026-09');
    });

    it('marks the Ramadan days and gives the Hijri day under each Gregorian day', async () => {
      const { month, ramadan } = await loadCalendarView(admin(), { month: '2026-03' }, SEPTEMBER);
      expect(month.weeks.flat().filter((c) => c?.ramadan)).toHaveLength(19);
      expect(month.weeks.flat().find((c) => c?.iso === '2026-03-19')?.secondary).toBe(30);
      expect(ramadan).toEqual({ hijriYear: 1447, from: '2026-02-18', to: '2026-03-19', gregorianKey: '2026-02', hijriKey: '1447-09' });
    });

    it('names a holiday on its days, in the language of the page, and never names the month of Ramadan on every day (it is the tint)', async () => {
      const names = async (locale: 'en' | 'ar') => (await loadCalendarView(admin(), { month: '2026-03', locale }, SEPTEMBER)).month.weeks.flat().flatMap((c) => (c?.holiday ? [c.holiday.name] : []));
      expect(new Set(await names('en'))).toEqual(new Set(['Eid al-Fitr']));
      expect((await names('ar')).every((name) => /[؀-ۿ]/.test(name))).toBe(true);
      expect((await names('ar')).length).toBe((await names('en')).length);
      expect((await loadCalendarView(admin(), { month: '2026-03' }, SEPTEMBER)).holidays.map((h) => h.nameEn)).toContain('Ramadan');
    });

    it('draws a Hijri month from the reference table: the Hijri month that holds the demo day by default, and any month the table has', async () => {
      const now = await loadCalendarView(admin(), { cal: 'hijri' }, SEPTEMBER);
      expect(now.month).toMatchObject({ mode: 'hijri', year: 1448, month: 4, containsToday: true, monthNameEn: expect.any(String) });
      expect(now.month.prev).toBe('1448-03');
      const ramadan = await loadCalendarView(admin(), { cal: 'hijri', month: '1447-09' }, SEPTEMBER);
      expect(ramadan.month).toMatchObject({ key: '1447-09', span: { from: '2026-02-18', to: '2026-03-19' } });
      expect(ramadan.month.weeks.flat().filter((c) => c !== null)).toHaveLength(30);
      expect((await loadCalendarView(admin(), { cal: 'hijri', month: '1447-07' }, SEPTEMBER)).month.prev).toBeNull();
      expect((await loadCalendarView(admin(), { cal: 'hijri', month: '1448-07' }, SEPTEMBER)).month.next).toBeNull();
      expect((await loadCalendarView(admin(), { cal: 'hijri', month: '1500-01' }, SEPTEMBER)).month.containsToday).toBe(true);
    });
  });

  describe('prayer times and the policy', () => {
    it('gives the prayer times of every city for the day, stored for 6 to 12 September and computed for any other day', async () => {
      const stored = (await loadCalendarView(admin(), { date: '2026-09-08' }, SEPTEMBER)).prayer;
      expect(stored).toMatchObject({ date: '2026-09-08', prev: '2026-09-07', next: '2026-09-09', storedRange: { from: '2026-09-06', to: '2026-09-12' } });
      expect(stored.rows.filter((r) => r.stored)).toHaveLength(3);
      expect(stored.rows.filter((r) => r.stored).every((r) => /^\d{2}:\d{2}$/.test(r.fajr))).toBe(true);
      const computed = (await loadCalendarView(admin(), { date: '2026-12-15' }, SEPTEMBER)).prayer;
      expect(computed.rows).toHaveLength(stored.rows.length);
      expect(computed.rows.every((r) => !r.stored)).toBe(true);
      expect((await loadCalendarView(admin(), { date: '2026-02-31' }, SEPTEMBER)).prayer.date).toBe('2026-09-13');
      expect((await loadCalendarView(admin(), {}, SEPTEMBER)).prayer.date).toBe('2026-09-13');
    });

    it('gives the leave policy with the share as a percent', async () => {
      expect((await loadCalendarView(admin(), {}, SEPTEMBER)).policy).toEqual({ minNoticeDays: 7, sharePercent: 15, blackouts: [] });
    });
  });
});
