// SPDX-License-Identifier: AGPL-3.0-only
'use client';

import { Collapse } from 'antd';
import { useState, type ReactNode } from 'react';
import { cx as joinClasses } from '../types';
import styles from './accordion.module.css';

const cx = (...names: Array<string | false | null | undefined>): string => joinClasses(...names) ?? '';

export interface AccordionItem {
  id: string;
  title: ReactNode;
  content: ReactNode;
  disabled?: boolean;
}

export interface AccordionProps {
  items: AccordionItem[];
  /** single: opening one closes the others. */
  type?: 'single' | 'multiple';
  defaultValue?: readonly string[];
  value?: readonly string[] | undefined;
  onValueChange?: (value: string[]) => void;
  className?: string | undefined;
}

/**
 * Ant Design's Collapse. Single mode is done here, not with antd's `accordion` flag, so the headers stay buttons
 * with aria-expanded rather than becoming tabs.
 */
export function Accordion({ items, type = 'single', defaultValue = [], value, onValueChange, className }: AccordionProps) {
  const [own, setOwn] = useState<readonly string[]>(defaultValue);
  const current = value ?? own;
  const open = type === 'single' ? current.slice(0, 1) : current;

  const change = (keys: string | string[]) => {
    const list = Array.isArray(keys) ? keys : [keys];
    let next = list;
    if (type === 'single') {
      const added = list.find((key) => !open.includes(key));
      next = added === undefined ? [] : [added];
    }
    if (value === undefined) setOwn(next);
    onValueChange?.(next);
  };

  return (
    <Collapse
      className={cx(styles.accordion, className)}
      activeKey={[...open]}
      onChange={change}
      items={items.map((item) => ({
        key: item.id,
        label: item.title,
        children: item.content,
        ...(item.disabled ? { collapsible: 'disabled' as const } : {}),
      }))}
    />
  );
}
