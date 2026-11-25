'use client';
// SPDX-License-Identifier: AGPL-3.0-only

import { Alert, Button, Card, Field, Select, StatusPill, Switch, useToast } from '@opendispatch/ui';
import { Play } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { ActionError } from '@/components/opendispatch/patterns/ActionError';
import { ReasonDialog } from '@/components/opendispatch/patterns/ReasonDialog';
import { useAdminAction } from '@/components/opendispatch/patterns/useAdminAction';
import { Reason, ReasonHint, useGate } from '@/components/opendispatch/ReasonHint';
import { changeHorizon, pauseForecast, resumeForecast } from './actions';
import { HORIZONS, type PauseView } from './types';
import styles from './ForecastModel.module.css';
import { useDateTime } from '@/components/opendispatch/useDateTime';

// The pause switch and its two dialogs: `#fm-pause`, `#fm-alert`, `#fm-confirm`;
// flow 7). Pausing and resuming each need a reason of 1 to 300 characters. A pause raises an alert that appears in the bell and in
// Notifications (the data layer writes it): the toast says who is told. The dialogs are mounted once, by the provider, so the
// alert's Resume button and the switch in the aside both open them.

interface DialogsApi {
  readonly askPause: () => void;
  readonly askResume: () => void;
}

const Context = createContext<DialogsApi | null>(null);

export function ModelDialogsProvider({ children }: { children: ReactNode }) {
  const m = useTranslations('admin.forecast_model');
  const toast = useToast();
  const [asking, setAsking] = useState<'pause' | 'resume' | null>(null);
  const api = useMemo<DialogsApi>(() => ({ askPause: () => setAsking('pause'), askResume: () => setAsking('resume') }), []);
  const pause = useAdminAction(pauseForecast, {
    quiet: true,
    onSuccess: () => {
      toast({ title: m('toast.paused'), description: m('toast.notified'), tone: 'warning' });
      setAsking(null);
    },
  });
  const resume = useAdminAction(resumeForecast, {
    quiet: true,
    onSuccess: () => {
      toast({ title: m('toast.resumed'), tone: 'success' });
      setAsking(null);
    },
  });
  const action = asking === 'pause' ? pause : resume;
  return (
    <Context.Provider value={api}>
      {children}
      <ReasonDialog
        open={asking !== null}
        onClose={() => {
          setAsking(null);
          pause.reset();
          resume.reset();
        }}
        onConfirm={(reason) => action.run({ reason })}
        title={asking === 'pause' ? m('c.pause') : m('c.resume')}
        confirmLabel={asking === 'pause' ? m('p.switch') : m('resume')}
        tone={asking === 'pause' ? 'danger' : 'default'}
        minLength={1}
        maxLength={300}
        size="sm"
        pending={action.pending}
        error={<ActionError error={action.error} onDismiss={action.reset} />}
      />
    </Context.Provider>
  );
}

/** Opens the pause or the resume dialog. Outside the provider (a test that renders one card) it does nothing. */
export function useModelDialogs(): DialogsApi {
  return useContext(Context) ?? { askPause: () => undefined, askResume: () => undefined };
}

/** The warning at the top of the page while the forecast is paused, with Resume. */
export function PausedAlert({ pause, canEdit }: { pause: PauseView; canEdit: boolean }) {
  const m = useTranslations('admin.forecast_model');
  const dateTime = useDateTime();
  const gate = useGate(canEdit ? 'edit' : 'view');
  const { askResume } = useModelDialogs();
  if (!pause.paused) return null;
  const when = pause.pausedAt === null ? '' : dateTime(pause.pausedAt);
  return (
    <Alert
      tone="warning"
      title={m('alert.title')}
      action={
        <ReasonHint reason={gate.edit.reason} visible={false}>
          <Button variant="secondary" size="sm" startIcon={<Play />} onClick={() => gate.edit.allowed && askResume()}>
            {m('resume')}
          </Button>
        </ReasonHint>
      }
    >
      {m.rich('alert.body', {
        who: pause.pausedBy ?? m('unknownPerson'),
        time: when,
        reason: pause.reason ?? '',
        n: (chunks) => <bdi translate="no">{chunks}</bdi>,
        t: (chunks) => (
          <bdi dir="ltr" translate="no">
            {chunks}
          </bdi>
        ),
        r: (chunks) => <bdi translate="no">{chunks}</bdi>,
      })}
    </Alert>
  );
}

/** The days each run covers, saved on change. */
function HorizonField({ days, canEdit }: { days: number; canEdit: boolean }) {
  const m = useTranslations('admin.forecast_model');
  const gate = useGate(canEdit ? 'edit' : 'view');
  const save = useAdminAction(changeHorizon, { successTitle: m('toast.horizon'), successDescription: (saved) => m('p.days', { n: saved.horizonDays }) });
  const options = [...new Set([...HORIZONS, days])].sort((a, b) => a - b).map((n) => ({ value: String(n), label: m('p.days', { n }) }));
  return (
    <>
      <Field label={m('p.horizon')}>
        <Select
          value={String(days)}
          disabled={!canEdit || save.pending}
          onChange={(event) => {
            const next = Number.parseInt(event.target.value, 10);
            if (next !== days && gate.edit.allowed) save.run({ horizon_days: next });
          }}
          options={options}
        />
      </Field>
      <ActionError error={save.error} onDismiss={save.reset} />
    </>
  );
}

/** "Forecast state": Running or Paused, the switch that pauses it and the horizon. */
export function PauseCard({ pause, canEdit, horizonDays = null }: { pause: PauseView; canEdit: boolean; horizonDays?: number | null }) {
  const m = useTranslations('admin.forecast_model');
  const dateTime = useDateTime();
  const gate = useGate(canEdit ? 'edit' : 'view');
  const { askPause, askResume } = useModelDialogs();
  const when = pause.pausedAt === null ? '' : dateTime(pause.pausedAt);
  return (
    <Card padding="lg">
      <div className={styles.cardInner}>
        <div className={styles.head}>
          <h2 className={styles.cardTitle}>{m('p.title')}</h2>
          <StatusPill status={pause.paused ? m('paused') : m('running')} tone={pause.paused ? 'warning' : 'success'} size="sm" />
        </div>
        <div className={styles.stackTight}>
          {/* The switch shows the saved state: a change opens the dialog, and the state changes only when the server says yes. */}
          <Switch label={m('p.switch')} checked={pause.paused} disabled={!canEdit} onCheckedChange={() => gate.edit.allowed && (pause.paused ? askResume() : askPause())} />
          {pause.paused ? (
            <span className={styles.meta}>
              <span translate="no">{pause.pausedBy ?? ''}</span>
              {pause.pausedBy === null || when === '' ? null : ', '}
              <bdi dir="ltr" translate="no">
                {when}
              </bdi>
            </span>
          ) : null}
          {horizonDays === null ? null : <HorizonField days={horizonDays} canEdit={canEdit} />}
          {gate.edit.reason === null ? null : <Reason>{gate.edit.reason}</Reason>}
        </div>
      </div>
    </Card>
  );
}
