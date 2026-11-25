// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment jsdom
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ShadowComparisonList, type ShadowComparisonRow } from './ShadowComparisonList';
import { hasArabicIndicDigits, hasLatinLetters, inLocale, readableText } from './test-utils';

afterEach(cleanup);

const ROWS: ShadowComparisonRow[] = [
  {
    id: '1',
    caseNumber: '00005',
    zone: 'RD-E',
    time: '00:10',
    opendispatchName: 'Khalid Al-Lahani',
    opendispatchMinutes: 5,
    customerName: 'Noura Al-Shaami',
    customerMinutes: 17,
    same: false,
  },
  {
    id: '2',
    caseNumber: '00043',
    zone: 'RD-S',
    time: '03:29',
    opendispatchName: 'Nasser Al-Kalahi',
    opendispatchMinutes: 13,
    customerName: 'Nasser Al-Kalahi',
    customerMinutes: 15,
    same: true,
  },
];

describe('ShadowComparisonList', () => {
  it('shows OpenDispatch’s choice beside Customer’s actual choice, one row per case', () => {
    const { container } = inLocale('en', <ShadowComparisonList rows={ROWS} />);
    expect(container.querySelector('ul')?.getAttribute('role')).toBe('list');
    expect(screen.getByText('00005')).toBeTruthy();
    expect(screen.getByText('Khalid Al-Lahani')).toBeTruthy();
    expect(screen.getByText('Noura Al-Shaami')).toBeTruthy();
    expect(screen.getByText('Different')).toBeTruthy();
    expect(screen.getByText('Same')).toBeTruthy();
  });

  it('names each side for assistive technology, even though the label is visual only on a narrow screen', () => {
    inLocale('en', <ShadowComparisonList rows={[ROWS[0] as ShadowComparisonRow]} />);
    expect(screen.getAllByText('OpenDispatch').length).toBeGreaterThan(0);
    expect(screen.getByText('Operator')).toBeTruthy();
  });

  it('shows a column header that a sighted reader can use, hidden from assistive technology', () => {
    const { container } = inLocale('en', <ShadowComparisonList rows={ROWS} />);
    const head = container.querySelector('li[aria-hidden="true"]');
    expect(head).not.toBeNull();
    expect(head?.textContent).toContain('OpenDispatch choice');
    expect(head?.textContent).toContain('Operator actual');
  });

  it('shows a loading state with no rows', () => {
    const { container } = inLocale('en', <ShadowComparisonList rows={[]} state="loading" />);
    expect(screen.getByRole('status').getAttribute('aria-busy')).toBe('true');
    expect(container.querySelectorAll('li')).toHaveLength(0);
  });

  it('shows an error state, with a retry when one is given', () => {
    const onRetry = vi.fn();
    inLocale('en', <ShadowComparisonList rows={[]} state="error" onRetry={onRetry} />);
    expect(screen.getByText('The comparison could not be loaded')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('shows an empty state when there is nothing to compare', () => {
    inLocale('en', <ShadowComparisonList rows={[]} />);
    expect(screen.getByText('No cases compared yet')).toBeTruthy();
  });

  it('renders Arabic with Western digits and the names and codes left alone', () => {
    const { container } = inLocale('ar', <ShadowComparisonList rows={ROWS} />);
    expect(screen.getByText('نفسه')).toBeTruthy();
    expect(screen.getByText('مختلف')).toBeTruthy();
    expect(hasArabicIndicDigits(readableText(container))).toBe(false);
    expect(
      hasLatinLetters(readableText(container), [
        '00005',
        '00043',
        'RD-E',
        'RD-S',
        'Khalid Al-Lahani',
        'Noura Al-Shaami',
        'Nasser Al-Kalahi',
        'OPENDISPATCH',
        'OpenDispatch',
      ]),
    ).toBe(false);
  });
});
