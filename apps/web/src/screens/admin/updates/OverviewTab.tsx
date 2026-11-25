'use client';
// SPDX-License-Identifier: AGPL-3.0-only

import { Badge, Card, EmptyState, DescriptionList, Stat, StatusPill, Tag, type Tone } from '@opendispatch/ui';
import { CircleCheck } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { AdminTable } from '@/components/opendispatch/patterns/AdminTable';
import { useUrlState } from '@/components/opendispatch/patterns/useUrlState';
import { AttentionAlert, LiveSystemCard, ResultAlert, RestoreCard, RunCard } from './RecoveryCards';
import { ReleaseCard } from './ReleaseCard';
import { ApplyDialog, ResumeDialog, RestoreDialog } from './UpdateDialogs';
import { CheckNowButton } from './UpdatesHeader';
import { useWhen } from './UpdatesShared';
import { usePhaseRefresh } from './usePhaseRefresh';
import type { OverviewView, RecurringWindowView, ReleaseView, RunView, StatusView, WindowSlot } from './types';
import styles from './Updates.module.css';

// The Overview tab: the four figures, then either the recovery cards (a migration
// failed partway, a restore is requested, in progress or done), the release card with the next window and the approval, or
// "you are up to date". All of it is drawn from the OverviewView the server built. While a download, its verification or a
// restore request is under way the tab asks the server again every second (usePhaseRefresh) and stops when it is over.

export interface OverviewTabProps {
  readonly overview: OverviewView;
  readonly status: StatusView;
  readonly recurring: readonly RecurringWindowView[];
  readonly openWindows: readonly WindowSlot[];
  readonly history: { readonly failedStartedAt: string | null };
  readonly canEdit: boolean;
}

const RESULT_TONE: Readonly<Record<string, Tone>> = { update_found: 'info', up_to_date: 'neutral', failed: 'danger' };

