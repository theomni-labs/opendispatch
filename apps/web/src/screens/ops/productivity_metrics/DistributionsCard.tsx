'use client';
// SPDX-License-Identifier: AGPL-3.0-only

import { Card, Field, SegmentedControl, Select } from '@opendispatch/ui';
import { BarChart } from '@opendispatch/ui/charts';
import { duration, num } from '@opendispatch/ui/format';
import { useTranslations } from 'next-intl';
import { IllustrativeLabel } from '@/components/opendispatch/IllustrativeLabel';
import { useUrlState } from '@/components/opendispatch/patterns/useUrlState';
import styles from './ProductivityMetrics.module.css';
import { CLOCK_VALUES, type ClockValue } from './types';
import type { HistogramView, ZoneOption } from './view';

// Distributions (#pm-zone, #pm-h1, #pm-h2)

export interface DistributionsCardProps {
  readonly zoneOptions: readonly ZoneOption[];
  readonly zone: string;
  readonly clock: ClockValue;
  readonly defaultClock: ClockValue;
  readonly toScene: HistogramView;
  readonly onScene: HistogramView;
}

function seriesOf(h: HistogramView, color: string, name: string) {
  return { data: h.counts.map((n, i) => ({ label: h.labels[i] ?? '', values: [n] })), series: [{ name, color }] };
}

export function DistributionsCard({ zoneOptions, zone, clock, defaultClock, toScene, onScene }: DistributionsCardProps) {
  const m = useTranslations('ops.productivity_metrics');
  const t = useTranslations();
  const url = useUrlState();

  const toSceneChart = seriesOf(toScene, clock === 'a' ? 'var(--od-chart-1)' : 'var(--od-chart-6)', m('hist.cases'));
  const onSceneChart = seriesOf(onScene, 'var(--od-chart-4)', m('hist.cases'));

  return (
    <div className={styles.stack}>
      <Field label={t('common.zone')}>
        <Select
          width="auto"
          placeholder={m('zoneAll')}
          value={zone}
          options={[...zoneOptions]}
          onChange={(event) => url.update({ zone: event.target.value === '' ? null : event.target.value })}
        />
      </Field>
      <div className={styles.histGrid}>
        <Card padding="lg">
          <div className={styles.cardHeadRow}>
            <h2 className={styles.cardTitle}>{m('hist.toScene')}</h2>
            <SegmentedControl
              size="sm"
              ariaLabel={m('clockLabel')}
              value={clock}
              onChange={(next) => {
                if ((CLOCK_VALUES as readonly string[]).includes(next)) url.update({ clock: next === defaultClock ? null : next });
              }}
              options={[
                { value: 'a', label: m('fromAssignment') },
                { value: 'r', label: m('fromRegistration') },
              ]}
            />
          </div>
          <div className={styles.cardMeta}>
            <IllustrativeLabel />
            <span className={styles.meta} translate="no">
              {m('median')} {duration(toScene.medianSeconds, 'clock')} {t('common.minShort')}
            </span>
          </div>
          <BarChart data={toSceneChart.data} series={toSceneChart.series} height={220} label={m('hist.toScene')} format={(v) => num(v, 0)} />
        </Card>
        <Card padding="lg">
          <div className={styles.cardHeadRow}>
            <h2 className={styles.cardTitle}>{m('hist.onScene')}</h2>
          </div>
          <div className={styles.cardMeta}>
            <IllustrativeLabel />
            <span className={styles.meta} translate="no">
              {m('median')} {duration(onScene.medianSeconds, 'clock')} {t('common.minShort')}
            </span>
          </div>
          <BarChart data={onSceneChart.data} series={onSceneChart.series} height={220} label={m('hist.onScene')} format={(v) => num(v, 0)} />
        </Card>
      </div>
    </div>
  );
}
