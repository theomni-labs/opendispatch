// SPDX-License-Identifier: AGPL-3.0-only

import { DownOutlined } from '@ant-design/icons';
import type { Ref, SelectHTMLAttributes } from 'react';
import { cx } from '../types';
import styles from './select.module.css';

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size'> {
  options: SelectOption[];
  /** Adds an empty first option with this text. It can be chosen to clear the value unless `required`. */
  placeholder?: string;
  size?: 'sm' | 'md' | 'lg';
  /** "full" (default) fills the container; "auto" is as wide as the longest option. */
  width?: 'full' | 'auto';
  invalid?: boolean;
  ref?: Ref<HTMLSelectElement>;
}

/**
 * A native <select> drawn like an Ant Design select. Native, so it submits with a form, works with every
 * keyboard and screen reader, and opens the phone's own picker. `className` goes on the outer wrapper.
 */
export function Select({
  options,
  placeholder,
  size = 'md',
  width = 'full',
  invalid = false,
  className,
  value,
  defaultValue,
  ref,
  ...rest
}: SelectProps) {
  const isInvalid = invalid || rest['aria-invalid'] === true || rest['aria-invalid'] === 'true';
  // Uncontrolled with a placeholder and no default: start on the placeholder.
  const initial = value === undefined && defaultValue === undefined && placeholder !== undefined ? '' : defaultValue;
  return (
    <span className={cx(styles.wrap, styles[size], width === 'auto' && styles.auto, className)}>
      <select
        {...rest}
        ref={ref}
        value={value}
        defaultValue={value === undefined ? initial : undefined}
        aria-invalid={isInvalid || undefined}
        className={cx(styles.select, isInvalid && styles.invalid)}
      >
        {placeholder !== undefined ? (
          <option value="" disabled={rest.required}>
            {placeholder}
          </option>
        ) : null}
        {options.map((option) => (
          <option key={option.value} value={option.value} disabled={option.disabled}>
            {option.label}
          </option>
        ))}
      </select>
      <DownOutlined aria-label="" className={styles.arrow} aria-hidden="true" />
    </span>
  );
}
