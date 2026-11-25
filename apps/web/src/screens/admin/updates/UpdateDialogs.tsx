'use client';
// SPDX-License-Identifier: AGPL-3.0-only

import { Alert, Button, DescriptionList, Field, Input, Modal, Progress, RadioGroup, Select, Stack, Tag, Textarea } from '@opendispatch/ui';
import { Info, Play, ArchiveRestore } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import { ActionError } from '@/components/opendispatch/patterns/ActionError';
import { ConfirmDialog } from '@/components/opendispatch/patterns/ConfirmDialog';
import { useAdminAction } from '@/components/opendispatch/patterns/useAdminAction';
import { Reason, ReasonHint } from '@/components/opendispatch/ReasonHint';
import { applyRelease, emergencyOverride, recoverUpdate, scheduleRelease } from './actions';
import { preflightRows, runRows } from './checks';
import { CheckList, useWhen } from './UpdatesShared';
import type { EmergencyChoices, PreflightView, RunView, WindowSlot } from './types';
import styles from './Updates.module.css';

// The dialogs of the Updates screen (mockup: `#up-apply-modal`, `#up-sched-modal`, `#up-emg-modal`, `#up-resume-modal`,
// `#up-restore-modal`). The skip dialog is a ReasonDialog in the release card. Every write is a server action through
// useAdminAction; the data layer authorises, validates and audits. THE UPDATE AGENT IS A STUB: an apply finishes in the call
// that asks for it, so the run comes back complete and is drawn as it is, without an animation of its own.

// ---------------------------------------------------------------------------------------------
// Schedule
// ---------------------------------------------------------------------------------------------

export interface ScheduleDialogProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly version: string;
  /** The open change windows, soonest first. */
  readonly windows: readonly WindowSlot[];
  /** Who has to approve: names of the listed approvers (empty when the change policy lists none). */
  readonly approvers: readonly string[];
  readonly secondRequired: boolean;
}

export function ScheduleDialog({ open, onClose, version, windows, approvers, secondRequired }: ScheduleDialogProps) {
  const m = useTranslations('admin.updates');
  const t = useTranslations();
  const when = useWhen();
  const name = useId();
  const [chosen, setChosen] = useState<string | undefined>(undefined);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setChosen(windows[0]?.start);
  }
  const schedule = useAdminAction(scheduleRelease, {
    successTitle: m('toast.scheduled'),
    successDescription: (result) => when.windowText(result.windowStart, result.windowEnd),
    onSuccess: onClose,
  });
  const selected = chosen ?? windows[0]?.start;
  const needs = approvers.length > 0 ? m('sched.needsNames', { names: approvers.join(', ') }) : secondRequired ? m('sched.needsSecond') : m('sched.noApproval');
  return (
    <Modal
      open={open}
      onClose={() => {
        schedule.reset();
        onClose();
      }}
      title={m('sched.title')}
      description={m('sched.desc')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <ReasonHint reason={selected === undefined ? m('sched.noWindow') : null} visible={false}>
            <Button variant="primary" loading={schedule.pending} onClick={() => selected !== undefined && schedule.run({ version, window_start: selected })}>
              {m('schedule')}
            </Button>
          </ReasonHint>
        </>
      }
    >
      <Stack gap={16}>
        {windows.length === 0 ? (
          <Alert tone="warning">{m('sched.noWindow')}</Alert>
        ) : (
          <RadioGroup
            name={name}
            value={selected}
            onChange={setChosen}
            options={windows.map((slot) => ({ value: slot.start, label: <span translate="no">{when.windowText(slot.start, slot.end)}</span> }))}
          />
        )}
        <Reason icon={<Info />}>{needs}</Reason>
        <ActionError error={schedule.error} onDismiss={schedule.reset} />
      </Stack>
    </Modal>
  );
}

// ---------------------------------------------------------------------------------------------
// Apply: pre-flight results first, then the run
// ---------------------------------------------------------------------------------------------

export interface ApplyDialogProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly version: string;
  readonly from: string;
  readonly preflight: PreflightView | null;
  readonly migrations: number;
  /** The run that came back, so the Overview can show its card. */
  readonly onRun: (run: RunView) => void;
}

