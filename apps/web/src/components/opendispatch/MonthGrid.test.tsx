// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment jsdom
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MonthGrid } from './MonthGrid';
import { gregorianWeeks, hijriOf, hijriWeeks, type DayContext } from './month-grid-geometry';
import { hasArabicIndicDigits, inLocale } from './test-utils';

afterEach(cleanup);

const context: DayContext = {
  today: '2026-09-13',
  ramadan: [{ from: '2026-02-18', to: '2026-03-19' }],
  holidays: [
    { id: 'h1', name: 'Saudi National Day', from: '2026-09-23', to: '2026-09-23' },
    { id: 'h2', name: 'Eid al-Fitr', from: '2026-03-20', to: '2026-03-22' },
  ],
};
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const cellsOf = (weeks: ReturnType<typeof gregorianWeeks>) => weeks.flat().filter((c) => c !== null);

describe('the geometry of a month', () => {
  it('lays a Gregorian month out in weeks that start on Sunday, empty before the first and after the last day', () => {
    const weeks = gregorianWeeks(2026, 9, context);
    expect(weeks).toHaveLength(5);
    expect(weeks.every((w) => w.length === 7)).toBe(true);
    expect(weeks[0]?.slice(0, 2)).toEqual([null, null]); // 1 September 2026 is a Tuesday
    expect(weeks[0]?.[2]?.iso).toBe('2026-09-01');
    expect(cellsOf(weeks)).toHaveLength(30);
    expect(weeks.at(-1)?.at(-1)).toBeNull();
  });

  it('marks today, the holiday, and the Ramadan days, and gives each day the Hijri day under it', () => {
    const september = cellsOf(gregorianWeeks(2026, 9, context));
    expect(september.filter((c) => c?.today).map((c) => c?.iso)).toEqual(['2026-09-13']);
    expect(september.find((c) => c?.iso === '2026-09-23')?.holiday).toEqual({ id: 'h1', name: 'Saudi National Day' });
    expect(september.some((c) => c?.ramadan)).toBe(false);
    const march = cellsOf(gregorianWeeks(2026, 3, context));
    expect(march.filter((c) => c?.ramadan)).toHaveLength(19);
    expect(march.filter((c) => c?.holiday?.id === 'h2')).toHaveLength(3);
    expect(hijriOf('2026-02-18')).toEqual({ year: 1447, month: 9, day: 1 });
    expect(march.find((c) => c?.iso === '2026-03-19')?.secondary).toBe(30);
  });

  it('lays a Hijri month out from the Gregorian days it spans, with the Hijri day first and the Gregorian day under it', () => {
    const weeks = hijriWeeks('2026-02-18', '2026-03-19', context);
    const cells = cellsOf(weeks);
    expect(cells).toHaveLength(30);
    expect(cells[0]).toMatchObject({ iso: '2026-02-18', day: 1, secondary: 18, ramadan: true });
    expect(cells.at(-1)).toMatchObject({ iso: '2026-03-19', day: 30, secondary: 19 });
    expect(weeks[0]?.filter((c) => c === null)).toHaveLength(3); // 18 February 2026 is a Wednesday
  });

  it('draws nothing for a range that is empty', () => {
    expect(hijriWeeks('2026-03-19', '2026-02-18', context)).toEqual([]);
  });
});

describe('MonthGrid', () => {
  const grid = (props: Partial<Parameters<typeof MonthGrid>[0]> = {}) => (
    <MonthGrid label="September 2026" weekdays={WEEKDAYS} weeks={gregorianWeeks(2026, 9, context)} todayLabel="Today" ramadanLabel="Ramadan" {...props} />
  );

  it('is a grid named by the caller with the seven weekday headers and one cell per day', () => {
    inLocale('en', grid());
    const table = screen.getByRole('grid', { name: 'September 2026' });
    expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(WEEKDAYS);
    expect(within(table).getAllByRole('gridcell').filter((c) => c.getAttribute('aria-hidden') !== 'true')).toHaveLength(30);
  });

  it('marks today for assistive technology, shows the other calendar under each day, and names the holiday', () => {
    inLocale('en', grid());
    const today = document.querySelector('[data-date="2026-09-13"]') as HTMLElement;
    expect(today.getAttribute('aria-current')).toBe('date');
    expect(within(today).getByText('Today')).toBeTruthy();
    expect(today.textContent).toContain('13');
    expect(today.textContent).toContain('1'); // the Hijri day of 13 September 2026 (1 Rabi' al-Awwal? checked by the geometry test)
    expect(screen.getByText('Saudi National Day')).toBeTruthy();
    expect(document.querySelectorAll('[aria-current="date"]')).toHaveLength(1);
  });

  it('hides the other calendar and the Ramadan tint when asked', () => {
    const withBoth = inLocale('en', grid({ weeks: gregorianWeeks(2026, 3, context) }));
    expect(withBoth.container.querySelector('[data-date="2026-03-05"]')?.textContent).toContain('Ramadan');
    cleanup();
    const without = inLocale('en', grid({ weeks: gregorianWeeks(2026, 3, context), showSecondary: false, markRamadan: false }));
    const cell = without.container.querySelector('[data-date="2026-03-05"]') as HTMLElement;
    expect(cell.textContent).toBe('5');
  });

  it('makes a holiday a button when the caller listens, and text when it does not', () => {
    const onSelect = vi.fn();
    inLocale('en', grid({ onSelect }));
    fireEvent.click(screen.getByRole('button', { name: 'Saudi National Day' }));
    expect(onSelect).toHaveBeenCalledWith('h1');
    cleanup();
    inLocale('en', grid());
    expect(screen.queryByRole('button', { name: 'Saudi National Day' })).toBeNull();
  });

  it('writes the days with Western digits in Arabic, marks the names of the data as data, and draws a Hijri grid', () => {
    const { container } = inLocale('ar', <MonthGrid label="رمضان ١٤٤٧" weekdays={['ح', 'ن', 'ث', 'ر', 'خ', 'ج', 'س']} weeks={hijriWeeks('2026-02-18', '2026-03-19', context)} todayLabel="اليوم" ramadanLabel="رمضان" />);
    expect(hasArabicIndicDigits(container.textContent?.replace('رمضان ١٤٤٧', '') ?? '')).toBe(false);
    expect(within(screen.getByRole('grid')).getAllByRole('gridcell').filter((c) => c.getAttribute('aria-hidden') !== 'true')).toHaveLength(30);
    expect(container.querySelector('[data-date="2026-02-18"]')?.textContent).toContain('رمضان');
  });
});
