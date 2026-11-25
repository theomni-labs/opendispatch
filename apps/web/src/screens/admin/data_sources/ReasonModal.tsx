'use client';
// SPDX-License-Identifier: AGPL-3.0-only

import { Alert, Button, Field, Modal, Stack, Textarea } from '@opendispatch/ui';
import { Info } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState, type ReactNode } from 'react';
import { Reason, ReasonHint } from '@/components/opendispatch/ReasonHint';
import styles from './DataSources.module.css';

// The confirm dialog of the Data Sources screen: a title, one line,
// an optional warning, and a reason that is optional for a stage change and required for a fallback or a resume signal. The
// confirm button stays unavailable, with the reason why, until a required note is written. The box starts empty every time the
// dialog opens.

export interface ReasonModalProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onConfirm: (reason: string) => void;
  readonly title: string;
  readonly description?: string | undefined;
  /** A warning shown above the reason (the automatic stage). */
  readonly warning?: ReactNode;
  /** True: a note is needed before Confirm works. False: the note is optional. */
  readonly required: boolean;
  readonly pending?: boolean | undefined;
  readonly error?: ReactNode;
}

const MAX = 300;

export function ReasonModal({ open, onClose, onConfirm, title, description, warning, required, pending = false, error }: ReasonModalProps) {
  const m = useTranslations('admin.data_sources');
  const t = useTranslations();
  const [reason, setReason] = useState('');
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setReason('');
  }
  const trimmed = reason.trim();
  const need = required && trimmed === '' ? m('m.need') : null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      title={title}
      description={description === undefined ? undefined : <span translate="no">{description}</span>}
      footer={
        <>
          {need === null ? null : <Reason icon={<Info />}>{need}</Reason>}
          <span className={styles.push} />
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <ReasonHint reason={need} visible={false}>
            <Button variant="primary" loading={pending} onClick={() => need === null && onConfirm(trimmed)}>
              {t('common.confirm')}
            </Button>
          </ReasonHint>
        </>
      }
    >
      <Stack gap={16}>
        {warning === undefined ? null : <Alert tone="warning">{warning}</Alert>}
        <Field label={t('common.reason')} required={required} optional={!required}>
          <Textarea value={reason} rows={3} maxLength={MAX} data-autofocus="" onChange={(event) => setReason(event.target.value)} />
        </Field>
        {error}
      </Stack>
    </Modal>
  );
}
