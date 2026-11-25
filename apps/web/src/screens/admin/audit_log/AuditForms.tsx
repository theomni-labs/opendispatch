'use client';
// SPDX-License-Identifier: AGPL-3.0-only

import { Button, DescriptionList, Menu, Stack, StatusPill, useFormat, useToast, type MenuEntry, type Tone } from '@opendispatch/ui';
import { ChevronDown, Download, RefreshCw } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { CopyButton } from '@/components/opendispatch/patterns/CopyButton';
import { RecordDrawer } from '@/components/opendispatch/patterns/RecordDrawer';
import { useAdminAction } from '@/components/opendispatch/patterns/useAdminAction';
import { useUrlState } from '@/components/opendispatch/patterns/useUrlState';
import { useRouter } from '@/i18n/navigation';
import { downloadText } from '@/lib/export/download';
import { exportAuditLog } from './actions';
import styles from './AuditLog.module.css';
import type { AuditOpen, AuditOutcome, ExportFilter } from './types';

// The client files of the Audit Log: the header (Export, and More with Refresh) and the event drawer. The log is append only,
// so there is nothing here to disable for a role: all three roles that can open the page read it and export it.

export const OUTCOME_TONE: Readonly<Record<AuditOutcome, Tone>> = { success: 'success', failure: 'warning', denied: 'danger' };

export function OutcomePill({ outcome }: { outcome: AuditOutcome }) {
  const m = useTranslations('admin.audit_log');
  return <StatusPill status={m(`out.${outcome}`)} tone={OUTCOME_TONE[outcome]} size="sm" />;
}

export interface AuditHeaderProps {
  /** True while the page shows a review state (no data was read): there is nothing to export. */
  readonly disabled?: boolean | undefined;
}

/** The two header actions: Export (primary) and More (Refresh). The State menu of the mockup is review tooling and is not built. */
export function AuditHeader({ disabled = false }: AuditHeaderProps) {
  const m = useTranslations('admin.audit_log');
  const t = useTranslations();
  const url = useUrlState();
  const router = useRouter();
  const toast = useToast();
  const exporter = useAdminAction(exportAuditLog, {
    successTitle: m('toast.export.title'),
    successDescription: m('toast.export.desc'),
    onSuccess: (file) => downloadText(file),
    failureToast: true,
  });

  function exportEvents() {
    // What is on screen is what is exported: the same four filters the address holds, sent as typed (the server checks them again).
    const filter: ExportFilter = { q: url.get('q'), outcome: url.get('outcome'), category: url.get('cat'), period: url.get('period') };
    exporter.run(filter);
  }

  const items: MenuEntry[] = [
    {
      label: m('menu.refresh'),
      icon: <RefreshCw />,
      disabled,
      onSelect: () => {
        router.refresh();
        toast({ title: m('toast.refreshed'), tone: 'info' });
      },
    },
  ];

  return (
    <>
      <Button variant="primary" startIcon={<Download />} loading={exporter.pending} disabled={disabled} onClick={exportEvents}>
        {t('common.export')}
      </Button>
      <Menu align="end" label={t('common.more')} trigger={<Button variant="secondary" endIcon={<ChevronDown />}>{t('common.more')}</Button>} items={items} />
    </>
  );
}

export interface AuditDrawerProps {
  readonly open: AuditOpen | undefined;
}

/** The event's drawer: read only. What the record says, then the record itself as JSON with a Copy button. */
export function AuditDrawer({ open }: AuditDrawerProps) {
  const m = useTranslations('admin.audit_log');
  const t = useTranslations();
  const format = useFormat();
  const url = useUrlState();
  const locale = useLocale();
  if (open === undefined) return <RecordDrawer open={false} title="" />;
  const { row, json } = open;
  const actionKey = `act.${row.action.replaceAll('.', '__')}`;
  const sentence = `sum.${row.action.replaceAll('.', '__')}`;
  const filled = row.summaryParams !== null && m.has(sentence) ? m(sentence, { ...row.summaryParams }) : null;
  const label = locale === 'ar' ? (filled ?? (m.has(actionKey) ? m(actionKey) : null)) : null;

  const actor =
    row.actorName !== null ? (
      <>
        <span translate="no">{row.actorName}</span>
        {row.actorRole === null ? null : <span className={styles.muted}> · {t(`roles.${row.actorRole}`)}</span>}
        {row.actorType === 'emergency_admin' ? <span className={styles.muted}> · {m('local')}</span> : null}
      </>
    ) : row.actorType === 'system' || row.actorType === 'demo' ? (
      m('actor.system.label')
    ) : (
      m('actor.unknown.label')
    );

  return (
    <RecordDrawer
      open
      recordKey={row.id}
      title={<span translate="no">{row.action}</span>}
      subtitle={
        <span translate="no">
          {format.dateBoth(row.occurredAt)} <bdi dir="ltr">{format.time(row.occurredAt)}</bdi>
        </span>
      }
      footer={
        <div className={styles.footer}>
          <CopyButton value={json} label={m('d.copy')} showLabel variant="secondary" description={m('toast.copied')} />
          <span className={styles.push} />
          <Button variant="ghost" onClick={() => url.update({ id: null }, { keepPage: true })}>
            {t('common.close')}
          </Button>
        </div>
      }
    >
      <Stack gap={20}>
        <DescriptionList
          dense
          columns={1}
          items={[
            ...(label === null
              ? [
                  {
                    label: m('col.summary'),
                    value: (
                      <span lang="en" dir="ltr" translate="no">
                        {row.summary}
                      </span>
                    ),
                  },
                ]
              : [
                  { label: m('col.summary'), value: <span>{label}</span> },
                  {
                    label: m('d.original'),
                    value: (
                      <span lang="en" dir="ltr" translate="no">
                        {row.summary}
                      </span>
                    ),
                  },
                ]),
            { label: m('col.actor'), value: actor },
            { label: m('d.actorType'), value: <span translate="no">{row.actorType}</span> },
            {
              label: m('col.entity'),
              value: (
                <span translate="no">
                  {row.entityType}
                  {row.entityId === null ? '' : ` · ${row.entityId}`}
                </span>
              ),
            },
            { label: m('col.outcome'), value: <OutcomePill outcome={row.outcome} /> },
            { label: m('col.source'), value: m(`src.${row.source}`) },
            { label: m('d.corr'), value: <span translate="no">{row.correlationId ?? '-'}</span> },
          ]}
        />
        <Stack gap={8}>
          <span className={styles.detailLabel}>{m('d.json')}</span>
          <pre className={styles.json} translate="no">
            {json}
          </pre>
        </Stack>
      </Stack>
    </RecordDrawer>
  );
}
