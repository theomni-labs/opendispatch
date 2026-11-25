// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment jsdom
import { DesignSystemProvider } from '@opendispatch/ui';
import { cleanup, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { inLocale } from '@/components/opendispatch/test-utils';
import { AssumptionsCard } from './AssumptionsCard';
import type { AssumptionsView } from './types';

afterEach(cleanup);

const base: AssumptionsView = {
  liveSpeedKmh: 35,
  planningSpeedKmh: 40,
  clockStart: 'assignment',
  clockConfirmed: true,
  paydayDay: 27,
  handlingInferred: true,
  caseSources: ['SYNTHETIC'],
  weather: { source: 'stored', cities: 3, from: '2023-09-01', to: '2026-10-16', attribution: 'Open-Meteo (ERA5, GFS), CC BY 4.0' },
  weatherFeed: 'openmeteo',
  trafficSource: 'none',
};

function show(locale: 'en' | 'ar', a: AssumptionsView) {
  return inLocale(locale, <DesignSystemProvider><AssumptionsCard assumptions={a} /></DesignSystemProvider>, { module: 'admin.forecast_model' });
}

describe('AssumptionsCard', () => {
  it('shows each assumption with its label, and the weather licence', () => {
    show('en', base);
    for (const text of ['35 km/h', '40 km/h', 'From assignment', 'Confirmed', 'Day 27 of the month', 'Inferred', 'Open-Meteo (ERA5, GFS), CC BY 4.0']) {
      expect(screen.getByText(text)).toBeTruthy();
    }
    expect(screen.getAllByText('Assumption')).toHaveLength(4);
    expect(screen.getByText(/^3 cities, /)).toBeTruthy();
  });
  it('says off, none and unconfirmed when the settings say so', () => {
    show('en', { ...base, paydayDay: 0, clockStart: 'registration', clockConfirmed: false, weather: { source: 'none', cities: 0, from: null, to: null, attribution: null } });
    expect(screen.getByText('Off')).toBeTruthy();
    expect(screen.getAllByText('None')).toHaveLength(2);
    expect(screen.queryByText('Confirmed')).toBeNull();
    expect(screen.getAllByText('Assumption')).toHaveLength(5);
  });
  it('names the synthetic weather and traffic series', () => {
    show('en', { ...base, weatherFeed: 'synthetic', trafficSource: 'synthetic', weather: { source: 'feed', cities: 0, from: null, to: null, attribution: null } });
    expect(screen.getByText('Synthetic weather')).toBeTruthy();
    expect(screen.getByText('Traffic')).toBeTruthy();
    expect(screen.getByText('Synthetic series')).toBeTruthy();
    expect(screen.getAllByText('Assumption')).toHaveLength(5);
  });
  it('is in Arabic', () => {
    show('ar', base);
    expect(screen.getByText('الافتراضات')).toBeTruthy();
    expect(screen.getByText('مؤكَّد')).toBeTruthy();
  });
});
