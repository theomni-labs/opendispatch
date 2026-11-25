// SPDX-License-Identifier: AGPL-3.0-only
'use client';

import { RightOutlined } from '@ant-design/icons';
import type { ReactNode } from 'react';
import { useLink } from '../provider';
import { cx } from '../types';
import { Tile, type TileColor } from './stat';
import styles from './task-list.module.css';

export interface TaskListItem {
  id: string;
  title: ReactNode;
  badge?: ReactNode;
  meta?: ReactNode;
  icon?: ReactNode;
  color?: TileColor;
  href?: string;
  disabled?: boolean;
}

export interface TaskListProps {
  items: TaskListItem[];
  className?: string | undefined;
}

/** A list of tasks, each a row with an icon tile, a title and meta; a row with `href` is a link. */
export function TaskList({ items, className }: TaskListProps) {
  const Link = useLink();
  return (
    <ul className={cx(styles.list, className)}>
      {items.map((item) => {
        const body = (
          <>
            {item.icon ? <Tile icon={item.icon} color={item.color ?? 'green'} /> : null}
            <span className={styles.text}>
              <span className={styles.titleRow}>
                <span className={styles.title}>{item.title}</span>
                {item.badge}
              </span>
              {item.meta ? <span className={styles.meta}>{item.meta}</span> : null}
            </span>
            {item.href ? (
              <span className={styles.chevron} aria-hidden="true">
                <RightOutlined aria-hidden="true" aria-label="" />
              </span>
            ) : null}
          </>
        );
        let row: ReactNode;
        if (item.disabled) {
          row = (
            <span className={cx(styles.task, styles.disabled)} {...(item.href ? { role: 'link', 'aria-disabled': true } : {})}>
              {body}
            </span>
          );
        } else if (item.href) {
          row = (
            <Link href={item.href} className={cx(styles.task, styles.link)}>
              {body}
            </Link>
          );
        } else {
          row = <div className={styles.task}>{body}</div>;
        }
        return <li key={item.id}>{row}</li>;
      })}
    </ul>
  );
}
