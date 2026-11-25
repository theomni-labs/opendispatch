// SPDX-License-Identifier: AGPL-3.0-only
'use client';

import { useCallback } from 'react';
import { useLabels } from '../provider';
import { paletteColor, useCompactFormat, useListJoin, useTitled } from './chart-text';
import styles from './chart.module.css';
import { EChart, type ColorReader } from './echart';
import { ChartLegend } from './legend';

export interface BarChartProps {
  data: { label: string; values: number[] }[];
  series: { name: string; color?: string }[];
  height?: number;
  format?: (n: number) => string;
  stacked?: boolean;
  horizontal?: boolean;
  /** A horizontal chart on a right-to-left page puts the names on the right. Set false to keep them on the left. */
  mirror?: boolean;
  min?: number;
  max?: number;
  label?: string;
}

const finite = (v: number | undefined): v is number => typeof v === 'number' && Number.isFinite(v);

/** A grouped or stacked bar chart on ECharts, vertical or horizontal. */
export function BarChart({
  data,
  series,
  height = 240,
  format,
  stacked = false,
  horizontal = false,
  mirror = true,
  min,
  max,
  label,
}: BarChartProps) {
  const t = useLabels();
  const compact = useCompactFormat();
  const join = useListJoin();
  const titled = useTitled();
  const show = format ?? compact;
  const colors = series.map((s, i) => s.color ?? paletteColor(i));

  const build = useCallback(
    (color: ColorReader, dir: 'ltr' | 'rtl') => {
      const text = color('var(--od-chart-label)');
      const grid = color('var(--od-chart-grid)');
      const flip = horizontal && mirror && dir === 'rtl';
      const categoryAxis = {
        type: 'category',
        data: data.map((d) => d.label),
        axisLabel: { color: text, hideOverlap: true },
        axisLine: { lineStyle: { color: grid } },
        axisTick: { show: false },
        ...(horizontal ? { inverse: true, position: flip ? 'right' : 'left' } : {}),
      };
      const valueAxis = {
        type: 'value',
        ...(min === undefined ? {} : { min }),
        ...(max === undefined ? {} : { max }),
        axisLabel: { color: text, formatter: (v: number) => show(v) },
        splitLine: { lineStyle: { color: grid } },
        ...(horizontal ? { inverse: flip } : { position: dir === 'rtl' ? 'right' : 'left' }),
      };
      return {
        animation: false,
        grid: { top: 16, bottom: 28, left: 8, right: 8, containLabel: true },
        textStyle: { fontFamily: 'inherit' },
        tooltip: {
          trigger: 'axis',
          axisPointer: { type: 'shadow' },
          valueFormatter: (v: number | null) => (finite(v ?? undefined) ? show(v as number) : '-'),
        },
        xAxis: horizontal ? valueAxis : categoryAxis,
        yAxis: horizontal ? categoryAxis : valueAxis,
        series: series.map((s, i) => ({
          type: 'bar',
          name: s.name,
          data: data.map((d) => (finite(d.values[i]) ? d.values[i] : null)),
          itemStyle: { color: color(colors[i] ?? paletteColor(i)), borderRadius: 2 },
          barMaxWidth: 28,
          ...(stacked ? { stack: 'total' } : {}),
        })),
      };
    },
    [colors, data, horizontal, max, min, mirror, series, show, stacked],
  );

  const values = data.flatMap((d) => d.values.filter(finite));
  if (data.length === 0 || values.length === 0) {
    return (
      <div className={styles.empty} style={{ blockSize: height }} role="img" aria-label={titled(label, t('chart.noData'))}>
        {t('chart.noData')}
      </div>
    );
  }

  const totals = stacked ? data.map((d) => d.values.filter(finite).reduce((a, b) => a + b, 0)) : values;
  const summary = t('barChart.summary', {
    stacked: stacked ? 1 : 0,
    horizontal: horizontal ? 1 : 0,
    categories: data.length,
    seriesCount: series.length,
    names: join(series.map((s) => s.name)),
    min: show(Math.min(0, ...totals)),
    max: show(Math.max(...totals)),
  });

  return (
    <div className={styles.chart}>
      {series.length > 1 ? <ChartLegend items={series.map((s, i) => ({ label: s.name, color: colors[i] ?? paletteColor(i) }))} /> : null}
      <EChart build={build} height={height} label={titled(label, summary)} />
    </div>
  );
}
