'use client';
// SPDX-License-Identifier: AGPL-3.0-only

import { Button, Card, FormSection, RadioGroup, Select, Stack, Switch, useToast } from '@opendispatch/ui';
import { useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import { ActionError } from '@/components/opendispatch/patterns/ActionError';
import { useAdminAction } from '@/components/opendispatch/patterns/useAdminAction';
import { Reason, ReasonHint, useGate } from '@/components/opendispatch/ReasonHint';
import { saveSettings } from './actions';
import type { SettingsView } from './types';
import styles from './Updates.module.css';

// The Settings tab: channel, check interval, download
// automatically, notify only. Saved as one write. THE UPDATE AGENT IS A STUB.

const INTERVALS = [1, 6, 12, 24] as const;

export function SettingsTab({ settings, canEdit }: { settings: SettingsView; canEdit: boolean }) {
  const m = useTranslations('admin.updates');
  const t = useTranslations();
  const toast = useToast();
  const gate = useGate(canEdit ? 'edit' : 'view');
  const name = useId();
  const [channel, setChannel] = useState(settings.channel);
  const [interval, setInterval] = useState(settings.checkIntervalHours);
  const [auto, setAuto] = useState(settings.autoDownload);
  const [notify, setNotify] = useState(settings.notifyOnly);
  const save = useAdminAction(saveSettings, { quiet: true, onSuccess: () => toast({ title: m('toast.settings'), tone: 'success' }) });
  const dirty = channel !== settings.channel || interval !== settings.checkIntervalHours || auto !== settings.autoDownload || notify !== settings.notifyOnly;
  // A value the data layer holds that is not one of the four choices (1 to 168 hours are valid) is still offered, so it is not lost.
  const hours = INTERVALS.includes(interval as (typeof INTERVALS)[number]) ? [...INTERVALS] : [...INTERVALS, interval].sort((a, b) => a - b);
  const intervalLabel = (n: number) => (n === 1 ? m('set.h1') : n === 6 ? m('set.h6') : n === 12 ? m('set.h12') : n === 24 ? m('set.h24') : m('set.hN', { n }));
  const disabled = !canEdit;

  return (
    <Card padding="lg">
      <div className={styles.cardInner}>
        <FormSection title={m('channel')}>
          <RadioGroup
            name={name}
            orientation="horizontal"
            value={channel}
            disabled={disabled}
            onChange={(next) => setChannel(next === 'hotfix' ? 'hotfix' : 'stable')}
            options={[
              { value: 'stable', label: m('ch.stable') },
              { value: 'hotfix', label: m('ch.hotfix') },
            ]}
          />
        </FormSection>
        <FormSection title={m('set.interval')}>
          <div className={styles.narrow}>
            <Select aria-label={m('set.interval')} value={String(interval)} disabled={disabled} onChange={(event) => setInterval(Number.parseInt(event.target.value, 10))} options={hours.map((n) => ({ value: String(n), label: intervalLabel(n) }))} />
          </div>
        </FormSection>
        <FormSection title={m('set.download')}>
          <Stack gap={16}>
            <Switch label={m('set.auto')} checked={auto} disabled={disabled} onCheckedChange={setAuto} />
            <Switch label={m('set.notify')} description={m('set.notifyDesc')} checked={notify} disabled={disabled} onCheckedChange={setNotify} />
          </Stack>
        </FormSection>
        <div className={styles.stackTight}>
          <div className={styles.actions}>
            <ReasonHint reason={gate.edit.reason} visible={false}>
              <Button variant="primary" loading={save.pending} disabled={false} onClick={() => gate.edit.allowed && save.run({ channel, check_interval_hours: interval, auto_download: auto, notify_only: notify })}>
                {t('common.save')}
              </Button>
            </ReasonHint>
            {dirty ? <span className={styles.meta}>{m('set.unsaved')}</span> : null}
          </div>
          {gate.edit.reason === null ? null : <Reason>{gate.edit.reason}</Reason>}
          <ActionError error={save.error} onDismiss={save.reset} />
        </div>
      </div>
    </Card>
  );
}
