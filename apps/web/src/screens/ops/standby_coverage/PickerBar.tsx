'use client';
// SPDX-License-Identifier: AGPL-3.0-only

import { Select } from '@opendispatch/ui';
import { useTranslations } from 'next-intl';
import { useUrlState } from '@/components/opendispatch/patterns/useUrlState';
import type { ZoneOption } from './view';

// Zone select (#sc-zone) in the map card

export interface PickerBarProps {
  readonly zoneOptions: readonly ZoneOption[];
  readonly zoneId: string;
}

export function PickerBar({ zoneOptions, zoneId }: PickerBarProps) {
  const t = useTranslations();
  const url = useUrlState();

  if (zoneOptions.length <= 1) return null;

  return (
    <Select
      width="auto"
      size="sm"
      aria-label={t('common.zone')}
      value={zoneId}
      options={zoneOptions.map((zone) => ({ value: zone.id, label: `${zone.name} (${zone.code})` }))}
      onChange={(event) => url.update({ zone: event.target.value, pt: null })}
    />
  );
}
