'use client';
// SPDX-License-Identifier: AGPL-3.0-only

import { Button, Card, DataTable, DescriptionList, EmptyState, Select, Skeleton, SkeletonText, useFormat } from '@opendispatch/ui';
import { LineChart } from '@opendispatch/ui/charts';
import { time } from '@opendispatch/ui/format';
import { ChartLine, Play, RefreshCw } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { DataSourceBadge } from '@/components/opendispatch/DataSourceBadge';
import { ActionError } from '@/components/opendispatch/patterns/ActionError';
import { useAdminAction } from '@/components/opendispatch/patterns/useAdminAction';
import { useUrlState } from '@/components/opendispatch/patterns/useUrlState';
import { IllustrativeLabel } from '@/components/opendispatch/IllustrativeLabel';
import { ReasonHint } from '@/components/opendispatch/ReasonHint';
import { useRouter } from '@/i18n/navigation';
import { runBacktestAction } from './actions';
import { cityRows, rowsMape, type AccuracyCardData } from './accuracy';
import styles from './ForecastExplorer.module.css';

// Forecast against actual (#fx-fva): a past day.

const LABELS = Array.from({ length: 96 }, (_, i) => time(i * 15));

function Header({ illustrative, sources, children }: { illustrative: boolean; sources?: Pick<AccuracyCardData, 'sources' | 'mixed'>; children?: ReactNode }) {
  const m = useTranslations('ops.forecast_explorer');
  return (
    <div className={styles.fvaHeader}>
      <h2 className="t-heading-s">{m('fva.title')}</h2>
      <div className={styles.chips}>
        {sources === undefined || sources.sources.length === 0 ? null : <DataSourceBadge sources={sources.sources} mixed={sources.mixed} />}
        {illustrative ? <IllustrativeLabel /> : null}
        {children}
      </div>
    </div>
  );
}

/** The card while the server reads. */
export function AccuracySkeleton() {
  return (
    <Card padding="none">
      <Header illustrative />
      <div className={styles.fvaBody} aria-busy="true">
        <SkeletonText lines={2} announce />
        <Skeleton height={220} radius="lg" />
      </div>
    </Card>
  );
}

