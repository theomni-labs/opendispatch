'use client';
// SPDX-License-Identifier: AGPL-3.0-only

import { Accordion, Alert, Button, DescriptionList, Menu, Stack, useToast, type MenuEntry } from '@opendispatch/ui';
import { BadgeCheck, ChevronDown, Download, Eye, RefreshCw, ShieldCheck } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { ActionError } from '@/components/opendispatch/patterns/ActionError';
import { RecordDrawer } from '@/components/opendispatch/patterns/RecordDrawer';
import { StubTag } from '@/components/opendispatch/patterns/StubTag';
import { useAdminAction } from '@/components/opendispatch/patterns/useAdminAction';
import { useUrlState } from '@/components/opendispatch/patterns/useUrlState';
import { ReasonHint } from '@/components/opendispatch/ReasonHint';
import { useRouter } from '@/i18n/navigation';
import { safeFilename } from '@/lib/export/download';
import { confirmBackupDone, createDiagnostics } from './actions';
import styles from './SystemHealth.module.css';
import type { DiagnosticsFile, DiagnosticsPreview } from './types';

// The forms of the System Health screen: the header (Download diagnostics, and More with Refresh and
// Confirm backup), the Confirm backup button of the Backups card, and the diagnostics drawer, which says what the file holds before
// anything is created. Every write is a server action through useAdminAction; the data layer authorises and audits, and a role
// without `edit` sees the same controls disabled with the reason.

