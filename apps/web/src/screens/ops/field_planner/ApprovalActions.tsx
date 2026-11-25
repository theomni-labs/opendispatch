'use client';
// SPDX-License-Identifier: AGPL-3.0-only

import { Button, Inline } from '@opendispatch/ui';
import { Check, Send, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { ActionError } from '@/components/opendispatch/patterns/ActionError';
import { useAdminAction } from '@/components/opendispatch/patterns/useAdminAction';
import { ReasonHint } from '@/components/opendispatch/ReasonHint';
import { approveRosterAction, publishRosterAction, rejectRosterAction } from './actions';
import type { ApprovalBarView } from './view';

// Approval bar: Reject, Approve, Publish (stub)

const REASON_KEY: Readonly<Record<Exclude<ApprovalBarView['approveReason'], null>, string>> = {
  own: 'r.own',
  notPending: 'r.notPending',
  approved: 'r.approved',
  needApprove: 'r.needApprove',
  notDraft: 'r.notDraft',
  needSubmit: 'r.needSubmit',
};

export interface ApprovalActionsProps {
  readonly rosterId: string;
  readonly approval: ApprovalBarView;
  readonly canEdit: boolean;
}

export function ApprovalActions({ rosterId, approval, canEdit }: ApprovalActionsProps) {
  const m = useTranslations('ops.field_planner');
  const t = useTranslations();
  const reasonText = (key: ApprovalBarView['approveReason']): string | null => (key === null ? null : m(REASON_KEY[key]));

  const approve = useAdminAction(approveRosterAction, { successTitle: m('toast.approved'), successDescription: m('toast.approvedDesc') });
  const reject = useAdminAction(rejectRosterAction, { successTitle: m('toast.rejected') });
  const publish = useAdminAction(publishRosterAction, { successTitle: m('toast.publish'), successDescription: m('toast.publishDesc') });

  return (
    <Inline gap={8} wrap>
      <ReasonHint reason={reasonText(approval.rejectReason)} visible={false}>
        <Button variant="secondary" startIcon={<X />} loading={reject.pending} onClick={() => reject.run({ rosterId })}>
          {t('common.reject')}
        </Button>
      </ReasonHint>
      <ReasonHint reason={reasonText(approval.approveReason)} visible={false}>
        <Button variant="secondary" startIcon={<Check />} loading={approve.pending} onClick={() => approve.run({ rosterId })}>
          {t('common.approve')}
        </Button>
      </ReasonHint>
      <ReasonHint reason={canEdit ? reasonText(approval.publishReason) : t('opendispatch.gate.viewOnly')} visible={false}>
        <Button variant="primary" startIcon={<Send />} loading={publish.pending} onClick={() => publish.run({ rosterId })}>
          {m('publish')}
        </Button>
      </ReasonHint>
      <ActionError error={approve.error ?? reject.error ?? publish.error} />
    </Inline>
  );
}
