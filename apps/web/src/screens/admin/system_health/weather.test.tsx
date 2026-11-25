// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { createTranslator } from 'next-intl';
import { afterEach, describe, expect, it } from 'vitest';
import { loadMessages } from '@/i18n/messages';
import type { WorkingAssumptions } from '@/lib/types';
import { WeatherSub } from './WeatherSub';
import { weatherHealth, weatherSourceOf } from './weather';

afterEach(cleanup);

const none: WorkingAssumptions['weather'] = { source: 'none', days: 0, cities: 0, from: null, to: null, fetched_at: null, attribution: null, data_sources: [] };
const stored: WorkingAssumptions['weather'] = {
  source: 'stored',
  days: 4000,
  cities: 4,
  from: '2023-08-01',
  to: '2026-09-28',
  fetched_at: '2026-09-13T03:10:00+03:00',
  attribution: 'Open-Meteo (ERA5, GFS), CC BY 4.0',
  data_sources: ['PUBLIC_OPEN_DATA'],
};

describe('the weather row', () => {
  it('reads Off only with no stored weather and no feed', () => {
    expect(weatherSourceOf(null)).toBeNull();
    expect(weatherSourceOf(none)).toBeNull();
    expect(weatherHealth('disabled', weatherSourceOf(none))).toBe('disabled');
  });

  it('reads stored weather as healthy, with its latest date and source', () => {
    const source = weatherSourceOf(stored);
    expect(source).toEqual({ kind: 'stored', to: '2026-09-28', source: 'Open-Meteo (ERA5, GFS), CC BY 4.0' });
    expect(weatherHealth('disabled', source)).toBe('healthy');
  });

  it('reads a configured feed alone as unknown, and keeps a real health', () => {
    const source = weatherSourceOf({ ...none, source: 'feed' });
    expect(source).toEqual({ kind: 'feed' });
    expect(weatherHealth('disabled', source)).toBe('unknown');
    expect(weatherHealth('degraded', source)).toBe('degraded');
  });

  it('says it in both languages, the source as data', () => {
    for (const locale of ['en', 'ar'] as const) {
      const t = createTranslator({ locale, messages: loadMessages(locale, 'admin.system_health'), namespace: 'admin.system_health' }) as unknown as (key: string, values?: { date: string }) => string;
      const { container } = render(<WeatherSub source={weatherSourceOf(stored)!} label={(key, values) => t(key, values)} locale={locale} />);
      expect(container.textContent).toContain(locale === 'en' ? 'Stored weather to' : 'طقس مخزّن حتى');
      expect(container.querySelector('bdi[translate="no"]')?.textContent).toBe('Open-Meteo (ERA5, GFS), CC BY 4.0');
      cleanup();
      render(<WeatherSub source={{ kind: 'feed' }} label={(key, values) => t(key, values)} locale={locale} />);
      expect(document.body.textContent).toBe(locale === 'en' ? 'Configured feed' : 'تغذية مُعدّة');
      cleanup();
    }
  });
});
