'use client';
// SPDX-License-Identifier: AGPL-3.0-only

import { Card, Field, Input, RadioGroup, Select, useFormat } from '@opendispatch/ui';
import { useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import { ActionError } from '@/components/opendispatch/patterns/ActionError';
import { useAdminAction } from '@/components/opendispatch/patterns/useAdminAction';
import { Reading, type ReadingItem } from '@/components/opendispatch/Reading';
import { Reason, useGate } from '@/components/opendispatch/ReasonHint';
import { changeClockStart, changeOptimizer, changePlanningLevel, changeRemoteHandling } from './actions';
import { CLOCK_STARTS, OPTIMIZER_KEY, OPTIMIZER_MODELS, PLANNING_LEVELS, REMOTE_HANDLING_SOURCES, type ClockStart, type OptimizerModel, type PlanningLevel, type ReadingView, type RemoteHandlingSource } from './types';
import styles from './ForecastModel.module.css';

// The 10-minute measure and the planning level. Until the customer
// confirms when the clock starts, the measure is always shown two ways, from assignment and from registration, and the primary one
// comes from THIS setting (default: assignment), never from code. Every figure is Illustrative. A change is saved as soon as it is
// made, audited, and the saved value is what the controls show.

export interface MeasureCardProps {
  readonly clockStart: ClockStart;
  readonly planningLevel: PlanningLevel;
  readonly optimizerModel: OptimizerModel;
  readonly remoteHandling: { readonly source: RemoteHandlingSource; readonly fixedMinutes: number };
  readonly reading: ReadingView | null;
  readonly canEdit: boolean;
}

export function MeasureCard({ clockStart, planningLevel, optimizerModel, remoteHandling, reading, canEdit }: MeasureCardProps) {
  const m = useTranslations('admin.forecast_model');
  const format = useFormat();
  const gate = useGate(canEdit ? 'edit' : 'view');
  const name = useId();
  const label = (value: ClockStart) => (value === 'assignment' ? m('m.fromAssignment') : m('m.fromRegistration'));
  const clock = useAdminAction(changeClockStart, { successTitle: m('toast.clock'), successDescription: (saved) => label(saved.clockStart === 'registration' ? 'registration' : 'assignment') });
  const level = useAdminAction(changePlanningLevel, { successTitle: m('toast.level'), successDescription: (saved) => m(`level.${saved.planningLevel === 'city' ? 'city' : saved.planningLevel === 'sub_zone' ? 'sub_zone' : 'zone'}`) });
  const optimizer = useAdminAction(changeOptimizer, { successTitle: m('toast.optimizer'), successDescription: (saved) => m(`opt.${OPTIMIZER_KEY[OPTIMIZER_MODELS.find((o) => o === saved.optimizerModel) ?? 'cpsat-1']}`) });
  const remote = useAdminAction(changeRemoteHandling, { successTitle: m('toast.remote'), successDescription: (saved) => (saved.source === 'fixed' ? m('rh.fixed') : m('rh.measured')) });
  const [minutes, setMinutes] = useState(String(remoteHandling.fixedMinutes));
  const saveMinutes = () => {
    const value = Number(minutes);
    if (!Number.isFinite(value) || value < 5 || value > 240) {
      setMinutes(String(remoteHandling.fixedMinutes));
      return;
    }
    if (value !== remoteHandling.fixedMinutes && gate.edit.allowed) remote.run({ handling_fixed_minutes: value });
  };
  const share = (value: number | null) => (value === null ? '-' : format.ratio(value));

  const items: ReadingItem[] = CLOCK_STARTS.map((value) => ({
    label: label(value),
    value: share(reading === null ? null : value === 'assignment' ? reading.fromAssignment : reading.fromRegistration),
    primary: value === clockStart,
    illustrative: reading?.illustrative ?? true,
  })).sort((a, b) => Number(b.primary) - Number(a.primary));

  return (
    <Card padding="lg">
      <div className={styles.cardInner}>
        <div className={styles.head}>
          <h2 className={styles.cardTitle}>{m('m.title')}</h2>
        </div>
        <div className={styles.stack}>
          <Field label={m('m.clock')}>
            <RadioGroup
              name={name}
              value={clockStart}
              disabled={!canEdit || clock.pending}
              onChange={(next) => {
                const chosen = CLOCK_STARTS.find((c) => c === next);
                if (chosen !== undefined && chosen !== clockStart && gate.edit.allowed) clock.run({ clock_start: chosen });
              }}
              options={CLOCK_STARTS.map((value) => ({ value, label: label(value), ...(value === 'assignment' ? { description: m('m.default') } : {}) }))}
            />
          </Field>
          <ActionError error={clock.error} onDismiss={clock.reset} />
          <Reading items={items} />
          <Field label={m('m.level')}>
            <Select
              value={planningLevel}
              disabled={!canEdit || level.pending}
              onChange={(event) => {
                const chosen = PLANNING_LEVELS.find((l) => l === event.target.value);
                if (chosen !== undefined && chosen !== planningLevel && gate.edit.allowed) level.run({ planning_level: chosen });
              }}
              options={PLANNING_LEVELS.map((value) => ({ value, label: m(`level.${value}`) }))}
            />
          </Field>
          <ActionError error={level.error} onDismiss={level.reset} />
          <Field label={m('m.optimizer')}>
            <Select
              value={optimizerModel}
              disabled={!canEdit || optimizer.pending}
              onChange={(event) => {
                const chosen = OPTIMIZER_MODELS.find((o) => o === event.target.value);
                if (chosen !== undefined && chosen !== optimizerModel && gate.edit.allowed) optimizer.run({ optimizer_model: chosen });
              }}
              options={OPTIMIZER_MODELS.map((value) => ({ value, label: m(`opt.${OPTIMIZER_KEY[value]}`) }))}
            />
          </Field>
          <ActionError error={optimizer.error} onDismiss={optimizer.reset} />
          <Field label={m('m.remote')}>
            <Select
              value={remoteHandling.source}
              disabled={!canEdit || remote.pending}
              onChange={(event) => {
                const chosen = REMOTE_HANDLING_SOURCES.find((o) => o === event.target.value);
                if (chosen !== undefined && chosen !== remoteHandling.source && gate.edit.allowed) remote.run({ handling_source: chosen });
              }}
              options={REMOTE_HANDLING_SOURCES.map((value) => ({ value, label: value === 'fixed' ? m('rh.fixed') : m('rh.measured') }))}
            />
          </Field>
          <Field label={m('m.remoteMinutes')} hint={m('rh.hint')}>
            <Input
              type="number"
              inputMode="decimal"
              min={5}
              max={240}
              step={0.5}
              value={minutes}
              translate="no"
              disabled={!canEdit || remote.pending}
              onChange={(event) => setMinutes(event.target.value)}
              onBlur={saveMinutes}
            />
          </Field>
          <ActionError error={remote.error} onDismiss={remote.reset} />
          {gate.edit.reason === null ? null : <Reason>{gate.edit.reason}</Reason>}
        </div>
      </div>
    </Card>
  );
}
