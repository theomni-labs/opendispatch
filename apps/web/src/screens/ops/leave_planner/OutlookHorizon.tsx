'use client';
// SPDX-License-Identifier: AGPL-3.0-only

import { SegmentedControl } from '@opendispatch/ui';
import { useTranslations } from 'next-intl';
import { useUrlState } from '@/components/opendispatch/patterns/useUrlState';
import type { OutlookHorizon as Horizon } from './outlook-types';

// 13 or 52 weeks, kept in ?horizon=.

export function OutlookHorizon({ value }: { readonly value: Horizon }) {
  const m = useTranslations('ops.leave_planner');
  const url = useUrlState();
  return (
    <SegmentedControl
      size="sm"
      ariaLabel={m('out.horizon')}
      value={String(value)}
      options={[
        { value: '13', label: m('out.w13') },
        { value: '52', label: m('out.w52') },
      ]}
      onChange={(next) => url.update({ horizon: next === '52' ? '52' : null }, { history: 'replace', keepPage: true })}
    />
  );
}