export function AccuracyCard({ data }: { data: AccuracyCardData }) {
  const m = useTranslations('ops.forecast_explorer');
  const t = useTranslations();
  const format = useFormat();
  const url = useUrlState();
  const router = useRouter();
  const run = useAdminAction(runBacktestAction, { successTitle: m('fva.started'), successDescription: m('fva.startedDesc') });
  const acc = data.accuracy;
  const reason = !data.canRun ? m('fva.runReason') : data.running || run.pending ? m('fva.running') : null;
  const illustrative = acc === null || acc.illustrative;

  const runButton = (
    <ReasonHint reason={reason} visible={false}>
      <Button variant="secondary" size="sm" startIcon={<Play />} loading={run.pending} onClick={() => reason === null && run.run()}>
        {m('fva.run')}
      </Button>
    </ReasonHint>
  );

  if (data.error || acc === null) {
    return (
      <Card padding="none">
        <Header illustrative>{runButton}</Header>
        <EmptyState
          compact
          tone="danger"
          title={m('fva.error')}
          action={
            <Button variant="secondary" size="sm" startIcon={<RefreshCw />} onClick={() => router.refresh()}>
              {t('common.retry')}
            </Button>
          }
        />
      </Card>
    );
  }

  const daySelect =
    data.days.length === 0 ? null : (
      <Select
        size="sm"
        width="auto"
        aria-label={m('fva.day')}
        value={acc.date ?? ''}
        options={data.days.map((d) => ({ value: d.value, label: d.label }))}
        onChange={(event) => url.update({ past: event.target.value })}
      />
    );
  const rows = cityRows(acc, data.zones);
  const f = acc.overall;
  const mape = rowsMape(rows);
  const signed = (v: number | null | undefined) => (v == null ? '-' : `${v > 0 ? '+' : v < 0 ? '-' : ''}${format.ratio(Math.abs(v), 1)}`);
  const made = acc.run === null ? '-' : m('fva.madeVal', { model: acc.run.model_version, date: `${format.date(acc.run.created_at)} ${format.time(acc.run.created_at)}` });

  return (
    <Card padding="none">
      <Header illustrative={illustrative} sources={data}>
        {daySelect}
        {runButton}
      </Header>
      {run.error === null ? null : (
        <div className={styles.fvaBody}>
          <ActionError error={run.error} onDismiss={run.reset} />
        </div>
      )}
      {acc.date === null || f == null ? (
        <EmptyState compact icon={<ChartLine />} title={m('fva.empty.title')} description={m('fva.empty.desc')} />
      ) : (
        <>
          <div className={styles.fvaBody}>
            <DescriptionList
              dense
              columns={2}
              items={[
                { label: m('fva.col.forecast'), value: <span translate="no">{format.int(f.forecast)}</span> },
                { label: m('fva.col.actual'), value: <span translate="no">{format.int(f.actual)}</span> },
                { label: m('fva.col.wape'), value: <span translate="no">{format.ratio(f.wape, 1)}</span> },
                {
                  label: 'MAPE',
                  value: (
                    <span className={styles.chips}>
                      <bdi translate="no">{mape === null ? '-' : format.ratio(mape, 1)}</bdi>
                      {illustrative ? <IllustrativeLabel /> : null}
                    </span>
                  ),
                },
                { label: m('fva.col.range'), value: <span translate="no">{format.ratio(f.within_range, 0)}</span> },
                { label: m('fva.made'), value: <bdi translate="no">{made}</bdi> },
              ]}
            />
            <span className="t-caption">{m('tl.unit')}</span>
            <LineChart
              label={m('fva.title')}
              labels={LABELS}
              min={0}
              height={220}
              band={{ low: acc.intervals.map((i) => i.low), high: acc.intervals.map((i) => i.high), color: 'var(--od-chart-1)' }}
              series={[
                { name: m('fva.col.forecast'), data: acc.intervals.map((i) => i.expected), color: 'var(--od-chart-1)' },
                { name: m('fva.col.actual'), data: acc.intervals.map((i) => i.actual), color: 'var(--od-chart-4)' },
              ]}
            />
          </div>
          <DataTable
            pageSize={0}
            caption={m('fva.title')}
            rows={rows}
            getRowId={(row) => row.zone_id}
            rowLabel={(row) => row.zone.name}
            rowHref={(row) => url.hrefFor({ zone: row.zone_id, sub: null })}
            rowTone={(row) => (row.zone_id === acc.zone_id ? 'info' : undefined)}
            columns={[
              {
                key: 'zone',
                header: m('fva.col.zone'),
                cell: (row) => (
                  <span className={styles.topRow}>
                    <b className="t-body-s" translate="no">
                      {row.zone.name}
                    </b>
                    <span className="t-caption" translate="no">
                      {row.zone.code}
                    </span>
                  </span>
                ),
              },
              { key: 'forecast', header: m('fva.col.forecast'), align: 'end', cell: (row) => <span translate="no">{format.int(row.figures.forecast)}</span> },
              { key: 'actual', header: m('fva.col.actual'), align: 'end', cell: (row) => <b translate="no">{format.int(row.figures.actual)}</b> },
              {
                key: 'diff',
                header: m('fva.col.diff'),
                align: 'end',
                cell: (row) => (
                  <bdi dir="ltr" translate="no">
                    {signed(row.figures.difference)}
                  </bdi>
                ),
              },
              { key: 'wape', header: m('fva.col.wape'), align: 'end', cell: (row) => <span translate="no">{format.ratio(row.figures.wape, 1)}</span> },
              { key: 'range', header: m('fva.col.range'), align: 'end', hideBelow: 'md', cell: (row) => <span translate="no">{format.ratio(row.figures.within_range, 0)}</span> },
            ]}
          />
        </>
      )}
    </Card>
  );
}
