'use client';
// SPDX-License-Identifier: AGPL-3.0-only

import { SegmentedControl } from '@opendispatch/ui';
import { useTranslations } from 'next-intl';
import { useUrlState } from '@/components/opendispatch/patterns/useUrlState';
import { SHOW_VALUES, type ShowValue } from './kpi';

// What a cell shows (#gs-show)

export interface ShowToggleProps {
  readonly value: ShowValue;
}

export function ShowToggle({ value }: ShowToggleProps) {
  const m = useTranslations('ops.gap_surplus');
  const url = useUrlState();

  return (
    <SegmentedControl
      size="sm"
      ariaLabel={m('show.label')}
      value={value}
      onChange={(next) => {
        if ((SHOW_VALUES as readonly string[]).includes(next)) url.update({ show: next === 'delta' ? null : next });
      }}
      options={[
        { value: 'delta', label: m('show.delta') },
        { value: 'met', label: m('show.met') },
        { value: 'reach', label: m('show.reach') },
      ]}
    />
  );
}
