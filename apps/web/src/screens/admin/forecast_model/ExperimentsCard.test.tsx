// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment jsdom
import { DesignSystemProvider } from '@opendispatch/ui';
import { cleanup, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { inLocale } from '@/components/opendispatch/test-utils';
import type { ForecastExperiment } from '@/lib/types';
import { ExperimentsCard } from './ExperimentsCard';
import { experimentRow } from './experiments';

afterEach(cleanup);

const experiment = (over: Partial<ForecastExperiment> = {}): ForecastExperiment => ({
  id: '0b7e1b52-27a8-4b0a-9a35-5d1f3c0a0001',
  tenant_id: '0b7e1b52-27a8-4b0a-9a35-5d1f3c0a00aa',
  data_source: 'SYNTHETIC',
  created_at: '2026-09-13T02:14:00+03:00',
  updated_at: '2026-09-13T02:15:00+03:00',
  created_by: null,
  kind: 'backtest',
  trigger: 'degradation',
  status: 'succeeded',
  model_version: 'ensemble-4',
  challenger_model: 'lightgbm-1',
  dataset_snapshot_id: 'ds-41a0c9e7d2b1f388',
  forecast_run_id: null,
  params: { held_out_days: 28 },
  metrics: { wape: 0.184, gate_result: 'pass' },
  illustrative: true,
  started_at: '2026-09-13T02:14:00+03:00',
  finished_at: '2026-09-13T02:15:00+03:00',
  error_class: null,
  ...over,
});

function show(locale: 'en' | 'ar', rows: ForecastExperiment[]) {
  return inLocale(locale, <DesignSystemProvider><ExperimentsCard rows={rows.map(experimentRow)} /></DesignSystemProvider>, { module: 'admin.forecast_model' });
}

describe('ExperimentsCard', () => {
  it('lists each run with its trigger, model, snapshot, WAPE and status, Illustrative', () => {
    show('en', [experiment(), experiment({ id: '0b7e1b52-27a8-4b0a-9a35-5d1f3c0a0002', kind: 'retrain', trigger: 'manual', status: 'running', challenger_model: null, metrics: {} })]);
    for (const text of ['Experiments', 'Backtest', 'Accuracy drop', 'lightgbm-1', 'ds-41a0c9e7d2b1f388', 'Succeeded', 'Retrain', 'Manual', 'Running', 'Illustrative']) {
      expect(screen.getAllByText(text).length, text).toBeGreaterThan(0);
    }
    expect(screen.getByText('18.4%')).toBeTruthy();
  });
  it('says so when there is none', () => {
    show('en', []);
    expect(screen.getByText('No experiments yet')).toBeTruthy();
  });
  it('is in Arabic', () => {
    show('ar', [experiment({ status: 'failed', error_class: 'engine_off' })]);
    expect(screen.getByRole('heading', { name: 'التجارب' })).toBeTruthy();
    expect(screen.getByText('فشل')).toBeTruthy();
  });
});
