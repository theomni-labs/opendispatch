// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment jsdom
import { cleanup, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { inLocale } from '@/components/opendispatch/test-utils';
import { Figures } from './Figures';
import type { FallbackView, ReadingPanelView } from './types';

afterEach(cleanup);

const fallback: FallbackView = { active: false, reason: 'none', sinceTime: null, timeoutSeconds: 5, count: 0 };
const reading = (fromAssignment: number | null, fromRegistration: number | null, clockStart: 'assignment' | 'registration' = 'assignment'): ReadingPanelView => ({
  clockStart,
  illustrative: true,
  customer: { fromAssignment, fromRegistration },
  opendispatch: { fromAssignment: null, fromRegistration: null },
  casesCompared: 0,
  fromDate: '',
  toDate: '',
});

const render = (r: ReadingPanelView, locale: 'en' | 'ar' = 'en') =>
  inLocale(locale, <Figures waiting={1} overReach={3} reading={r} fallback={fallback} stages={[]} />, { module: 'ops.live_dispatch_board' });

describe('Figures: Within 10 min', () => {
  it('shows both clocks, the primary from the setting, with Illustrative', () => {
    render(reading(0.49, 0.25));
    expect(screen.getByText('49%')).toBeTruthy();
    expect(screen.getByText('From assignment · 25% from registration')).toBeTruthy();
    cleanup();
    render(reading(0.49, 0.25, 'registration'));
    expect(screen.getByText('25%')).toBeTruthy();
    expect(screen.getByText('From registration · 49% from assignment')).toBeTruthy();
  });

  it('shows the no-data state when there is no comparison yet, in English and Arabic', () => {
    const { container } = render(reading(null, null));
    expect(container.querySelector('[data-no-data]')?.textContent).toBe('—');
    expect(screen.getByText('No comparisons yet')).toBeTruthy();
    expect(screen.queryByText(/from registration/)).toBeNull();
    cleanup();
    render(reading(null, null), 'ar');
    expect(screen.getByText('لا توجد مقارنات بعد')).toBeTruthy();
  });
});
