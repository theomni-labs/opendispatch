'use client';
// SPDX-License-Identifier: AGPL-3.0-only

import { Button, Combobox, DescriptionList, Drawer, Field, RadioGroup, Stack, Textarea, useFormat } from '@opendispatch/ui';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { ActionError } from '@/components/opendispatch/patterns/ActionError';
import { IllustrativeLabel } from '@/components/opendispatch/IllustrativeLabel';
import { Reason, ReasonHint } from '@/components/opendispatch/ReasonHint';
import type { ClientFailure } from '@/lib/actions/types';
import type { OverrideReasonCode } from '@/lib/types';
import type { OverrideInput } from './actions';
import styles from './OverrideDrawer.module.css';
import type { CaseCardView } from './types';

export interface ReasonOption {
  readonly value: OverrideReasonCode;
  readonly label: string;
}

export interface OverrideDrawerProps {
  /** The case being overridden, or null when the drawer is closed. */
  readonly target: CaseCardView | null;
  readonly reasonOptions: readonly ReasonOption[];
  readonly pending: boolean;
  readonly error: ClientFailure | null;
  readonly onClose: () => void;
  readonly onConfirm: (input: OverrideInput, agentName: string, reasonLabel: string) => void;
}

/** Override assignment: an agent and a reason
 * are required; `other` also needs a note. The alternatives are the recommendation's own ranking minus the top pick. */
export function OverrideDrawer({ target, reasonOptions, pending, error, onClose, onConfirm }: OverrideDrawerProps) {
  const m = useTranslations('ops.live_dispatch_board');
  const t = useTranslations();
  const format = useFormat();

  const [openKey, setOpenKey] = useState<string | null>(null);
  const [agentId, setAgentId] = useState<string | undefined>(undefined);
  const [reasonCode, setReasonCode] = useState<OverrideReasonCode | undefined>(undefined);
  const [note, setNote] = useState('');

  const key = target?.caseId ?? null;
  if (key !== openKey) {
    setOpenKey(key);
    setAgentId(undefined);
    setReasonCode(undefined);
    setNote('');
  }

  const options = (target?.overrideOptions ?? []).map((o) => ({ value: o.agentId, label: o.name, meta: `${format.int(o.minutes)} ${t('common.minShort')}` }));
  const needsNote = reasonCode === 'other';
  const need = agentId === undefined ? 'agent' : reasonCode === undefined ? 'reason' : needsNote && note.trim() === '' ? 'note' : null;
  const valid = need === null;

  const confirm = () => {
    if (!valid || target === null || agentId === undefined || reasonCode === undefined) return;
    const agentName = options.find((o) => o.value === agentId)?.label ?? '';
    const reasonLabel = reasonOptions.find((r) => r.value === reasonCode)?.label ?? reasonCode;
    onConfirm({ caseId: target.caseId, agentId, reasonCode, note: needsNote ? note.trim() : null }, agentName, reasonLabel);
  };

  return (
    <Drawer
      open={target !== null}
      onClose={onClose}
      title={m('override.title')}
      subtitle={
        target === null ? undefined : (
          <span dir="ltr" translate="no">
            {target.caseNumber} · {target.zoneCode}
          </span>
        )
      }
      footer={
        <>
          {need === null ? null : <Reason>{m(`override.need.${need}`)}</Reason>}
          <span className={styles.push} />
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <ReasonHint reason={need === null ? null : m(`override.need.${need}`)} visible={false}>
            <Button variant="primary" loading={pending} onClick={confirm}>
              {t('common.confirm')}
            </Button>
          </ReasonHint>
        </>
      }
    >
      {target === null ? null : (
        <Stack gap={20}>
          <DescriptionList
            dense
            items={[
              { label: t('opendispatch.dispatch.pickOpenDispatch'), value: <span translate="no">{target.pick?.name ?? t('opendispatch.dispatch.outsideScope')}</span> },
              {
                label: t('opendispatch.dispatch.eta'),
                value: (
                  <>
                    <span translate="no">{target.eta?.kind === 'eta' ? target.eta.time : ''}</span> <IllustrativeLabel />
                  </>
                ),
              },
            ]}
          />
          <Field label={m('override.agent')} required>
            <Combobox
              options={options}
              {...(agentId === undefined ? {} : { value: agentId })}
              onChange={setAgentId}
              placeholder={m('override.choose')}
              emptyText={m('override.noMatch')}
              disabled={pending}
            />
          </Field>
          <Field label={t('common.reason')} required>
            <RadioGroup
              name="ldb-override-reason"
              value={reasonCode}
              disabled={pending}
              onChange={(next) => setReasonCode(reasonOptions.find((r) => r.value === next)?.value)}
              options={reasonOptions.map((r) => ({ value: r.value, label: r.label }))}
            />
          </Field>
          {needsNote ? (
            <Field label={t('common.note')} required>
              <Textarea rows={3} value={note} disabled={pending} onChange={(event) => setNote(event.target.value)} />
            </Field>
          ) : null}
          <ActionError error={error} />
        </Stack>
      )}
    </Drawer>
  );
}
