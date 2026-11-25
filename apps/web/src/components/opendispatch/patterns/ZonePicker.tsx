'use client';
// SPDX-License-Identifier: AGPL-3.0-only

import { Checkbox } from '@opendispatch/ui';
import { useTranslations } from 'next-intl';
import { useId } from 'react';
import styles from './ZonePicker.module.css';

// A checkbox list of zones grouped by city: the users' zones, the group rules' zones. Each city has a
// whole-city checkbox that selects or clears all its zones (indeterminate when only some are chosen). A role whose scope
// is not "assigned zones" disables the picker (`disabled`) and the hint says it is not needed. When `required` and none
// is chosen the hint becomes the error "Choose at least one zone". Zone codes and city names are data: translate="no".
//
//   <ZonePicker legend={t('common.zone')} zones={zones} value={ids} onChange={setIds} disabled={!assigned} required={assigned} disabledHint={t('zones.none')} />
//
// The picker holds no state: the parent owns `value` and validates it again (the data layer requires a zone for the three
// zone-scoped roles and refuses one outside the caller's scope).

export interface PickerZone {
  readonly id: string;
  /** The short code shown on the checkbox (`RD-C`). */
  readonly code: string;
  /** The zone's full name, for the checkbox's tooltip and a screen reader. */
  readonly name: string;
  readonly cityId: string;
  readonly cityName: string;
}

export interface ZonePickerProps {
  readonly zones: readonly PickerZone[];
  readonly value: readonly string[];
  readonly onChange: (next: string[]) => void;
  /** The group's label. */
  readonly legend: string;
  readonly disabled?: boolean | undefined;
  /** At least one zone must be chosen. */
  readonly required?: boolean | undefined;
  /** The hint while disabled (for example "Not needed for this role"). */
  readonly disabledHint?: string | undefined;
}

export function ZonePicker({ zones, value, onChange, legend, disabled = false, required = false, disabledHint }: ZonePickerProps) {
  const t = useTranslations('patterns.zones');
  const hintId = useId();
  const chosen = new Set(value);

  const cities: { id: string; name: string; zones: PickerZone[] }[] = [];
  for (const zone of zones) {
    let city = cities.find((c) => c.id === zone.cityId);
    if (city === undefined) {
      city = { id: zone.cityId, name: zone.cityName, zones: [] };
      cities.push(city);
    }
    city.zones.push(zone);
  }

  const toggleZone = (id: string, on: boolean) => onChange(on ? [...new Set([...value, id])] : value.filter((zoneId) => zoneId !== id));
  const toggleCity = (ids: readonly string[], on: boolean) => onChange(on ? [...new Set([...value, ...ids])] : value.filter((zoneId) => !ids.includes(zoneId)));

  const missing = required && !disabled && value.length === 0;
  const hint = disabled ? disabledHint : missing ? t('chooseOne') : value.length > 0 ? t('chosen', { count: value.length }) : undefined;

  return (
    <fieldset className={styles.picker} disabled={disabled} aria-describedby={hint === undefined ? undefined : hintId} data-invalid={missing ? '' : undefined}>
      <legend className={styles.legend}>{legend}</legend>
      {zones.length === 0 ? <span className={styles.hint}>{t('none')}</span> : null}
      <div className={styles.cities}>
        {cities.map((city) => {
          const ids = city.zones.map((zone) => zone.id);
          const count = ids.filter((id) => chosen.has(id)).length;
          return (
            <div key={city.id} className={styles.city}>
              <Checkbox
                className={styles.cityToggle}
                label={
                  <span className={styles.cityName} translate="no">
                    {city.name}
                  </span>
                }
                aria-label={t('wholeCity', { city: city.name })}
                checked={count === ids.length}
                indeterminate={count > 0 && count < ids.length}
                disabled={disabled}
                onChange={(event) => toggleCity(ids, event.target.checked)}
              />
              <div className={styles.zones}>
                {city.zones.map((zone) => (
                  <Checkbox
                    key={zone.id}
                    label={<span translate="no">{zone.code}</span>}
                    title={zone.name}
                    checked={chosen.has(zone.id)}
                    disabled={disabled}
                    onChange={(event) => toggleZone(zone.id, event.target.checked)}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>
      {hint === undefined ? null : (
        <span id={hintId} className={missing ? styles.error : styles.hint} role={missing ? 'alert' : undefined}>
          {hint}
        </span>
      )}
    </fieldset>
  );
}
