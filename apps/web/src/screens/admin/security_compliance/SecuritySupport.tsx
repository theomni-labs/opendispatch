'use client';
// SPDX-License-Identifier: AGPL-3.0-only

import { Button, Card, Field, Input, Modal, Stack, StatusPill, Textarea, useToast } from '@opendispatch/ui';
import { Info, LockOpen } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { ActionError } from '@/components/opendispatch/patterns/ActionError';
import { useAdminAction } from '@/components/opendispatch/patterns/useAdminAction';
import { useUrlState } from '@/components/opendispatch/patterns/useUrlState';
import { Reason, ReasonHint } from '@/components/opendispatch/ReasonHint';
import { ReasonSwitch } from '@/components/opendispatch/ReasonSwitch';
import { endSupport, grantSupport, saveSupportSetting } from './actions';
import styles from './Security.module.css';

// The Support access tab: the switch (off by default), the longest grant, Grant access with its dialog (a time limit and a reason),
// and End now for an open grant. Vendor support access is time limited and ends by itself. Every write is a server action; a role
// without `edit` sees each control disabled with the reason.

const MAX_HOURS = 72;

export interface SupportPanelProps {
  readonly enabled: boolean;
  readonly maxHours: number;
  /** True while a grant is open: only one is open at a time. */
  readonly hasOpenGrant: boolean;
  readonly canEdit: boolean;
}

export function SupportPanel({ enabled, maxHours, hasOpenGrant, canEdit }: SupportPanelProps) {
  const m = useTranslations('admin.security_compliance');
  const t = useTranslations();
  const toast = useToast();
  const url = useUrlState();
  const [max, setMax] = useState(String(maxHours));
  const [heldMax, setHeldMax] = useState(maxHours);
  if (maxHours !== heldMax) {
    setHeldMax(maxHours);
    setMax(String(maxHours));
  }
  const maxNumber = /^\d{1,3}$/.test(max.trim()) ? Number(max) : null;
  const maxValid = maxNumber !== null && maxNumber >= 1 && maxNumber <= MAX_HOURS;
  const dirty = max !== String(maxHours);

  const roReason = canEdit ? null : t('opendispatch.gate.viewOnly');
  const toggle = useAdminAction(saveSupportSetting, {
    quiet: true,
    failureToast: true,
    onSuccess: (saved) => toast({ title: m(saved.enabled ? 'toast.supOn' : 'toast.supOff'), tone: saved.enabled ? 'warning' : 'info' }),
  });
  const saveMax = useAdminAction(saveSupportSetting, { successTitle: m('toast.supMax') });

  const grantReason = roReason ?? (!enabled ? m('sup.needOn') : hasOpenGrant ? m('sup.already') : null);

  return (
    <Card padding="lg">
      <Stack gap={16}>
        <div className={styles.headRow}>
          <h2 className={styles.sectionTitle}>{m('tab.support')}</h2>
          <StatusPill status={t(enabled ? 'common.on' : 'common.off')} tone={enabled ? 'success' : 'neutral'} size="sm" />
        </div>
        <ReasonSwitch
          reason={roReason}
          checked={enabled}
          label={m('sup.enable')}
          description={m('sup.default')}
          onCheckedChange={(next) => {
            if (roReason === null) toggle.run({ enabled: next, max_duration_hours: maxHours });
          }}
        />
        <div className={styles.maxRow}>
          <div className={styles.narrow}>
            <Field label={m('sup.max')} {...(maxValid || max === '' ? {} : { error: m('need.maxHours') })}>
              <Input type="number" min={1} max={MAX_HOURS} step={1} suffix={m('hoursShort')} dir="ltr" value={max} disabled={!canEdit} invalid={!maxValid} onChange={(event) => setMax(event.target.value)} />
            </Field>
          </div>
          {dirty ? (
            <ReasonHint reason={roReason ?? (maxValid ? null : m('need.maxHours'))} visible={false}>
              <Button variant="secondary" size="sm" loading={saveMax.pending} onClick={() => roReason === null && maxValid && maxNumber !== null && saveMax.run({ enabled, max_duration_hours: maxNumber })}>
                {t('common.save')}
              </Button>
            </ReasonHint>
          ) : null}
        </div>
        <div>
          <ReasonHint reason={grantReason} visible={false}>
            <Button variant="secondary" startIcon={<LockOpen />} onClick={() => grantReason === null && url.update({ grant: '1' }, { history: 'push' })}>
              {m('sup.grant')}
            </Button>
          </ReasonHint>
        </div>
        <ActionError error={toggle.error ?? saveMax.error} onDismiss={() => (toggle.error === null ? saveMax.reset() : toggle.reset())} />
      </Stack>
    </Card>
  );
}

