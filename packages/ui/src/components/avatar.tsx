// SPDX-License-Identifier: AGPL-3.0-only

import { Avatar as AntAvatar } from 'antd';
import { initials } from '../format';
import { cx as joinClasses, type CategoryColor } from '../types';
import styles from './avatar.module.css';

const cx = (...names: Array<string | false | null | undefined>): string => joinClasses(...names) ?? '';

const COLORS: readonly CategoryColor[] = ['geekblue', 'red', 'gold', 'green', 'magenta', 'volcano', 'gray'];

/** The same name always gets the same colour. */
function colorFor(name: string): CategoryColor {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + (char.codePointAt(0) ?? 0)) >>> 0;
  return COLORS[hash % COLORS.length] ?? 'gray';
}

const SIZE = { xs: 20, sm: 24, md: 32, lg: 40 } as const;

export interface AvatarProps {
  name: string;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  color?: CategoryColor;
  className?: string | undefined;
}

/** Initials on Ant Design's Avatar, named by the full name (role="img"). */
export function Avatar({ name, size = 'md', color, className }: AvatarProps) {
  const letters = initials(name);
  const text = (size === 'xs' ? letters.slice(0, 1) : letters) || '?';
  return (
    <AntAvatar
      size={SIZE[size]}
      {...({ role: 'img', 'aria-label': name, title: name } as object)}
      className={cx(styles.avatar, styles[color ?? colorFor(name)], className)}
    >
      <span aria-hidden="true">{text}</span>
    </AntAvatar>
  );
}
