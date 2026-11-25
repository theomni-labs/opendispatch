// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment jsdom
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { firstHijriDate, findMonth, HijriDateField, monthLength, toGregorian, type HijriDateValue, type HijriMonthOption } from './HijriDateField';
import { inLocale } from './test-utils';

// The Hijri date field: three Selects built from the months of the reference table (the data layer's
// listHijriMonths, 2026 only), the Gregorian date of the choice written under them through the shared formatter.

afterEach(cleanup);

const MONTHS: HijriMonthOption[] = [
  { year: 1447, month: 12, nameEn: 'Dhu al-Hijjah', nameAr: 'ذو الحجة', gregorianStart: '2026-05-18', gregorianEnd: '2026-06-15' },
  { year: 1448, month: 1, nameEn: 'Muharram', nameAr: 'محرم', gregorianStart: '2026-06-16', gregorianEnd: '2026-07-14' },
  { year: 1448, month: 2, nameEn: 'Safar', nameAr: 'صفر', gregorianStart: '2026-07-15', gregorianEnd: '2026-08-12' },
  { year: 1448, month: 4, nameEn: "Rabi' al-thani", nameAr: 'ربيع الآخر', gregorianStart: '2026-09-12', gregorianEnd: '2026-10-11' },
];
const labels = { day: 'Day', month: 'Month', year: 'Year', caption: (date: string) => `Same day: ${date}` };

describe('the helpers', () => {
  it('know the length of a month, find a month, and convert a Hijri day with the table', () => {
    expect(monthLength(MONTHS[0] as HijriMonthOption)).toBe(29);
    expect(monthLength(MONTHS[1] as HijriMonthOption)).toBe(29);
    expect(monthLength(MONTHS[3] as HijriMonthOption)).toBe(30);
    expect(findMonth(MONTHS, { year: 1448, month: 4, day: 1 })?.nameEn).toBe("Rabi' al-thani");
    expect(findMonth(MONTHS, { year: 1448, month: 9, day: 1 })).toBeUndefined();
    expect(toGregorian(MONTHS, { year: 1448, month: 4, day: 12 })).toBe('2026-09-23');
    expect(toGregorian(MONTHS, { year: 1447, month: 12, day: 30 })).toBeNull();
    expect(toGregorian(MONTHS, { year: 1500, month: 1, day: 1 })).toBeNull();
    expect(firstHijriDate(MONTHS)).toEqual({ year: 1447, month: 12, day: 1 });
    expect(firstHijriDate([])).toBeNull();
  });
});

function Harness({ start, locale }: { start: HijriDateValue; locale?: 'en' | 'ar' }) {
  const [value, setValue] = useState(start);
  return (
    <>
      <HijriDateField legend={locale === 'ar' ? 'من' : 'From'} months={MONTHS} value={value} onChange={setValue} labels={labels} />
      <output data-testid="value">{`${value.year}-${value.month}-${value.day}`}</output>
    </>
  );
}
const current = () => screen.getByTestId('value').textContent;

describe('the field', () => {
  it('offers the years, the months of the chosen year and the days of the chosen month, named for a screen reader', () => {
    inLocale('en', <Harness start={{ year: 1448, month: 4, day: 12 }} />);
    const years = screen.getByLabelText('From: Year') as HTMLSelectElement;
    const months = screen.getByLabelText('From: Month') as HTMLSelectElement;
    const days = screen.getByLabelText('From: Day') as HTMLSelectElement;
    expect([...years.options].map((o) => o.value)).toEqual(['1447', '1448']);
    expect([...months.options].map((o) => o.textContent)).toEqual(['Muharram', 'Safar', "Rabi' al-thani"]);
    expect(days.options).toHaveLength(30);
    expect(screen.getByText('Same day: 23 Sept 2026')).toBeTruthy();
  });

  it('a year change keeps the month when that year has it, else goes to its first month; a month change clamps the day', () => {
    inLocale('en', <Harness start={{ year: 1448, month: 4, day: 30 }} />);
    fireEvent.change(screen.getByLabelText('From: Month'), { target: { value: '2' } });
    expect(current()).toBe('1448-2-29');
    fireEvent.change(screen.getByLabelText('From: Year'), { target: { value: '1447' } });
    expect(current()).toBe('1447-12-29');
    fireEvent.change(screen.getByLabelText('From: Year'), { target: { value: '1448' } });
    expect(current()).toBe('1448-1-29');
  });

  it('shows the Gregorian date of the choice and updates it', () => {
    inLocale('en', <Harness start={{ year: 1448, month: 1, day: 1 }} />);
    expect(screen.getByText(/^Same day: 16 June? 2026$/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('From: Day'), { target: { value: '15' } });
    expect(screen.getByText(/^Same day: 30 June? 2026$/)).toBeTruthy();
  });

  it('writes month names in Arabic in an Arabic page, and the Gregorian date with Western digits', () => {
    inLocale('ar', <Harness start={{ year: 1448, month: 1, day: 1 }} locale="ar" />);
    expect([...(screen.getByLabelText('من: Month') as HTMLSelectElement).options].map((o) => o.textContent)).toEqual(['محرم', 'صفر', 'ربيع الآخر']);
    const caption = screen.getByText(/Same day/);
    expect(caption.textContent).toMatch(/2026/);
    expect(caption.textContent).not.toMatch(/[٠-٩]/);
    // The line is text in the page's language and direction: not marked as data (translate="no") and not forced left to right.
    expect([caption.tagName, caption.hasAttribute('dir'), caption.hasAttribute('translate'), caption.querySelector('[dir], [translate]')]).toEqual(['P', false, false, null]);
  });

  it('is disabled as a group, and ignores a value that is not a number', () => {
    const onChange = vi.fn();
    inLocale('en', <HijriDateField legend="From" months={MONTHS} value={{ year: 1448, month: 1, day: 1 }} onChange={onChange} labels={labels} disabled />);
    expect((screen.getByLabelText('From: Day') as HTMLSelectElement).matches(':disabled')).toBe(true);
    cleanup();
    inLocale('en', <HijriDateField legend="From" months={MONTHS} value={{ year: 1448, month: 1, day: 1 }} onChange={onChange} labels={labels} />);
    fireEvent.change(screen.getByLabelText('From: Month'), { target: { value: '9' } });
    expect(onChange).not.toHaveBeenCalled();
  });
});
