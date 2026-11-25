// SPDX-License-Identifier: AGPL-3.0-only
'use client';

import { Input as AntInput } from 'antd';
import type { InputRef } from 'antd';
import { useCallback, useId, useState, type ChangeEvent, type InputHTMLAttributes, type Ref } from 'react';
import { NO_VALUE, date } from '../format';
import { useLabels, useLocale } from '../provider';
import { cx } from '../types';
import styles from './date-input.module.css';
import { ANT_SIZE, assignRef, defined } from './form-utils';

export interface DateInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size' | 'type'> {
  size?: 'sm' | 'md' | 'lg';
  invalid?: boolean;
  /** Shows the chosen day in the Umm al-Qura calendar under the field. */
  showHijri?: boolean;
  ref?: Ref<HTMLInputElement>;
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

function outOfRange(value: string, min: unknown, max: unknown): boolean {
  if (!ISO_DAY.test(value)) return false;
  if (typeof min === 'string' && ISO_DAY.test(min) && value < min) return true;
  return typeof max === 'string' && ISO_DAY.test(max) && value > max;
}

/**
 * A native date field (<input type="date">, so the browser's own picker and a plain YYYY-MM-DD value in forms),
 * drawn by Ant Design's Input. A day outside min and max is marked invalid.
 */
export function DateInput({
  size = 'md',
  invalid = false,
  showHijri = false,
  className,
  ref,
  onChange,
  'aria-describedby': describedBy,
  ...rest
}: DateInputProps) {
  const locale = useLocale();
  const label = useLabels();
  const captionId = useId();
  const [typed, setTyped] = useState(typeof rest.defaultValue === 'string' ? rest.defaultValue : '');
  const current = rest.value === undefined ? typed : String(rest.value);
  const isInvalid = invalid || rest['aria-invalid'] === true || rest['aria-invalid'] === 'true' || outOfRange(current, rest.min, rest.max);
  const hijri = showHijri && current !== '' ? date(current, { locale, calendar: 'hijri' }) : NO_VALUE;
  const caption = hijri === NO_VALUE ? null : label('dateInput.hijriCaption', { date: hijri });
  const setRef = useCallback(
    (instance: InputRef | null) => {
      assignRef(ref, instance?.input ?? null);
    },
    [ref],
  );

  const native = rest as Record<string, unknown>;
  const field = (
    <AntInput
      {...native}
      ref={setRef}
      type="date"
      size={ANT_SIZE[size]}
      {...defined({
        status: isInvalid ? ('error' as const) : undefined,
        'aria-invalid': isInvalid || undefined,
        'aria-describedby': [describedBy, caption === null ? undefined : captionId].filter(Boolean).join(' ') || undefined,
        className: cx(styles.input, className),
      })}
      onChange={(event: ChangeEvent<HTMLInputElement>) => {
        setTyped(event.target.value);
        onChange?.(event);
      }}
    />
  );
  if (!showHijri) return field;
  return (
    <div className={styles.wrap}>
      {field}
      <span id={captionId} className={styles.caption}>
        {caption}
      </span>
    </div>
  );
}
