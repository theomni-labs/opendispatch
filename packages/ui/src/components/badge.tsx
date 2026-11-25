// SPDX-License-Identifier: AGPL-3.0-only
'use client';

import { CloseOutlined } from '@ant-design/icons';
import { Tag as AntTag } from 'antd';
import type { ReactNode } from 'react';
import { useFormat, useLabels } from '../provider';
import { cx as joinClasses, type CategoryColor, type Tone } from '../types';
import styles from './badge.module.css';

/** Class names for Ant Design props, which take a string, not undefined. */
const cx = (...names: Array<string | false | null | undefined>): string => joinClasses(...names) ?? '';

/** Ant Design's status colours for each tone. */
const STATUS: Record<Tone, string | undefined> = {
  neutral: undefined,
  accent: 'processing',
  success: 'success',
  warning: 'warning',
  danger: 'error',
  info: 'processing',
};

/** The solid fill of each tone, from tokens.css. */
const SOLID: Record<Tone, string> = {
  neutral: 'var(--od-color-neutral)',
  accent: 'var(--od-color-primary)',
  success: 'var(--od-color-success)',
  warning: 'var(--od-color-warning)',
  danger: 'var(--od-color-error)',
  info: 'var(--od-color-info)',
};

export interface BadgeProps {
  tone?: Tone;
  variant?: 'soft' | 'solid' | 'outline';
  size?: 'sm' | 'md';
  /** A coloured dot before the text. */
  dot?: boolean;
  icon?: ReactNode;
  className?: string | undefined;
  children?: ReactNode;
}

/** A short status label on Ant Design's Tag. */
export function Badge({ tone = 'neutral', variant = 'soft', size = 'md', dot = false, icon, className, children }: BadgeProps) {
  const color = variant === 'solid' ? SOLID[tone] : STATUS[tone];
  return (
    <AntTag
      bordered={variant === 'outline'}
      {...(color === undefined ? {} : { color })}
      className={cx(styles.badge, styles[size], styles[tone], variant === 'solid' && styles.solid, className)}
    >
      {dot ? <span className={styles.dot} aria-hidden="true" /> : null}
      {icon ? (
        <span className={styles.icon} aria-hidden="true">
          {icon}
        </span>
      ) : null}
      <span className={styles.label}>{children}</span>
    </AntTag>
  );
}

export interface CountBadgeProps {
  count: number;
  tone?: Tone;
  /** Above this, "99+". */
  max?: number;
  className?: string | undefined;
}

/** A small rounded count, such as unread items. */
export function CountBadge({ count, tone = 'neutral', max = 99, className }: CountBadgeProps) {
  const { int } = useFormat();
  const text = count > max ? `${int(max)}+` : int(count);
  return <span className={cx(styles.count, styles[`count-${tone}`], className)}>{text}</span>;
}

export interface StatusPillProps {
  status: string;
  tone: Tone;
  size?: 'sm' | 'md';
  className?: string | undefined;
}

/** A status word with a dot in its tone. */
export function StatusPill({ status, tone, size = 'md', className }: StatusPillProps) {
  return (
    <Badge tone={tone} size={size} dot className={className}>
      {status}
    </Badge>
  );
}

export interface TagProps {
  color?: CategoryColor;
  /** Shows a remove button named "Remove {text}". */
  onRemove?: () => void;
  icon?: ReactNode;
  className?: string | undefined;
  children?: ReactNode;
}

/** A category label on Ant Design's Tag, in a preset colour. */
export function Tag({ color = 'gray', onRemove, icon, className, children }: TagProps) {
  const label = useLabels();
  const removeName = typeof children === 'string' ? label('tag.remove', { name: children }) : label('tag.removeGeneric');
  return (
    <AntTag bordered={false} {...(color === 'gray' ? {} : { color })} className={cx(styles.badge, styles.md, className)}>
      {icon ? (
        <span className={styles.icon} aria-hidden="true">
          {icon}
        </span>
      ) : null}
      <span className={styles.label}>{children}</span>
      {onRemove ? (
        <button type="button" className={styles.remove} onClick={onRemove} aria-label={removeName}>
          <CloseOutlined aria-label="" aria-hidden="true" />
        </button>
      ) : null}
    </AntTag>
  );
}
