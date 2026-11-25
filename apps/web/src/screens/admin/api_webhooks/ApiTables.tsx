'use client';
// SPDX-License-Identifier: AGPL-3.0-only

import { Button, Card, CardHeader, DataTable, IconButton, Input, Tag, useToast, type Column } from '@opendispatch/ui';
import { Ban, Play, RefreshCw, RotateCcw } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { ActionError } from '@/components/opendispatch/patterns/ActionError';
import { ConfirmDialog } from '@/components/opendispatch/patterns/ConfirmDialog';
import { StubTag } from '@/components/opendispatch/patterns/StubTag';
import { useAdminAction } from '@/components/opendispatch/patterns/useAdminAction';
import { IllustrativeLabel } from '@/components/opendispatch/IllustrativeLabel';
import { ReasonHint } from '@/components/opendispatch/ReasonHint';
import { KeyDialog } from './ApiForms';
import { retryDelivery, revokeClient, rotateClient, saveLimits, testHook } from './actions';
import styles from './ApiWebhooks.module.css';
import type { ClientCreated, LimitRow, Scope } from './types';

// The buttons that sit in the rows of the tables (Rotate, Revoke, Send test, Retry) and the rate limits card (client files: they call
// server actions). A view-only role sees each disabled with the reason. The two tests are LABELLED STUBS: nothing is
// sent, and the toast says so.

const TAG_COLOR: Readonly<Record<Scope, 'geekblue' | 'red' | 'green'>> = { read: 'geekblue', write: 'red', feeds: 'green' };

export function ScopeTag({ scope }: { scope: Scope }) {
  return (
    <Tag color={TAG_COLOR[scope]}>
      <span translate="no">{scope}</span>
    </Tag>
  );
}

/** Revoke an API client: an icon in the row, then a confirmation, because systems that use the key stop working. */
export function RevokeButton({ clientId, name, canEdit }: { clientId: string; name: string; canEdit: boolean }) {
  const m = useTranslations('admin.api_webhooks');
  const t = useTranslations();
  const [confirming, setConfirming] = useState(false);
  const revoke = useAdminAction(revokeClient, {
    successTitle: m('toast.revoked'),
    successDescription: (revoked) => (revoked.name === '' ? name : revoked.name),
    onSuccess: () => setConfirming(false),
  });
  return (
    <>
      <ReasonHint reason={canEdit ? null : t('opendispatch.gate.viewOnly')} visible={false}>
        <IconButton icon={<Ban />} label={m('revoke')} variant="ghost" size="sm" onClick={() => canEdit && setConfirming(true)} />
      </ReasonHint>
      <ConfirmDialog
        open={confirming}
        onClose={() => {
          setConfirming(false);
          revoke.reset();
        }}
        onConfirm={() => revoke.run({ clientId })}
        title={m('revokeConfirm.title')}
        description={
          <>
            <bdi translate="no">{name}</bdi>
            {' · '}
            {m('revokeConfirm.desc')}
          </>
        }
        confirmLabel={m('revokeConfirm.ok')}
        tone="danger"
        pending={revoke.pending}
        error={<ActionError error={revoke.error} onDismiss={revoke.reset} />}
      />
    </>
  );
}

/** Rotate a key: a new one, shown once. */
export function RotateButton({ clientId, canEdit }: { clientId: string; canEdit: boolean }) {
  const m = useTranslations('admin.api_webhooks');
  const t = useTranslations();
  const [secret, setSecret] = useState<ClientCreated | null>(null);
  const rotate = useAdminAction(rotateClient, { quiet: true, failureToast: true, onSuccess: setSecret });
  return (
    <>
      <ReasonHint reason={canEdit ? null : t('opendispatch.gate.viewOnly')} visible={false}>
        <IconButton icon={<RefreshCw />} label={m('rotate')} variant="ghost" size="sm" disabled={rotate.pending} onClick={() => canEdit && rotate.run({ clientId })} />
      </ReasonHint>
      <KeyDialog secret={secret} rotated onClosed={() => setSecret(null)} />
    </>
  );
}

/** Send a test delivery to a webhook (LABELLED STUB: a scripted answer, nothing is sent). */
export function TestHookButton({ hookId, canEdit }: { hookId: string; canEdit: boolean }) {
  const m = useTranslations('admin.api_webhooks');
  const t = useTranslations();
  const toast = useToast();
  const test = useAdminAction(testHook, {
    quiet: true,
    failureToast: true,
    onSuccess: (result) => {
      const detail = `${result.httpStatus === null ? '' : `HTTP ${result.httpStatus} · `}${m('nothingSent')}`;
      toast({ title: m(result.delivered ? 'toast.tested' : 'toast.testFailed'), description: `${result.name} · ${detail}`, tone: result.delivered ? 'success' : 'warning' });
    },
  });
  return (
    <ReasonHint reason={canEdit ? null : t('opendispatch.gate.viewOnly')} visible={false}>
      <IconButton icon={<Play />} label={m('test')} variant="ghost" size="sm" onClick={() => canEdit && test.run({ hookId })} />
    </ReasonHint>
  );
}

