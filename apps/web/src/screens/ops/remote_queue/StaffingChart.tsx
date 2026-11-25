'use client';
// SPDX-License-Identifier: AGPL-3.0-only

import { LineChart } from '@opendispatch/ui/charts';
import { useTranslations } from 'next-intl';
import type { StaffingView } from './view';

// Reviewers per interval (#rq-chart)

export interface StaffingChartProps {
  readonly staffing: StaffingView;
}

export function StaffingChart({ staffing }: StaffingChartProps) {
  const m = useTranslations('ops.remote_queue');

  return (
    <LineChart
      label={m('staff.chart')}
      labels={[...staffing.labels]}
      min={0}
      series={[
        { name: m('staff.planned'), data: [...staffing.planned], color: 'var(--od-chart-1)' },
        { name: m('staff.required'), data: [...staffing.required], color: 'var(--od-chart-4)', dashed: true },
      ]}
      height={220}
    />
  );
}