export function ApplyDialog({ open, onClose, version, from, preflight, migrations, onRun }: ApplyDialogProps) {
  const m = useTranslations('admin.updates');
  const t = useTranslations();
  const [run, setRun] = useState<RunView | null>(null);
  // The version the install ran when the apply started: the prop moves to the new one once it lands.
  const [started, setStarted] = useState<string | null>(null);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setRun(null);
      setStarted(null);
    }
  }
  const shownFrom = started ?? from;
  const apply = useAdminAction(applyRelease, {
    quiet: true,
    onSuccess: (result) => {
      setRun(result.run);
      onRun(result.run);
    },
  });
  const passed = preflight?.checks.filter((check) => check.status === 'passed').length ?? 0;
  const total = preflight?.checks.length ?? 6;
  const done = run === null ? 0 : run.steps.filter((step) => step.state === 'succeeded' || step.state === 'skipped').length;
  const percent = run === null ? 0 : Math.round((done / run.steps.length) * 100);
  const failed = run?.steps.some((step) => step.state === 'failed') === true;
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={m('apply.title', { v: version })}
      description={<span translate="no">{m('apply.from', { a: shownFrom, b: version })}</span>}
      footer={
        run === null ? (
          <>
            <Button variant="ghost" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="primary"
              startIcon={<Play />}
              loading={apply.pending}
              onClick={() => {
                setStarted(from);
                apply.run({ version });
              }}
            >
              {m('applyNow')}
            </Button>
          </>
        ) : (
          <Button variant="primary" onClick={onClose}>
            {m('done')}
          </Button>
        )
      }
    >
      <Stack gap={16}>
        {run === null ? (
          <>
            <div className={styles.between}>
              <span className={styles.label}>{m('pf.title')}</span>
              <span className={styles.meta}>{m('rel.checksPassed', { n: passed })}</span>
            </div>
            {preflight === null ? null : <CheckList label={m('pf.title')} rows={preflightRows(preflight, shownFrom, version, migrations, m).slice(0, total)} />}
            <ActionError error={apply.error} onDismiss={apply.reset} />
          </>
        ) : (
          <>
            <Progress value={percent} tone={failed ? 'danger' : 'info'} label={m('run.title')} showValue />
            <CheckList label={m('run.title')} rows={runRows(run, m)} />
            {run.state === 'succeeded' ? (
              <Alert tone="success" title={m('run.done')}>
                {m('run.health')}
              </Alert>
            ) : run.state === 'rolled_back' ? (
              <Alert tone="warning" title={m('rb.title', { v: version, from: shownFrom })}>
                {m('rb.why')} {m('toast.rolledBack.desc')}
              </Alert>
            ) : (
              <Alert tone="danger" title={m('na.title', { v: version })}>
                {m('toast.needsAttention.desc')}
              </Alert>
            )}
          </>
        )}
      </Stack>
    </Modal>
  );
}

// ---------------------------------------------------------------------------------------------
// Resume and restore
// ---------------------------------------------------------------------------------------------

export interface ResumeDialogProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly version: string;
  readonly from: string;
  readonly onRun: (run: RunView) => void;
}

export function ResumeDialog({ open, onClose, version, from, onRun }: ResumeDialogProps) {
  const m = useTranslations('admin.updates');
  const resume = useAdminAction(recoverUpdate, {
    quiet: true,
    onSuccess: (result) => {
      onClose();
      if (result.run !== null) onRun(result.run);
    },
  });
  return (
    <ConfirmDialog
      open={open}
      onClose={() => {
        resume.reset();
        onClose();
      }}
      onConfirm={() => resume.run({ action: 'resume', note: '' })}
      title={m('res.title', { v: version })}
      description={m('res.desc')}
      confirmLabel={m('resume')}
      pending={resume.pending}
      error={<ActionError error={resume.error} onDismiss={resume.reset} />}
    >
      <Stack gap={16}>
        <DescriptionList
          dense
          columns={1}
          items={[
            { label: m('res.from'), value: <span translate="no">{from}</span> },
            { label: m('res.to'), value: <span translate="no">{version}</span> },
            { label: m('sys.maint'), value: m('res.maintV') },
          ]}
        />
        <Reason icon={<Info />}>{m('res.hint')}</Reason>
      </Stack>
    </ConfirmDialog>
  );
}

export interface RestoreDialogProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly version: string;
  /** The version the install runs, and runs again as after the restore. */
  readonly runningAs: string;
  readonly backup: string;
  /** When the backup was taken (the failed update's start), when the history says. */
  readonly takenAt: string | null;
}

const MAX_NOTE = 500;

