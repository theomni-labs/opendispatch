'use client';
// SPDX-License-Identifier: AGPL-3.0-only

import { Field, SegmentedControl, Select } from '@opendispatch/ui';
import { useTranslations } from 'next-intl';
import { useUrlState } from '@/components/opendispatch/patterns/useUrlState';
import styles from './ServiceLevelSimulator.module.css';
import { ASSIGNMENT_POLICIES } from './types';
import type { OptionItem } from './view';

// Replay inputs (#sl-in), written to the URL

export interface ReplayInputsCardProps {
  readonly rosterOptions: readonly OptionItem[];
  readonly dateOptions: readonly OptionItem[];
  readonly rosterId: string;
  readonly runDate: string;
  readonly policy: (typeof ASSIGNMENT_POLICIES)[number];
}

export function ReplayInputsCard({ rosterOptions, dateOptions, rosterId, runDate, policy }: ReplayInputsCardProps) {
  const m = useTranslations('ops.service_level_simulator');
  const url = useUrlState();

  return (
    <div className={styles.formGrid}>
      <Field label={m('f.roster')}>
        <Select value={rosterId} options={[...rosterOptions]} onChange={(event) => url.update({ ref: event.target.value })} />
      </Field>
      <Field label={m('f.date')}>
        <Select value={runDate} options={[...dateOptions]} onChange={(event) => url.update({ date: event.target.value })} />
      </Field>
      <Field label={m('f.policy')}>
        <SegmentedControl
          ariaLabel={m('f.policy')}
          value={policy}
          options={ASSIGNMENT_POLICIES.map((value) => ({ value, label: m(`policy.${value}`) }))}
          onChange={(value) => url.update({ policy: value })}
        />
      </Field>
    </div>
  );
}
