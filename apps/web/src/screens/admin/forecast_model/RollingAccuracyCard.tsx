'use client';
// SPDX-License-Identifier: AGPL-3.0-only

import { Button, Card, DataTable, DescriptionList, EmptyState, SegmentedControl, StatusPill, Tooltip, useFormat, type Column } from '@opendispatch/ui';
import { ChartLine, RefreshCw } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { DataSourceBadge } from '@/components/opendispatch/DataSourceBadge';
import { IllustrativeLabel } from '@/components/opendispatch/IllustrativeLabel';
import { useRouter } from '@/i18n/navigation';
import type { RollingAccuracyFigures } from '@/lib/types';
import { accuracyRows, hasWindow, type AccuracyBy, type AccuracyRow, type RollingAccuracyCardData } from './rollingAccuracy';
import styles from './ForecastModel.module.css';

// Accuracy card (#fm-acc): rolling MAPE and WAPE.

function Status({ figures }: { figures: RollingAccuracyFigures }) {
  const m = useTranslations('admin.forecast_model');
  if (figures.target_status === null) return <span className={styles.meta}>{m('acc.noCases')}</span>;
  const above = figures.target_status === 'above';
  return <StatusPill status={m(above ? 'acc.status.above' : 'acc.status.ok')} tone={above ? 'warning' : 'success'} size="sm" />;
}

export function RollingAccuracyCard({ data }: { data: RollingAccuracyCardData }) {
  const m = useTranslations('admin.forecast_model');
  const t = useTranslations();
  const format = useFormat();
  const router = useRouter();
  const [by, setBy] = useState<AccuracyBy>('zone');
  const state = data.state;
  if (state === null && !data.error) return null;

  const filled = hasWindow(state) ? state : null;
  const illustrative = state === null || state.illustrative;
  const sources = state === null ? [] : state.data_sources.length > 0 ? state.data_sources : [state.data_source];
  const pct = (v: number | null) => (v === null ? '-' : format.ratio(v, 1));
  const header = (
    <div className={styles.cardHeader}>
      <h2 className={styles.cardTitle}>{m('acc.title', { n: state?.window_days ?? 28 })}</h2>
      <div className={styles.inline}>
        {illustrative ? <IllustrativeLabel /> : null}
        {state === null ? null : <DataSourceBadge sources={sources} />}
        {filled?.overall == null ? null : <Status figures={filled.overall} />}
      </div>
    </div>
  );

  if (data.error) {
    return (
      <Card padding="none">
        {header}
        <EmptyState
          compact
          tone="danger"
          title={m('acc.error')}
          action={
            <Button variant="secondary" size="sm" startIcon={<RefreshCw />} onClick={() => router.refresh()}>
              {t('common.retry')}
            </Button>
          }
        />
      </Card>
    );
  }
  if (filled === null || filled.overall === null) {
    return (
      <Card padding="none">
        {header}
        <EmptyState compact icon={<ChartLine />} title={m('acc.empty.title')} description={m('acc.empty.desc')} />
      </Card>
    );
  }

  const overall = filled.overall;
  const figure = (v: number | null) => (
    <span className={styles.inline}>
      <bdi translate="no">{pct(v)}</bdi>
      {illustrative ? <IllustrativeLabel /> : null}
    </span>
  );
  const mapeHead = (
    <Tooltip content={m('acc.tip.mape')}>
      <span translate="no" tabIndex={0}>
        MAPE
      </span>
    </Tooltip>
  );
  const wapeHead = (
    <Tooltip content={m('bt.tip.wape')}>
      <span translate="no" tabIndex={0}>
        WAPE
      </span>
    </Tooltip>
  );
  const firstHead = by === 'zone' ? t('common.zone') : by === 'hour' ? m('bt.col.hour') : m('acc.col.day');
  const columns: Column<AccuracyRow>[] = [
    {
      key: 'name',
      header: firstHead,
      cell: (row) =>
        row.minutes === null ? (
          <bdi className={styles.strong} translate={by === 'zone' ? 'no' : undefined}>
            {row.label}
          </bdi>
        ) : (
          <bdi className={styles.strong} translate="no">
            {format.time(row.minutes)}
          </bdi>
        ),
    },
    { key: 'mape', header: mapeHead, align: 'end', cell: (row) => <b translate="no">{pct(row.figures.mape)}</b> },
    { key: 'wape', header: wapeHead, align: 'end', cell: (row) => <span translate="no">{pct(row.figures.wape)}</span> },
    { key: 'status', header: m('acc.col.status'), cell: (row) => <Status figures={row.figures} /> },
    { key: 'cases', header: m('acc.col.cases'), align: 'end', hideBelow: 'md', cell: (row) => <span translate="no">{format.int(row.figures.actual)}</span> },
  ];
  const computed = filled.computed_at;

  return (
    <Card padding="none">
      {header}
      <div className={styles.cardBody}>
        <div className={styles.cardInner}>
          <DescriptionList
            dense
            columns={2}
            items={[
              { label: 'MAPE', value: figure(overall.mape) },
              { label: 'WAPE', value: figure(overall.wape) },
              { label: m('bt.target'), value: m('acc.targetVal', { p: format.ratio(filled.mape_target, 0) }) },
              {
                label: m('acc.window'),
                value: (
                  <span className={styles.stackTight}>
                    <bdi translate="no">
                      {format.date(filled.window_start)} - {format.date(filled.window_end)}
                    </bdi>
                    <span className={styles.meta}>{m('acc.measured', { n: overall.days })}</span>
                  </span>
                ),
              },
            ]}
          />
          <SegmentedControl
            size="sm"
            ariaLabel={m('acc.by.label')}
            value={by}
            options={[
              { value: 'zone', label: m('acc.by.zone') },
              { value: 'hour', label: m('acc.by.hour') },
              { value: 'weekday', label: m('acc.by.weekday') },
            ]}
            onChange={(next) => setBy(next === 'hour' || next === 'weekday' ? next : 'zone')}
          />
        </div>
      </div>
      <DataTable
        dense
        pageSize={0}
        caption={`${m('acc.title', { n: filled.window_days })}: ${m(`acc.by.${by}`)}`}
        columns={columns}
        rows={accuracyRows(data, by)}
        getRowId={(row) => row.key}
        rowTone={(row) => (row.figures.target_status === 'above' ? 'warning' : undefined)}
      />
      {computed === null ? null : (
        <div className={styles.btFoot}>
          <span className={styles.meta}>{m('acc.meta', { time: `${format.date(computed)}, ${format.time(computed)}` })}</span>
        </div>
      )}
    </Card>
  );
}
