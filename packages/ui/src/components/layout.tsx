// SPDX-License-Identifier: AGPL-3.0-only

import { Divider as AntDivider } from 'antd';
import type { CSSProperties, ElementType, HTMLAttributes, ReactNode } from 'react';
import { cx as joinClasses } from '../types';
import styles from './layout.module.css';

/** Class names for Ant Design props, which take a string, not undefined. */
const cx = (...names: Array<string | false | null | undefined>): string => joinClasses(...names) ?? '';

/** Gaps in pixels, from the spacing scale. */
export type LayoutGap = 0 | 2 | 4 | 6 | 8 | 12 | 16 | 20 | 24 | 32 | 40 | 48;

function gapStyle(gap: LayoutGap, style: CSSProperties | undefined): CSSProperties {
  return { gap: gap === 0 ? 0 : `var(--od-space-${String(gap)})`, ...style };
}

const ALIGN: Record<string, string> = {
  start: 'flex-start',
  center: 'center',
  end: 'flex-end',
  stretch: 'stretch',
  baseline: 'baseline',
};
const JUSTIFY: Record<string, string> = {
  start: 'flex-start',
  center: 'center',
  end: 'flex-end',
  between: 'space-between',
};

export interface StackProps extends Omit<HTMLAttributes<HTMLElement>, 'children'> {
  gap?: LayoutGap;
  align?: 'start' | 'center' | 'end' | 'stretch';
  as?: ElementType;
  className?: string | undefined;
  children?: ReactNode;
}

/** A vertical flex column. */
export function Stack({ gap = 12, align = 'stretch', as: Element = 'div', className, style, children, ...rest }: StackProps) {
  return (
    <Element {...rest} className={cx(styles.stack, className)} style={{ alignItems: ALIGN[align], ...gapStyle(gap, style) }}>
      {children}
    </Element>
  );
}

export interface InlineProps extends Omit<HTMLAttributes<HTMLElement>, 'children'> {
  gap?: LayoutGap;
  align?: 'start' | 'center' | 'end' | 'baseline' | 'stretch';
  justify?: 'start' | 'center' | 'end' | 'between';
  wrap?: boolean;
  as?: ElementType;
  className?: string | undefined;
  children?: ReactNode;
}

/** A horizontal flex row that follows the writing direction. */
export function Inline({
  gap = 8,
  align = 'center',
  justify = 'start',
  wrap = false,
  as: Element = 'div',
  className,
  style,
  children,
  ...rest
}: InlineProps) {
  return (
    <Element
      {...rest}
      className={cx(styles.inline, className)}
      style={{ alignItems: ALIGN[align], justifyContent: JUSTIFY[justify], flexWrap: wrap ? 'wrap' : 'nowrap', ...gapStyle(gap, style) }}
    >
      {children}
    </Element>
  );
}

export interface DividerProps {
  label?: string;
  vertical?: boolean;
  spacing?: 0 | 8 | 12 | 16 | 24;
  className?: string | undefined;
}

/** A rule between blocks, optionally with a label, or a vertical rule between inline items. */
export function Divider({ label, vertical = false, spacing = 0, className }: DividerProps) {
  const margin = spacing === 0 ? 0 : `var(--od-space-${String(spacing)})`;
  if (vertical) {
    return <AntDivider type="vertical" className={cx(className)} style={{ marginInline: margin }} />;
  }
  if (label) {
    return (
      <AntDivider {...({ 'aria-label': label } as object)} className={cx(className)} style={{ marginBlock: margin }}>
        {label}
      </AntDivider>
    );
  }
  return <AntDivider className={cx(className)} style={{ marginBlock: margin }} />;
}
