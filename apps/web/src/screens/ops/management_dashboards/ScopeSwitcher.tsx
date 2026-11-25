'use client';
// SPDX-License-Identifier: AGPL-3.0-only

import { SegmentedControl, Select } from '@opendispatch/ui';
import { useTranslations } from 'next-intl';
import { useUrlState } from '@/components/opendispatch/patterns/useUrlState';
import styles from './ManagementDashboards.module.css';
import { SCOPE_VALUES, type OptionItem, type ScopeLevel } from './types';

// Scope row (#md-scope-row), in the URL

export interface ScopeSwitcherProps {
  readonly scope: ScopeLevel;
  readonly cityOptions: readonly OptionItem[];
  readonly zoneOptions: readonly OptionItem[];
  readonly cityValue: string;
  readonly zoneValue: string;
}

export function ScopeSwitcher({ scope, cityOptions, zoneOptions, cityValue, zoneValue }: ScopeSwitcherProps) {
  const m = useTranslations('ops.management_dashboards');
  const url = useUrlState();

  return (
    <div className={styles.scopeRow}>
      <SegmentedControl
        size="sm"
        ariaLabel={m('scope.label')}
        value={scope}
        options={SCOPE_VALUES.map((value) => ({ value, label: m(`scope.${value}`) }))}
        onChange={(next) => url.update({ scope: next === 'kingdom' ? null : next, city: null, zone: null })}
      />
      {scope === 'city' ? (
        <Select width="auto" aria-label={m('pick.city')} value={cityValue} options={[...cityOptions]} onChange={(event) => url.update({ city: event.target.value })} />
      ) : scope === 'zone' ? (
        <Select width="auto" aria-label={m('pick.zone')} value={zoneValue} options={[...zoneOptions]} onChange={(event) => url.update({ zone: event.target.value })} />
      ) : null}
    </div>
  );
}
