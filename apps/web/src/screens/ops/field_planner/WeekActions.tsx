'use client';
// SPDX-License-Identifier: AGPL-3.0-only

import { Button, Menu, type MenuEntry } from '@opendispatch/ui';
import { CalendarRange, ChevronDown, Send } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { ActionError } from '@/components/opendispatch/patterns/ActionError';
import { useAdminAction } from '@/components/opendispatch/patterns/useAdminAction';
import { ReasonHint } from '@/components/opendispatch/ReasonHint';
import { buildWeekAction, publishWeekAction, submitWeekAction } from './actions';

// Week view header: Build week; More: Submit, Publish (stub)

export interface WeekActionsProps {
  readonly weekStart: string;
  /** Null when allowed; else why not. */
  readonly buildReason: string | null;
  readonly submitReason: string | null;
  readonly publishReason: string | null;
}

export function WeekActions({ weekStart, buildReason, submitReason, publishReason }: WeekActionsProps) {
  const m = useTranslations('ops.field_planner');
  const t = useTranslations();
  const counts = (r: { done: readonly unknown[]; skipped: readonly unknown[] }) => ({ n: String(r.done.length), s: String(r.skipped.length) });
  const build = useAdminAction(buildWeekAction, { successTitle: m('week.toast.built'), successDescription: (r) => m('week.toast.builtDesc', counts(r)) });
  const submit = useAdminAction(submitWeekAction, { successTitle: m('week.toast.submitted'), successDescription: (r) => m('week.toast.submittedDesc', counts(r)), failureToast: true });
  const publish = useAdminAction(publishWeekAction, { successTitle: m('toast.publish'), successDescription: (r) => m('week.toast.publishDesc', { n: String(r.done.length) }), failureToast: true });

  const items: MenuEntry[] = [
    ...(submitReason === null ? [] : [{ type: 'heading', label: submitReason } as const]),
    { label: m('week.submit'), icon: <Send />, disabled: submitReason !== null || submit.pending, onSelect: () => submit.run({ weekStart }) },
    ...(publishReason === null ? [] : [{ type: 'heading', label: publishReason } as const]),
    { label: m('week.publish'), icon: <Send />, disabled: publishReason !== null || publish.pending, onSelect: () => publish.run({ weekStart }) },
  ];

  return (
    <>
      <ReasonHint reason={buildReason} visible={false}>
        <Button variant="primary" startIcon={<CalendarRange />} loading={build.pending} onClick={() => build.run({ weekStart })} data-testid="fp-build-week">
          {m('week.build')}
        </Button>
      </ReasonHint>
      <Menu trigger={<Button variant="secondary" endIcon={<ChevronDown />}>{t('common.more')}</Button>} items={items} align="end" label={t('common.more')} />
      <ActionError error={build.error} onDismiss={build.reset} />
    </>
  );
}
