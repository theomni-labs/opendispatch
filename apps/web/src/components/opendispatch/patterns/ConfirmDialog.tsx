'use client';
// SPDX-License-Identifier: AGPL-3.0-only

import { Button, Modal } from '@opendispatch/ui';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

// A confirmation before something that cannot be undone or that a person may not expect: a Modal with a
// title, one line of description, Cancel and the confirm button. `tone="danger"` makes the confirm button danger-coloured.
// `pending` shows the spinner and blocks a second click; `error` is where <ActionError> goes, so a refusal stays in the
// dialog with the person's choice intact. Cancel is the first control, so it takes the focus when the dialog opens: the
// safe answer is one Enter away.
//
//   <ConfirmDialog open={open} onClose={close} onConfirm={run} title={t('disable.title', { name })} description={t('disable.desc')}
//     confirmLabel={t('disable.ok')} tone="danger" pending={disable.pending} error={<ActionError error={disable.error} />} />
//
// Needs a written reason? Use ReasonDialog.

export interface ConfirmDialogProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onConfirm: () => void;
  readonly title: ReactNode;
  readonly description?: ReactNode;
  readonly confirmLabel: string;
  /** Default: "Cancel". */
  readonly cancelLabel?: string | undefined;
  readonly tone?: 'default' | 'danger' | undefined;
  readonly pending?: boolean | undefined;
  readonly error?: ReactNode;
  readonly size?: 'sm' | 'md' | undefined;
  readonly children?: ReactNode;
}

export function ConfirmDialog({ open, onClose, onConfirm, title, description, confirmLabel, cancelLabel, tone = 'default', pending = false, error, size = 'sm', children }: ConfirmDialogProps) {
  const t = useTranslations('common');
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      size={size}
      footer={
        <>
          <Button variant="ghost" data-autofocus="" onClick={onClose}>
            {cancelLabel ?? t('cancel')}
          </Button>
          <Button variant={tone === 'danger' ? 'danger' : 'primary'} loading={pending} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {error !== undefined || children !== undefined ? (
        <div>
          {children}
          {error}
        </div>
      ) : null}
    </Modal>
  );
}
