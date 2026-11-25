// SPDX-License-Identifier: AGPL-3.0-only

import type { ElementType, HTMLAttributes, ReactNode } from 'react';
import { cx } from '../types';
import styles from './card.module.css';

export interface CardProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  padding?: 'none' | 'sm' | 'md' | 'lg';
  /** Lifts on hover, for a card that is a link or button. */
  interactive?: boolean;
  tone?: 'default' | 'subtle';
  /** The element to render: a section, an article or a list item keeps the page's structure. */
  as?: ElementType;
  href?: string;
  className?: string | undefined;
  children?: ReactNode;
}

const PADDING = { none: styles.padNone, sm: styles.padSm, md: styles.padMd, lg: styles.padLg } as const;

/**
 * A bordered surface drawn like Ant Design's Card. It is a plain element rather than antd's Card because screens
 * choose the element (`as="section"`, `as="li"`), which antd's Card cannot.
 */
export function Card({ padding = 'md', interactive = false, tone = 'default', as: Element = 'div', className, children, ...rest }: CardProps) {
  return (
    <Element
      className={cx(styles.card, PADDING[padding], tone === 'subtle' && styles.subtle, interactive && styles.interactive, className)}
      {...rest}
    >
      {children}
    </Element>
  );
}

export interface CardHeaderProps {
  title: ReactNode;
  subtitle?: ReactNode;
  icon?: ReactNode;
  actions?: ReactNode;
  bordered?: boolean;
  className?: string | undefined;
}

/** The card's title row: an h3, an optional subtitle, and actions at the inline end. */
export function CardHeader({ title, subtitle, icon, actions, bordered = false, className }: CardHeaderProps) {
  return (
    <div className={cx(styles.header, bordered && styles.bordered, className)}>
      {icon ? (
        <span className={styles.headerIcon} aria-hidden="true">
          {icon}
        </span>
      ) : null}
      <div className={styles.headerText}>
        <h3 className={styles.title}>{title}</h3>
        {subtitle ? <p className={styles.subtitle}>{subtitle}</p> : null}
      </div>
      {actions ? <div className={styles.actions}>{actions}</div> : null}
    </div>
  );
}
