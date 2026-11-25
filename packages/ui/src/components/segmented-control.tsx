// SPDX-License-Identifier: AGPL-3.0-only
'use client';

import { useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { cx } from '../types';
import styles from './segmented-control.module.css';

export interface SegmentedControlOption {
  value: string;
  label: ReactNode;
  icon?: ReactNode;
}

export interface SegmentedControlProps {
  options: SegmentedControlOption[];
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  size?: 'sm' | 'md';
  /** The group's accessible name (same as `aria-label`). */
  ariaLabel?: string;
  'aria-label'?: string;
  'aria-labelledby'?: string;
  'aria-describedby'?: string;
  id?: string;
  className?: string | undefined;
}

/**
 * A row of options of which one is chosen, drawn like Ant Design's Segmented. Built as a radiogroup of buttons with
 * role="radio" and aria-checked, with one tab stop and arrow keys that follow the reading direction.
 */
export function SegmentedControl({
  options,
  value,
  defaultValue,
  onChange,
  size = 'md',
  ariaLabel,
  'aria-label': ariaLabelAttribute,
  'aria-labelledby': ariaLabelledBy,
  'aria-describedby': ariaDescribedBy,
  id,
  className,
}: SegmentedControlProps) {
  const [own, setOwn] = useState(defaultValue ?? options[0]?.value);
  const current = value === undefined ? own : value;
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);
  const selectedIndex = options.findIndex((option) => option.value === current);
  const tabStop = selectedIndex === -1 ? 0 : selectedIndex;

  function choose(next: string) {
    if (value === undefined) setOwn(next);
    if (next !== current) onChange?.(next);
  }

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const rtl = getComputedStyle(event.currentTarget).direction === 'rtl';
    const forward = rtl ? 'ArrowLeft' : 'ArrowRight';
    const back = rtl ? 'ArrowRight' : 'ArrowLeft';
    const count = options.length;
    let target: number | null = null;
    if (event.key === forward || event.key === 'ArrowDown') target = (index + 1) % count;
    else if (event.key === back || event.key === 'ArrowUp') target = (index - 1 + count) % count;
    else if (event.key === 'Home') target = 0;
    else if (event.key === 'End') target = count - 1;
    if (target === null) return;
    event.preventDefault();
    const option = options[target];
    if (!option) return;
    choose(option.value);
    buttons.current[target]?.focus();
  }

  return (
    <div
      id={id}
      role="radiogroup"
      aria-label={ariaLabelAttribute ?? ariaLabel}
      aria-labelledby={ariaLabelledBy}
      aria-describedby={ariaDescribedBy}
      className={cx(styles.group, size === 'sm' && styles.sm, className)}
    >
      {options.map((option, index) => {
        const selected = option.value === current;
        return (
          <button
            key={option.value}
            ref={(node) => {
              buttons.current[index] = node;
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={index === tabStop ? 0 : -1}
            className={cx(styles.item, selected && styles.selected)}
            onClick={() => choose(option.value)}
            onKeyDown={(event) => onKeyDown(event, index)}
          >
            {option.icon ? (
              <span className={styles.icon} aria-hidden="true">
                {option.icon}
              </span>
            ) : null}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
