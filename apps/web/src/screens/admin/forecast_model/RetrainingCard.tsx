'use client';
// SPDX-License-Identifier: AGPL-3.0-only

import { Button, Card, Field, Input, Select, SegmentedControl, Switch, useToast } from '@opendispatch/ui';
import { Info } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { ActionError } from '@/components/opendispatch/patterns/ActionError';
import { useAdminAction } from '@/components/opendispatch/patterns/useAdminAction';
import { Reason, ReasonHint, useGate } from '@/components/opendispatch/ReasonHint';
import { changeAutoRetrain, saveSchedule } from './actions';
import { CADENCES, type Cadence, type ScheduleView } from './types';
import styles from './ForecastModel.module.css';

// Retraining: whether an accuracy drop retrains, the
// cadence, and for a weekly one the day, and the time of day. The schedule is stored and audited. Save is unavailable, with the
// reason, until something changed and the time is valid.

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const DAYS = [0, 1, 2, 3, 4, 5, 6] as const;

export function RetrainingCard({ schedule, canEdit, autoRetrain = null }: { schedule: ScheduleView; canEdit: boolean; autoRetrain?: boolean | null }) {
  const m = useTranslations('admin.forecast_model');
  const t = useTranslations();
  const toast = useToast();
  const gate = useGate(canEdit ? 'edit' : 'view');
  const [cadence, setCadence] = useState<Cadence>(schedule.cadence);
  const [day, setDay] = useState(schedule.day ?? 5);
  const [time, setTime] = useState(schedule.time);
  // The drafts follow the saved schedule when the server sends a new one.
  const [seen, setSeen] = useState(schedule);
  if (seen.cadence !== schedule.cadence || seen.day !== schedule.day || seen.time !== schedule.time) {
    setSeen(schedule);
    setCadence(schedule.cadence);
    setDay(schedule.day ?? 5);
    setTime(schedule.time);
  }
  const auto = useAdminAction(changeAutoRetrain, { successTitle: m('toast.auto') });
  const save = useAdminAction(saveSchedule, {
    quiet: true,
    onSuccess: () => toast({ title: m('toast.retrain.saved'), ...(cadence === 'manual' ? {} : { description: m('toast.retrain.at', { time }) }), tone: 'success' }),
  });

  const dirty = cadence !== schedule.cadence || (cadence === 'weekly' && day !== (schedule.day ?? 5)) || (cadence !== 'manual' && time !== schedule.time);
  const badTime = cadence !== 'manual' && !TIME.test(time.trim());
  const reason = gate.edit.reason ?? (badTime ? m('t.badTime') : !dirty ? m('t.nochange') : null);
  const disabled = !canEdit;

  return (
    <Card padding="lg">
      <div className={styles.cardInner}>
        <div className={styles.head}>
          <h2 className={styles.cardTitle}>{m('t.title')}</h2>
        </div>
        {autoRetrain === null ? null : (
          <>
            <Switch label={m('t.auto')} checked={autoRetrain} disabled={disabled || auto.pending} onCheckedChange={(next) => gate.edit.allowed && auto.run({ auto_retrain: next })} />
            <ActionError error={auto.error} onDismiss={auto.reset} />
          </>
        )}
        <SegmentedControl
          size="sm"
          ariaLabel={m('t.cadence')}
          value={cadence}
          onChange={(next) => !disabled && setCadence(CADENCES.find((c) => c === next) ?? cadence)}
          options={CADENCES.map((value) => ({ value, label: m(`cad.${value}`) }))}
        />
        {cadence === 'manual' ? null : (
          <div className={styles.formGrid}>
            {cadence === 'weekly' ? (
              <Field label={m('t.day')}>
                <Select value={String(day)} disabled={disabled} onChange={(event) => setDay(Number.parseInt(event.target.value, 10))} options={DAYS.map((d) => ({ value: String(d), label: m(`day.${d}`) }))} />
              </Field>
            ) : null}
            <Field label={m('t.time')}>
              <Input value={time} dir="ltr" inputMode="numeric" placeholder={m('t.timePh')} autoComplete="off" disabled={disabled} invalid={badTime} onChange={(event) => setTime(event.target.value)} />
            </Field>
          </div>
        )}
        <div className={styles.between}>
          {badTime ? <Reason icon={<Info />}>{m('t.badTime')}</Reason> : <span />}
          <ReasonHint reason={reason} visible={false}>
            <Button
              variant="secondary"
              size="sm"
              loading={save.pending}
              onClick={() => reason === null && save.run({ cadence, day_of_week: cadence === 'weekly' ? day : null, time_of_day: TIME.test(time.trim()) ? time.trim() : schedule.time })}
            >
              {t('common.save')}
            </Button>
          </ReasonHint>
        </div>
        {gate.edit.reason === null ? null : <Reason>{gate.edit.reason}</Reason>}
        <ActionError error={save.error} onDismiss={save.reset} />
      </div>
    </Card>
  );
}
