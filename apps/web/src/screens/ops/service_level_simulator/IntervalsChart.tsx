'use client';
// SPDX-License-Identifier: AGPL-3.0-only

import { Field, Select } from '@opendispatch/ui';
import { BarChart } from '@opendispatch/ui/charts';
import { time as formatTime } from '@opendispatch/ui/format';
import { useTranslations } from 'next-intl';
import { useUrlState } from '@/components/opendispatch/patterns/useUrlState';
import type { ClockStart } from '@/lib/types';
import styles from './ServiceLevelSimulator.module.css';
import type { IntervalPoint, OptionItem } from './view';

// Intervals tab (#sl-ichart); no data state if none

export interface IntervalsChartProps {
  readonly zoneOptions: readonly OptionItem[];
  readonly zone: string;
  readonly points: readonly IntervalPoint[];
  readonly clockStart: ClockStart;
}

export function IntervalsChart({ zoneOptions, zone, points, clockStart }: IntervalsChartProps) {
  const m = useTranslations('ops.service_level_simulator');
  const t = useTranslations();
  const url = useUrlState();

  const assignmentFirst = clockStart === 'assignment';
  const series = [
    { name: m('read.fromAssignment'), color: 'var(--od-chart-1)' },
    { name: m('read.fromRegistration'), color: 'var(--od-chart-4)' },
  ];
  const data = points.map((p) => ({
    label: formatTime(p.label),
    values: assignmentFirst ? [...p.values] : [p.values[1], p.values[0]],
  }));

  return (
    <div className={styles.stack}>
      <div className={styles.intervalHead}>
        <Field label={m('i.zone')}>
          <Select
            width="auto"
            placeholder={t('common.all')}
            value={zone}
            options={[...zoneOptions]}
            onChange={(event) => url.update({ izone: event.target.value === '' ? null : event.target.value })}
          />
        </Field>
        <span className={styles.meta}>{m('i.meta')}</span>
      </div>
      <BarChart data={data} series={assignmentFirst ? series : [series[1]!, series[0]!]} height={240} max={100} format={(v) => `${v}%`} label={m('i.chart')} />
    </div>
  );
}
