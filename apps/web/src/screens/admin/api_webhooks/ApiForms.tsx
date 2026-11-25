'use client';
// SPDX-License-Identifier: AGPL-3.0-only

import { Alert, Button, Checkbox, Field, Input, Menu, Modal, Stack, Switch, useToast, type MenuEntry } from '@opendispatch/ui';
import { ChevronDown, Download, Info, Plus, Webhook } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { ActionError } from '@/components/opendispatch/patterns/ActionError';
import { ConfirmDialog } from '@/components/opendispatch/patterns/ConfirmDialog';
import { CopyButton } from '@/components/opendispatch/patterns/CopyButton';
import { RecordDrawer } from '@/components/opendispatch/patterns/RecordDrawer';
import { useAdminAction } from '@/components/opendispatch/patterns/useAdminAction';
import { useUrlState } from '@/components/opendispatch/patterns/useUrlState';
import { Reason, ReasonHint } from '@/components/opendispatch/ReasonHint';
import { saveCsv } from '@/lib/export/download';
import { createClient, removeHook, saveHook } from './actions';
import styles from './ApiWebhooks.module.css';
import { EVENT_TYPES, SCOPES, type ClientCreated, type EventType, type HookRow, type Scope } from './types';

// The forms of the API and Webhooks screen: the header (Create client, and More with Add webhook and
// Export delivery log), the create-client drawer with the dialog that shows the key ONCE, and the webhook drawer. Every write is a
// server action through useAdminAction; the data layer authorises, validates and audits, and a role without `edit` sees the same
// controls disabled with the reason.
//
// THE KEY. It exists only in the result of the create action. It goes to `secret`, the state of this component, and from
// there to a read-only box in a dialog that cannot be closed until the person says they copied it. It is never put in the address,
// a cookie, storage or a log, and it is dropped from state when the dialog closes.

