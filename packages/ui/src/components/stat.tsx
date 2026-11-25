// SPDX-License-Identifier: AGPL-3.0-only
'use client';

import { ArrowDownOutlined, ArrowUpOutlined, MinusOutlined } from '@ant-design/icons';
import { createElement, type ReactNode } from 'react';
import { useFormat, useLink } from '../provider';
import { cx, type CategoryColor } from '../types';
import styles from './stat.module.css';

export interface StatDelta {
  /** A change in percent. */
  value: number;
  goodWhen?: 'up' | 'down';
  label?: string;
}

export interface StatProps {
  label: string;
  value: ReactNode;
  unit?: string;
  delta?: StatDelta;
  icon?: ReactNode;
  hint?: ReactNode;
  href?: string;
  footer?: ReactNode;
  className?: string | undefined;
}

/** A key figure in the manner of Ant Design's Statistic: label, value with unit, an optional change and hint. */
export function Stat({ label, value, unit, delta, icon, hint, href, footer, className }: StatProps) {
  const Link = useLink();
  const format = useFormat();
  let change: ReactNode = null;
  if (delta) {
    let direction: 'up' | 'down' | 'flat' = 'flat';
    if (delta.value > 0) direction = 'up';
    else if (delta.value < 0) direction = 'down';
    let tone = styles.flat;
    if (direction !== 'flat') tone = direction === (delta.goodWhen ?? 'up') ? styles.good : styles.bad;
    let arrow = <MinusOutlined aria-label="" aria-hidden="true" />;
    if (direction === 'up') arrow = <ArrowUpOutlined aria-label="" aria-hidden="true" />;
    else if (direction === 'down') arrow = <ArrowDownOutlined aria-label="" aria-hidden="true" />;
    change = (
      <div className={styles.deltaRow}>
        <span className={cx(styles.delta, tone)}>
          {arrow}
          {/* Isolated so the sign stays on the left of the figure in Arabic text. */}
          <bdi dir="ltr">{format.delta(delta.value)}</bdi>
        </span>
        {delta.label ? <span className={styles.caption}>{delta.label}</span> : null}
      </div>
    );
  }
  const body = (
    <>
      <div className={styles.top}>
        <span className={styles.label}>{label}</span>
        {icon ? (
          <span className={styles.icon} aria-hidden="true">
            {icon}
          </span>
        ) : null}
      </div>
      <div className={styles.valueRow}>
        <span className={styles.value}>{value}</span>
        {unit ? <span className={styles.unit}>{unit}</span> : null}
      </div>
      {change}
      {hint ? <div className={styles.caption}>{hint}</div> : null}
      {footer ? <div className={styles.footer}>{footer}</div> : null}
    </>
  );
  if (href) {
    return createElement(Link, { href, className: cx(styles.stat, styles.link, className) }, body);
  }
  return <div className={cx(styles.stat, className)}>{body}</div>;
}

/** Tile colours are the category colours. */
export type TileColor = CategoryColor;

export interface TileProps {
  icon: ReactNode;
  color?: TileColor;
  size?: 'md' | 'lg';
  shape?: 'circle' | 'square';
  /** Names the tile as an image; without it the tile is decoration. */
  label?: string;
  className?: string | undefined;
}

/** An icon on a tinted round or square tile. */
export function Tile({ icon, color = 'green', size = 'md', shape = 'circle', label, className }: TileProps) {
  return (
    <span
      className={cx(styles.tile, styles[`tile-${color}`], shape === 'square' && styles.square, size === 'lg' && styles.large, className)}
      {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })}
    >
      {icon}
    </span>
  );
}
