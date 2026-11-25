'use client';
// SPDX-License-Identifier: AGPL-3.0-only

import { Alert, Button, Card, DescriptionList, StatusPill, Stepper, Tag, type Tone } from '@opendispatch/ui';
import { ArchiveRestore, Play } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Reason, ReasonHint } from '@/components/opendispatch/ReasonHint';
import { runRows } from './checks';
import { CheckList, useWhen } from './UpdatesShared';
import type { OverviewMode, RecoveryView, RestoreView, RunView, StatusView } from './types';
import styles from './Updates.module.css';

// The recovery half of the Overview: needs_attention, restore_requested,
// restore_in_progress, restored, resumed, rolled_back): the alert with Resume and Restore, the restore request card, the
// run card and the live system card. Everything is drawn from what the agent reports; a restore request moves on with time
// (requested, in progress, completed) and the Overview asks the server again while it does. THE UPDATE AGENT IS A STUB.

const RUN_TONE: Readonly<Record<RunView['state'], Tone>> = { running: 'info', succeeded: 'success', failed: 'danger', rolled_back: 'warning', needs_attention: 'danger' };

// ---------------------------------------------------------------------------------------------
// The alert: what failed, what is safe, what next
// ---------------------------------------------------------------------------------------------

export interface AttentionAlertProps {
  readonly recovery: RecoveryView;
  readonly mode: OverviewMode;
  readonly canEdit: boolean;
  readonly onResume: () => void;
  readonly onRestore: () => void;
}

export function AttentionAlert({ recovery, mode, canEdit, onResume, onRestore }: AttentionAlertProps) {
  const m = useTranslations('admin.updates');
  const locked = mode === 'restore_requested' || mode === 'restore_in_progress';
  const reason = locked ? m('rq.locked') : canEdit ? null : m('na.roleView');
  const version = recovery.version ?? '';
  return (
    <Alert
      tone="danger"
      title={m('na.title', { v: version })}
      action={
        <div className={styles.actions}>
          <ReasonHint reason={reason} visible={false}>
            <Button variant="primary" startIcon={<Play />} onClick={() => reason === null && onResume()}>
              {m('resume')}
            </Button>
          </ReasonHint>
          <ReasonHint reason={reason} visible={false}>
            <Button variant="secondary" startIcon={<ArchiveRestore />} onClick={() => reason === null && onRestore()}>
              {m('restore')}
            </Button>
          </ReasonHint>
        </div>
      }
    >
      <span className={styles.stackTight}>
        <span>
          <span className={styles.strong}>{m('na.failedLead')}</span> {m('na.failed')}{' '}
          {recovery.failedMigration === null ? null : (
            <Tag color="gray">
              <span dir="ltr" translate="no">
                {recovery.failedMigration}
              </span>
            </Tag>
          )}
        </span>
        <span>
          <span className={styles.strong}>{m('na.safeLead')}</span> {m('na.safe')}
        </span>
        <span>
          <span className={styles.strong}>{m('na.nextLead')}</span> {m('na.next')}
        </span>
        {reason === null ? null : <Reason>{reason}</Reason>}
      </span>
    </Alert>
  );
}

// ---------------------------------------------------------------------------------------------
// Results the screen keeps in view
// ---------------------------------------------------------------------------------------------

export interface ResultAlertProps {
  readonly kind: 'resumed' | 'rolled_back' | 'restored';
  readonly version: string;
  readonly from: string | null;
  readonly current: string;
  readonly onHistory: () => void;
}

export function ResultAlert({ kind, version, from, current, onHistory }: ResultAlertProps) {
  const m = useTranslations('admin.updates');
  if (kind === 'resumed') {
    return (
      <Alert tone="success" title={m('rz.title', { v: version })}>
        {m('rz.body')}
      </Alert>
    );
  }
  if (kind === 'restored') {
    return (
      <Alert tone="success" title={m('rt.title', { v: version })}>
        {m('rt.body', { from: current })} {m('rt.cases')}
      </Alert>
    );
  }
  return (
    <Alert
      tone="warning"
      title={m('rb.title', { v: version, from: from ?? current })}
      action={
        <Button variant="secondary" size="sm" onClick={onHistory}>
          {m('rb.history')}
        </Button>
      }
    >
      {m('rb.why')} {m('toast.rolledBack.desc')}
    </Alert>
  );
}

