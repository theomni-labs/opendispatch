// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment jsdom
import { DesignSystemProvider } from '@opendispatch/ui';
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { inLocale } from '@/components/opendispatch/test-utils';
import type { ForecastBacktest, ForecastBacktestState } from '@/lib/types';
import { BacktestCard } from './BacktestCard';
import type { BacktestCardData } from './backtest';

const env = vi.hoisted(() => ({ refresh: vi.fn(), start: vi.fn() }));
vi.mock('@/i18n/navigation', () => ({ usePathname: () => '/admin/forecast-model', useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: env.refresh }) }));
vi.mock('./actions', () => ({ startBacktest: env.start }));

afterEach(() => {
  cleanup();
  env.start.mockReset();
});

const arm = (wape: number, mape: number) => ({ wape, mape, mae: 2.6, rmse: 4.1, range_coverage: null });
const hours = Array.from({ length: 24 }, (_, hour) => ({ hour, wape: 0.2 + hour / 100, baseline_wape: 0.25 }));
const zone = (id: string, wape: number, base: number, cases: number) => ({ zone_id: id, wape, baseline_wape: base, actual_total: cases, hours });

const latest: ForecastBacktest = {
  generated_at: '2026-09-13T02:00:00+03:00',
  data_source: 'SYNTHETIC',
  mixed_sources: false,
  illustrative: true,
  model_version: 'ensemble-4',
  held_out: { from: '2026-08-16', to: '2026-09-12', days: 28 },
  training: { from: '2025-01-01', to: '2026-08-15', features: 9 },
  gate: { result: 'pass', baseline: 'segment', min_improvement: 0.1, improvement: 0.132, worse_zones: 1, compared_zones: 8 },
  engine: { ...arm(0.184, 0.241), range_coverage: 0.91 },
  naive: arm(0.229, 0.306),
  segment: arm(0.212, 0.279),
  event_days: { days: 2, wape: 0.312, baseline_wape: 0.41 },
  ordinary_days: { days: 26, wape: 0.158, baseline_wape: 0.197 },
  weakest_zones: [zone('z1', 0.33, 0.334, 64), zone('z2', 0.314, 0.36, 412), zone('z3', 0.279, 0.295, 530), zone('z4', 0.262, 0.251, 288), zone('z5', 0.248, 0.302, 1104), zone('z6', 0.239, 0.288, 356)],
  challenger: { champion: 'ensemble-4', challenger: 'ensemble-5', challenger_ran: 'ensemble-5', gate_result: 'fail', champion_wape: 0.184, challenger_wape: 0.188, wape_lift: -0.022, champion_mape: 0.241, challenger_mape: 0.244, mape_lift: -0.012, error: null },
};
const names = { z1: 'Jeddah West', z2: 'Jeddah South', z3: 'Riyadh West', z4: 'Dammam East', z5: 'Riyadh East', z6: 'Makkah Central' };
const state = (over: Partial<ForecastBacktestState> = {}): ForecastBacktestState => ({ latest, run: { state: 'idle' }, active_model: 'ensemble-4', ...over });

function show(data: BacktestCardData, canEdit = true, mapeTarget: number | null = null, locale: 'en' | 'ar' = 'en') {
  return inLocale(locale, <DesignSystemProvider><BacktestCard data={data} canEdit={canEdit} mapeTarget={mapeTarget} /></DesignSystemProvider>, { module: 'admin.forecast_model' });
}

