'use client';
// SPDX-License-Identifier: AGPL-3.0-only

import { Button, Field, Modal, Stack, Textarea } from '@opendispatch/ui';
import { useTranslations } from 'next-intl';
import { useState, type ReactNode } from 'react';
import { ReasonHint } from '../ReasonHint';

// A Modal that asks for a written reason before it acts (pause the model, fall back to the customer dispatch, grant
// support access, skip an update, reject a rule). The confirm button stays unavailable, with the reason why in a tooltip
// and in the hint under the box, until the note has `minLength` characters; the note is trimmed, and `onConfirm` gets the
// trimmed text. The box starts empty every time the dialog opens. `error` is where <ActionError> goes.
//
//   <ReasonDialog open={open} onClose={close} onConfirm={(reason) => pause.run({ reason })} minLength={20} maxLength={500}
//     title={t('pause.title')} confirmLabel={t('pause.ok')} tone="danger" pending={pause.pending} error={<ActionError error={pause.error} />} />

export interface ReasonDialogProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onConfirm: (reason: string) => void;
  readonly title: ReactNode;
  readonly description?: ReactNode;
  readonly confirmLabel: string;
  readonly cancelLabel?: string | undefined;
  /** Label of the box. Default: "Reason". */
  readonly reasonLabel?: string | undefined;
  readonly placeholder?: string | undefined;
  /** The fewest characters, after trimming. Default 1. */
  readonly minLength?: number | undefined;
  readonly maxLength?: number | undefined;
  readonly tone?: 'default' | 'danger' | undefined;
  readonly pending?: boolean | undefined;
  readonly error?: ReactNode;
  readonly size?: 'sm' | 'md' | undefined;
}

export function ReasonDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel,
  cancelLabel,
  reasonLabel,
  placeholder,
  minLength = 1,
  maxLength = 500,
  tone = 'default',
  pending = false,
  error,
  size = 'md',
}: ReasonDialogProps) {
  const t = useTranslations();
  const [reason, setReason] = useState('');
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setReason('');
  }

  const trimmed = reason.trim();
  const valid = trimmed.length >= minLength;
  const need = t('patterns.dialog.needReason', { min: minLength });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      size={size}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {cancelLabel ?? t('common.cancel')}
          </Button>
          <ReasonHint reason={valid ? null : need} visible={false}>
            <Button
              variant={tone === 'danger' ? 'danger' : 'primary'}
              loading={pending}
              onClick={() => {
                if (valid) onConfirm(trimmed);
              }}
            >
              {confirmLabel}
            </Button>
          </ReasonHint>
        </>
      }
    >
      <Stack gap={12}>
        <Field label={reasonLabel ?? t('common.reason')} required hint={valid ? undefined : need}>
          <Textarea value={reason} rows={3} maxLength={maxLength} placeholder={placeholder} data-autofocus="" onChange={(event) => setReason(event.target.value)} />
        </Field>
        {error}
      </Stack>
    </Modal>
  );
}
