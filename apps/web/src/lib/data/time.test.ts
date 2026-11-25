// SPDX-License-Identifier: AGPL-3.0-only
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { listAuditEvents } from './audit';
import { ForbiddenError, InvalidInputError } from './errors';
import { fixtureRecords } from './internal/fixtures';
import { ctxFor, expectValid, expectValidItems, withTempDemoState } from './test-support';
import { listZones } from './locations';
import { getLeavePolicy, listHijriMonths, listPrayerTimes, recomputePrayerTimes, updateLeavePolicy } from './time';
import { resetGoTestState } from './go-test-reset';
import type { City, HijriMonth, PrayerTime } from '@/lib/types';

withTempDemoState();
beforeEach(resetGoTestState);

const admin = () => ctxFor('administrator');
const cities = () => fixtureRecords<City>('City');

// Shifts, breaks, holidays: see time.live.test.ts.

describe('Hijri months and Ramadan', () => {
  it('lists the fixtures with is_ramadan, and filters by range', async () => {
    const all = await listHijriMonths(admin());
    expect(all.items).toHaveLength(fixtureRecords<HijriMonth>('HijriMonth').length);
    expectValid('HijriMonthList', all);
    expect((await listHijriMonths(admin(), { date_from: '2026-02-18', date_to: '2026-03-19' })).items.some((m) => m.is_ramadan)).toBe(true);
    await expect(listHijriMonths(ctxFor('change_approver'))).rejects.toThrow(ForbiddenError);
  });
});

describe('prayer times', () => {
  it('serves the committed fixture week unchanged', async () => {
    const list = await listPrayerTimes(admin());
    expect(list.items).toHaveLength(fixtureRecords<PrayerTime>('PrayerTime').length);
    expectValid('PrayerTimeList', list);
  });

  it('computes any other date with adhan and matches the committed week to the minute', async () => {
    for (const city of cities()) {
      const committed = fixtureRecords<PrayerTime>('PrayerTime').filter((p) => p.city_id === city.id);
      const recomputed = (await listPrayerTimes(admin(), { city_id: city.id, date_from: '2026-09-06', date_to: '2026-09-12' })).items;
      expect(recomputed).toHaveLength(7);
      // Fixtures win over computed values inside the committed week, so compare a forced recompute as well.
      const forced = (await recomputePrayerTimes(admin(), { city_id: city.id, date_from: '2026-09-06', date_to: '2026-09-12' })).items;
      for (const row of forced) {
        const was = committed.find((c) => c.prayer_date === row.prayer_date)!;
        expect({ f: row.fajr, s: row.sunrise, d: row.dhuhr, a: row.asr, m: row.maghrib, i: row.isha }).toEqual({ f: was.fajr, s: was.sunrise, d: was.dhuhr, a: was.asr, m: was.maghrib, i: was.isha });
      }
    }
  });

  it('computes a date outside the fixtures without storing it', async () => {
    const riyadh = cities()[0]!;
    const list = await listPrayerTimes(admin(), { city_id: riyadh.id, date_from: '2026-10-01', date_to: '2026-10-02' });
    expect(list.items).toHaveLength(2);
    expectValidItems('PrayerTime', list.items);
    expect(list.items[0]!.fajr < list.items[0]!.dhuhr).toBe(true);
    expect((await listPrayerTimes(admin())).items).toHaveLength(fixtureRecords<PrayerTime>('PrayerTime').length);
  });

  it('stores recomputed times, audited, and refuses other roles', async () => {
    const before = (await listPrayerTimes(admin())).page.total;
    const cityCount = new Set((await listZones(admin(), { limit: 200 })).items.map((z) => z.city_id)).size;
    const out = await recomputePrayerTimes(admin(), { date_from: '2026-11-01', date_to: '2026-11-02' });
    expect(out.items).toHaveLength(cityCount * 2);
    expectValid('PrayerTimeList', out);
    expect((await listPrayerTimes(admin())).page.total).toBe((before ?? 0) + cityCount * 2);
    expect((await listAuditEvents(admin(), { action: 'prayer_times.recomputed' })).items).toHaveLength(1);
    await expect(recomputePrayerTimes(ctxFor('planner'), { date_from: '2026-11-01', date_to: '2026-11-02' })).rejects.toThrow(ForbiddenError);
    await expect(recomputePrayerTimes(admin(), { date_from: '2026-11-05', date_to: '2026-11-01' })).rejects.toThrow(InvalidInputError);
  });
});

describe('leave policy', () => {
  it('has a default, validates updates, and persists across a fresh module instance', async () => {
    const initial = await getLeavePolicy(admin());
    expectValid('LeavePolicy', initial);
    expect(initial.min_notice_days).toBe(7);
    const policy = await updateLeavePolicy(admin(), { min_notice_days: 14, max_concurrent_leave_share: 0.1, blackout_periods: [{ start_date: '2026-09-23', end_date: '2026-09-24', label_en: 'National Day' }] });
    expectValid('LeavePolicy', policy);
    await expect(updateLeavePolicy(admin(), { min_notice_days: -1, max_concurrent_leave_share: 0.1, blackout_periods: [] })).rejects.toThrow(InvalidInputError);
    await expect(updateLeavePolicy(ctxFor('planner'), policy)).rejects.toThrow(ForbiddenError);
    vi.resetModules();
    const fresh = await import('./time');
    expect((await fresh.getLeavePolicy(admin())).min_notice_days).toBe(14);
  });
});
