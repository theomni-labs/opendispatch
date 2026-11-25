'use client';
// SPDX-License-Identifier: AGPL-3.0-only

import { Button, Menu, useToast, type MenuEntry } from '@opendispatch/ui';
import { num } from '@opendispatch/ui/format';
import { ChevronDown, Plug, RefreshCw } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useAdminAction } from '@/components/opendispatch/patterns/useAdminAction';
import { ReasonHint } from '@/components/opendispatch/ReasonHint';
import { useRouter } from '@/i18n/navigation';
import { testConnection } from './actions';
import type { TestOutcome } from './types';

// Header: Test connection and More (Refresh).

export interface AssistantHeaderProps {
  readonly canEdit: boolean;
  /** Why the test cannot run, already translated. */
  readonly offReason: string | null;
}

function useTest() {
  const m = useTranslations('admin.ai_assistant');
  const toast = useToast();
  const locale = useLocale() === 'ar' ? 'ar' : 'en';
  return useAdminAction(testConnection, {
    quiet: true,
    failureToast: true,
    onSuccess: (r: TestOutcome) => {
      if (r.ok) toast({ title: m('test.ok'), description: `${num(r.durationMs / 1000, 1, locale)} ${m('unit.s')}`, tone: 'success' });
      else toast({ title: m('test.failed'), description: m(`err.${r.errorCode ?? 'provider_error'}`), tone: 'danger' });
    },
  });
}

export function TestButton({ canEdit, offReason }: AssistantHeaderProps) {
  const m = useTranslations('admin.ai_assistant');
  const t = useTranslations();
  const test = useTest();
  const reason = canEdit ? offReason : t('opendispatch.gate.viewOnly');
  return (
    <ReasonHint reason={reason} visible={false}>
      <Button variant="primary" startIcon={<Plug />} loading={test.pending} onClick={() => test.run()} data-test-connection="">
        {m('test.label')}
      </Button>
    </ReasonHint>
  );
}

export function RefreshButton() {
  const m = useTranslations('admin.ai_assistant');
  const router = useRouter();
  const toast = useToast();
  return (
    <Button
      variant="secondary"
      startIcon={<RefreshCw />}
      onClick={() => {
        router.refresh();
        toast({ title: m('toast.refreshed'), tone: 'info' });
      }}
    >
      {m('refresh')}
    </Button>
  );
}

export function AssistantHeader(props: AssistantHeaderProps) {
  const m = useTranslations('admin.ai_assistant');
  const t = useTranslations();
  const toast = useToast();
  const router = useRouter();
  const items: MenuEntry[] = [
    {
      label: m('refresh'),
      icon: <RefreshCw />,
      onSelect: () => {
        router.refresh();
        toast({ title: m('toast.refreshed'), tone: 'info' });
      },
    },
  ];
  return (
    <>
      <TestButton {...props} />
      <Menu align="end" label={t('common.more')} trigger={<Button variant="secondary" endIcon={<ChevronDown />}>{t('common.more')}</Button>} items={items} />
    </>
  );
}
