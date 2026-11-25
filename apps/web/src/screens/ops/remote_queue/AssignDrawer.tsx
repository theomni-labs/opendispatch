'use client';
// SPDX-License-Identifier: AGPL-3.0-only

import { Alert, Button, DescriptionList, Drawer, Field, RadioGroup, Stack } from '@opendispatch/ui';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { ActionError } from '@/components/opendispatch/patterns/ActionError';
import { useAdminAction } from '@/components/opendispatch/patterns/useAdminAction';
import { useUrlState } from '@/components/opendispatch/patterns/useUrlState';
import { Qualifier } from '@/components/opendispatch/Qualifier';
import { reviewCaseAction, suggestCaseAction } from '@/components/opendispatch/assistant/case-actions';
import type { CaseAiCard } from '@/components/opendispatch/assistant/caseCard';
import { CaseSuggestionCard } from '@/components/opendispatch/assistant/CaseSuggestionCard';
import { Reason, ReasonHint } from '@/components/opendispatch/ReasonHint';
import { assignReviewerAction } from './actions';
import type { AssignDrawerTarget } from './view';

// Assign reviewer (#rq-drawer)

export interface AssignDrawerProps {
  readonly target: AssignDrawerTarget | undefined;
  readonly canEdit: boolean;
  /** Suggested by AI for the case; null hides it. */
  readonly ai?: CaseAiCard | null | undefined;
}

export function AssignDrawer({ target, canEdit, ai }: AssignDrawerProps) {
  const m = useTranslations('ops.remote_queue');
  const t = useTranslations();
  const url = useUrlState();

  const [openKey, setOpenKey] = useState<string | null>(null);
  const [agentId, setAgentId] = useState<string | undefined>(undefined);

  const key = target?.caseId ?? null;
  if (key !== openKey) {
    setOpenKey(key);
    setAgentId(undefined);
  }

  const close = () => url.update({ assign: null }, { keepPage: true });

  const assign = useAdminAction(assignReviewerAction, {
    successTitle: m('toast.assigned'),
    successDescription: (item) => m('toast.assignedDesc', { name: candidateName(agentId), no: item.case_number }),
    onSuccess: close,
  });

  function candidateName(id: string | undefined): string {
    return target?.candidates.find((c) => c.id === id)?.name ?? '';
  }

  const need = !canEdit ? t('opendispatch.gate.viewOnly') : agentId === undefined ? m('drawer.need') : null;

  const submit = () => {
    if (!canEdit || target === undefined || agentId === undefined) return;
    assign.run({ caseId: target.caseId, agentId });
  };

  return (
    <Drawer
      open={target !== undefined}
      onClose={close}
      title={m('drawer.title')}
      subtitle={
        target === undefined ? undefined : (
          <span dir="ltr" translate="no">
            {target.caseNumber} · {target.zoneCode}
          </span>
        )
      }
      footer={
        <>
          {need === null ? null : <Reason>{need}</Reason>}
          <Button variant="ghost" onClick={close}>
            {t('common.cancel')}
          </Button>
          <ReasonHint reason={need} visible={false}>
            <Button variant="primary" loading={assign.pending} onClick={submit}>
              {m('assign')}
            </Button>
          </ReasonHint>
        </>
      }
    >
      {target === undefined ? null : (
        <Stack gap={20}>
          <DescriptionList
            dense
            items={[
              {
                label: m('col.handling'),
                value: (
                  <>
                    {m('handling.remote')} <Qualifier />
                  </>
                ),
              },
              { label: m('col.waiting'), value: <span translate="no">{target.waitLabel}</span> },
            ]}
          />
          {ai === null || ai === undefined || ai.view.caseId !== target.caseId ? null : (
            <CaseSuggestionCard view={ai.view} configured={ai.configured} offline={ai.offline} canEdit={canEdit} suggestAction={suggestCaseAction} reviewAction={reviewCaseAction} />
          )}
          <Field label={m('col.reviewer')} required>
            {target.candidates.length === 0 ? (
              <Alert tone="warning">{m('drawer.noCandidates')}</Alert>
            ) : (
              <RadioGroup
                name="rq-cand"
                value={agentId}
                disabled={assign.pending}
                onChange={setAgentId}
                options={target.candidates.map((c) => ({ value: c.id, label: c.name, description: c.poolZoneCode === null ? c.code : `${c.code} · ${c.poolZoneCode}` }))}
              />
            )}
          </Field>
          <ActionError error={assign.error} onDismiss={assign.reset} />
        </Stack>
      )}
    </Drawer>
  );
}