export function OverviewTab({ overview, status, recurring, openWindows, history, canEdit }: OverviewTabProps) {
  const m = useTranslations('admin.updates');
  const t = useTranslations();
  const when = useWhen();
  const url = useUrlState();
  const [resuming, setResuming] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [lastRun, setLastRun] = useState<RunView | null>(null);
  // The release being applied, captured when the dialog opens: a successful apply can make the next poll drop the
  // release from `overview` (it is no longer pending), which would otherwise unmount ReleaseCard and close this dialog
  // on the caller before they can see the result and press Done. It lives here, not in ReleaseCard, so it survives that.
  const [applying, setApplying] = useState<ReleaseView | null>(null);
  usePhaseRefresh(overview.polling);

  const mode = overview.mode;
  const recovery = overview.recovery;
  const release = overview.release;
  const offline = status.connectionMode === 'offline';
  const inRecovery = mode === 'needs_attention' || mode === 'restore_requested' || mode === 'restore_in_progress' || mode === 'restored';
  const attention = mode === 'needs_attention' || mode === 'restore_requested' || mode === 'restore_in_progress';
  const result = overview.lastResult;
  // The run behind the recovery cards: the one the restore request names, else the one this tab has just been told about.
  const run = recovery?.run ?? (lastRun !== null && ((attention && lastRun.state === 'needs_attention') || (result !== null && lastRun.version === result.version)) ? lastRun : null);
  const failedVersion = recovery?.version ?? '';
  const first = recurring[0];

  const lastCheck = status.lastCheckAt === null ? '-' : when.dateTime(status.lastCheckAt);
  const resultKey = status.lastCheckResult;
  const resultPill = resultKey === null ? null : <StatusPill status={resultKey === 'update_found' ? m('result.found') : resultKey === 'up_to_date' ? m('state.empty') : m('result.failed')} tone={RESULT_TONE[resultKey] ?? 'neutral'} size="sm" />;

  return (
    <div className={styles.stack}>
      {attention && recovery !== null ? <AttentionAlert recovery={recovery} mode={mode} canEdit={canEdit} onResume={() => setResuming(true)} onRestore={() => setRestoring(true)} /> : null}
      {mode === 'restored' ? <ResultAlert kind="restored" version={recovery?.restore?.version ?? recovery?.version ?? ''} from={null} current={status.currentVersion} onHistory={() => url.update({ tab: 'history' })} /> : null}
      {result === null ? null : <ResultAlert kind={result.kind} version={result.version} from={result.from} current={status.currentVersion} onHistory={() => url.update({ tab: 'history' })} />}

      <div className={styles.statGrid}>
        <Stat label={m('stat.version')} value={<bdi translate="no">{status.currentVersion}</bdi>} />
        <Stat label={m('channel')} value={status.channel === 'hotfix' ? m('ch.hotfix') : m('ch.stable')} />
        <Stat label={m('stat.mode')} value={status.connectionMode === 'connected' ? m('mode.connected') : m('mode.offline')} />
        <Stat
          label={m('stat.check')}
          value={
            <bdi dir="ltr" translate="no">
              <span className={styles.wrapValue}>{lastCheck}</span>
            </bdi>
          }
          footer={resultPill}
        />
      </div>

      {inRecovery && recovery !== null ? (
        <div className={styles.grid2}>
          <div className={styles.col}>
            {recovery.restore === null ? null : <RestoreCard restore={recovery.restore} />}
            {run === null ? null : <RunCard run={run} />}
          </div>
          <aside className={styles.col}>
            <LiveSystemCard status={status} backup={attention || mode === 'restored' ? recovery.backupReference : null} />
          </aside>
        </div>
      ) : null}

      {result !== null && lastRun !== null && !inRecovery && lastRun.version === result.version ? (
        <div className={styles.grid2}>
          <div className={styles.col}>
            <RunCard run={lastRun} />
          </div>
          <aside className={styles.col}>
            <LiveSystemCard status={status} backup={null} />
          </aside>
        </div>
      ) : null}

      {release !== null && (mode === 'release' || mode === 'restored') ? (
        <div className={styles.grid2}>
          <div className={styles.col}>
            <ReleaseCard key={release.version} release={release} status={status} overview={overview} openWindows={openWindows} canEdit={canEdit} offline={offline} onApply={() => setApplying(release)} />
            {overview.others.length === 0 ? null : (
              <Card padding="none">
                <div className={styles.cardHeader}>
                  <h2 className={styles.cardTitle}>{m('others.title')}</h2>
                </div>
                <AdminTable
                  caption={m('others.title')}
                  rowParam="release"
                  pageSize={0}
                  dense
                  columns={[
                    { key: 'version', header: m('h.version') },
                    { key: 'channel', header: m('channel'), hideBelow: 'md' },
                    { key: 'state', header: t('common.status') },
                    { key: 'published', header: m('others.published'), hideBelow: 'md' },
                  ]}
                  rows={overview.others.map((other) => ({
                    id: other.version,
                    cells: {
                      version: <span className={styles.strong} translate="no">{other.version}</span>,
                      channel: <Tag color="gray">{other.channel === 'hotfix' ? m('ch.hotfix') : m('ch.stable')}</Tag>,
                      state: <StatusPill status={m(`rs.${other.state}`)} tone={other.state === 'withdrawn' ? 'danger' : other.state === 'ready' || other.state === 'verified' ? 'success' : other.state === 'scheduled' ? 'warning' : 'info'} size="sm" />,
                      published: <bdi translate="no">{when.format.date(other.publishedAt)}</bdi>,
                    },
                  }))}
                />
              </Card>
            )}
          </div>
          <aside className={styles.col}>
            <Card padding="lg">
              <div className={styles.cardInner}>
                <div className={styles.head}>
                  <h2 className={styles.cardTitle}>{m('nw.title')}</h2>
                  {overview.nextWindow === null ? null : overview.nextWindow.open ? <StatusPill status={m('win.open')} tone="success" size="sm" /> : <StatusPill status={m('win.blocked')} tone="warning" size="sm" />}
                </div>
                <DescriptionList
                  dense
                  columns={1}
                  items={[
                    { label: m('nw.when'), value: overview.nextWindow === null ? '-' : <bdi translate="no">{when.windowText(overview.nextWindow.start, overview.nextWindow.end)}</bdi> },
                    { label: m('nw.rule'), value: first === undefined ? '-' : <span>{windowRule(first, when)}</span> },
                    { label: m('nw.tz'), value: <Tag color="gray"><span translate="no">Asia/Riyadh</span></Tag> },
                  ]}
                />
              </div>
            </Card>
            <Card padding="lg">
              <div className={styles.cardInner}>
                <div className={styles.head}>
                  <h2 className={styles.cardTitle}>{m('ap.title')}</h2>
                </div>
                <DescriptionList
                  dense
                  columns={1}
                  items={[
                    { label: m('ap.approver'), value: overview.approvers.length === 0 ? <span>{m('ap.none')}</span> : <span translate="no">{overview.approvers.map((person) => person.name).join(', ')}</span> },
                    { label: m('ap.second'), value: overview.secondApproverRequired ? <Badge tone="warning" size="sm">{m('ap.required')}</Badge> : m('ap.notRequired') },
                  ]}
                />
              </div>
            </Card>
          </aside>
        </div>
      ) : null}

      {release === null && mode === 'up_to_date' ? (
        <Card padding="none">
          <EmptyState compact icon={<CircleCheck />} title={m('states.empty.title')} description={m('states.empty.desc')} action={<CheckNowButton canEdit={canEdit} offline={offline} variant="secondary" />} />
        </Card>
      ) : null}

      <ApplyDialog
        open={applying !== null}
        onClose={() => setApplying(null)}
        version={applying?.version ?? ''}
        from={status.currentVersion}
        preflight={applying?.preflight ?? null}
        migrations={applying?.migrations.length ?? 0}
        onRun={setLastRun}
      />

      {recovery === null ? null : (
        <>
          <ResumeDialog open={resuming} onClose={() => setResuming(false)} version={failedVersion} from={status.currentVersion} onRun={setLastRun} />
          <RestoreDialog open={restoring} onClose={() => setRestoring(false)} version={failedVersion} runningAs={status.currentVersion} backup={recovery.backupReference ?? `backup-before-${failedVersion}`} takenAt={history.failedStartedAt} />
        </>
      )}
    </div>
  );
}

/** "Sunday to Thursday, 03:00 to 05:00" in the reader's language. */
export function windowRule(window: RecurringWindowView, when: ReturnType<typeof useWhen>): string {
  const days = [...window.days].sort((a, b) => a - b);
  const consecutive = days.every((day, index) => index === 0 || day === (days[index - 1] ?? 0) + 1);
  const dayText = days.length > 2 && consecutive ? when.rangeOfDays(days[0] ?? 0, days[days.length - 1] ?? 0) : days.map((day) => when.longDay(day)).join(when.separator);
  return `${dayText}, ${when.range(window.start, window.end)}`;
}
