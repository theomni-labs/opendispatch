// SPDX-License-Identifier: AGPL-3.0-only
'use client';

import { Checkbox as AntCheckbox, Radio as AntRadio, Switch as AntSwitch } from 'antd';
import type { CheckboxChangeEvent, CheckboxRef } from 'antd/es/checkbox';
import { useCallback, useId, useState, type InputHTMLAttributes, type KeyboardEvent, type ReactNode, type Ref } from 'react';
import { useDir } from '../provider';
import { cx } from '../types';
import styles from './choice.module.css';
import { assignRef, defined } from './form-utils';


const joinIds = (...ids: Array<string | undefined>): string | undefined => ids.filter(Boolean).join(' ') || undefined;

/* Checkbox */

export type { CheckboxChangeEvent };

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'onChange'> {
  label?: ReactNode;
  description?: ReactNode;
  /** Shows a dash and reports "mixed": some, not all, of a set are chosen. */
  indeterminate?: boolean;
  /** `event.target.checked` is the new state. */
  onChange?: (event: CheckboxChangeEvent) => void;
  ref?: Ref<HTMLInputElement>;
}

/** Ant Design's Checkbox: a native checkbox (it submits with a form) inside a label. */
export function Checkbox({ label, description, indeterminate = false, className, id, ref, title, ...rest }: CheckboxProps) {
  const generated = useId();
  const inputId = id ?? `checkbox-${generated}`;
  const descriptionId = description ? `${inputId}-description` : undefined;
  const setRef = useCallback((instance: CheckboxRef | null) => assignRef(ref, instance?.input ?? null), [ref]);
  // Ant Design types its own props; the remaining native attributes (name, value, aria-*) reach the <input>.
  const native = rest as Record<string, unknown>;
  const box = (
    <AntCheckbox
      {...native}
      ref={setRef}
      id={inputId}
      indeterminate={indeterminate}
      {...defined({
        'aria-checked': indeterminate ? ('mixed' as const) : undefined,
        'aria-describedby': joinIds(rest['aria-describedby'], descriptionId),
        className: cx(styles.checkbox, description ? undefined : className),
        title,
      })}
    >
      {label}
    </AntCheckbox>
  );
  if (!description) return box;
  return (
    <span className={cx(styles.choice, className)}>
      {box}
      <span id={descriptionId} className={styles.description}>
        {description}
      </span>
    </span>
  );
}

/* RadioGroup */

export interface RadioOption {
  value: string;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean | undefined;
}

export interface RadioGroupProps {
  /** The form field name every radio carries. */
  name: string;
  options: RadioOption[];
  value?: string | undefined;
  defaultValue?: string | undefined;
  onChange?: ((value: string) => void) | undefined;
  orientation?: 'vertical' | 'horizontal' | undefined;
  disabled?: boolean | undefined;
  id?: string | undefined;
  className?: string | undefined;
  'aria-label'?: string | undefined;
  'aria-labelledby'?: string | undefined;
  'aria-describedby'?: string | undefined;
}

/**
 * Native radios (Ant Design's Radio) in a role="radiogroup". Arrow keys move between them as the browser does
 * for radios that share a name, in either direction.
 */
export function RadioGroup({
  name,
  options,
  value,
  defaultValue,
  onChange,
  orientation = 'vertical',
  disabled = false,
  id,
  className,
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledBy,
  'aria-describedby': ariaDescribedBy,
}: RadioGroupProps) {
  const generated = useId();
  const baseId = id ?? `radio-${generated}`;
  const [own, setOwn] = useState(defaultValue);
  const current = value === undefined ? own : value;

  const dir = useDir();

  function choose(next: string) {
    if (value === undefined) setOwn(next);
    onChange?.(next);
  }

  // Arrow keys move the choice along the reading direction (right is "next" in English, "previous" in Arabic),
  // skipping disabled options and wrapping at the ends, as a native radio group does in a browser.
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const forward = dir === 'rtl' ? -1 : 1;
    const steps: Record<string, number> = { ArrowRight: forward, ArrowLeft: -forward, ArrowDown: 1, ArrowUp: -1 };
    const step = steps[event.key];
    if (step === undefined) return;
    const enabled = options.filter((option) => !disabled && option.disabled !== true);
    if (enabled.length === 0) return;
    event.preventDefault();
    const at = enabled.findIndex((option) => option.value === current);
    const next = enabled[(at + step + enabled.length) % enabled.length];
    if (!next) return;
    choose(next.value);
    const index = options.indexOf(next);
    event.currentTarget.querySelector<HTMLInputElement>(`[id="${baseId}-${String(index)}"]`)?.focus();
  }

  return (
    <div
      id={id}
      role="radiogroup"
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledBy ?? (id && !ariaLabel ? `${id}-label` : undefined)}
      aria-describedby={ariaDescribedBy}
      className={cx(styles.group, orientation === 'horizontal' ? styles.horizontal : styles.vertical, className)}
      onKeyDown={onKeyDown}
    >
      {options.map((option, index) => {
        const optionId = `${baseId}-${String(index)}`;
        const descriptionId = option.description ? `${optionId}-description` : undefined;
        return (
          <div key={option.value} className={styles.option}>
            <AntRadio
              id={optionId}
              name={name}
              value={option.value}
              checked={current === option.value}
              disabled={disabled || option.disabled === true}
              onChange={() => choose(option.value)}
              {...defined({ 'aria-describedby': descriptionId })}
            >
              {option.label}
            </AntRadio>
            {option.description ? (
              <span id={descriptionId} className={styles.description}>
                {option.description}
              </span>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

/* Switch */

export interface SwitchProps {
  checked?: boolean | undefined;
  defaultChecked?: boolean | undefined;
  onCheckedChange?: ((checked: boolean) => void) | undefined;
  label?: ReactNode;
  description?: ReactNode;
  disabled?: boolean | undefined;
  id?: string | undefined;
  className?: string | undefined;
  'aria-label'?: string | undefined;
  'aria-describedby'?: string | undefined;
}

/** Ant Design's Switch: a button with role="switch" and aria-checked, named by its label. */
export function Switch({
  checked,
  defaultChecked = false,
  onCheckedChange,
  label,
  description,
  disabled = false,
  id,
  className,
  'aria-label': ariaLabel,
  'aria-describedby': ariaDescribedBy,
}: SwitchProps) {
  const generated = useId();
  const switchId = id ?? `switch-${generated}`;
  const descriptionId = description ? `${switchId}-description` : undefined;
  const [own, setOwn] = useState(defaultChecked);
  const isOn = checked === undefined ? own : checked;

  return (
    <span className={cx(styles.switchRow, className)}>
      <AntSwitch
        id={switchId}
        checked={isOn}
        disabled={disabled}
        {...defined({ 'aria-label': ariaLabel, 'aria-describedby': joinIds(ariaDescribedBy, descriptionId) })}
        onChange={(next) => {
          if (checked === undefined) setOwn(next);
          onCheckedChange?.(next);
        }}
      />
      {label || description ? (
        <span className={styles.switchText}>
          {label ? (
            <label htmlFor={switchId} className={cx(styles.switchLabel, disabled && styles.disabled)}>
              {label}
            </label>
          ) : null}
          {description ? (
            <span id={descriptionId} className={styles.description}>
              {description}
            </span>
          ) : null}
        </span>
      ) : null}
    </span>
  );
}
