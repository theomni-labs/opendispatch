// SPDX-License-Identifier: AGPL-3.0-only
'use client';

import { Select as AntSelect } from 'antd';
import { useState } from 'react';
import { useLabels } from '../provider';
import { cx } from '../types';
import styles from './combobox.module.css';
import { ANT_SIZE, defined } from './form-utils';

export interface ComboboxOption {
  value: string;
  label: string;
  /** A second line under the label. Searched too. */
  description?: string;
  /** A short note at the end of the row. Searched too. */
  meta?: string;
}

export interface ComboboxProps {
  options: ComboboxOption[];
  value?: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  /** Shown when nothing matches. Default: the "combobox.empty" label. */
  emptyText?: string;
  size?: 'sm' | 'md' | 'lg';
  invalid?: boolean;
  id?: string;
  disabled?: boolean;
  className?: string | undefined;
  'aria-label'?: string;
  'aria-labelledby'?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean | 'true' | 'false';
}


function matches(option: ComboboxOption, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (needle === '') return true;
  return [option.label, option.description, option.meta, option.value].some((text) => text?.toLowerCase().includes(needle));
}

/**
 * A searchable single choice on Ant Design's Select (showSearch). The input has role="combobox"; typing filters the
 * options by label, description, meta and value. The list opens in a layer above drawers and dialogs.
 */
export function Combobox({
  options,
  value,
  onChange,
  placeholder,
  emptyText,
  size = 'md',
  invalid = false,
  id,
  disabled = false,
  className,
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledBy,
  'aria-describedby': ariaDescribedBy,
  'aria-invalid': ariaInvalid,
}: ComboboxProps) {
  const label = useLabels();
  const [own, setOwn] = useState<string | undefined>(undefined);
  const current = value === undefined ? own : value;
  const isInvalid = invalid || ariaInvalid === true || ariaInvalid === 'true';
  const byValue = new Map(options.map((option) => [option.value, option]));

  return (
    <AntSelect<string, { value: string; label: string }>
      showSearch
      {...defined({
        id,
        value: current,
        status: isInvalid ? ('error' as const) : undefined,
        'aria-label': ariaLabel,
        'aria-labelledby': ariaLabelledBy,
        'aria-describedby': ariaDescribedBy,
        'aria-invalid': isInvalid || undefined,
        className: cx(styles.combobox, className),
      })}
      disabled={disabled}
      size={ANT_SIZE[size]}
      placeholder={placeholder ?? label('combobox.placeholder')}
      notFoundContent={<span className={styles.empty}>{emptyText ?? label('combobox.empty')}</span>}
      options={options.map((option) => ({ value: option.value, label: option.label }))}
      filterOption={(input, option) => {
        const full = option ? byValue.get(option.value) : undefined;
        return full ? matches(full, input) : false;
      }}
      optionRender={(option) => {
        const full = byValue.get(String(option.value));
        if (!full) return option.label;
        return (
          <span className={styles.option}>
            <span className={styles.text}>
              <span className={styles.label}>{full.label}</span>
              {full.description ? <span className={styles.description}>{full.description}</span> : null}
            </span>
            {full.meta ? <span className={styles.meta}>{full.meta}</span> : null}
          </span>
        );
      }}
      onChange={(next) => {
        if (value === undefined) setOwn(next);
        onChange?.(next);
      }}
    />
  );
}
