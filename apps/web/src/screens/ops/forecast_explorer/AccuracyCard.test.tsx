// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment jsdom
import { DesignSystemProvider } from '@opendispatch/ui';
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { inLocale } from '@/components/opendispatch/test-utils';
import type { ForecastAccuracy } from '@/lib/types';
import type { AccuracyCardData } from './accuracy';
import { AccuracyCard } from './AccuracyCard';

const env = vi.hoisted(() => ({ refresh: vi.fn(), replace: vi.fn(), run: vi.fn() }));
vi.mock('@/i18n/navigation', () => ({ usePathname: () => '/ops/forecast-explorer', useRouter: () => ({ push: vi.fn(), replace: env.replace, refresh: env.refresh }) }));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams('') }));
vi.mock('./actions', () => ({ runBacktestAction: env.run, exportPlanAction: vi.fn() }));

afterEach(() => {
  cleanup();
  env.run.mockReset();
});

const intervals = Array.from({ length: 96 }, (_, i) => ({ interval_index: i, low: 0, expected: i === 36 ? 1.5 : 0, high: i === 36 ? 3 : 0, actual: i === 36 ? 1 : 0 }));
const accuracy: ForecastAccuracy = {
  dates: ['2026-09-12', '2026-09-11'],
  date: '2026-09-12',
  zone_id: 'z1',
  run: { id: '00000000-0000-4000-8000-000000000001', model_version: 'ensemble-4', created_at: '2026-09-11T02:04:00+03:00' },
  data_source: 'SYNTHETIC',
  mixed_sources: false,
  illustrative: true,
  overall: { forecast: 267, actual: 277, difference: -0.035, wape: 0.133, within_range: 1 },
  zones: [
    { zone_id: 'z1', figures: { forecast: 267, actual: 277, difference: -0.035, wape: 0.133, within_range: 1 } },
    { zone_id: 'z2', figures: { forecast: 192, actual: 187, difference: 0.025, wape: 0.143, within_range: 0.98 } },
  ],
  intervals,
};
const zones = [
  { id: 'z1', code: 'RD-C', name: 'Riyadh Central' },
  { id: 'z2', code: 'RD-N', name: 'Riyadh North' },
];
const data = (over: Partial<AccuracyCardData> = {}): AccuracyCardData => ({
  error: false,
  accuracy,
  days: [
    { value: '2026-09-12', label: 'Sat 12 Sept 2026' },
    { value: '2026-09-11', label: 'Fri 11 Sept 2026' },
  ],
  zones,
  canRun: true,
  running: false,
  sources: ['SYNTHETIC'],
  mixed: false,
  ...over,
});

function show(d: AccuracyCardData) {
  return inLocale('en', <DesignSystemProvider><AccuracyCard data={d} /></DesignSystemProvider>, { module: 'ops.forecast_explorer' });
}

describe('AccuracyCard', () => {
  it('shows the day, the figures, the run made for the day and a row per zone, Illustrative', () => {
    show(data());
    expect(screen.getByRole('heading', { name: 'Forecast against actual' })).toBeTruthy();
    expect(screen.getAllByText('Illustrative').length).toBeGreaterThan(0);
    expect((screen.getByRole('combobox', { name: 'Past day' }) as HTMLSelectElement).value).toBe('2026-09-12');
    expect(screen.getByText('13.3%', { selector: 'dd span' })).toBeTruthy();
    expect(screen.getByText(/ensemble-4/)).toBeTruthy();
    const table = screen.getByRole('table', { name: 'Forecast against actual' });
    expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Zone', 'Forecast', 'Actual', 'Difference', 'Hourly WAPE', 'Within range']);
    expect(within(table).getByText('-3.5%')).toBeTruthy();
    expect(within(table).getByText('+2.5%')).toBeTruthy();
  });

  it('shows where the forecast and the cases come from, and says when they are mixed', () => {
    show(data());
    expect(screen.getByRole('group', { name: 'Data source: Synthetic' })).toBeTruthy();
    cleanup();
    show(data({ sources: ['SYNTHETIC', 'LIVE'], mixed: true }));
    expect(screen.getByRole('group', { name: 'Data source: Mixed (Synthetic, Live data)' })).toBeTruthy();
  });

  it('changes the day in the address bar', () => {
    show(data());
    fireEvent.change(screen.getByRole('combobox', { name: 'Past day' }), { target: { value: '2026-09-11' } });
    expect(env.replace).toHaveBeenCalled();
    expect(String(env.replace.mock.calls[0]?.[0])).toContain('past=2026-09-11');
  });

  it('runs the backtest for the Administrator, and disables it with the reason otherwise or while one runs', () => {
    env.run.mockResolvedValue({ ok: true, data: { running: true } });
    show(data());
    fireEvent.click(screen.getByRole('button', { name: 'Run backtest' }));
    expect(env.run).toHaveBeenCalledWith();
    cleanup();
    env.run.mockReset();
    for (const over of [{ canRun: false }, { running: true }]) {
      show(data(over));
      const button = screen.getByRole('button', { name: 'Run backtest' });
      expect(button.getAttribute('aria-disabled')).toBe('true');
      fireEvent.click(button);
      cleanup();
    }
    expect(env.run).not.toHaveBeenCalled();
  });

  it('is empty without a past forecast, and errors with a retry', () => {
    show(data({ accuracy: { ...accuracy, dates: [], date: null, run: null, overall: null, zones: [], intervals: [] }, days: [] }));
    expect(screen.getByText('No past forecast to compare')).toBeTruthy();
    expect(screen.queryByRole('combobox', { name: 'Past day' })).toBeNull();
    cleanup();
    show(data({ error: true, accuracy: null }));
    expect(screen.getByText('The comparison could not load')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(env.refresh).toHaveBeenCalled();
  });
});
