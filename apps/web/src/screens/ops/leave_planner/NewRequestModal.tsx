'use client';
// SPDX-License-Identifier: AGPL-3.0-only

import { Button, DateInput, Field, Modal, Select, Stack } from '@opendispatch/ui';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { ActionError } from '@/components/opendispatch/patterns/ActionError';
import { useAdminAction } from '@/components/opendispatch/patterns/useAdminAction';
import { useUrlState } from '@/components/opendispatch/patterns/useUrlState';
import { ReasonHint, useGate } from '@/components/opendispatch/ReasonHint';
import { createLeaveRequestAction } from './actions';
import styles from './LeavePlanner.module.css';
import { LEAVE_TYPES, type LeaveTypeValue } from './types';
import type { CandidateView } from './view';

// New request (#lp-new), field agents only

export interface NewRequestModalProps {
  readonly open: boolean;
  readonly canEdit: boolean;
  readonly candidates: readonly CandidateView[];
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function NewRequestModal({ open, canEdit, candidates }: NewRequestModalProps) {
  const m = useTranslations('ops.leave_planner');
  const t = useTranslations();
  const url = useUrlState();
  const gate = useGate(canEdit ? 'edit' : 'view');
  const first = candidates[0];

  const [agentId, setAgentId] = useState(first?.id ?? '');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [leaveType, setLeaveType] = useState<LeaveTypeValue>('annual');
  const [dismissed, setDismissed] = useState(false);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setAgentId(first?.id ?? '');
      setFrom('');
      setTo('');
      setLeaveType('annual');
      setDismissed(false);
    }
  }

  const close = () => {
    setDismissed(true);
    url.update({ new: null }, { history: 'replace', keepPage: true });
  };

  const create = useAdminAction(createLeaveRequestAction, {
    successTitle: m('toast.created'),
    successDescription: (request) => candidates.find((c) => c.id === request.agent_id)?.name,
    onSuccess: close,
  });

  const need =
    candidates.length === 0
      ? m('n.noCandidates')
      : agentId === ''
        ? m('n.needAgent')
        : !DATE.test(from) || !DATE.test(to) || to < from
          ? m('n.needDates')
          : null;
  const reason = gate.edit.reason ?? need;

  return (
    <Modal
      open={open && !dismissed}
      onClose={close}
      size="sm"
      title={m('new')}
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            {t('common.cancel')}
          </Button>
          <ReasonHint reason={reason} visible={false}>
            <Button
              variant="primary"
              loading={create.pending}
              onClick={() => {
                if (reason === null) create.run({ agentId, startDate: from, endDate: to, leaveType });
              }}
            >
              {m('n.create')}
            </Button>
          </ReasonHint>
        </>
      }
    >
      <Stack gap={12}>
        <Field label={t('common.agent')} required>
          <Select
            value={agentId}
            disabled={!gate.edit.allowed || candidates.length === 0}
            options={candidates.map((c) => ({ value: c.id, label: `${c.name} · ${c.zoneCode}` }))}
            onChange={(event) => setAgentId(event.target.value)}
          />
        </Field>
        <div className={styles.pair}>
          <Field label={m('n.from')} required>
            <DateInput value={from} disabled={!gate.edit.allowed} onChange={(event) => setFrom(event.target.value)} />
          </Field>
          <Field label={m('n.to')} required>
            <DateInput value={to} disabled={!gate.edit.allowed} min={from || undefined} onChange={(event) => setTo(event.target.value)} />
          </Field>
        </div>
        <Field label={m('filter.type')}>
          <Select
            value={leaveType}
            disabled={!gate.edit.allowed}
            options={LEAVE_TYPES.map((type) => ({ value: type, label: m(`type.${type}`) }))}
            onChange={(event) => setLeaveType(event.target.value as LeaveTypeValue)}
          />
        </Field>
        <ActionError error={create.error} onDismiss={create.reset} />
      </Stack>
    </Modal>
  );
}
