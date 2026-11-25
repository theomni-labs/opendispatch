'use client';
// SPDX-License-Identifier: AGPL-3.0-only

import { LineChart } from '@opendispatch/ui/charts';
import { useTranslations } from 'next-intl';
import type { RemotePerformanceView } from './view';

// Received and handled per hour (#rq-pf-chart)

export interface PerformanceChartProps {
  readonly hours: RemotePerformanceView['hours'];
}

export function PerformanceChart({ hours }: PerformanceChartProps) {
  const m = useTranslations('ops.remote_queue');

  return (
    <LineChart
      label={m('pf.hr.chart')}
      labels={[...hours.labels]}
      min={0}
      series={[
        { name: m('pf.hr.received'), data: [...hours.received], color: 'var(--od-chart-1)' },
        { name: m('pf.hr.handled'), data: [...hours.handled], color: 'var(--od-chart-4)', dashed: true },
      ]}
      height={220}
    />
  );
}
