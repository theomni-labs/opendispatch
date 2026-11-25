'use client';
// SPDX-License-Identifier: AGPL-3.0-only

import { Alert, Badge, Button, Card, DescriptionList, StatusPill, Tag, useToast, type Tone } from '@opendispatch/ui';
import { Check, CalendarCheck, Download, Info, Play, RefreshCw, ShieldCheck, SkipForward, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { ActionError } from '@/components/opendispatch/patterns/ActionError';
import { ReasonDialog } from '@/components/opendispatch/patterns/ReasonDialog';
import { useAdminAction } from '@/components/opendispatch/patterns/useAdminAction';
import { Reason, ReasonHint, useGate } from '@/components/opendispatch/ReasonHint';
import { approveRelease, cancelSchedule, confirmBackup, downloadRelease, rejectRelease, runPreflight, skipRelease } from './actions';
import { imageRows, passedCount, preflightRows, verifyReason, verifyRows, type Translate } from './checks';
import { ScheduleDialog } from './UpdateDialogs';
import { CheckList, DataText, DownloadBar, useWhen } from './UpdatesShared';
import type { DecisionGate, OverviewView, ReleaseStage, ReleaseView, StatusView, WindowSlot } from './types';
import styles from './Updates.module.css';

// The release card of the Overview and its stages: available,
// downloading, verifying, verified, verify_failed, ready, awaiting approval, approved. The stage comes from the agent's
// state (view.ts stageOf); nothing here decides it. A download and its verification take time in the scripted agent, and the
// Overview asks the server again while they run (OverviewTab), so this card only draws what it is given. THE UPDATE AGENT IS A
// STUB: the release notes and results carry "(stub)" from the data layer.

const STAGE_PILL: Readonly<Record<ReleaseStage, { tone: Tone; key: 'rel.avail' | 'state.downloading' | 'state.verifying' | 'rel.verified' | 'rel.discarded' | 'rel.ready' | 'state.awaiting' | 'appr.title' }>> = {
  available: { tone: 'info', key: 'rel.avail' },
  downloading: { tone: 'info', key: 'state.downloading' },
  verifying: { tone: 'info', key: 'state.verifying' },
  verified: { tone: 'success', key: 'rel.verified' },
  verify_failed: { tone: 'danger', key: 'rel.discarded' },
  ready: { tone: 'success', key: 'rel.ready' },
  awaiting: { tone: 'warning', key: 'state.awaiting' },
  approved: { tone: 'success', key: 'appr.title' },
};

export interface ReleaseCardProps {
  readonly release: ReleaseView;
  readonly status: StatusView;
  readonly overview: OverviewView;
  /** The open windows a person may schedule into (the first few of the upcoming ones). */
  readonly openWindows: readonly WindowSlot[];
  readonly canEdit: boolean;
  readonly offline: boolean;
  /** The Apply dialog lives in the Overview tab, not here: a successful apply can make the next refresh drop this card
   * (the release is no longer pending), and the dialog must survive that to let the caller see the result and press Done. */
  readonly onApply: () => void;
}

/** Why the Approve and Reject buttons are unavailable, in the reader's language (null when the caller may decide). */
function decisionReason(gate: DecisionGate, m: Translate, roleReason: string): string | null {
  switch (gate) {
    case 'allowed':
    case 'nothing_to_decide':
      return null;
    case 'own_request':
      return m('await.self');
    case 'not_an_approver_role':
      return roleReason;
    case 'not_listed':
      return m('await.notListed');
    case 'already_decided':
      return m('await.decided');
  }
}

export function ReleaseCard({ release, status, overview, openWindows, canEdit, offline, onApply }: ReleaseCardProps) {
  const m = useTranslations('admin.updates');
  const t = useTranslations();
  const toast = useToast();
  const when = useWhen();
  const gate = useGate(canEdit ? 'edit' : 'view');
  const stage = release.stage;
  const version = release.version;
  const [scheduling, setScheduling] = useState(false);
  const [skipping, setSkipping] = useState(false);
  const previous = useRef<ReleaseStage | null>(stage);

  // The phases end on their own: say so once, in the toast the mockup has, when the poll sees the end.
  useEffect(() => {
    if (previous.current === 'verifying' && stage === 'verified') toast({ title: m('toast.dlDone.title', { v: version }), description: m('toast.dlDone.desc'), tone: 'success' });
    else if ((previous.current === 'verifying' || previous.current === 'downloading') && stage === 'verify_failed') toast({ title: m('toast.dlFailed', { v: version }), tone: 'danger' });
    previous.current = stage;
  }, [stage, toast, m, version]);

  const download = useAdminAction(downloadRelease, {
    onSuccess: (result) => {
      if (result.state === 'verified') toast({ title: m('toast.dlDone.title', { v: version }), description: m('toast.dlDone.desc'), tone: 'success' });
    },
    quiet: true,
  });
  const preflight = useAdminAction(runPreflight, {
    quiet: true,
    onSuccess: (result) => toast(result.state === 'passed' ? { title: m('toast.preflight.title'), description: m('toast.preflight.desc'), tone: 'success' } : { title: m('toast.preflightWait'), tone: 'info' }),
  });
  const backup = useAdminAction(confirmBackup, {
    quiet: true,
    onSuccess: (result) => toast(result.state === 'passed' ? { title: m('toast.backup'), description: m('toast.preflight.desc'), tone: 'success' } : { title: m('toast.backup'), tone: 'success' }),
  });
  const unschedule = useAdminAction(cancelSchedule, { successTitle: m('toast.unscheduled') });
  const approve = useAdminAction(approveRelease, { successTitle: m('toast.approved') });
  const reject = useAdminAction(rejectRelease, { successTitle: m('toast.rejected') });
  const skip = useAdminAction(skipRelease, {
    successTitle: () => m('toast.skipped', { v: version }),
    onSuccess: () => setSkipping(false),
  });

  const editReason = gate.edit.reason;
  const decision = overview.decision;
  const decideReason = decisionReason(decision, m, t('opendispatch.gate.approve'));
  const schedule = release.schedule;
  const windowText = schedule === null ? '' : when.windowText(schedule.windowStart, schedule.windowEnd);
  const approvedBy = schedule === null ? [] : schedule.approvals.filter((a) => a.decision === 'approved').map((a) => a.name);
  const pill = stage === null ? null : STAGE_PILL[stage];
  const preflightPassed = passedCount(release.preflight);
  const nextWindow = overview.nextWindow === null ? '-' : when.windowText(overview.nextWindow.start, overview.nextWindow.end);

  const verifyContext = {
    version,
    current: status.currentVersion,
    images: release.images,
    indexValidUntil: status.indexValidUntil,
    date: (iso: string) => when.format.date(iso),
    badImage: release.download?.verification?.digestsMatch === false ? (release.download.images.find((image) => image.state === 'failed')?.name ?? null) : null,
    connected: status.connectionMode === 'connected',
  } as const;

  const signature = stage === 'verify_failed' ? <Badge tone="danger" size="sm">{m('st.failed')}</Badge> : stage === 'verifying' ? <Badge tone="info" size="sm">{m('rel.checking')}</Badge> : stage === 'verified' || stage === 'ready' || stage === 'awaiting' || stage === 'approved' ? <Badge tone="success" size="sm">{m('rel.verified')}</Badge> : <Badge tone="neutral" size="sm">{m('rel.notChecked')}</Badge>;
  const preflightFact =
    release.preflight === null || release.preflight.state === 'not_run' ? (
      <StatusPill status={m('rel.notRun')} tone="neutral" size="sm" />
    ) : release.preflight.state === 'passed' ? (
      <StatusPill status={m('rel.checksPassed', { n: preflightPassed })} tone="success" size="sm" />
    ) : (
      <StatusPill status={release.waitingForBackup ? m('pf.needs') : m('rel.checksSome', { n: preflightPassed })} tone={release.waitingForBackup ? 'warning' : 'danger'} size="sm" />
    );

  const viewOnlyLine = editReason === null ? null : <Reason icon={<Info />}>{editReason}</Reason>;

  return (
    <Card padding="lg" id="up-release" data-stage={stage ?? undefined}>
      <div className={styles.cardInner}>
        <div className={styles.head}>
          <div className={styles.headTitle}>
            <h2 className={styles.cardTitle}>
              {m('rel.title')} <span translate="no">{version}</span>
            </h2>
            {pill === null ? null : <StatusPill status={m(pill.key)} tone={pill.tone} size="sm" />}
          </div>
          <span className={styles.meta}>
            <Tag color="gray">{release.channel === 'hotfix' ? m('ch.hotfix') : m('ch.stable')}</Tag> <bdi translate="no">{when.format.date(release.publishedAt)}</bdi>
          </span>
        </div>

        <div className={styles.stack}>
          <p className={styles.notes}>{release.notes}</p>
          <DescriptionList
            columns={2}
            items={[
              {
                label: m('rel.changes'),
                span: 2,
                value: (
                  <span className={styles.stackTight}>
                    {release.migrations.length === 0 ? <span>{m('rel.noMigrations')}</span> : release.migrations.map((migration) => <DataText key={migration.id}>{migration.summary ?? migration.id}</DataText>)}
                    <span className={styles.tags}>
                      {release.images.map((image) => (
                        <Tag key={image} color="gray">
                          <span translate="no">{image}</span>
                        </Tag>
                      ))}
                    </span>
                  </span>
                ),
              },
              { label: m('rel.downtime'), value: release.needsDowntime ? (release.downtimeMinutes === null ? m('rel.downtimeYes') : m('rel.downtimeMin', { n: release.downtimeMinutes })) : m('rel.none') },
              { label: m('rel.fallback'), value: release.liveFallback ? m('rel.fallbackYes') : m('rel.fallbackNone') },
              { label: m('rel.rollback'), value: release.restoreToRollback ? m('rel.rollbackRestore') : m('rel.rollbackAuto') },
              { label: m('rel.checks'), value: preflightFact },
              { label: m('rel.signature'), value: signature },
              { label: m('rel.next'), value: <bdi dir="ltr" translate="no">{nextWindow}</bdi> },
            ]}
          />

          {stage === 'available' ? (
            <div className={styles.stackTight}>
              <div className={styles.actions}>
                <ReasonHint reason={editReason ?? (offline ? m('dl.offline') : null)} visible={false}>
                  <Button variant="primary" startIcon={<Download />} loading={download.pending} onClick={() => !editReason && !offline && download.run({ version })}>
                    {m('download')}
                  </Button>
                </ReasonHint>
                <SkipButton reason={editReason} onClick={() => setSkipping(true)} label={m('skip.label')} />
              </div>
              <Reason icon={<Info />}>{m('avail.hint')}</Reason>
              {viewOnlyLine}
              <ActionError error={download.error} onDismiss={download.reset} />
            </div>
          ) : null}

          {stage === 'downloading' && release.download !== null ? (
            <div className={styles.stack} aria-live="polite">
              <DownloadBar done={release.download.bytesDone} total={release.download.bytesTotal} label={m('dl.title')} />
              <CheckList label={m('dl.title')} rows={imageRows(release.download, m)} />
              <Reason icon={<Info />}>{m('dl.wait')}</Reason>
            </div>
          ) : null}

          {stage === 'verifying' && release.download !== null ? (
            <div className={styles.stack} aria-live="polite">
              <DownloadBar done={release.download.bytesTotal} total={release.download.bytesTotal} label={m('vf.done')} tone="success" />
              <div className={styles.stackTight}>
                <div className={styles.between}>
                  <span className={styles.label}>{m('vf.title')}</span>
                  <StatusPill status={m('state.verifying')} tone="info" size="sm" />
                </div>
                <CheckList label={m('vf.title')} rows={verifyRows(null, verifyContext, m)} />
              </div>
              <Reason icon={<Info />}>{m('dl.wait')}</Reason>
            </div>
          ) : null}

          {stage === 'verified' && release.download !== null ? (
            <div className={styles.stack} aria-live="polite">
              <DownloadBar done={release.download.bytesTotal} total={release.download.bytesTotal} label={m('vf.done')} tone="success" />
              <div className={styles.stackTight}>
                <div className={styles.between}>
                  <span className={styles.label}>{m('vf.title')}</span>
                  <StatusPill status={m('rel.verified')} tone="success" size="sm" />
                </div>
                <CheckList label={m('vf.title')} rows={verifyRows(release.download.verification, verifyContext, m)} />
              </div>
              {release.preflight !== null && release.preflight.state !== 'not_run' ? (
                <div className={styles.stackTight}>
                  <div className={styles.between}>
                    <span className={styles.label}>{m('pf.title')}</span>
                    {preflightFact}
                  </div>
                  <CheckList label={m('pf.title')} rows={preflightRows(release.preflight, status.currentVersion, version, release.migrations.length, m)} />
                </div>
              ) : null}
              <div className={styles.stackTight}>
                <div className={styles.actions}>
                  {release.waitingForBackup ? (
                    <ReasonHint reason={editReason} visible={false}>
                      <Button variant="primary" startIcon={<Check />} loading={backup.pending} onClick={() => !editReason && backup.run({ version })}>
                        {m('backup.confirm')}
                      </Button>
                    </ReasonHint>
                  ) : (
                    <ReasonHint reason={editReason} visible={false}>
                      <Button variant="primary" startIcon={<ShieldCheck />} loading={preflight.pending} onClick={() => !editReason && preflight.run({ version })}>
                        {m('preflight')}
                      </Button>
                    </ReasonHint>
                  )}
                  <SkipButton reason={editReason} onClick={() => setSkipping(true)} label={m('skip.label')} />
                </div>
                {viewOnlyLine}
                <ActionError error={preflight.error ?? backup.error} onDismiss={() => (preflight.error === null ? backup.reset() : preflight.reset())} />
              </div>
            </div>
          ) : null}

          {stage === 'verify_failed' ? (
            <div className={styles.stack}>
              <Alert tone="danger" title={m('vf.failedT')}>
                {m('vf.failedB')} {verifyReason(release.download?.verification ?? null, m) ?? ''}
              </Alert>
              <div className={styles.stackTight}>
                <span className={styles.label}>{m('vf.title')}</span>
                <CheckList label={m('vf.title')} rows={verifyRows(release.download?.verification ?? null, verifyContext, m)} />
              </div>
              <div className={styles.stackTight}>
                <div className={styles.actions}>
                  <ReasonHint reason={editReason} visible={false}>
                    <Button variant="primary" startIcon={<RefreshCw />} loading={download.pending} onClick={() => !editReason && download.run({ version })}>
                      {t('common.retry')}
                    </Button>
                  </ReasonHint>
                  <SkipButton reason={editReason} onClick={() => setSkipping(true)} label={m('skip.label')} />
                </div>
                {viewOnlyLine}
                <ActionError error={download.error} onDismiss={download.reset} />
              </div>
            </div>
          ) : null}

          {stage === 'ready' ? (
            <div className={styles.stackTight}>
              <div className={styles.actions}>
                <ReasonHint reason={editReason} visible={false}>
                  <Button variant="primary" startIcon={<CalendarCheck />} onClick={() => !editReason && setScheduling(true)}>
                    {m('schedule')}
                  </Button>
                </ReasonHint>
                <ReasonHint reason={editReason ?? m('apply.needs')} visible={false}>
                  <Button variant="secondary" startIcon={<Play />}>
                    {m('apply.label')}
                  </Button>
                </ReasonHint>
                <SkipButton reason={editReason} onClick={() => setSkipping(true)} label={m('skip.label')} />
              </div>
              <Reason>{editReason ?? m('apply.needs')}</Reason>
            </div>
          ) : null}

          {stage === 'awaiting' && schedule !== null ? (
            <div className={styles.stackTight}>
              <Alert tone="warning" title={m('await.title')}>
                {m('await.body', { name: schedule.requestedBy })} · <bdi dir="ltr" translate="no">{windowText}</bdi>
              </Alert>
              <div className={styles.actions}>
                <ReasonHint reason={decideReason} visible={false}>
                  <Button variant="primary" startIcon={<Check />} loading={approve.pending} onClick={() => decision === 'allowed' && approve.run({ version, note: '' })}>
                    {t('common.approve')}
                  </Button>
                </ReasonHint>
                <ReasonHint reason={decideReason} visible={false}>
                  <Button variant="secondary" startIcon={<X />} loading={reject.pending} onClick={() => decision === 'allowed' && reject.run({ version, note: '' })}>
                    {t('common.reject')}
                  </Button>
                </ReasonHint>
                <ReasonHint reason={editReason} visible={false} quiet>
                  <Button variant="ghost" loading={unschedule.pending} onClick={() => !editReason && unschedule.run({ version })}>
                    {m('unschedule')}
                  </Button>
                </ReasonHint>
              </div>
              {decideReason === null ? null : <Reason>{decideReason}</Reason>}
              <ActionError error={approve.error ?? reject.error ?? unschedule.error} onDismiss={() => { approve.reset(); reject.reset(); unschedule.reset(); }} />
            </div>
          ) : null}

          {stage === 'approved' && schedule !== null ? (
            <div className={styles.stackTight}>
              <Alert tone="success" title={m('appr.title')}>
                {approvedBy.length === 0 ? m('appr.auto') : m('appr.body', { name: approvedBy.join(', ') })} · <bdi dir="ltr" translate="no">{windowText}</bdi>
              </Alert>
              <div className={styles.actions}>
                <ReasonHint reason={editReason} visible={false}>
                  <Button variant="primary" startIcon={<Play />} onClick={() => !editReason && onApply()}>
                    {m('applyNow')}
                  </Button>
                </ReasonHint>
                <ReasonHint reason={editReason} visible={false} quiet>
                  <Button variant="ghost" loading={unschedule.pending} onClick={() => !editReason && unschedule.run({ version })}>
                    {m('unschedule')}
                  </Button>
                </ReasonHint>
              </div>
              {viewOnlyLine}
              <ActionError error={unschedule.error} onDismiss={unschedule.reset} />
            </div>
          ) : null}
        </div>
      </div>

      <ScheduleDialog
        open={scheduling}
        onClose={() => setScheduling(false)}
        version={version}
        windows={openWindows}
        approvers={overview.approvers.map((person) => person.name)}
        secondRequired={overview.secondApproverRequired}
      />
      <ReasonDialog
        open={skipping}
        onClose={() => {
          setSkipping(false);
          skip.reset();
        }}
        onConfirm={(reason) => skip.run({ version, reason })}
        title={m('skip.title')}
        confirmLabel={m('skip.label')}
        minLength={1}
        maxLength={300}
        pending={skip.pending}
        error={<ActionError error={skip.error} onDismiss={skip.reset} />}
      />
    </Card>
  );
}

function SkipButton({ reason, onClick, label }: { reason: string | null; onClick: () => void; label: string }) {
  return (
    <ReasonHint reason={reason} visible={false} quiet>
      <Button variant="ghost" startIcon={<SkipForward />} onClick={() => reason === null && onClick()}>
        {label}
      </Button>
    </ReasonHint>
  );
}