const HTTPS = /^https:\/\/.+/i;
const LOCAL_HTTP = /^http:\/\/localhost(:\d+)?([/?#].*)?$/i;
const validUrl = (url: string): boolean => HTTPS.test(url.trim()) || LOCAL_HTTP.test(url.trim());

export interface ApiHeaderProps {
  readonly canEdit: boolean;
  /** The delivery log as text for Export, or undefined while the page shows a review state (nothing was read). */
  readonly exportRows: readonly (readonly string[])[] | undefined;
  readonly exportHeader: readonly string[];
  readonly exportFilename: string;
}

export function CreateClientButton({ canEdit, variant = 'primary', showReason = false }: { canEdit: boolean; variant?: 'primary' | 'secondary'; showReason?: boolean }) {
  const m = useTranslations('admin.api_webhooks');
  const t = useTranslations();
  const url = useUrlState();
  return (
    <ReasonHint reason={canEdit ? null : t('opendispatch.gate.viewOnly')} visible={showReason}>
      <Button
        variant={variant}
        startIcon={<Plus />}
        onClick={() => {
          if (canEdit) url.update({ client: 'new' }, { history: 'push' });
        }}
      >
        {m('create')}
      </Button>
    </ReasonHint>
  );
}

export function AddHookButton({ canEdit, size = 'sm' }: { canEdit: boolean; size?: 'sm' | 'md' }) {
  const m = useTranslations('admin.api_webhooks');
  const t = useTranslations();
  const url = useUrlState();
  return (
    <ReasonHint reason={canEdit ? null : t('opendispatch.gate.viewOnly')} visible={false}>
      <Button
        variant="secondary"
        size={size}
        startIcon={<Plus />}
        onClick={() => {
          if (canEdit) url.update({ hook: 'new' }, { history: 'push' });
        }}
      >
        {m('addHook')}
      </Button>
    </ReasonHint>
  );
}

/** The two header actions: Create client (primary) and More (Add webhook, Export delivery log). The State menu of the mockup is review tooling. */
export function ApiHeader({ canEdit, exportRows, exportHeader, exportFilename }: ApiHeaderProps) {
  const m = useTranslations('admin.api_webhooks');
  const t = useTranslations();
  const toast = useToast();
  const url = useUrlState();
  const items: MenuEntry[] = [
    ...(canEdit ? [] : [{ type: 'heading', label: t('opendispatch.gate.viewOnly') } as const]),
    { label: m('addHook'), icon: <Webhook />, disabled: !canEdit, onSelect: () => url.update({ hook: 'new' }, { history: 'push' }) },
    {
      label: m('exportLog'),
      icon: <Download />,
      disabled: exportRows === undefined,
      onSelect: () => {
        if (exportRows === undefined) return;
        saveCsv(exportFilename, { header: [...exportHeader], rows: exportRows.map((row) => [...row]) });
        toast({ title: m('toast.export'), tone: 'info' });
      },
    },
  ];
  return (
    <>
      <CreateClientButton canEdit={canEdit} />
      <Menu align="end" label={t('common.more')} trigger={<Button variant="secondary" endIcon={<ChevronDown />}>{t('common.more')}</Button>} items={items} />
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// Create client, and the key dialog
// ---------------------------------------------------------------------------------------------

export interface ClientCreateProps {
  /** `?client=new` and the person may edit. Decided on the server. */
  readonly open: boolean;
  readonly canEdit: boolean;
}

export function ClientCreate({ open, canEdit }: ClientCreateProps) {
  const m = useTranslations('admin.api_webhooks');
  const t = useTranslations();
  const url = useUrlState();
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<readonly Scope[]>([]);
  const [secret, setSecret] = useState<ClientCreated | null>(null);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setName('');
      setScopes([]);
    }
  }

  const create = useAdminAction(createClient, {
    // The dialog is the feedback; the key is never put in a toast.
    quiet: true,
    onSuccess: (created) => {
      setSecret(created);
      url.update({ client: null }, { history: 'replace' });
    },
  });

  const need = name.trim() === '' ? m('need.name') : scopes.length === 0 ? m('need.scopes') : null;
  const gate = canEdit ? need : t('opendispatch.gate.viewOnly');

  const footer = (
    <div className={styles.footer}>
      {need === null ? null : <Reason icon={<Info />}>{need}</Reason>}
      <span className={styles.push} />
      <Button variant="ghost" onClick={() => url.update({ client: null }, { history: 'replace' })}>
        {t('common.cancel')}
      </Button>
      <ReasonHint reason={gate} visible={false}>
        <Button variant="primary" loading={create.pending} onClick={() => gate === null && create.run({ name: name.trim(), scopes })}>
          {m('createShort')}
        </Button>
      </ReasonHint>
    </div>
  );

  return (
    <>
      <RecordDrawer open={open && canEdit} param="client" title={m('create')} footer={footer}>
        <Stack gap={20}>
          <Field label={m('f.name')} required>
            <Input value={name} placeholder={m('f.namePh')} autoComplete="off" translate="no" onChange={(event) => setName(event.target.value)} />
          </Field>
          <fieldset className={styles.fieldset}>
            <legend className={styles.legend}>
              {m('col.scopes')} <span aria-hidden="true">*</span>
            </legend>
            <Stack gap={8}>
              {SCOPES.map((scope) => (
                <Checkbox
                  key={scope}
                  label={<span translate="no">{scope}</span>}
                  description={m(`scope.${scope}`)}
                  checked={scopes.includes(scope)}
                  onChange={(event) => setScopes(event.target.checked ? [...scopes, scope] : scopes.filter((other) => other !== scope))}
                />
              ))}
            </Stack>
          </fieldset>
          <ActionError error={create.error} onDismiss={create.reset} />
        </Stack>
      </RecordDrawer>
      <KeyDialog secret={secret} rotated={false} onClosed={() => setSecret(null)} />
    </>
  );
}

export interface KeyDialogProps {
  /** The key to show once; null: closed. */
  readonly secret: ClientCreated | null;
  readonly rotated: boolean;
  readonly onClosed: () => void;
}

/** The key, shown once; it closes only after the person says they copied it. */
export function KeyDialog({ secret, rotated, onClosed }: KeyDialogProps) {
  const m = useTranslations('admin.api_webhooks');
  const [acknowledged, setAcknowledged] = useState(false);
  const [nudge, setNudge] = useState(false);
  const [shown, setShown] = useState(secret);
  if (secret !== shown) {
    setShown(secret);
    setAcknowledged(false);
    setNudge(false);
  }

  function closeKey() {
    setAcknowledged(false);
    setNudge(false);
    onClosed();
  }

  return (
    <Modal
      open={secret !== null}
      onClose={() => (acknowledged ? closeKey() : setNudge(true))}
      title={m(rotated ? 'secret.rotated' : 'secret.title')}
      description={secret === null ? undefined : <span translate="no">{secret.name}</span>}
      footer={
        <>
          {nudge && !acknowledged ? <Reason icon={<Info />}>{m('secret.first')}</Reason> : null}
          <ReasonHint reason={acknowledged ? null : m('secret.first')} visible={false}>
            <Button variant="primary" onClick={() => acknowledged && closeKey()}>
              {m('secret.done')}
            </Button>
          </ReasonHint>
        </>
      }
    >
      <Stack gap={16}>
        <Alert tone="warning">{m('secret.once')}</Alert>
        <Field label={m('secret.key')}>
          <div className={styles.keyRow}>
            <Input readOnly value={secret?.secret ?? ''} dir="ltr" translate="no" autoComplete="off" spellCheck={false} data-secret="" />
            <CopyButton value={secret?.secret ?? ''} label={m('secret.copy')} showLabel variant="secondary" description={m('toast.copied')} />
          </div>
        </Field>
        <Checkbox label={m('secret.ack')} checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} />
      </Stack>
    </Modal>
  );
}

// ---------------------------------------------------------------------------------------------
// The webhook drawer
// ---------------------------------------------------------------------------------------------

export interface HookDrawerProps {
  /** The webhook `?hook=` names, or `new`; undefined: closed. The parent gives the component a `key` for it, so a new target starts afresh. */
  readonly hook: HookRow | 'new' | undefined;
  readonly canEdit: boolean;
}

export function HookDrawer({ hook, canEdit }: HookDrawerProps) {
  const m = useTranslations('admin.api_webhooks');
  const t = useTranslations();
  const url = useUrlState();
  const existing = hook === 'new' || hook === undefined ? undefined : hook;
  const [name, setName] = useState(existing?.name ?? '');
  const [address, setAddress] = useState(existing?.url ?? '');
  const [events, setEvents] = useState<readonly EventType[]>(existing?.events ?? []);
  const [enabled, setEnabled] = useState(existing?.enabled ?? true);
  const [confirming, setConfirming] = useState(false);

  const close = () => url.update({ hook: null }, { history: 'replace' });
  const save = useAdminAction(saveHook, { successTitle: m('toast.hook'), successDescription: (saved) => saved.name, onSuccess: close });
  const remove = useAdminAction(removeHook, {
    successTitle: m('toast.hookDeleted'),
    onSuccess: () => {
      setConfirming(false);
      close();
    },
  });

  if (hook === undefined) return <RecordDrawer open={false} param="hook" title="" />;

  const need = name.trim() === '' ? m('need.name') : !validUrl(address) ? m('need.url') : events.length === 0 ? m('need.events') : null;
  const roReason = canEdit ? null : t('opendispatch.gate.viewOnly');
  const gate = roReason ?? need;

  const footer = (
    <div className={styles.footer}>
      {need === null || roReason !== null ? null : <Reason icon={<Info />}>{need}</Reason>}
      {existing === undefined ? null : (
        <ReasonHint reason={roReason} visible={false}>
          <Button variant="ghost" onClick={() => roReason === null && setConfirming(true)}>
            {m('hook.delete')}
          </Button>
        </ReasonHint>
      )}
      <span className={styles.push} />
      <Button variant="ghost" onClick={close}>
        {t('common.cancel')}
      </Button>
      <ReasonHint reason={gate} visible={false}>
        <Button
          variant="primary"
          loading={save.pending}
          onClick={() => {
            if (gate === null) save.run({ ...(existing === undefined ? {} : { hookId: existing.id }), name: name.trim(), target_url: address.trim(), event_types: events, is_enabled: enabled });
          }}
        >
          {t('common.save')}
        </Button>
      </ReasonHint>
    </div>
  );

  return (
    <>
      <RecordDrawer open recordKey={existing?.id ?? 'new'} param="hook" title={<span>{existing === undefined ? m('addHook') : m('hook.edit')}</span>} footer={footer}>
        <Stack gap={20}>
          <Field label={m('f.name')} required>
            <Input value={name} autoComplete="off" translate="no" disabled={!canEdit} onChange={(event) => setName(event.target.value)} />
          </Field>
          <Field label={m('f.url')} required hint={m('f.urlHint')}>
            <Input value={address} placeholder="https://hooks.example.com/opendispatch/roster" dir="ltr" translate="no" autoComplete="off" disabled={!canEdit} onChange={(event) => setAddress(event.target.value)} />
          </Field>
          <fieldset className={styles.fieldset} disabled={!canEdit}>
            <legend className={styles.legend}>
              {m('col.events')} <span aria-hidden="true">*</span>
            </legend>
            <Stack gap={8}>
              {EVENT_TYPES.map((event) => (
                <Checkbox
                  key={event}
                  label={<span translate="no">{event}</span>}
                  checked={events.includes(event)}
                  onChange={(change) => setEvents(change.target.checked ? [...events, event] : events.filter((other) => other !== event))}
                />
              ))}
            </Stack>
          </fieldset>
          <Switch checked={enabled} label={m('f.enabled')} disabled={!canEdit} onCheckedChange={setEnabled} />
          <ActionError error={save.error} onDismiss={save.reset} />
        </Stack>
      </RecordDrawer>
      <ConfirmDialog
        open={confirming}
        onClose={() => {
          setConfirming(false);
          remove.reset();
        }}
        onConfirm={() => existing !== undefined && remove.run({ hookId: existing.id })}
        title={m('hook.delTitle')}
        description={m('hook.delDesc')}
        confirmLabel={m('hook.delete')}
        tone="danger"
        pending={remove.pending}
        error={<ActionError error={remove.error} onDismiss={remove.reset} />}
      />
    </>
  );
}
