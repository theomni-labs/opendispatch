// SPDX-License-Identifier: AGPL-3.0-only
'use client';

import { CloseOutlined } from '@ant-design/icons';
import { Drawer as AntDrawer } from 'antd';
import { useId, type ReactNode } from 'react';
import { useDir, useLabels } from '../provider';
import { cx } from '../types';
import styles from './overlay.module.css';
import { bodyContainer, DialogFocus } from './overlay-focus';

export interface DrawerProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  subtitle?: ReactNode;
  /** Panel width in pixels, capped to the viewport. Default 480. */
  width?: number;
  /** The edge it slides in from: the inline end (default) or the inline start. */
  side?: 'start' | 'end';
  /** Focus on open: the marked or first control (default), or the close button. */
  initialFocus?: 'content' | 'close';
  footer?: ReactNode;
  className?: string | undefined;
  children?: ReactNode;
}

/** A side panel on Ant Design's Drawer, following the text direction. */
export function Drawer({
  open,
  onClose,
  title,
  subtitle,
  width = 480,
  side = 'end',
  initialFocus = 'content',
  footer,
  className,
  children,
}: DrawerProps) {
  const label = useLabels();
  const dir = useDir();
  const subtitleId = useId();
  const titleId = useId();
  const closeLabel = label('drawer.close');
  const atRight = (side === 'end') === (dir === 'ltr');

  return (
    <AntDrawer
      open={open}
      onClose={onClose}
      placement={atRight ? 'right' : 'left'}
      width={`min(${String(width)}px, 100vw)`}
      destroyOnHidden
      keyboard={false}
      getContainer={bodyContainer}
      autoFocus={false}
      className={cx(styles.drawer, className) ?? ''}
      closable={{ 'aria-label': closeLabel }}
      closeIcon={<CloseOutlined aria-label="" aria-hidden="true" title={closeLabel} />}
      title={
        <div className={styles.heading}>
          <h2 id={titleId} className={styles.title}>
          {title}
        </h2>
          {subtitle ? (
            <p id={subtitleId} className={styles.description}>
              {subtitle}
            </p>
          ) : null}
        </div>
      }
      footer={footer ? <div className={styles.footer} data-overlay-footer="">{footer}</div> : null}
    >
      <DialogFocus onClose={onClose} labelledBy={titleId} initialFocus={initialFocus} describedBy={subtitle ? subtitleId : undefined} />
      {children}
    </AntDrawer>
  );
}