export function RestoreDialog({ open, onClose, version, runningAs, backup, takenAt }: RestoreDialogProps) {
  const m = useTranslations('admin.updates');
  const t = useTranslations();
  const when = useWhen();
  const [note, setNote] = useState('');
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setNote('');
  }
  const restore = useAdminAction(recoverUpdate, {
    successTitle: m('toast.restoreReq.title'),
    successDescription: m('toast.restoreReq.desc'),
    onSuccess: onClose,
  });
  const trimmed = note.trim();
  const need = trimmed === '' ? m('skip.need') : null;
  return (
    <Modal
      open={open}
      onClose={() => {
        restore.reset();
        onClose();
      }}
      title={m('rst.title', { v: version })}
      description={m('rst.desc')}
      footer={
        <>
          {need === null ? null : <Reason icon={<Info />}>{need}</Reason>}
          <span className={styles.push} />
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <ReasonHint reason={need} visible={false}>
            <Button variant="danger" startIcon={<ArchiveRestore />} loading={restore.pending} onClick={() => need === null && restore.run({ action: 'restore', note: trimmed })}>
              {m('rst.go')}
            </Button>
          </ReasonHint>
        </>
      }
    >
      <Stack gap={16}>
        <Alert tone="danger" title={m('rst.warnT', { v: version })}>
          {m('rst.warnB')}
        </Alert>
        <DescriptionList
          dense
          columns={1}
          items={[
            {
              label: m('rst.what'),
              value: (
                <Tag color="gray">
                  <span translate="no">{backup}</span>
                </Tag>
              ),
            },
            ...(takenAt === null ? [] : [{ label: m('rst.taken'), value: <bdi translate="no">{when.dateTime(takenAt)}</bdi> }]),
            { label: m('rst.back'), value: <span translate="no">{runningAs}</span> },
            { label: m('rst.after'), value: m('rst.afterV') },
            { label: m('rq.doer'), value: m('rq.team') },
          ]}
        />
        <Field label={t('common.reason')} required>
          <Textarea value={note} rows={2} maxLength={MAX_NOTE} data-autofocus="" onChange={(event) => setNote(event.target.value)} />
        </Field>
        <span className={styles.counter} dir="ltr" translate="no">
          {note.length} / {MAX_NOTE}
        </span>
        <ActionError error={restore.error} onDismiss={restore.reset} />
      </Stack>
    </Modal>
  );
}

// ---------------------------------------------------------------------------------------------
// Emergency override
// ---------------------------------------------------------------------------------------------

export interface EmergencyDialogProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly choices: EmergencyChoices;
  readonly canEdit: boolean;
  readonly onRun: (run: RunView) => void;
}

export function EmergencyDialog({ open, onClose, choices, canEdit, onRun }: EmergencyDialogProps) {
  const m = useTranslations('admin.updates');
  const t = useTranslations();
  const [release, setRelease] = useState('');
  const [second, setSecond] = useState('');
  const [reason, setReason] = useState('');
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setRelease(choices.releases[0]?.version ?? '');
      setSecond(choices.secondApprovers[0]?.id ?? '');
      setReason('');
    }
  }
  const override = useAdminAction(emergencyOverride, {
    successTitle: (result) => m('toast.emergency.title', { v: result.run.version }),
    successDescription: m('toast.emergency.desc'),
    onSuccess: (result) => {
      onClose();
      onRun(result.run);
    },
  });
  const trimmed = reason.trim();
  const version = release === '' ? (choices.releases[0]?.version ?? '') : release;
  const secondId = second === '' ? (choices.secondApprovers[0]?.id ?? '') : second;
  const need = !canEdit
    ? t('opendispatch.gate.viewOnly')
    : !choices.enabled
      ? m('emg.off')
      : choices.releases.length === 0
        ? m('emg.noRelease')
        : choices.secondApprovers.length === 0
          ? m('emg.noApprover')
          : trimmed.length < choices.minLength
            ? m('emg.need', { n: choices.minLength })
            : null;
  return (
    <Modal
      open={open}
      onClose={() => {
        override.reset();
        onClose();
      }}
      title={m('menu.emergency')}
      description={m('emg.desc')}
      footer={
        <>
          <span className={styles.push} />
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <ReasonHint reason={need} visible={false}>
            <Button variant="danger" loading={override.pending} onClick={() => need === null && override.run({ version, second_approver_user_id: secondId, reason: trimmed })}>
              {m('applyNow')}
            </Button>
          </ReasonHint>
        </>
      }
    >
      <Stack gap={16}>
        <Field label={m('emg.release')}>
          <Select
            value={version}
            disabled={choices.releases.length === 0}
            onChange={(event) => setRelease(event.target.value)}
            options={choices.releases.map((option) => ({ value: option.version, label: `${option.version}${option.channel === 'hotfix' ? ` (${m('ch.hotfix').toLowerCase()})` : ''}` }))}
          />
        </Field>
        <div className={styles.formGrid}>
          <Field label={m('emg.first')}>
            <Input value={choices.firstApprover} readOnly translate="no" />
          </Field>
          <Field label={m('emg.second')}>
            <Select value={secondId} disabled={choices.secondApprovers.length === 0} onChange={(event) => setSecond(event.target.value)} options={choices.secondApprovers.map((person) => ({ value: person.id, label: person.name }))} />
          </Field>
        </div>
        <Field label={t('common.reason')} required hint={<span><bdi dir="ltr" translate="no">{trimmed.length} / {choices.minLength}</bdi> {m('emg.min')}</span>}>
          <Textarea value={reason} rows={3} maxLength={1000} onChange={(event) => setReason(event.target.value)} />
        </Field>
        {need === null ? null : <Reason icon={<Info />}>{need}</Reason>}
        <ActionError error={override.error} onDismiss={override.reset} />
      </Stack>
    </Modal>
  );
}
