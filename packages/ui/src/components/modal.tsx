// SPDX-License-Identifier: AGPL-3.0-only
'use client';

import { CloseOutlined } from '@ant-design/icons';
import { Modal as AntModal } from 'antd';
import { useId, type ReactNode } from 'react';
import { useLabels } from '../provider';
import { cx } from '../types';
import styles from './overlay.module.css';
import { bodyContainer, DialogFocus } from './overlay-focus';

export type ModalSize = 'sm' | 'md' | 'lg' | 'xl';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  size?: ModalSize;
  footer?: ReactNode;
  className?: string | undefined;
  children?: ReactNode;
}

const WIDTHS: Record<ModalSize, number> = { sm: 400, md: 520, lg: 720, xl: 960 };

/** A centred dialog on Ant Design's Modal: titled, closed by Escape, the close button or a click outside. */
export function Modal({ open, onClose, title, description, size = 'md', footer, className, children }: ModalProps) {
  const label = useLabels();
  const descriptionId = useId();
  const titleId = useId();
  const closeLabel = label('modal.close');

  return (
    <AntModal
      open={open}
      onCancel={onClose}
      title={<h2 id={titleId} className={styles.title}>
          {title}
        </h2>}
      width={WIDTHS[size]}
      centered
      keyboard={false}
      getContainer={bodyContainer}
      destroyOnHidden
      transitionName=""
      maskTransitionName=""
      zIndex={1010}
      className={cx(styles.modal, className) ?? ''}
      closable={{ 'aria-label': closeLabel }}
      closeIcon={<CloseOutlined aria-label="" aria-hidden="true" title={closeLabel} />}
      footer={footer ? <div className={styles.footer} data-overlay-footer="">{footer}</div> : null}
    >
      <DialogFocus onClose={onClose} labelledBy={titleId} describedBy={description ? descriptionId : undefined} />
      {description ? (
        <p id={descriptionId} className={styles.description}>
          {description}
        </p>
      ) : null}
      {children}
    </AntModal>
  );
}
