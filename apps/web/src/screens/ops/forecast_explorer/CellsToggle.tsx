'use client';
// SPDX-License-Identifier: AGPL-3.0-only

import { useTranslations } from 'next-intl';
import { ReasonSwitch } from '@/components/opendispatch/ReasonSwitch';
import { useUrlState } from '@/components/opendispatch/patterns/useUrlState';

// The map's "Cells" switch: needs a sub-zone.
export function CellsToggle({ on, hasSub }: { readonly on: boolean; readonly hasSub: boolean }) {
  const m = useTranslations('ops.forecast_explorer');
  const url = useUrlState();
  return (
    <ReasonSwitch
      label={m('cells.label')}
      checked={on && hasSub}
      reason={hasSub ? null : m('cells.pick')}
      onCheckedChange={(next) => url.update({ cells: next ? '1' : null })}
    />
  );
}
