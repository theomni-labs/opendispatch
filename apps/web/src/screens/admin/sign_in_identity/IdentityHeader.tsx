'use client';
// SPDX-License-Identifier: AGPL-3.0-only

import { Alert, Button, Menu, useToast, type MenuEntry } from '@opendispatch/ui';
import { ChevronDown, CloudOff, Download, Lock, Plus, Send } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { ActionError } from '@/components/opendispatch/patterns/ActionError';
import { ReasonDialog } from '@/components/opendispatch/patterns/ReasonDialog';
import { useAdminAction } from '@/components/opendispatch/patterns/useAdminAction';
import { useUrlState } from '@/components/opendispatch/patterns/useUrlState';
import { ReasonHint } from '@/components/opendispatch/ReasonHint';
import { downloadText } from '@/lib/export/download';
import { requestChange } from './actions';

// The header of the Sign-in and Identity screen: Add provider and More (Export settings), and the read-only banner of the shared
// tier with "Request a change". A view-only Administrator (a shared install) sees the same controls disabled with the mockup's
// reason, "Managed by our staff in the shared tier". The State menu of the mockup is review tooling and is not built.

/** Keycloak admin access is not configured: providers are stored only. */
export function KeycloakBanner() {
  const m = useTranslations('admin.sign_in_identity');
  return (
    <Alert tone="warning" icon={<CloudOff />} title={m('kc.title')}>
      {m('kc.body')}
    </Alert>
  );
}

export const SETTINGS_FILE = 'sign-in-identity-settings.json';

export interface IdentityHeaderProps {
  readonly canEdit: boolean;
  /** The settings of every tab as JSON text, or undefined while the page shows a review state (nothing was read). */
  readonly exportJson: string | undefined;
}

/** The empty state's Add provider, and the header's. */
export function AddProviderButton({ canEdit, variant = 'primary', showReason = false }: { canEdit: boolean; variant?: 'primary' | 'secondary'; showReason?: boolean }) {
  const m = useTranslations('admin.sign_in_identity');
  const url = useUrlState();
  return (
    <ReasonHint reason={canEdit ? null : m('ro.reason')} visible={showReason}>
      <Button
        variant={variant}
        startIcon={<Plus />}
        onClick={() => {
          if (canEdit) url.update({ wizard: '1' }, { history: 'push' });
        }}
      >
        {m('add')}
      </Button>
    </ReasonHint>
  );
}

export function IdentityHeader({ canEdit, exportJson }: IdentityHeaderProps) {
  const m = useTranslations('admin.sign_in_identity');
  const t = useTranslations();
  const toast = useToast();
  const items: MenuEntry[] = [
    {
      label: m('export'),
      icon: <Download />,
      disabled: exportJson === undefined,
      onSelect: () => {
        if (exportJson === undefined) return;
        downloadText({ filename: SETTINGS_FILE, mime: 'application/json', text: exportJson });
        toast({ title: m('toast.export'), tone: 'info' });
      },
    },
  ];
  return (
    <>
      <AddProviderButton canEdit={canEdit} />
      <Menu align="end" label={t('common.more')} trigger={<Button variant="secondary" endIcon={<ChevronDown />}>{t('common.more')}</Button>} items={items} />
    </>
  );
}

/** "Read only. Our staff set up providers in the shared tier." with Request a change: the data layer takes the request, audits it and raises an alert. */
export function ReadOnlyBanner() {
  const m = useTranslations('admin.sign_in_identity');
  const [open, setOpen] = useState(false);
  const request = useAdminAction(requestChange, {
    successTitle: m('toast.request.title'),
    successDescription: (receipt) => `${m('toast.request.desc')} · ${m('ref', { code: receipt.referenceCode })}`,
    onSuccess: () => setOpen(false),
  });
  return (
    <>
      <Alert
        tone="info"
        icon={<Lock />}
        title={m('ro.title')}
        action={
          <Button
            variant="secondary"
            size="sm"
            startIcon={<Send />}
            onClick={() => {
              request.reset();
              setOpen(true);
            }}
          >
            {m('ro.request')}
          </Button>
        }
      >
        {m('ro.body')}
      </Alert>
      <ReasonDialog
        open={open}
        onClose={() => setOpen(false)}
        onConfirm={(change) => request.run({ change })}
        title={m('ro.request')}
        description={m('req.desc')}
        reasonLabel={m('req.label')}
        confirmLabel={m('req.ok')}
        maxLength={1000}
        pending={request.pending}
        error={<ActionError error={request.error} onDismiss={request.reset} />}
      />
    </>
  );
}