describe('BacktestCard', () => {
  it('shows the gate, the measures against both baselines, the challenger, the day types and the weakest zones', () => {
    const { container } = show({ state: state(), error: false, zoneNames: names });
    expect(screen.getByText('Pass bar met')).toBeTruthy();
    expect(screen.getByText('Pass bar')).toBeTruthy();
    expect(screen.getAllByText('Illustrative').length).toBeGreaterThan(0);
    expect(screen.getByText('13.2% better than baseline')).toBeTruthy();
    expect(screen.getByText("10% better than the customer's method")).toBeTruthy();
    const measures = screen.getByRole('table', { name: 'Error against baseline' });
    expect(within(measures).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Measure', 'Model', 'Same hour last week', "Customer's method", 'Change']);
    expect(within(measures).getByText('MAPE')).toBeTruthy();
    expect(within(measures).getByText('24.1%')).toBeTruthy();
    expect(within(measures).getByText('91%')).toBeTruthy();
    const chall = screen.getByRole('table', { name: 'Challenger ensemble-5' });
    expect(within(chall).getByText('-2.2%')).toBeTruthy();
    expect(screen.getByText('Pass bar missed')).toBeTruthy();
    const weakest = screen.getByRole('table', { name: 'Weakest locations' });
    expect(within(weakest).getAllByRole('row').filter((r) => within(r).queryAllByRole('cell').length > 0)).toHaveLength(5);
    expect(within(weakest).getByText('Worse than baseline')).toBeTruthy();
    expect(within(weakest).getByText('Few cases')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Show all 6' }));
    expect(within(screen.getByRole('table', { name: 'Weakest locations' })).getByText('Makkah Central')).toBeTruthy();
    expect(container.querySelector('[data-badge="SYNTHETIC"]')).not.toBeNull();
  });

  it('opens a zone drawer with the hourly error and the worst hours', () => {
    show({ state: state(), error: false, zoneNames: names });
    fireEvent.click(screen.getByRole('button', { name: 'Error by hour: Jeddah South' }));
    const drawer = screen.getByRole('dialog');
    expect(within(drawer).getByRole('table', { name: 'Worst hours' })).toBeTruthy();
    expect(within(within(drawer).getByRole('table', { name: 'Worst hours' })).getByText('23:00')).toBeTruthy();
  });

  it('says a backtest of another model is stale, and starts a run for the Administrator', () => {
    env.start.mockResolvedValue({ ok: true, data: { running: true } });
    show({ state: state({ active_model: 'ensemble-5' }), error: false, zoneNames: names });
    expect(screen.getByText('Stale')).toBeTruthy();
    expect(screen.getByText(/Run on ensemble-4\. Active version is ensemble-5\./)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Run backtest' }));
    expect(env.start).toHaveBeenCalledWith();
  });

  it('shows Running with a skeleton while a run goes, the button disabled with the reason', () => {
    show({ state: state({ run: { state: 'running', started_at: '2026-09-13T06:12:00+03:00' } }), error: false, zoneNames: names });
    expect(screen.getByText('Running')).toBeTruthy();
    const button = screen.getByRole('button', { name: 'Run backtest' });
    expect(button.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(button);
    expect(env.start).not.toHaveBeenCalled();
  });

  it('is empty before the first run, says when the last run failed, and errors with a retry', () => {
    show({ state: { latest: null, run: { state: 'failed', error_class: 'timeout' }, active_model: 'ensemble-4' }, error: false, zoneNames: {} });
    expect(screen.getByText('No backtest yet')).toBeTruthy();
    expect(screen.getByText('The last run failed (timeout).')).toBeTruthy();
    cleanup();
    show({ state: null, error: true, zoneNames: {} });
    expect(screen.getByText('The backtest could not load')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(env.refresh).toHaveBeenCalled();
  });

  it('disables the run for a view-only role, with the reason', () => {
    show({ state: state(), error: false, zoneNames: names }, false);
    const button = screen.getByRole('button', { name: 'Run backtest' });
    expect(button.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(button);
    expect(env.start).not.toHaveBeenCalled();
  });

  it('compares the backtest MAPE with the MAPE target, in both languages', () => {
    show({ state: state(), error: false, zoneNames: names }, true, 0.15);
    expect(screen.getByText('MAPE above 15% target')).toBeTruthy();
    cleanup();
    show({ state: state(), error: false, zoneNames: names }, true, 0.25);
    expect(screen.getByText('MAPE within 25% target')).toBeTruthy();
    cleanup();
    show({ state: state(), error: false, zoneNames: names }, true, 0.15, 'ar');
    expect(screen.getByText('MAPE أعلى من هدف 15%')).toBeTruthy();
    expect(screen.getByText('حد الاجتياز')).toBeTruthy();
  });

  it('shows no MAPE pill without a target', () => {
    show({ state: state(), error: false, zoneNames: names });
    expect(screen.queryByText(/MAPE (above|within)/)).toBeNull();
  });
});
