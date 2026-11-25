'use client';
// SPDX-License-Identifier: AGPL-3.0-only

import { Badge, SegmentedControl } from '@opendispatch/ui';
import { useTranslations } from 'next-intl';
import { useUrlState } from '@/components/opendispatch/patterns/useUrlState';
import { CAUSE_VALUES, type CauseValue } from './types';
import type { CauseCounts } from './view';

// Cause chips (#gs-cause)

export interface CauseFilterProps {
  readonly value: CauseValue | undefined;
  readonly counts: CauseCounts;
}

export function CauseFilter({ value, counts }: CauseFilterProps) {
  const m = useTranslations('ops.gap_surplus');
  const t = useTranslations();
  const url = useUrlState();

  const label = (key: CauseValue, n: number) => (
    <>
      {m(`cause.${key}`)} <Badge size="sm" tone="neutral">{n}</Badge>
    </>
  );

  return (
    <SegmentedControl
      size="sm"
      ariaLabel={m('causeFilterLabel')}
      value={value ?? 'all'}
      onChange={(next) => {
        if (next === 'all') { url.update({ cause: null }); return; }
        if ((CAUSE_VALUES as readonly string[]).includes(next)) url.update({ cause: next });
      }}
      options={[
        { value: 'all', label: t('common.all') },
        { value: 'people', label: label('people', counts.people) },
        { value: 'vehicles', label: label('vehicles', counts.vehicles) },
        { value: 'geography', label: label('geography', counts.geography) },
      ]}
    />
  );
}
