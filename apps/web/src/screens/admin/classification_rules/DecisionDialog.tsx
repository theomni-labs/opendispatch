'use client';
// SPDX-License-Identifier: AGPL-3.0-only

import { Button, Field, Modal, Stack, Textarea, useFormat } from '@opendispatch/ui';
import { Info } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { ActionError } from '@/components/opendispatch/patterns/ActionError';
import { useAdminAction } from '@/components/opendispatch/patterns/useAdminAction';
import { Reason, ReasonHint } from '@/components/opendispatch/ReasonHint';
import { approveRule, rejectRule } from './actions';
import type { RuleSummary } from './types';
import styles from './ClassificationRules.module.css';

// Approve or reject a submitted rule version, with a note (required to reject). Opened from the Approvals table and from the
// drawer. The data layer decides who may approve (a Dispatch Supervisor, never the person who submitted it): a refusal shows
// here, in English, with the person's note kept. Nothing here names the caller.

export interface DecisionDialogProps {
  readonly open: boolean;
  readonly kind: 'approve' | 'reject';
  readonly code: string;
  readonly version: number;
  readonly onClose: () => void;
  /** After a decision was saved: the caller closes its drawer. */
  readonly onDone: (result: RuleSummary) => void;
}

const MAX_NOTE = 500;

export function DecisionDialog({ open, kind, code, version, onClose, onDone }: DecisionDialogProps) {
  const m = useTranslations('admin.classification_rules');
  const t = useTranslations();
  const format = useFormat();
  const [note, setNote] = useState('');
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setNote('');
  }

  const approve = useAdminAction(approveRule, {
    successTitle: m('toast.approved.title'),
    successDescription: (result) => m('toast.approved.desc', { code: result.code, date: result.effectiveFrom === undefined ? '' : format.date(result.effectiveFrom) }),
    onSuccess: onDone,
  });
  const reject = useAdminAction(rejectRule, { successTitle: m('toast.rejected'), successDescription: (result) => result.code, onSuccess: onDone });
  const action = kind === 'approve' ? approve : reject;

  const trimmed = note.trim();
  const need = kind === 'reject' && trimmed === '' ? m('decide.noteReq') : null;
  const close = () => {
    approve.reset();
    reject.reset();
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={close}
      size="sm"
      title={m(kind === 'approve' ? 'decide.approve' : 'decide.reject', { code })}
      footer={
        <>
          {need === null ? null : <Reason icon={<Info />}>{need}</Reason>}
          <span className={styles.push} />
          <Button variant="ghost" onClick={close}>
            {t('common.cancel')}
          </Button>
          <ReasonHint reason={need} visible={false}>
            <Button
              variant={kind === 'reject' ? 'danger' : 'primary'}
              loading={action.pending}
              onClick={() => {
                if (need === null) action.run({ rule_code: code, version, note: trimmed });
              }}
            >
              {t(kind === 'approve' ? 'common.approve' : 'common.reject')}
            </Button>
          </ReasonHint>
        </>
      }
    >
      <Stack gap={12}>
        <Field label={t('common.note')} {...(kind === 'reject' ? { required: true } : { optional: true })}>
          <Textarea value={note} rows={3} maxLength={MAX_NOTE} data-autofocus="" onChange={(event) => setNote(event.target.value)} />
        </Field>
        <ActionError error={action.error} onDismiss={action.reset} />
      </Stack>
    </Modal>
  );
}