/** Saves the archive the action returned: base64 to bytes to a Blob, then an anchor with a download name. Browser only; call it from an event handler. */
export function downloadBase64(file: DiagnosticsFile): void {
  const bytes = Uint8Array.from(atob(file.contentBase64), (char) => char.charCodeAt(0));
  const blob = new Blob([bytes], { type: file.contentType === 'application/zip' ? file.contentType : 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = safeFilename(file.fileName);
  anchor.rel = 'noopener';
  anchor.hidden = true;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function useConfirmBackup() {
  const m = useTranslations('admin.system_health');
  return useAdminAction(confirmBackupDone, { successTitle: m('toast.backup') });
}

export interface HealthHeaderProps {
  readonly canEdit: boolean;
}

export function DiagnosticsButton({ canEdit }: { canEdit: boolean }) {
  const m = useTranslations('admin.system_health');
  const t = useTranslations();
  const url = useUrlState();
  return (
    <ReasonHint reason={canEdit ? null : t('opendispatch.gate.viewOnly')} visible={false}>
      <Button
        variant="primary"
        startIcon={<Download />}
        onClick={() => {
          if (canEdit) url.update({ diag: '1' }, { history: 'push' });
        }}
      >
        {m('diag.button')}
      </Button>
    </ReasonHint>
  );
}

/** The two header actions: Download diagnostics (primary) and More (Refresh, Confirm backup). The State menu of the mockup is review tooling. */
export function HealthHeader({ canEdit }: HealthHeaderProps) {
  const m = useTranslations('admin.system_health');
  const t = useTranslations();
  const toast = useToast();
  const router = useRouter();
  const backup = useConfirmBackup();
  const items: MenuEntry[] = [
    {
      label: m('refresh'),
      icon: <RefreshCw />,
      onSelect: () => {
        router.refresh();
        toast({ title: m('toast.refreshed'), tone: 'info' });
      },
    },
    { label: m('bk.confirm'), icon: <BadgeCheck />, disabled: !canEdit, onSelect: () => backup.run() },
    ...(canEdit ? [] : [{ type: 'heading', label: t('opendispatch.gate.viewOnly') } as const]),
  ];
  return (
    <>
      <DiagnosticsButton canEdit={canEdit} />
      <Menu align="end" label={t('common.more')} trigger={<Button variant="secondary" endIcon={<ChevronDown />}>{t('common.more')}</Button>} items={items} />
    </>
  );
}

/** The empty state's action: nothing to load, so it refreshes the page and says so. */
export function RefreshButton() {
  const m = useTranslations('admin.system_health');
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

/** Confirm backup: a record that the customer took a backup (OpenDispatch runs none in a private install). */
export function ConfirmBackupButton({ canEdit }: { canEdit: boolean }) {
  const m = useTranslations('admin.system_health');
  const t = useTranslations();
  const backup = useConfirmBackup();
  return (
    <Stack gap={8}>
      <div>
        <ReasonHint reason={canEdit ? null : t('opendispatch.gate.viewOnly')} visible={false}>
          <Button variant="secondary" startIcon={<BadgeCheck />} loading={backup.pending} onClick={() => canEdit && backup.run()}>
            {m('bk.confirm')}
          </Button>
        </ReasonHint>
      </div>
      <ActionError error={backup.error} onDismiss={backup.reset} />
    </Stack>
  );
}

// ---------------------------------------------------------------------------------------------
// The diagnostics drawer
// ---------------------------------------------------------------------------------------------

export interface DiagnosticsDrawerProps {
  /** `?diag=1` and the person may edit. Decided on the server. */
  readonly open: boolean;
  readonly preview: DiagnosticsPreview;
  readonly canEdit: boolean;
}

export function DiagnosticsDrawer({ open, preview, canEdit }: DiagnosticsDrawerProps) {
  const m = useTranslations('admin.system_health');
  const t = useTranslations();
  const toast = useToast();
  const url = useUrlState();
  const close = () => url.update({ diag: null }, { history: 'replace' });
  const create = useAdminAction(createDiagnostics, {
    quiet: true,
    onSuccess: (file) => {
      downloadBase64(file);
      toast({ title: m('toast.diag'), description: file.fileName, tone: 'success' });
      close();
    },
  });

  const footer = (
    <div className={styles.footer}>
      <span className={styles.push} />
      <Button variant="ghost" onClick={close}>
        {t('common.cancel')}
      </Button>
      <ReasonHint reason={canEdit ? null : t('opendispatch.gate.viewOnly')} visible={false}>
        <Button variant="primary" startIcon={<Download />} loading={create.pending} onClick={() => canEdit && create.run()}>
          {m('diag.create')}
        </Button>
      </ReasonHint>
    </div>
  );

  return (
    <RecordDrawer open={open} param="diag" title={m('diag.title')} subtitle={m('diag.sub')} footer={footer}>
      <Stack gap={16}>
        <Alert tone="success" icon={<ShieldCheck />} title={m('diag.inc2')}>
          {m('diag.inc3')}
        </Alert>
        <div className={styles.inline}>
          <StubTag kind="demo" />
        </div>
        <Accordion
          type="single"
          defaultValue={['settings']}
          items={[
            {
              id: 'settings',
              title: <span translate="no">settings.json</span>,
              content: (
                <dl className={styles.kv}>
                  {preview.settings.map((entry) => (
                    <div key={entry.key} className={styles.kvRow}>
                      <dt translate="no">{entry.key}</dt>
                      <dd translate="no">{entry.value}</dd>
                    </div>
                  ))}
                </dl>
              ),
            },
            { id: 'health', title: <span translate="no">health.json</span>, content: <span>{m('diag.healthPrev', { services: preview.services, feeds: preview.feeds })}</span> },
            { id: 'jobs', title: <span translate="no">jobs.json</span>, content: <span>{m('diag.jobsPrev', { n: preview.jobs })}</span> },
            { id: 'readme', title: <span translate="no">README.txt</span>, content: <span>{m('diag.readmePrev')}</span> },
          ]}
        />
        <ActionError error={create.error} onDismiss={create.reset} />
      </Stack>
    </RecordDrawer>
  );
}

/** The Preview button of the Diagnostics card: opens the same drawer. */
export function PreviewButton({ canEdit }: { canEdit: boolean }) {
  const m = useTranslations('admin.system_health');
  const t = useTranslations();
  const url = useUrlState();
  return (
    <ReasonHint reason={canEdit ? null : t('opendispatch.gate.viewOnly')} visible={false}>
      <Button variant="secondary" size="sm" startIcon={<Eye />} onClick={() => canEdit && url.update({ diag: '1' }, { history: 'push' })}>
        {m('diag.preview')}
      </Button>
    </ReasonHint>
  );
}

/** Retry of the Engines card. */
export function RetryButton() {
  const t = useTranslations();
  const router = useRouter();
  return (
    <Button variant="secondary" size="sm" startIcon={<RefreshCw />} onClick={() => router.refresh()}>
      {t('common.retry')}
    </Button>
  );
}

export interface EngineDrawerProps {
  /** Decided on the server. */
  readonly open: boolean;
  readonly recordKey: string | undefined;
  readonly title: string;
  readonly subtitle: ReactNode;
  readonly items: readonly { readonly label: string; readonly value: ReactNode }[];
}

/** Read-only drawer of one engine's counts. */
export function EngineDrawer({ open, recordKey, title, subtitle, items }: EngineDrawerProps) {
  return (
    <RecordDrawer open={open} recordKey={recordKey} param="engine" title={title} subtitle={subtitle}>
      <DescriptionList dense columns={1} items={[...items]} />
    </RecordDrawer>
  );
}
