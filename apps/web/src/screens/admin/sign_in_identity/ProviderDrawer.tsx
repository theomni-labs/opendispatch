'use client';
// SPDX-License-Identifier: AGPL-3.0-only

import { Badge, Button, DescriptionList, Stack, StatusPill, Tag, useToast } from '@opendispatch/ui';
import { Pencil, Plug } from 'lucide-react';
import { date } from '@opendispatch/ui/format';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { RecordDrawer } from '@/components/opendispatch/patterns/RecordDrawer';
import { StubTag } from '@/components/opendispatch/patterns/StubTag';
import { useAdminAction } from '@/components/opendispatch/patterns/useAdminAction';
import { useUrlState } from '@/components/opendispatch/patterns/useUrlState';
import { ActionError } from '@/components/opendispatch/patterns/ActionError';
import { ReasonHint } from '@/components/opendispatch/ReasonHint';
import { setProviderEnabled, testProvider } from './actions';
import { PROTOCOL_NAME, SYNC_PILL } from './presets';
import styles from './SignIn.module.css';
import { TestResult } from './TestResult';
import type { ProviderDetail, SyncStatus, SyncView, TestOutcome } from './types';

// The provider's drawer (`?provider=<id>`): what is set up, the Keycloak sync state, a connection test (Keycloak fetches the
// metadata; a LABELLED STUB when Keycloak is not connected), Edit (the wizard) and
// Enable or Disable. The mock provider of the demo is read only; in a shared install every provider is, and each
// disabled control says why.

export function ProtocolBadge({ protocol }: { protocol: 'oidc' | 'saml' }) {
  return (
    <Badge size="sm" tone="neutral">
      <span translate="no">{PROTOCOL_NAME[protocol]}</span>
    </Badge>
  );
}

export function DomainList({ domains }: { domains: readonly string[] }) {
  const m = useTranslations('admin.sign_in_identity');
  if (domains.length === 0) return <>{m('domains.none')}</>;
  return (
    <>
      {domains.map((domain, index) => (
        <span key={domain}>
          {index === 0 ? '' : ', '}
          <span translate="no">{domain}</span>
        </span>
      ))}
    </>
  );
}

export function SyncPill({ status }: { status: SyncStatus }) {
  const m = useTranslations('admin.sign_in_identity');
  const pill = SYNC_PILL[status];
  return <StatusPill status={m(pill.key)} tone={pill.tone} size="sm" />;
}

function SyncDetail({ sync, locale }: { sync: SyncView | null; locale: 'en' | 'ar' }) {
  if (sync === null) return <span className={styles.muted}>-</span>;
  return (
    <span className={styles.syncCell}>
      <span className={styles.inline}>
        <SyncPill status={sync.status} />
        {sync.status === 'not_configured' || sync.at === null ? null : <span className={styles.meta}>{date(sync.at, { locale })}</span>}
      </span>
      {sync.status === 'failed' && sync.error !== null ? (
        <span className={styles.meta} lang="en" dir="ltr" translate="no">
          {sync.error}
        </span>
      ) : null}
    </span>
  );
}

export interface ProviderDrawerProps {
  readonly provider: ProviderDetail | undefined;
  readonly canEdit: boolean;
  /** Keycloak admin access is configured: the test is real, not the demo stub. */
  readonly keycloakConnected: boolean;
}

export function ProviderDrawer({ provider, canEdit, keycloakConnected }: ProviderDrawerProps) {
  const m = useTranslations('admin.sign_in_identity');
  const locale = useLocale() === 'ar' ? 'ar' : 'en';
  const url = useUrlState();
  const toast = useToast();
  const [result, setResult] = useState<TestOutcome | null>(null);
  const [seen, setSeen] = useState<string | undefined>(provider?.id);
  if (provider?.id !== seen) {
    setSeen(provider?.id);
    setResult(null);
  }

  const test = useAdminAction(testProvider, {
    quiet: true,
    onSuccess: (outcome) => {
      setResult(outcome);
      if (outcome.ok && provider !== undefined) toast({ title: m('toast.tested'), description: provider.name, tone: 'success' });
    },
  });
  const toggle = useAdminAction(setProviderEnabled, {
    successTitle: (saved) => m(saved.enabled ? 'toast.enabled' : 'toast.disabled'),
    successDescription: (saved) => saved.name,
  });

  if (provider === undefined) return <RecordDrawer open={false} param="provider" title="" />;

  const roReason = canEdit ? null : m('ro.reason');
  const changeReason = roReason ?? (provider.mock ? m('mock.reason') : null);
  const signed = provider.protocol === 'saml' ? <StatusPill status={m('locked')} tone="success" size="sm" /> : <span className={styles.muted}>-</span>;

  const footer = (
    <div className={styles.footer}>
      <span className={styles.inline}>
        <ReasonHint reason={roReason} visible={false}>
          <Button variant="secondary" startIcon={<Plug />} loading={test.pending} onClick={() => roReason === null && test.run({ providerId: provider.id })}>
            {m('test.label')}
          </Button>
        </ReasonHint>
        {keycloakConnected ? null : <StubTag kind="demo" />}
      </span>
      <span className={styles.push} />
      <ReasonHint reason={changeReason} visible={false}>
        <Button variant="secondary" startIcon={<Pencil />} onClick={() => changeReason === null && url.update({ wizard: provider.id }, { history: 'push' })}>
          {m('d.edit')}
        </Button>
      </ReasonHint>
      <ReasonHint reason={changeReason} visible={false}>
        <Button variant="secondary" loading={toggle.pending} onClick={() => changeReason === null && toggle.run({ providerId: provider.id, enabled: !provider.enabled })}>
          {m(provider.enabled ? 'd.disable' : 'd.enable')}
        </Button>
      </ReasonHint>
    </div>
  );

  return (
    <RecordDrawer open recordKey={provider.id} param="provider" title={<span translate="no">{provider.name}</span>} subtitle={<span translate="no">{provider.presetName}</span>} footer={footer}>
      <Stack gap={20}>
        <div className={styles.pills}>
          <StatusPill status={m(provider.enabled ? 'status.on' : 'status.off')} tone={provider.enabled ? 'success' : 'neutral'} size="sm" />
          <ProtocolBadge protocol={provider.protocol} />
          {provider.mock ? <Tag color="gold">{m('demo')}</Tag> : null}
        </div>
        <DescriptionList
          dense
          columns={1}
          items={[
            { label: m('col.protocol'), value: <span translate="no">{PROTOCOL_NAME[provider.protocol]}</span> },
            { label: m('col.domains'), value: <DomainList domains={provider.domains} /> },
            { label: m('claim.email'), value: <span translate="no">{provider.claims.email}</span> },
            { label: m('claim.name'), value: <span translate="no">{provider.claims.name}</span> },
            { label: m('claim.groups'), value: <span translate="no">{provider.claims.groups}</span> },
            { label: m('signed.label'), value: signed },
            { label: m('col.sync'), value: <SyncDetail sync={provider.sync} locale={locale} /> },
          ]}
        />
        {result === null ? null : <TestResult result={result} />}
        <ActionError error={test.error ?? toggle.error} onDismiss={() => (test.error === null ? toggle.reset() : test.reset())} />
      </Stack>
    </RecordDrawer>
  );
}
