'use client';
// SPDX-License-Identifier: AGPL-3.0-only

import { Button, Menu, type MenuEntry } from '@opendispatch/ui';
import { ChevronDown, Download, RefreshCw, UserPlus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { ReasonHint } from '@/components/opendispatch/ReasonHint';
import { useRouter } from '@/i18n/navigation';
import { useUrlState } from '@/components/opendispatch/patterns/useUrlState';
import { useExportStub } from '@/components/opendispatch/patterns/useExportStub';

// Header (#rq): Assign reviewer and More

/** Empty state action: asks the server again. */
export function RefreshButton() {
  const m = useTranslations('ops.remote_queue');
  const router = useRouter();
  return (
    <Button variant="secondary" startIcon={<RefreshCw />} onClick={() => router.refresh()}>
      {m('refresh')}
    </Button>
  );
}

export interface HeaderActionsProps {
  readonly firstWaitingCaseId: string | null;
  readonly canEdit: boolean;
}

export function HeaderActions({ firstWaitingCaseId, canEdit }: HeaderActionsProps) {
  const m = useTranslations('ops.remote_queue');
  const t = useTranslations();
  const exportStub = useExportStub();
  const url = useUrlState();

  const items: MenuEntry[] = [{ label: m('menu.export'), icon: <Download />, onSelect: exportStub }];
  const reason = !canEdit ? t('opendispatch.gate.viewOnly') : firstWaitingCaseId === null ? m('need.noWaiting') : null;

  return (
    <>
      <ReasonHint reason={reason} visible={false}>
        <Button
          variant="primary"
          startIcon={<UserPlus />}
          onClick={() => {
            if (reason !== null || firstWaitingCaseId === null) return;
            url.update({ assign: firstWaitingCaseId }, { keepPage: true, history: 'push' });
          }}
        >
          {m('assign')}
        </Button>
      </ReasonHint>
      <Menu align="end" label={t('common.more')} trigger={<Button variant="secondary" endIcon={<ChevronDown />}>{t('common.more')}</Button>} items={items} />
    </>
  );
}