/** Retry a failed delivery (LABELLED STUB: a scripted answer, nothing is sent). */
export function RetryButton({ deliveryId, canEdit }: { deliveryId: string; canEdit: boolean }) {
  const m = useTranslations('admin.api_webhooks');
  const t = useTranslations();
  const toast = useToast();
  const retry = useAdminAction(retryDelivery, {
    quiet: true,
    failureToast: true,
    onSuccess: (result) => {
      const detail = `${result.httpStatus === null ? '' : `HTTP ${result.httpStatus} · `}${m('nothingSent')}`;
      toast({ title: m(result.delivered ? 'toast.retried' : 'toast.retryFailed'), description: detail, tone: result.delivered ? 'success' : 'warning' });
    },
  });
  return (
    <ReasonHint reason={canEdit ? null : t('opendispatch.gate.viewOnly')} visible={false}>
      <Button variant="secondary" size="sm" startIcon={<RotateCcw />} loading={retry.pending} onClick={() => canEdit && retry.run({ deliveryId })}>
        {m('retry.label')}
      </Button>
    </ReasonHint>
  );
}

// ---------------------------------------------------------------------------------------------
// Rate limits: STORED, NOT ENFORCED
// ---------------------------------------------------------------------------------------------

export interface LimitsPanelProps {
  readonly limits: readonly LimitRow[];
  readonly canEdit: boolean;
}

const MAX_PER_MINUTE = 100_000;
const asNumber = (text: string): number | null => (/^\d{1,6}$/.test(text.trim()) && Number(text) >= 1 && Number(text) <= MAX_PER_MINUTE ? Number(text) : null);
const draftOf = (limits: readonly LimitRow[]): Readonly<Record<string, string>> => Object.fromEntries(limits.map((limit) => [limit.scope, String(limit.requestsPerMinute)]));

/** The requests per minute of each scope. The figures are stored and audited, and nothing counts or refuses a request yet: labelled Illustrative and Not applied. */
export function LimitsPanel({ limits, canEdit }: LimitsPanelProps) {
  const m = useTranslations('admin.api_webhooks');
  const t = useTranslations();
  const [draft, setDraft] = useState<Readonly<Record<string, string>>>(() => draftOf(limits));
  // What the server holds now; the form starts again from it whenever that changes (after a save).
  const [held, setHeld] = useState(() => JSON.stringify(limits));
  if (JSON.stringify(limits) !== held) {
    setHeld(JSON.stringify(limits));
    setDraft(draftOf(limits));
  }
  const save = useAdminAction(saveLimits, { successTitle: m('toast.limits') });
  const values = limits.map((limit) => asNumber(draft[limit.scope] ?? ''));
  const dirty = limits.some((limit) => draft[limit.scope] !== String(limit.requestsPerMinute));
  const roReason = canEdit ? null : t('opendispatch.gate.viewOnly');
  const saveReason = roReason ?? (values.includes(null) ? m('need.limit') : dirty ? null : m('need.changes'));

  const columns: Column<LimitRow>[] = [
    { key: 'scope', header: m('col.scope'), cell: (row) => <ScopeTag scope={row.scope} /> },
    {
      key: 'perMin',
      header: m('lim.perMin'),
      align: 'end',
      cell: (row) => (
        <div className={styles.limitInput}>
          <Input size="sm" type="number" min={1} max={MAX_PER_MINUTE} step={1} dir="ltr" translate="no" value={draft[row.scope] ?? ''} disabled={!canEdit} invalid={asNumber(draft[row.scope] ?? '') === null} aria-label={row.scope} onChange={(event) => setDraft({ ...draft, [row.scope]: event.target.value })} />
        </div>
      ),
    },
    { key: 'burst', header: m('lim.burst'), align: 'end', cell: (row) => <bdi translate="no">{row.burst}</bdi> },
    { key: 'clients', header: m('lim.clients'), align: 'end', hideBelow: 'md', cell: (row) => <bdi translate="no">{row.clients}</bdi> },
  ];

  return (
    <Card padding="none">
      <CardHeader
        title={m('lim.title')}
        actions={
          <span className={styles.inline}>
            <IllustrativeLabel />
            <StubTag kind="notApplied" />
          </span>
        }
      />
      <DataTable columns={columns} rows={[...limits]} getRowId={(row) => row.scope} rowLabel={(row) => row.scope} pageSize={0} caption={m('lim.title')} />
      <div className={styles.cardFooter}>
        <ReasonHint reason={saveReason} visible={false}>
          <Button
            variant="primary"
            size="sm"
            loading={save.pending}
            onClick={() => {
              if (saveReason === null) save.run({ limits: limits.map((limit) => ({ scope: limit.scope, requests_per_minute: asNumber(draft[limit.scope] ?? '') ?? limit.requestsPerMinute, burst: limit.burst })) });
            }}
          >
            {t('common.save')}
          </Button>
        </ReasonHint>
        {saveReason === null || roReason !== null ? null : <span className={styles.cellSub}>{saveReason}</span>}
        <ActionError error={save.error} onDismiss={save.reset} />
      </div>
    </Card>
  );
}
