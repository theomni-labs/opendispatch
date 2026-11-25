// SPDX-License-Identifier: AGPL-3.0-only
'use client';

import { ArrowLeftOutlined } from '@ant-design/icons';
import type { ReactNode } from 'react';
import { useLabels } from '../provider';
import { cx } from '../types';
import { IconButton } from './button';
import styles from './page-header.module.css';

export interface PageHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  tabs?: ReactNode;
  backHref?: string | undefined;
  className?: string | undefined;
}

/** The page's <header>: an h1 with meta beside it, a description, actions at the inline end, then tabs. */
export function PageHeader({ title, description, meta, actions, tabs, backHref, className }: PageHeaderProps) {
  const label = useLabels();
  return (
    <header className={cx(styles.root, className)}>
      <div className={styles.row}>
        <div className={styles.main}>
          {backHref ? (
            <IconButton href={backHref} icon={<ArrowLeftOutlined aria-hidden="true" aria-label="" className={styles.flip} />} label={label('pageHeader.back')} variant="ghost" size="sm" />
          ) : null}
          <div className={styles.heading}>
            <div className={styles.titleRow}>
              <h1 className={styles.title}>{title}</h1>
              {meta ? <div className={styles.meta}>{meta}</div> : null}
            </div>
            {description ? <p className={styles.description}>{description}</p> : null}
          </div>
        </div>
        {actions ? <div className={styles.actions}>{actions}</div> : null}
      </div>
      {tabs !== null && tabs !== undefined ? <div className={styles.tabs}>{tabs}</div> : null}
    </header>
  );
}
