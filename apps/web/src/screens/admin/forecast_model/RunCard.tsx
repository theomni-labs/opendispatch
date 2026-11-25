'use client';
// SPDX-License-Identifier: AGPL-3.0-only

import { Card, DescriptionList, StatusPill, useFormat, type Tone } from '@opendispatch/ui';
import { useTranslations } from 'next-intl';
import { DataSourceBadge } from '@/components/opendispatch/DataSourceBadge';
import { IllustrativeLabel } from '@/components/opendispatch/IllustrativeLabel';
import { RunForecastButton } from './ModelHeader';
import { useRun } from './RunState';
import type { RunView } from './types';
import styles from './ForecastModel.module.css';

// The latest forecast run: the model, the engine, the rule set, the
// horizon, the likely range (Illustrative: the placeholder forecaster) and when it ran. THE FORECASTER IS A PLACEHOLDER ENGINE.

const TONE: Readonly<Record<RunView['status'], Tone>> = { succeeded: 'success', running: 'info', queued: 'info', failed: 'danger', cancelled: 'neutral' };

export function RunCard({ run, paused, canEdit }: { run: RunView | null; paused: boolean; canEdit: boolean }) {
  const m = useTranslations('admin.forecast_model');
  const format = useFormat();
  const running = useRun().pending;
  return (
    <Card padding="lg">
      <div className={styles.cardInner}>
        <div className={styles.head}>
          <div className={styles.headTitle}>
            <h2 className={styles.cardTitle}>{m('r.title')}</h2>
            {run === null ? null : <StatusPill status={m(`r.${running ? 'running' : run.status}`)} tone={TONE[running ? 'running' : run.status]} size="sm" />}
          </div>
          <RunForecastButton canEdit={canEdit} paused={paused} variant="secondary" size="sm" />
        </div>
        {run === null ? (
          <p className={styles.empty}>{m('r.none')}</p>
        ) : (
          <DescriptionList
            dense
            columns={2}
            items={[
              { label: m('r.model'), value: <span translate="no">{run.model}</span> },
              { label: m('col.engine'), value: <span translate="no">{run.engine ?? '-'}</span> },
              { label: m('r.rules'), value: <span translate="no">{run.ruleSet ?? '-'}</span> },
              {
                label: m('r.horizon'),
                value: <span>{`${m('r.from', { date: format.date(run.horizonStart) })}, ${m('r.days', { n: run.horizonDays })}`}</span>,
              },
              {
                label: m('r.coverage'),
                value: (
                  <span className={styles.inline}>
                    <bdi dir="ltr" translate="no">
                      {format.ratio(run.coverage)}
                    </bdi>
                    <IllustrativeLabel />
                  </span>
                ),
              },
              {
                label: m('r.time'),
                value: (
                  <bdi dir="ltr" translate="no">
                    {run.startedAt === null ? '-' : format.time(run.startedAt)} - {run.finishedAt === null ? '-' : format.time(run.finishedAt)}
                  </bdi>
                ),
              },
              { label: m('r.input'), value: <DataSourceBadge sources={run.sources.length === 0 ? ['SYNTHETIC'] : run.sources} /> },
              {
                label: m('r.snapshot'),
                value: (
                  <bdi dir="ltr" translate="no">
                    {run.snapshot ?? '-'}
                  </bdi>
                ),
              },
            ]}
          />
        )}
      </div>
    </Card>
  );
}
