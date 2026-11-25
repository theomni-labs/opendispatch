'use client';
// SPDX-License-Identifier: AGPL-3.0-only

import { SegmentedControl } from '@opendispatch/ui';
import { LineChart, type LineMarker } from '@opendispatch/ui/charts';
import { useTranslations } from 'next-intl';
import { useUrlState } from '@/components/opendispatch/patterns/useUrlState';
import type { PrayerRow, TimelineSeries } from './view';

// 15-min timeline (#fx-chart): likely range as a
// band, chosen time and prayer times as markers.
// Plot stays left to right in both languages, like
// every chart and the map.

export interface TimelineChartProps {
  readonly timeline: TimelineSeries;
  readonly view: 'total' | 'field' | 'remote';
  readonly time: number;
  readonly prayers: readonly PrayerRow[];
  readonly fieldShare: number;
}

function toIndex(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return Math.round(((h ?? 0) * 60 + (m ?? 0)) / 15);
}

export function TimelineChart({ timeline, view, time, prayers, fieldShare }: TimelineChartProps) {
  const m = useTranslations('ops.forecast_explorer');
  const url = useUrlState();

  const factor = view === 'field' ? fieldShare : view === 'remote' ? 1 - fieldShare : 1;
  const series = timeline.expected.map((v) => v * factor);
  const low = view === 'total' ? timeline.low : timeline.low.map((v) => v * factor);
  const high = view === 'total' ? timeline.high : timeline.high.map((v) => v * factor);
  const color = view === 'field' ? 'var(--od-chart-2)' : view === 'remote' ? 'var(--od-chart-3)' : 'var(--od-chart-1)';
  const seriesName = m(view === 'total' ? 'series.expected' : view === 'field' ? 'series.field' : 'series.remote');

  const markers: LineMarker[] = [...prayers.map((p): LineMarker => ({ index: toIndex(p.time), label: m(`prayer.${p.key}`) })), { index: time }];

  return (
    <>
      <SegmentedControl
        size="sm"
        ariaLabel={m('view.label')}
        value={view}
        options={[
          { value: 'total', label: m('view.total') },
          { value: 'field', label: m('view.field') },
          { value: 'remote', label: m('view.remote') },
        ]}
        onChange={(value) => url.update({ view: value === 'total' ? null : value })}
      />
      <LineChart
        label={m('tl.title')}
        labels={[...timeline.labels]}
        min={0}
        band={{ low: [...low], high: [...high], color }}
        markers={markers}
        series={[{ name: seriesName, data: series, color }]}
        height={260}
      />
    </>
  );
}
