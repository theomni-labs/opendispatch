'use client';
// SPDX-License-Identifier: AGPL-3.0-only

import { Field, SegmentedControl, Select, Stack } from '@opendispatch/ui';
import { useTranslations } from 'next-intl';
import { useUrlState } from '@/components/opendispatch/patterns/useUrlState';
import type { DayOption, PickerOption } from './view';
import styles from './ForecastExplorer.module.css';

// Picker (#fx "Zone and day" card): city, zone,
// sub-zone, day. City/zone choose the sub-zones the
// map and timeline read; day picks which forecast.

export interface PickerBarProps {
  readonly cities: readonly PickerOption[];
  readonly zones: readonly PickerOption[];
  readonly subZones: readonly PickerOption[];
  readonly city: string;
  readonly zoneId: string;
  readonly sub: string;
  readonly day: string;
  readonly days: readonly DayOption[];
}

export function PickerBar({ cities, zones, subZones, city, zoneId, sub, day, days }: PickerBarProps) {
  const m = useTranslations('ops.forecast_explorer');
  const t = useTranslations();
  const url = useUrlState();

  return (
    <Stack gap={12}>
      <div className={styles.pickerGrid}>
        <Field label={m('city')}>
          <Select
            value={city}
            options={cities.map((c) => ({ value: c.code, label: c.name }))}
            onChange={(event) => url.update({ city: event.target.value, zone: null, sub: null })}
          />
        </Field>
        <Field label={t('common.zone')}>
          <Select
            value={zoneId}
            options={zones.map((z) => ({ value: z.id, label: `${z.name} (${z.code})` }))}
            onChange={(event) => url.update({ zone: event.target.value, sub: null })}
          />
        </Field>
        <Field label={m('subzone')}>
          <Select
            value={sub}
            placeholder={m('allsubs')}
            options={subZones.map((s) => ({ value: s.id, label: s.name }))}
            onChange={(event) => url.update({ sub: event.target.value === '' ? null : event.target.value })}
          />
        </Field>
      </div>
      <Field label={m('day')}>
        <SegmentedControl className={styles.days} size="sm" value={day} options={days.map((d) => ({ value: d.value, label: d.label }))} onChange={(value) => url.update({ day: value })} />
      </Field>
    </Stack>
  );
}
