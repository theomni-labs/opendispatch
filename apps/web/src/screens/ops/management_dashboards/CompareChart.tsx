'use client';
// SPDX-License-Identifier: AGPL-3.0-only

import { BarChart } from '@opendispatch/ui/charts';

// Client wrapper: owns the format function

export interface CompareChartProps {
  readonly label: string;
  readonly data: readonly { readonly label: string; readonly values: readonly number[] }[];
  readonly series: readonly { readonly name: string; readonly color: string }[];
}

const pctFormat = (v: number): string => `${v}%`;

export function CompareChart({ label, data, series }: CompareChartProps) {
  return <BarChart height={220} format={pctFormat} label={label} data={[...data.map((d) => ({ label: d.label, values: [...d.values] }))]} series={[...series]} />;
}
