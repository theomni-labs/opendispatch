// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment jsdom
import { DesignSystemProvider } from '@opendispatch/ui';
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { inLocale } from '@/components/opendispatch/test-utils';
import type { RollingAccuracyFigures, RollingForecastAccuracy } from '@/lib/types';
import { RollingAccuracyCard } from './RollingAccuracyCard';
import { accuracyRows, type RollingAccuracyCardData } from './rollingAccuracy';

const env = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('@/i18n/navigation', () => ({ usePathname: () => '/admin/forecast-model', useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: env.refresh }) }));

afterEach(() => {
  cleanup();
  env.refresh.mockReset();
});

const fig = (mape: number | null, wape: number | null, actual: number): RollingAccuracyFigures => ({
  days: 28,
  forecast: actual,
  actual,
  mape,
  wape,
  target_status: mape === null ? null : mape <= 0.15 ? 'at_or_below' : 'above',
});
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const state = (over: Partial<RollingForecastAccuracy> = {}): RollingForecastAccuracy => ({
  window_days: 28,
  window_start: '2026-08-16',
  window_end: '2026-09-12',
  computed_at: '2026-09-13T02:05:00+03:00',
  mape_target: 0.15,
  data_source: 'SYNTHETIC',
  data_sources: ['SYNTHETIC'],
  mixed_sources: false,
  illustrative: true,
  overall: fig(0.138, 0.112, 31840),
  zones: [
    { zone_id: 'z1', figures: fig(0.124, 0.101, 9450) },
    { zone_id: 'z2', figures: fig(0.169, 0.137, 1740) },
  ],
  hours: [
    { hour: 3, figures: fig(0.262, 0.213, 300) },
    { hour: 9, figures: fig(null, null, 0) },
  ],
  weekdays: [{ weekday: 4, figures: fig(0.156, 0.126, 4100) }],
  ...over,
});
const data = (over: Partial<RollingAccuracyCardData> = {}): RollingAccuracyCardData => ({ state: state(), error: false, zoneNames: { z1: 'Riyadh Central', z2: 'Jeddah South' }, weekdays: WEEKDAYS, ...over });

function show(d: RollingAccuracyCardData) {
  return inLocale('en', <DesignSystemProvider><RollingAccuracyCard data={d} /></DesignSystemProvider>, { module: 'admin.forecast_model' });
}

describe('RollingAccuracyCard', () => {
  it('shows the window figures, Illustrative, the source and the status in words, by zone first', () => {
    show(data());
    expect(screen.getByRole('heading', { name: 'Accuracy, rolling 28 days' })).toBeTruthy();
    expect(screen.getAllByText('Illustrative').length).toBeGreaterThanOrEqual(3);
    expect(screen.getByText('13.8%')).toBeTruthy();
    expect(screen.getByText('11.2%')).toBeTruthy();
    expect(screen.getByText('15% or less')).toBeTruthy();
    expect(screen.getByText('28 days measured')).toBeTruthy();
    expect(document.querySelector('[data-badge="SYNTHETIC"]')).not.toBeNull();
    const table = screen.getByRole('table');
    expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Zone', 'MAPE', 'WAPE', 'Against target', 'Cases']);
    expect(within(table).getByText('Riyadh Central')).toBeTruthy();
    expect(within(table).getByText('Above target')).toBeTruthy();
    expect(screen.getAllByText('At or below target').length).toBe(2);
  });

  it('switches to hour of day and day of week', () => {
    show(data());
    fireEvent.click(screen.getByRole('radio', { name: 'Hour of day' }));
    const hours = screen.getByRole('table');
    expect(within(hours).getAllByRole('columnheader')[0]?.textContent).toBe('Hour');
    expect(within(hours).getByText('03:00')).toBeTruthy();
    expect(within(hours).getByText('No cases')).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: 'Day of week' }));
    expect(within(screen.getByRole('table')).getByText('Thursday')).toBeTruthy();
  });

  it('names every source when they mix, and drops Illustrative on Customer data', () => {
    show(data({ state: state({ data_source: 'LIVE', data_sources: ['IMPORTED', 'LIVE'], mixed_sources: true, illustrative: false }) }));
    expect(screen.queryByText('Illustrative')).toBeNull();
    expect(document.querySelector('[data-badge="MIXED"]')).not.toBeNull();
  });

  it('has an empty state before the first window and an error state with a retry', () => {
    show(data({ state: state({ window_start: null, window_end: null, computed_at: null, overall: null, zones: [], hours: [], weekdays: [], data_sources: [] }) }));
    expect(screen.getByText('No accuracy yet')).toBeTruthy();
    cleanup();
    show(data({ state: null, error: true }));
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(env.refresh).toHaveBeenCalled();
  });

  it('is hidden when the read is forbidden', () => {
    const { container } = show(data({ state: null, error: false }));
    expect(container.textContent).toBe('');
  });

  it('builds the rows of each breakdown', () => {
    const d = data();
    expect(accuracyRows(d, 'zone').map((r) => r.label)).toEqual(['Riyadh Central', 'Jeddah South']);
    expect(accuracyRows(d, 'hour').map((r) => r.minutes)).toEqual([180, 540]);
    expect(accuracyRows(d, 'weekday').map((r) => r.label)).toEqual(['Thursday']);
    expect(accuracyRows(data({ state: null }), 'zone')).toEqual([]);
  });
});
