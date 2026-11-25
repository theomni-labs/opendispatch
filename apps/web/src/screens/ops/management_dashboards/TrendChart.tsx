'use client';
// SPDX-License-Identifier: AGPL-3.0-only

import { LineChart } from '@opendispatch/ui/charts';

// Client wrapper: owns the format function

export interface TrendChartProps {
  readonly label: string;
  readonly labels: readonly string[];
  readonly series: readonly { readonly name: string; readonly data: readonly number[]; readonly color: string; readonly dashed?: boolean }[];
  /** pct (default): 12%; count: 1,234. */
  readonly unit?: 'pct' | 'count';
}

const pctFormat = (v: number): string => `${v}%`;
const countFormat = (v: number): string => Math.round(v).toLocaleString('en-US');

export function TrendChart({ label, labels, series, unit = 'pct' }: TrendChartProps) {
  return (
    <LineChart
      height={220}
      format={unit === 'pct' ? pctFormat : countFormat}
      min={0}
      label={label}
      labels={[...labels]}
      series={series.map((s) => ({ name: s.name, data: [...s.data], color: s.color, ...(s.dashed === true ? { dashed: true } : {}) }))}
    />
  );
}
