'use client';
// SPDX-License-Identifier: AGPL-3.0-only

import { Badge, Button, Card, EmptyState, StatusPill, Tag, useFormat, useToast } from '@opendispatch/ui';
import { Bell, Check } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { AdminTable, type AdminTableColumn, type AdminTableRow } from '@/components/opendispatch/patterns/AdminTable';
import { ListToolbar } from '@/components/opendispatch/patterns/ListToolbar';
import { useAdminAction } from '@/components/opendispatch/patterns/useAdminAction';
import { ReasonHint, useGate } from '@/components/opendispatch/ReasonHint';
import { markAlertsRead } from './actions';
import { CATEGORIES, READ_STATES, SEVERITIES, SEVERITY_TONE, type AlertRow } from './types';
import styles from './Notifications.module.css';

// The Alert log tab: every alert with a search box and three
// filters (severity, category, status), unread ones marked, and a bulk bar with "Mark read". An alert can be marked read only by the
// person it is addressed to (or their role): "Yours" marks those, and a selection with none of them says so. The title and the body
// of an alert are the data layer's English lines (data, as they are), or the Arabic title when the record has one.

export interface LogTableProps {
  readonly alerts: readonly AlertRow[];
  /** How many alerts the log holds before any filter: zero shows the empty state, not "no match". */
  readonly total: number;
  readonly canEdit: boolean;
  readonly page: number | undefined;
  readonly emptyState: ReactNode;
  /** The empty state's action (Send test alert). */
  readonly emptyAction: ReactNode;
}

export function LogTable({ alerts, total, canEdit, page, emptyState, emptyAction }: LogTableProps) {
  const m = useTranslations('admin.notifications_alerts');
  const t = useTranslations();
  const locale = useLocale();
  const format = useFormat();
  const toast = useToast();
  const gate = useGate(canEdit ? 'edit' : 'view');
  const mark = useAdminAction(markAlertsRead, {
    quiet: true,
    onSuccess: (result) =>
      toast({
        title: m('toast.read', { n: result.marked }),
        ...(result.skipped > 0 ? { description: m('toast.skipped', { n: result.skipped }) } : {}),
        tone: 'success',
      }),
    failureToast: true,
  });

  if (total === 0) {
    return (
      <Card padding="none">
        <EmptyState compact icon={<Bell />} title={m('states.empty.title')} description={m('states.empty.desc')} action={emptyAction} />
      </Card>
    );
  }

  // Alerts and their titles are data: English unless the record has an Arabic title, marked so a screen reader switches voice.
  const inArabic = locale === 'ar';
  const dataProps = (arabic: boolean) => (inArabic && !arabic ? ({ lang: 'en', dir: 'ltr' } as const) : {});
  const titleOf = (alert: AlertRow) => (inArabic && alert.titleAr !== null ? alert.titleAr : alert.title);

  const columns: AdminTableColumn[] = [
    { key: 'time', header: m('col.time'), hideBelow: 'md' },
    { key: 'alert', header: m('col.alert') },
    { key: 'category', header: m('col.category'), hideBelow: 'md' },
    { key: 'severity', header: m('col.severity') },
    { key: 'to', header: m('col.to'), hideBelow: 'md' },
  ];
  const rows: AdminTableRow[] = alerts.map((alert) => {
    const arabicTitle = inArabic && alert.titleAr !== null;
    return {
      id: alert.id,
      label: titleOf(alert),
      ...(alert.read ? {} : { tone: 'accent' as const }),
      cells: {
        time: (
          <span className={styles.cell}>
            <span className={styles.strong}>{format.date(alert.at)}</span>
            <span className={styles.meta}>
              <bdi dir="ltr" translate="no">
                {format.time(alert.at)}
              </bdi>
            </span>
          </span>
        ),
        alert: (
          <span className={styles.cell}>
            <span className={styles.inline}>
              <span className={styles.strong} translate="no" {...dataProps(arabicTitle)}>
                {titleOf(alert)}
              </span>
              {alert.read ? null : (
                <Badge tone="info" size="sm">
                  {m('f.unread')}
                </Badge>
              )}
            </span>
            {alert.body === null ? null : (
              <span className={styles.meta} translate="no" {...dataProps(false)}>
                {alert.body}
              </span>
            )}
          </span>
        ),
        category: m(`cat.${alert.category}`),
        severity: <StatusPill status={m(`sev.${alert.severity}`)} tone={SEVERITY_TONE[alert.severity]} size="sm" />,
        to: (
          <span className={styles.inline}>
            {alert.toName !== null ? <span translate="no">{alert.toName}</span> : alert.toRole !== null ? t(`roles.${alert.toRole}`) : '-'}
            {alert.mine ? <Tag color="gold">{m('log.yours')}</Tag> : null}
          </span>
        ),
      },
    };
  });

  function markSelected(ids: string[], clear: () => void) {
    if (!gate.edit.allowed) return;
    // Only alerts addressed to the person, and not read yet, can change.
    const targets = ids.filter((id) => alerts.some((a) => a.id === id && a.mine && !a.read));
    if (targets.length === 0) {
      toast({ title: m('bulk.nothing'), tone: 'info' });
      return;
    }
    mark.run({ ids: targets });
    clear();
  }

  return (
    <Card padding="none">
      <ListToolbar
        searchLabel={m('log.search')}
        filters={[
          { key: 'severity', label: m('f.severity'), options: SEVERITIES.map((value) => ({ value, label: m(`sev.${value}`) })) },
          { key: 'category', label: m('col.category'), options: CATEGORIES.map((value) => ({ value, label: m(`cat.${value}`) })) },
          { key: 'read', label: t('common.status'), options: READ_STATES.map((value) => ({ value, label: m(`f.${value}`) })) },
        ]}
      />
      <AdminTable
        caption={m('log.title')}
        columns={columns}
        rows={rows}
        rowParam={false}
        page={page}
        emptyState={emptyState}
        selectable
        bulkActions={(ids, clear) => (
          <ReasonHint reason={gate.edit.reason} visible={false}>
            <Button variant="secondary" size="sm" startIcon={<Check />} loading={mark.pending} onClick={() => markSelected(ids, clear)}>
              {m('bulk.markRead')}
            </Button>
          </ReasonHint>
        )}
      />
    </Card>
  );
}
