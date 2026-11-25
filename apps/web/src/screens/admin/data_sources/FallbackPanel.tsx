'use client';
// SPDX-License-Identifier: AGPL-3.0-only

import { Badge, Button, Card, Field, QuantityInput, Switch, useFormat, useToast } from '@opendispatch/ui';
import { Info, Play, ShieldAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { ActionError } from '@/components/opendispatch/patterns/ActionError';
import { useAdminAction } from '@/components/opendispatch/patterns/useAdminAction';
import { FallbackBanner } from '@/components/opendispatch/FallbackBanner';
import { Reason, ReasonHint, useGate } from '@/components/opendispatch/ReasonHint';
import { saveFallback, sendSignal, setMaintenance } from './actions';
import { ReasonModal } from './ReasonModal';
import type { FallbackView } from './types';
import styles from './DataSources.module.css';
import { useDateTime } from '@/components/opendispatch/useDateTime';

// The aside of the Live assignment section: the fallback banner, the fallback
// settings (timeout 1 to 300 s, decision deadline 50 to 30,000 ms, the last signal, Send fallback signal or Resume OpenDispatch with a
// reason), and maintenance mode. RULE 19: The customer's dispatch is the fallback and takes over by itself; this screen only lets an
// Administrator ask it to take over now, or to hand control back, and both are audited with a reason.

export interface FallbackPanelProps {
  readonly fallback: FallbackView;
  readonly timeoutSeconds: number;
  readonly deadlineMs: number;
  readonly canEdit: boolean;
}

export function FallbackPanel({ fallback, timeoutSeconds, deadlineMs, canEdit }: FallbackPanelProps) {
  const m = useTranslations('admin.data_sources');
  const t = useTranslations();
  const format = useFormat();
  const dateTime = useDateTime();
  const toast = useToast();
  const gate = useGate(canEdit ? 'edit' : 'view');
  const [timeout, setTimeoutValue] = useState(timeoutSeconds);
  const [deadline, setDeadline] = useState(deadlineMs);
  const [signalling, setSignalling] = useState<'fallback' | 'resume' | null>(null);
  // The drafts follow the saved values when the server sends new ones (after a save, or another tab).
  const [seen, setSeen] = useState({ timeoutSeconds, deadlineMs });
  if (seen.timeoutSeconds !== timeoutSeconds || seen.deadlineMs !== deadlineMs) {
    setSeen({ timeoutSeconds, deadlineMs });
    setTimeoutValue(timeoutSeconds);
    setDeadline(deadlineMs);
  }

  const save = useAdminAction(saveFallback, { successTitle: m('toast.fbSaved') });
  const signal = useAdminAction(sendSignal, {
    quiet: true,
    onSuccess: () => {
      toast(signalling === 'resume' ? { title: m('toast.resume'), tone: 'success' } : { title: m('toast.signal.title'), description: m('toast.signal.desc'), tone: 'warning' });
      setSignalling(null);
    },
  });
  const maintenance = useAdminAction(setMaintenance, {
    quiet: true,
    onSuccess: (result) =>
      toast(result.state === 'maintenance' ? { title: m('toast.mntOn.title'), description: m('toast.mntOn.desc'), tone: 'warning' } : { title: m('toast.mntOff.title'), description: m('toast.mntOff.desc'), tone: 'success' }),
  });

  const state = fallback.state;
  const active = state !== 'armed';
  const dirty = timeout !== timeoutSeconds || deadline !== deadlineMs;
  const validTimeout = Number.isInteger(timeout) && timeout >= 1 && timeout <= 300;
  const validDeadline = Number.isInteger(deadline) && deadline >= 50 && deadline <= 30000;
  const saveReason = gate.edit.reason ?? (!dirty ? m('nochange') : !validTimeout || !validDeadline ? m('fb.range') : null);
  const since = fallback.since === null ? '' : format.time(fallback.since);
  const meta =
    state === 'armed' ? m('fb.meta.armed', { s: timeoutSeconds }) : state === 'maintenance' ? m('fb.meta.maintenance') : m('fb.meta.active', { time: since, reason: m(`fb.reason.${fallback.reason}`) });
  const lastSignal = fallback.lastSignal === 'fallback' ? m('fb.sig.fallback') : fallback.lastSignal === 'resume' ? m('fb.sig.resume') : m('fb.sig.none');
  const lastAt = fallback.lastSignalAt === null ? '-' : dateTime(fallback.lastSignalAt);
  const sendReason = gate.edit.reason ?? (state === 'maintenance' ? m('fb.inMaint') : null);

  return (
    <>
      <FallbackBanner active={active} title={m(`fb.state.${state}`)} meta={meta} />

      <Card padding="lg">
        <div className={styles.cardInner}>
          <div className={styles.head}>
            <h3 className={styles.cardTitle}>{m('fb.title')}</h3>
          </div>
          <div className={styles.formGrid}>
            <Field label={m('fb.timeout')}>
              <QuantityInput value={timeout} min={1} max={300} step={1} uom={m('uom.s')} disabled={!canEdit} aria-label={m('fb.timeout')} onChange={setTimeoutValue} />
            </Field>
            <Field label={m('fb.deadline')}>
              <QuantityInput value={deadline} min={50} max={30000} step={250} uom={m('uom.ms')} disabled={!canEdit} aria-label={m('fb.deadline')} onChange={setDeadline} />
            </Field>
          </div>
          <div className={styles.between}>
            {dirty ? <Reason icon={<Info />}>{m('unsaved')}</Reason> : <span />}
            <ReasonHint reason={saveReason} visible={false}>
              <Button variant="secondary" size="sm" loading={save.pending} onClick={() => saveReason === null && save.run({ timeoutSeconds: timeout, deadlineMs: deadline })}>
                {t('common.save')}
              </Button>
            </ReasonHint>
          </div>
          <ActionError error={save.error} onDismiss={save.reset} />
          <hr className={styles.divider} />
          <div className={styles.stackTight}>
            <div className={styles.kv}>
              <span className={styles.meta}>{m('fb.signal')}</span>
              <span>{lastSignal}</span>
            </div>
            <div className={styles.kv}>
              <span className={styles.meta}>{m('fb.last')}</span>
              <bdi dir="ltr" translate="no">
                {lastAt}
              </bdi>
            </div>
          </div>
          <div className={styles.actions}>
            {state === 'active' ? (
              <ReasonHint reason={gate.edit.reason} visible={false}>
                <Button variant="secondary" size="sm" startIcon={<Play />} onClick={() => gate.edit.allowed && setSignalling('resume')}>
                  {m('fb.resume')}
                </Button>
              </ReasonHint>
            ) : (
              <ReasonHint reason={sendReason} visible={false}>
                <Button variant="secondary" size="sm" startIcon={<ShieldAlert />} onClick={() => sendReason === null && setSignalling('fallback')}>
                  {m('fb.send')}
                </Button>
              </ReasonHint>
            )}
          </div>
          {sendReason === null ? null : <Reason>{sendReason}</Reason>}
        </div>
      </Card>

      <Card padding="lg">
        <div className={styles.cardInner}>
          <div className={styles.head}>
            <h3 className={styles.cardTitle}>{m('mnt.title')}</h3>
            {state === 'maintenance' ? (
              <Badge tone="warning" size="sm">
                {m('busy')}
              </Badge>
            ) : null}
          </div>
          <Switch
            label={m('mnt.switch')}
            checked={state === 'maintenance'}
            disabled={!canEdit || maintenance.pending}
            onCheckedChange={(next) => gate.edit.allowed && maintenance.run({ enabled: next })}
          />
          {gate.edit.reason === null ? null : <Reason>{gate.edit.reason}</Reason>}
          <ActionError error={maintenance.error} onDismiss={maintenance.reset} />
        </div>
      </Card>

      <ReasonModal
        open={signalling !== null}
        onClose={() => {
          setSignalling(null);
          signal.reset();
        }}
        onConfirm={(reason) => signalling !== null && signal.run({ signal: signalling, reason })}
        title={signalling === 'resume' ? m('m.resume') : m('m.signal')}
        required
        pending={signal.pending}
        error={<ActionError error={signal.error} onDismiss={signal.reset} />}
      />
    </>
  );
}
