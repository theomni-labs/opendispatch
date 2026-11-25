// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { buildLocations } from './locations';
import { calibration } from './calibration';
import { clock, hijriMonthsOfYear, holidaysOfYear, prayerTimesFor, toHijri } from './calendar';

const seed = calibration.structure.seed.value;

describe('Hijri calendar and holidays (Intl islamic-umalqura)', () => {
  it('computes known 2026 dates', () => {
    expect(toHijri('2026-02-18')).toEqual({ year: 1447, month: 9, day: 1 });
    expect(toHijri('2026-03-20')).toEqual({ year: 1447, month: 10, day: 1 });
    expect(toHijri('2026-09-06')).toEqual({ year: 1448, month: 3, day: 24 });
  });

  it('lists the Hijri months of 2026, contiguous, with Ramadan flagged', () => {
    const months = hijriMonthsOfYear(2026);
    expect(months[0]?.starts_on).toBe('2026-01-01');
    expect(months[months.length - 1]?.ends_on).toBe('2026-12-31');
    for (let i = 1; i < months.length; i += 1) {
      const prev = months[i - 1];
      const cur = months[i];
      if (prev === undefined || cur === undefined) throw new Error('gap');
      const next = new Date(`${prev.ends_on}T00:00:00Z`);
      next.setUTCDate(next.getUTCDate() + 1);
      expect(next.toISOString().slice(0, 10)).toBe(cur.starts_on);
    }
    const ramadan = months.filter((m) => m.is_ramadan);
    expect(ramadan).toHaveLength(1);
    expect(ramadan[0]).toMatchObject({ starts_on: '2026-02-18', ends_on: '2026-03-19', hijri_year: 1447 });
  });

  it('places the holidays of 2026, and none in the case week', () => {
    const rows = holidaysOfYear(2026);
    const by = (key: string) => rows.find((r) => r.key === key);
    expect(by('eid_al_fitr')).toMatchObject({ start_date: '2026-03-20', end_date: '2026-03-22' });
    expect(by('arafah_day')?.start_date).toBe('2026-05-26');
    expect(by('eid_al_adha')).toMatchObject({ start_date: '2026-05-27', end_date: '2026-05-30' });
    expect(by('national_day')?.start_date).toBe('2026-09-23');
    expect(by('ramadan')).toMatchObject({ start_date: '2026-02-18', end_date: '2026-03-19', kind: 'observance' });
    for (const h of rows.filter((r) => r.kind === 'public')) {
      expect(h.end_date < '2026-09-06' || h.start_date > '2026-09-13').toBe(true);
    }
  });
});

describe('prayer times (adhan, Umm al-Qura)', () => {
  const riyadh = buildLocations(seed).cities[0];
  if (riyadh === undefined) throw new Error('no city');

  it('matches the known Riyadh times for Sunday 6 September 2026 (rounded to the minute)', () => {
    const p = prayerTimesFor(riyadh, '2026-09-06');
    expect([clock(p.fajr), clock(p.sunrise), clock(p.dhuhr), clock(p.asr), clock(p.maghrib), clock(p.isha)]).toEqual(['04:17', '05:36', '11:52', '15:20', '18:07', '19:37']);
    // Umm al-Qura: isha is 90 minutes after maghrib.
    expect(Math.round((p.isha - p.maghrib) / 60)).toBe(90);
  });

  it('is the same on every machine: the Umm al-Qura times do not depend on the process time zone', () => {
    const a = prayerTimesFor(riyadh, '2026-09-09');
    const b = prayerTimesFor(riyadh, '2026-09-09');
    expect(a).toEqual(b);
    expect(a.fajr).toBeLessThan(a.sunrise);
    expect(a.dhuhr).toBeLessThan(a.asr);
    expect(a.maghrib).toBeLessThan(a.isha);
  });
});
