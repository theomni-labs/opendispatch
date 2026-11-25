// SPDX-License-Identifier: AGPL-3.0-only
'use client';

import { useCallback } from 'react';
import { useLabels } from '../provider';
import { useCompactFormat, useListJoin, useTitled, paletteColor } from './chart-text';
import styles from './chart.module.css';
import { EChart, type ColorReader } from './echart';
import { ChartLegend, type LegendItem } from './legend';

export interface LineSeries {
  name: string;
  data: number[];
  /** A CSS colour or custom property, such as `var(--od-chart-1)`. Default: the chart palette in order. */
  color?: string;
  area?: boolean;
  dashed?: boolean;
}

/** A likely range drawn as a shaded band. */
export interface LineBand {
  low: number[];
  high: number[];
  name?: string;
  color?: string;
}

/** A vertical line at a point; 2.5 sits half way between the third and the fourth point. */
export interface LineMarker {
  index: number;
  label?: string;
}

export interface LineChartProps {
  /** One label per point; '' leaves a point without an axis label. */
  labels: string[];
  /** Fuller point names for the tooltip and the summary. */
  tooltipLabels?: string[];
  series: LineSeries[];
  height?: number;
  format?: (n: number) => string;
  band?: LineBand;
  markers?: LineMarker[];
  min?: number;
  max?: number;
  /** The chart's name; the generated summary follows it in the accessible name. */
  label?: string;
}

const finite = (v: number | undefined): v is number => typeof v === 'number' && Number.isFinite(v);

/** A line chart on ECharts. Its accessible name summarises the series, range and markers. */
export function LineChart({ labels, tooltipLabels, series, height = 240, format, band, markers, min, max, label }: LineChartProps) {
  const t = useLabels();
  const compact = useCompactFormat();
  const join = useListJoin();
  const titled = useTitled();
  const show = format ?? compact;
  const count = Math.max(labels.length, ...series.map((s) => s.data.length), 0);
  const values = series.flatMap((s) => s.data.filter(finite));
  const bandName = band ? (band.name ?? t('lineChart.band')) : '';
  const colors = series.map((s, i) => s.color ?? paletteColor(i));
  const bandColor = band?.color ?? colors[0] ?? paletteColor(0);

  const pointName = useCallback(
    (i: number) => tooltipLabels?.[i] || labels[i] || String(i + 1),
    [labels, tooltipLabels],
  );

  const build = useCallback(
    (color: ColorReader, dir: 'ltr' | 'rtl') => {
      const text = color('var(--od-chart-label)');
      const grid = color('var(--od-chart-grid)');
      const drawn: Record<string, unknown>[] = [];
      if (band) {
        const fill = color(bandColor);
        drawn.push(
          {
            type: 'line',
            name: `${bandName} low`,
            data: band.low.map((v, i) => [i, v]),
            stack: 'band',
            symbol: 'none',
            lineStyle: { opacity: 0 },
            silent: true,
            tooltip: { show: false },
          },
          {
            type: 'line',
            name: bandName,
            data: band.high.map((v, i) => [i, v - (band.low[i] ?? 0)]),
            stack: 'band',
            symbol: 'none',
            lineStyle: { opacity: 0 },
            areaStyle: { color: fill, opacity: 0.18 },
            silent: true,
            tooltip: { show: false },
          },
        );
      }
      series.forEach((s, i) => {
        const stroke = color(colors[i] ?? paletteColor(i));
        drawn.push({
          type: 'line',
          name: s.name,
          data: s.data.map((v, x) => [x, finite(v) ? v : null]),
          symbol: 'circle',
          symbolSize: 4,
          showSymbol: false,
          lineStyle: { color: stroke, width: 2, type: s.dashed ? 'dashed' : 'solid' },
          itemStyle: { color: stroke },
          ...(s.area ? { areaStyle: { color: stroke, opacity: 0.12 } } : {}),
          ...(i === 0 && markers && markers.length > 0
            ? {
                markLine: {
                  silent: true,
                  symbol: 'none',
                  lineStyle: { color: text, type: 'dashed', width: 1 },
                  label: { color: text, formatter: (p: { name?: string }) => p.name ?? '' },
                  data: markers.map((m) => ({ xAxis: m.index, name: m.label ?? '' })),
                },
              }
            : {}),
        });
      });
      return {
        animation: false,
        grid: { top: 16, bottom: 28, left: 8, right: 8, containLabel: true },
        textStyle: { fontFamily: 'inherit' },
        tooltip: {
          trigger: 'axis',
          formatter: (items: Array<{ seriesName: string; value: [number, number | null]; marker: string }>) => {
            const first = items[0];
            if (!first) return '';
            const index = first.value[0];
            const rows = items
              .filter((item) => item.seriesName !== bandName && item.seriesName !== `${bandName} low`)
              .map((item) => `${item.marker}${item.seriesName}: ${item.value[1] === null ? '-' : show(item.value[1])}`);
            if (band && finite(band.low[index]) && finite(band.high[index])) {
              rows.push(`${bandName}: ${t('lineChart.bandValue', { low: show(band.low[index]), high: show(band.high[index]) })}`);
            }
            return [pointName(index), ...rows].join('<br/>');
          },
        },
        xAxis: {
          type: 'value',
          min: 0,
          max: Math.max(count - 1, 1),
          interval: 1,
          inverse: false,
          axisLabel: {
            color: text,
            hideOverlap: true,
            formatter: (v: number) => (Number.isInteger(v) ? (labels[v] ?? '') : ''),
          },
          axisLine: { lineStyle: { color: grid } },
          splitLine: { show: false },
          axisTick: { show: false },
        },
        yAxis: {
          type: 'value',
          position: dir === 'rtl' ? 'right' : 'left',
          ...(min === undefined ? {} : { min }),
          ...(max === undefined ? {} : { max }),
          axisLabel: { color: text, formatter: (v: number) => show(v) },
          splitLine: { lineStyle: { color: grid } },
        },
        series: drawn,
      };
    },
    [band, bandColor, bandName, colors, count, labels, markers, max, min, pointName, series, show, t],
  );

  if (count === 0 || values.length === 0) {
    return (
      <div className={styles.empty} style={{ blockSize: height }} role="img" aria-label={titled(label, t('chart.noData'))}>
        {t('chart.noData')}
      </div>
    );
  }

  const named = Array.from({ length: count }, (_, i) => tooltipLabels?.[i] || labels[i] || '').filter((n) => n !== '');
  const markerNames = (markers ?? []).flatMap((m) => (m.label ? [m.label] : []));
  const summary = [
    t('lineChart.summary', {
      series: join(series.map((s) => s.name)),
      count,
      first: named[0] ?? pointName(0),
      last: named[named.length - 1] ?? pointName(count - 1),
      min: show(Math.min(...values)),
      max: show(Math.max(...values)),
    }),
    markerNames.length > 0 ? t('lineChart.markers', { markers: join(markerNames) }) : '',
  ]
    .filter(Boolean)
    .join(' ');

  const legend: LegendItem[] = series.map((s, i) => ({ label: s.name, color: colors[i] ?? paletteColor(i), dashed: s.dashed === true }));
  if (band) legend.push({ label: bandName, color: bandColor });

  return (
    <div className={styles.chart}>
      {legend.length > 1 ? <ChartLegend items={legend} /> : null}
      <EChart build={build} height={height} label={titled(label, summary)} />
    </div>
  );
}