// ---------------------------------------------------------------------------------------------
// Cards
// ---------------------------------------------------------------------------------------------

export function RestoreCard({ restore }: { restore: RestoreView }) {
  const m = useTranslations('admin.updates');
  const when = useWhen();
  const current = restore.state === 'requested' ? 0 : restore.state === 'in_progress' ? 1 : 3;
  return (
    <Card padding="lg" id="up-rq">
      <div className={styles.cardInner}>
        <div className={styles.head}>
          <h2 className={styles.cardTitle}>{m('rq.title')}</h2>
          <StatusPill status={restore.state === 'completed' ? m('rq.s3') : restore.state === 'requested' ? m('rq.s1') : m('rq.s2')} tone={restore.state === 'completed' ? 'success' : 'warning'} size="sm" />
        </div>
        <div className={styles.stack}>
          <Stepper current={current} steps={[{ label: m('rq.s1') }, { label: m('rq.s2') }, { label: m('rq.s3') }]} />
          <DescriptionList
            columns={2}
            items={[
              { label: m('rq.by'), value: <span translate="no">{restore.requestedBy}</span> },
              { label: m('rq.at'), value: <bdi translate="no">{when.dateTime(restore.requestedAt)}</bdi> },
              {
                label: m('rq.backup'),
                value: (
                  <Tag color="gray">
                    <span dir="ltr" translate="no">
                      {restore.backupReference ?? ''}
                    </span>
                  </Tag>
                ),
              },
              { label: m('rq.doer'), value: m('rq.team') },
            ]}
          />
        </div>
      </div>
    </Card>
  );
}

export function RunCard({ run }: { run: RunView }) {
  const m = useTranslations('admin.updates');
  const when = useWhen();
  const kind = run.kind === 'resume' ? m('k.resume') : run.kind === 'rollback' ? m('k.rollback') : run.kind === 'emergency' ? m('k.emergency_override') : run.kind === 'restore' ? m('k.restore') : m('k.update');
  const stateText = run.state === 'succeeded' ? m('r.succeeded') : run.state === 'rolled_back' ? m('r.rolled_back') : run.state === 'needs_attention' ? m('state.needs_attention') : run.state === 'failed' ? m('r.failed') : m('st.run');
  return (
    <Card padding="lg" id="up-runcard">
      <div className={styles.cardInner}>
        <div className={styles.head}>
          <div className={styles.headTitle}>
            <h2 className={styles.cardTitle}>
              {m('rc.title')} <span translate="no">{run.version}</span>
            </h2>
            <Tag color="gray">{kind}</Tag>
            <StatusPill status={stateText} tone={RUN_TONE[run.state]} size="sm" />
          </div>
          <span className={styles.meta} translate="no">
            {when.dateTime(run.startedAt)}
          </span>
        </div>
        <CheckList label={m('rc.title')} rows={runRows(run, m)} />
      </div>
    </Card>
  );
}

export interface LiveSystemCardProps {
  readonly status: StatusView;
  readonly backup: string | null;
}

export function LiveSystemCard({ status, backup }: LiveSystemCardProps) {
  const m = useTranslations('admin.updates');
  const t = useTranslations();
  return (
    <Card padding="lg">
      <div className={styles.cardInner}>
        <div className={styles.head}>
          <h2 className={styles.cardTitle}>{m('sys.title')}</h2>
        </div>
        <DescriptionList
          dense
          columns={1}
          items={[
            { label: m('sys.version'), value: <span translate="no">{status.currentVersion}</span> },
            { label: m('sys.maint'), value: status.inMaintenance ? <StatusPill status={t('common.on')} tone="warning" size="sm" /> : <StatusPill status={t('common.off')} tone="neutral" size="sm" /> },
            { label: m('rel.fallback'), value: status.fallbackActive ? <StatusPill status={m('sys.fallback')} tone="warning" size="sm" /> : <StatusPill status={m('sys.opendispatch')} tone="success" size="sm" /> },
            ...(backup === null
              ? []
              : [
                  {
                    label: m('rq.backup'),
                    value: (
                      <Tag color="gray">
                        <span dir="ltr" translate="no">
                          {backup}
                        </span>
                      </Tag>
                    ),
                  },
                ]),
          ]}
        />
      </div>
    </Card>
  );
}
