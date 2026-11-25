'use client';
// SPDX-License-Identifier: AGPL-3.0-only

import { Button, Menu, useToast, type MenuEntry } from '@opendispatch/ui';
import { CheckCheck, ChevronDown, Download, Moon, Send } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useAdminAction } from '@/components/opendispatch/patterns/useAdminAction';
import { useUrlState } from '@/components/opendispatch/patterns/useUrlState';
import { ReasonHint, useGate } from '@/components/opendispatch/ReasonHint';
import { saveCsv } from '@/lib/export/download';
import { markAllRead, sendTestAlert } from './actions';

// The header of the Notifications and Alerts screen: "Send test alert" (the one primary action) and "More" (Quiet hours, Mark all
// read, Export log). The mockup's "State" radio group is review tooling of the mockup and is not built (`?state=` is the app's
// review hook). Send test alert sends an in-app alert to the person who pressed it, for the first rule that is switched on, and the
// toast names the rule; no e-mail is sent. "Mark all read" marks the alerts addressed to the person (their own and their role's).

export interface SendTestButtonProps {
  readonly canEdit: boolean;
  /** The first rule that is switched on (the one the test is for). Left out, the server takes the first one that is on. */
  readonly ruleId: string | undefined;
  /** True when the screen knows that no rule is switched on: there is nothing to test. */
  readonly noRule?: boolean;
  readonly variant?: 'primary' | 'secondary';
}

export function SendTestButton({ canEdit, ruleId, noRule = false, variant = 'primary' }: SendTestButtonProps) {
  const m = useTranslations('admin.notifications_alerts');
  const toast = useToast();
  const gate = useGate(canEdit ? 'edit' : 'view');
  const send = useAdminAction(sendTestAlert, {
    quiet: true,
    onSuccess: (sent) => toast({ title: m('toast.test.title'), description: m('toast.test.desc', { event: m(`ev.${sent.event}`) }), tone: 'success' }),
    failureToast: true,
  });
  const reason = gate.edit.reason ?? (noRule ? m('sendNone') : null);
  return (
    <ReasonHint reason={reason} visible={false}>
      <Button variant={variant} startIcon={<Send />} loading={send.pending} onClick={() => reason === null && send.run({ ruleId })}>
        {m('send')}
      </Button>
    </ReasonHint>
  );
}

export interface NotificationsHeaderProps {
  readonly canEdit: boolean;
  readonly testRuleId: string | undefined;
  readonly noRule?: boolean;
  readonly exportHeader: readonly string[];
  /** The alerts on screen as text; undefined while the page shows a review state (no data was read). */
  readonly exportRows: readonly (readonly string[])[] | undefined;
}

export function NotificationsHeader({ canEdit, testRuleId, noRule = false, exportHeader, exportRows }: NotificationsHeaderProps) {
  const m = useTranslations('admin.notifications_alerts');
  const t = useTranslations();
  const toast = useToast();
  const url = useUrlState();
  const gate = useGate(canEdit ? 'edit' : 'view');
  const reason = gate.edit.reason;
  const all = useAdminAction(markAllRead, {
    quiet: true,
    onSuccess: () => toast({ title: m('toast.allRead'), tone: 'success' }),
    failureToast: true,
  });
  const items: MenuEntry[] = [
    ...(reason === null ? [] : [{ type: 'heading', label: reason } as const]),
    { label: m('menu.quiet'), icon: <Moon />, disabled: reason !== null, onSelect: () => url.update({ quiet: '1' }, { history: 'push' }) },
    { label: m('menu.markAll'), icon: <CheckCheck />, disabled: reason !== null, onSelect: () => reason === null && all.run() },
    {
      label: m('menu.export'),
      icon: <Download />,
      disabled: exportRows === undefined,
      onSelect: () => {
        if (exportRows === undefined) return;
        saveCsv('alert-log.csv', { header: [...exportHeader], rows: exportRows.map((row) => [...row]) });
        toast({ title: m('toast.export'), tone: 'info' });
      },
    },
  ];
  return (
    <>
      <SendTestButton canEdit={canEdit} ruleId={testRuleId} noRule={noRule} />
      <Menu align="end" label={t('common.more')} trigger={<Button variant="secondary" endIcon={<ChevronDown />}>{t('common.more')}</Button>} items={items} />
    </>
  );
}
