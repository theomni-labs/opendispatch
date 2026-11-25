'use client';
// SPDX-License-Identifier: AGPL-3.0-only

import { Card, Field, Select } from '@opendispatch/ui';
import { useTranslations } from 'next-intl';
import { ActionError } from '@/components/opendispatch/patterns/ActionError';
import { useAdminAction } from '@/components/opendispatch/patterns/useAdminAction';
import { Reason, useGate } from '@/components/opendispatch/ReasonHint';
import { changeChallenger, changeGateBaseline } from './actions';
import { GATE_BASELINES, type ComparisonView } from './types';
import styles from './ForecastModel.module.css';

// Model comparison: saved on change.

const NONE = '';

export function ComparisonCard({ comparison, canEdit }: { comparison: ComparisonView; canEdit: boolean }) {
  const m = useTranslations('admin.forecast_model');
  const gate = useGate(canEdit ? 'edit' : 'view');
  const challenger = useAdminAction(changeChallenger, { successTitle: m('toast.challenger'), successDescription: (saved) => saved.challenger ?? m('cmp.none') });
  const baseline = useAdminAction(changeGateBaseline, { successTitle: m('toast.gateBaseline'), successDescription: (saved) => m(saved.gateBaseline === 'naive' ? 'cmp.naive' : 'cmp.segment') });
  const options = [{ value: NONE, label: m('cmp.none') }, ...comparison.models.filter((model) => model !== comparison.champion).map((model) => ({ value: model, label: model }))];

  return (
    <Card padding="lg">
      <div className={styles.cardInner}>
        <div className={styles.head}>
          <h2 className={styles.cardTitle}>{m('cmp.title')}</h2>
        </div>
        <div className={styles.stack}>
          <Field label={m('cmp.challenger')}>
            <Select
              translate="no"
              value={comparison.challenger ?? NONE}
              disabled={!canEdit || challenger.pending}
              onChange={(event) => {
                const chosen = event.target.value;
                if (chosen !== (comparison.challenger ?? NONE) && gate.edit.allowed) challenger.run({ challenger_model: chosen === NONE ? null : chosen });
              }}
              options={options}
            />
          </Field>
          <ActionError error={challenger.error} onDismiss={challenger.reset} />
          <Field label={m('cmp.baseline')}>
            <Select
              value={comparison.gateBaseline}
              disabled={!canEdit || baseline.pending}
              onChange={(event) => {
                const chosen = GATE_BASELINES.find((b) => b === event.target.value);
                if (chosen !== undefined && chosen !== comparison.gateBaseline && gate.edit.allowed) baseline.run({ gate_baseline: chosen });
              }}
              options={GATE_BASELINES.map((value) => ({ value, label: m(`cmp.${value}`) }))}
            />
          </Field>
          <ActionError error={baseline.error} onDismiss={baseline.reset} />
          {gate.edit.reason === null ? null : <Reason>{gate.edit.reason}</Reason>}
        </div>
      </div>
    </Card>
  );
}
