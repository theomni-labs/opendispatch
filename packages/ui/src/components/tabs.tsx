// SPDX-License-Identifier: AGPL-3.0-only
'use client';

import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useDir } from '../provider';
import { cx } from '../types';
import styles from './tabs.module.css';

export interface TabItem {
  value: string;
  label: ReactNode;
  count?: number;
  icon?: ReactNode;
}

export interface TabsProps {
  items: TabItem[];
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  /** line: an underlined bar; pill: segments inside a card. */
  variant?: 'line' | 'pill';
  ariaLabel?: string;
  'aria-label'?: string;
  'aria-labelledby'?: string;
  /** Prefix of the tab ids: each tab is `${id}-tab-${value}`, so the page's own panel can be named by its tab. */
  id?: string;
  className?: string | undefined;
}

/**
 * A tab list drawn like Ant Design's Tabs. The screens own their panels (often server rendered, one at a time) and
 * name them by the tab ids, which antd's Tabs, with its own panels and ids, cannot offer. Arrow keys follow the
 * writing direction; Home and End go to the first and last tab.
 */
export function Tabs({
  items,
  value,
  defaultValue,
  onChange,
  variant = 'line',
  ariaLabel,
  'aria-label': ariaLabelAttribute,
  'aria-labelledby': labelledBy,
  id,
  className,
}: TabsProps) {
  const generated = useId();
  const base = id ?? `tabs-${generated}`;
  const dir = useDir();
  const [own, setOwn] = useState(defaultValue ?? items[0]?.value);
  const current = value ?? own;
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);
  const currentIndex = items.findIndex((item) => item.value === current);
  const focusable = currentIndex === -1 ? 0 : currentIndex;

  const choose = (next: string) => {
    if (value === undefined) setOwn(next);
    if (next !== current) onChange?.(next);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const rtl = (event.currentTarget.closest('[dir]')?.getAttribute('dir') ?? dir) === 'rtl';
    let next: number | null = null;
    if (event.key === (rtl ? 'ArrowLeft' : 'ArrowRight')) next = (index + 1) % items.length;
    else if (event.key === (rtl ? 'ArrowRight' : 'ArrowLeft')) next = (index - 1 + items.length) % items.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = items.length - 1;
    if (next === null) return;
    event.preventDefault();
    const target = items[next];
    if (!target) return;
    choose(target.value);
    buttons.current[next]?.focus();
  };

  return (
    <div
      role="tablist"
      aria-label={ariaLabelAttribute ?? ariaLabel}
      aria-labelledby={labelledBy}
      aria-orientation="horizontal"
      className={cx(styles.list, styles[variant], className)}
    >
      {items.map((item, index) => {
        const selected = item.value === current;
        return (
          <button
            key={item.value}
            ref={(element) => {
              buttons.current[index] = element;
            }}
            id={`${base}-tab-${item.value}`}
            type="button"
            role="tab"
            aria-selected={selected}
            tabIndex={index === focusable ? 0 : -1}
            className={cx(styles.tab, selected && styles.active)}
            onClick={() => choose(item.value)}
            onKeyDown={(event) => onKeyDown(event, index)}
          >
            {item.icon ? (
              <span className={styles.icon} aria-hidden="true">
                {item.icon}
              </span>
            ) : null}
            <span>{item.label}</span>
            {item.count === undefined ? null : <span className={styles.count}>{item.count}</span>}
          </button>
        );
      })}
    </div>
  );
}