export interface GrantDialogProps {
  /** `?grant=1`, the setting is on and the person may edit. Decided on the server. */
  readonly open: boolean;
  readonly maxHours: number;
}

/** The dialog that grants support access: how long (up to the setting's longest grant) and why. */
export function GrantDialog({ open, maxHours }: GrantDialogProps) {
  const m = useTranslations('admin.security_compliance');
  const t = useTranslations();
  const toast = useToast();
  const url = useUrlState();
  const [hours, setHours] = useState('2');
  const [reason, setReason] = useState('');
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setHours(String(Math.min(2, maxHours)));
      setReason('');
    }
  }

  const close = () => url.update({ grant: null }, { history: 'replace' });
  const grant = useAdminAction(grantSupport, {
    quiet: true,
    onSuccess: (granted) => {
      toast({ title: m('toast.granted', { n: granted.hours }), tone: 'warning' });
      close();
    },
  });

  const hoursNumber = /^\d{1,3}$/.test(hours.trim()) ? Number(hours) : null;
  const hoursValid = hoursNumber !== null && hoursNumber >= 1 && hoursNumber <= maxHours;
  const need = reason.trim() === '' ? m('grant.need') : !hoursValid ? m('grant.hoursRange', { max: maxHours }) : null;

  return (
    <Modal
      open={open}
      onClose={close}
      title={m('sup.grant')}
      description={m('grant.desc')}
      footer={
        <>
          {need === null ? null : <Reason icon={<Info />}>{need}</Reason>}
          <Button variant="ghost" onClick={close}>
            {t('common.cancel')}
          </Button>
          <ReasonHint reason={need} visible={false}>
            <Button variant="primary" loading={grant.pending} onClick={() => need === null && hoursNumber !== null && grant.run({ hours: hoursNumber, reason: reason.trim() })}>
              {m('sup.grant')}
            </Button>
          </ReasonHint>
        </>
      }
    >
      <Stack gap={16}>
        <div className={styles.narrow}>
          <Field label={m('grant.hours')} required>
            <Input type="number" min={1} max={maxHours} step={1} suffix={m('hoursShort')} dir="ltr" value={hours} invalid={!hoursValid} data-autofocus="" onChange={(event) => setHours(event.target.value)} />
          </Field>
        </div>
        <Field label={t('common.reason')} required>
          <Textarea value={reason} rows={2} maxLength={500} onChange={(event) => setReason(event.target.value)} />
        </Field>
        <ActionError error={grant.error} onDismiss={grant.reset} />
      </Stack>
    </Modal>
  );
}

/** End now, for the open grant's row. */
export function EndButton({ grantId, canEdit }: { grantId: string; canEdit: boolean }) {
  const m = useTranslations('admin.security_compliance');
  const t = useTranslations();
  const end = useAdminAction(endSupport, { successTitle: m('toast.ended'), failureToast: true });
  return (
    <ReasonHint reason={canEdit ? null : t('opendispatch.gate.viewOnly')} visible={false}>
      <Button variant="secondary" size="sm" loading={end.pending} onClick={() => canEdit && end.run({ grantId })}>
        {m('sup.end')}
      </Button>
    </ReasonHint>
  );
}
