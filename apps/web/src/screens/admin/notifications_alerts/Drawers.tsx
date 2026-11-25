'use client';
// SPDX-License-Identifier: AGPL-3.0-only

import { Button, Checkbox, Field, Input, RadioGroup, Select, Stack, Switch, useToast } from '@opendispatch/ui';
import { useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import { ActionError } from '@/components/opendispatch/patterns/ActionError';
import { RecordDrawer } from '@/components/opendispatch/patterns/RecordDrawer';
import { StubTag } from '@/components/opendispatch/patterns/StubTag';
import { useAdminAction } from '@/components/opendispatch/patterns/useAdminAction';
import { useUrlState } from '@/components/opendispatch/patterns/useUrlState';
import { Reason, ReasonHint, useGate } from '@/components/opendispatch/ReasonHint';
import { ROLES, type Role } from '@/lib/access';
import { saveQuietHours, saveRule } from './actions';
import { APPLIES_TO, CHANNELS, SEVERITIES, type AppliesTo, type Channel, type QuietView, type RuleRow, type Severity } from './types';
import styles from './Notifications.module.css';

// The two drawers of the screen. The rule drawer (`?rule=`) edits the channels (at least one), the recipients, the severity and
// whether the rule is on. The quiet-hours drawer (`?quiet=1`) edits the window, what it applies to and whether it is on; critical
// alerts always send, and that switch is fixed. QUIET HOURS ARE STORED, NOT APPLIED: the drawer says so with the "Not applied"
// tag, and an e-mail channel is stored on the rule while nothing is sent (the same tag sits by the channels).

// ---------------------------------------------------------------------------------------------
// The rule drawer
// ---------------------------------------------------------------------------------------------

export function RuleDrawer({ rule, canEdit }: { rule: RuleRow | undefined; canEdit: boolean }) {
  const m = useTranslations('admin.notifications_alerts');
  const t = useTranslations();
  const toast = useToast();
  const url = useUrlState();
  const gate = useGate(canEdit ? 'edit' : 'view');
  const [channels, setChannels] = useState<readonly Channel[]>(rule?.channels ?? []);
  const [roles, setRoles] = useState<readonly Role[]>(rule?.roles ?? []);
  const [severity, setSeverity] = useState<Severity>(rule?.severity ?? 'info');
  const [enabled, setEnabled] = useState<boolean>(rule?.enabled ?? true);
  const [seen, setSeen] = useState<string | undefined>(rule?.id);
  if (rule?.id !== seen) {
    setSeen(rule?.id);
    setChannels(rule?.channels ?? []);
    setRoles(rule?.roles ?? []);
    setSeverity(rule?.severity ?? 'info');
    setEnabled(rule?.enabled ?? true);
  }
  const save = useAdminAction(saveRule, {
    quiet: true,
    onSuccess: (saved) => {
      toast({ title: m('toast.rule'), description: m(`ev.${saved.event}`), tone: 'success' });
      url.update({ rule: null });
    },
  });

  if (rule === undefined) return <RecordDrawer open={false} title="" param="rule" />;
  const name = m(`ev.${rule.event}`);
  const reason = gate.edit.reason ?? (channels.length === 0 ? m('rd.need') : null);
  const toggle = <T extends string>(list: readonly T[], value: T, on: boolean): T[] => (on ? [...list.filter((x) => x !== value), value] : list.filter((x) => x !== value));

  const footer = (
    <div className={styles.footer}>
      {reason !== null && gate.edit.reason === null ? <Reason>{reason}</Reason> : null}
      <span className={styles.push} />
      <ReasonHint reason={reason} visible={false}>
        <Button
          variant="primary"
          loading={save.pending}
          onClick={() =>
            reason === null &&
            save.run({
              ruleId: rule.id,
              channels: CHANNELS.filter((c) => channels.includes(c)),
              roles: ROLES.filter((r) => roles.includes(r)),
              severity,
              enabled,
            })
          }
        >
          {t('common.save')}
        </Button>
      </ReasonHint>
    </div>
  );

  return (
    <RecordDrawer open param="rule" recordKey={rule.id} title={m('rd.title')} subtitle={name} footer={footer}>
      <Stack gap={20}>
        <fieldset className={styles.plainFieldset} disabled={!canEdit}>
          <legend className={styles.legend}>{m('col.channels')}</legend>
          <div className={styles.checks}>
            {CHANNELS.map((channel) => (
              <span key={channel} className={styles.inline}>
                <Checkbox label={m(`ch.${channel}`)} checked={channels.includes(channel)} onChange={(event) => setChannels((previous) => toggle(previous, channel, event.target.checked))} />
                {channel === 'email' ? <StubTag kind="notApplied" /> : null}
              </span>
            ))}
          </div>
        </fieldset>
        <fieldset className={styles.plainFieldset} disabled={!canEdit}>
          <legend className={styles.legend}>{m('col.recipients')}</legend>
          <div className={styles.checks}>
            {ROLES.map((role) => (
              <Checkbox key={role} label={t(`roles.${role}`)} checked={roles.includes(role)} onChange={(event) => setRoles((previous) => toggle(previous, role, event.target.checked))} />
            ))}
          </div>
        </fieldset>
        <Field label={m('col.severity')}>
          <Select
            value={severity}
            disabled={!canEdit}
            onChange={(event) => setSeverity(SEVERITIES.find((s) => s === event.target.value) ?? severity)}
            options={SEVERITIES.map((value) => ({ value, label: m(`sev.${value}`) }))}
          />
        </Field>
        <Switch label={m('rd.enabled')} checked={enabled} disabled={!canEdit} onCheckedChange={setEnabled} />
        {gate.edit.reason === null ? null : <Reason>{gate.edit.reason}</Reason>}
        <ActionError error={save.error} onDismiss={save.reset} />
      </Stack>
    </RecordDrawer>
  );
}

// ---------------------------------------------------------------------------------------------
// The quiet-hours drawer
// ---------------------------------------------------------------------------------------------

export function QuietDrawer({ open, quiet, canEdit }: { open: boolean; quiet: QuietView; canEdit: boolean }) {
  const m = useTranslations('admin.notifications_alerts');
  const t = useTranslations();
  const toast = useToast();
  const url = useUrlState();
  const scope = useId();
  const gate = useGate(canEdit ? 'edit' : 'view');
  const [enabled, setEnabled] = useState(quiet.enabled);
  const [start, setStart] = useState(quiet.start);
  const [end, setEnd] = useState(quiet.end);
  const [appliesTo, setAppliesTo] = useState<AppliesTo>(quiet.appliesTo);
  // The fields start from what is stored each time the drawer opens.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setEnabled(quiet.enabled);
      setStart(quiet.start);
      setEnd(quiet.end);
      setAppliesTo(quiet.appliesTo);
    }
  }
  const save = useAdminAction(saveQuietHours, {
    quiet: true,
    onSuccess: () => {
      toast({ title: m('toast.quiet'), tone: 'success' });
      url.update({ quiet: null });
    },
  });

  const reason = gate.edit.reason ?? (start === '' || end === '' || start === end ? m('qd.same') : null);
  const footer = (
    <div className={styles.footer}>
      {reason !== null && gate.edit.reason === null ? <Reason>{reason}</Reason> : null}
      <span className={styles.push} />
      <ReasonHint reason={reason} visible={false}>
        <Button variant="primary" loading={save.pending} onClick={() => reason === null && save.run({ enabled, start, end, appliesTo })}>
          {t('common.save')}
        </Button>
      </ReasonHint>
    </div>
  );

  return (
    <RecordDrawer
      open={open}
      param="quiet"
      recordKey="quiet"
      title={m('qh.title')}
      subtitle={
        <span className={styles.inline}>
          {m('qd.sub')}
          <StubTag kind="notApplied" />
        </span>
      }
      footer={footer}
    >
      <Stack gap={20}>
        <Switch label={m('qd.on')} checked={enabled} disabled={!canEdit} onCheckedChange={setEnabled} />
        <div className={styles.formGrid}>
          <Field label={m('qd.from')}>
            <Input type="time" value={start} dir="ltr" disabled={!canEdit} onChange={(event) => setStart(event.target.value)} />
          </Field>
          <Field label={m('qd.to')}>
            <Input type="time" value={end} dir="ltr" disabled={!canEdit} onChange={(event) => setEnd(event.target.value)} />
          </Field>
        </div>
        <Field label={m('qh.applies')}>
          <RadioGroup
            name={scope}
            value={appliesTo}
            disabled={!canEdit}
            onChange={(next) => setAppliesTo(APPLIES_TO.find((a) => a === next) ?? appliesTo)}
            options={[
              { value: 'email', label: m('qd.emailOnly') },
              { value: 'email_and_in_app', label: m('qd.both') },
            ]}
          />
        </Field>
        {/* Critical alerts are never held: the switch is fixed on, and says why. */}
        <Switch label={m('qd.critical')} description={m('qd.criticalWhy')} checked disabled />
        {gate.edit.reason === null ? null : <Reason>{gate.edit.reason}</Reason>}
        <ActionError error={save.error} onDismiss={save.reset} />
      </Stack>
    </RecordDrawer>
  );
}
