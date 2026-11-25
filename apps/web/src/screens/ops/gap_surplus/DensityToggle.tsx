'use client';
// SPDX-License-Identifier: AGPL-3.0-only

import { SegmentedControl } from '@opendispatch/ui';
import { useTranslations } from 'next-intl';
import { useUrlState } from '@/components/opendispatch/patterns/useUrlState';
import { DENSITY_VALUES, type Density } from './types';

// Interval toggle (#gs-dens): 15 min or hourly

export interface DensityToggleProps {
  readonly value: Density;
}

export function DensityToggle({ value }: DensityToggleProps) {
  const m = useTranslations('ops.gap_surplus');
  const url = useUrlState();

  return (
    <SegmentedControl
      size="sm"
      ariaLabel={m('densityLabel')}
      value={value}
      onChange={(next) => {
        if ((DENSITY_VALUES as readonly string[]).includes(next)) url.update({ dens: next === 'q' ? null : next });
      }}
      options={[
        { value: 'q', label: m('dens.q') },
        { value: 'h', label: m('dens.h') },
      ]}
    />
  );
}
