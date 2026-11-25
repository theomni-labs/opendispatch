'use client';
// SPDX-License-Identifier: AGPL-3.0-only

import { Alert, Button, Card, DataTable, DescriptionList, Field, FileDrop, Input, SegmentedControl, StatusPill, Switch, useToast, type Column } from '@opendispatch/ui';
import { ExternalLink, Info, Plug, Upload } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRef, useState } from 'react';
import { ActionError } from '@/components/opendispatch/patterns/ActionError';
import { CopyButton } from '@/components/opendispatch/patterns/CopyButton';
import { StubTag } from '@/components/opendispatch/patterns/StubTag';
import { useAdminAction } from '@/components/opendispatch/patterns/useAdminAction';
import { useUrlState } from '@/components/opendispatch/patterns/useUrlState';
import { Reason, ReasonHint, useGate } from '@/components/opendispatch/ReasonHint';
import { changeMode, saveProxy, testConnection, uploadUpdateFile } from './actions';
import { CheckList, DataText, useWhen, type CheckRow } from './UpdatesShared';
import type { ConnectionTestView, ConnectionView, UploadOutcome } from './types';
import styles from './Updates.module.css';

// The Connection tab: connected or offline; what to allow in the
// firewall with a copy button; the proxy; Test connection; and, offline, the signed update file with its signature checks.
// THE UPDATE AGENT IS A STUB: the connection test and the signature checks are scripted (a file naming "tampered" or
// "invalid" fails, "revoked" marks the key revoked), and the customer portal link is a placeholder.

/** The largest update file this screen sends: the data layer's limit is 2,000,000 characters, and a file of that many bytes has at most that many characters. */
export const UPDATE_FILE_MAX_BYTES = 2_000_000;
const CERTIFICATE_MAX = 20_000;

interface EndpointRow {
  readonly hostname: string;
  readonly port: number;
  readonly purpose: string;
}

export interface ConnectionTabProps {
  readonly connection: ConnectionView;
  readonly canEdit: boolean;
}

export function ConnectionTab({ connection, canEdit }: ConnectionTabProps) {
  const m = useTranslations('admin.updates');
  const toast = useToast();
  const gate = useGate(canEdit ? 'edit' : 'view');
  const mode = connection.mode;
  const setMode = useAdminAction(changeMode, {
    quiet: true,
    onSuccess: (saved) => toast({ title: saved.mode === 'offline' ? m('toast.modeOffline') : m('toast.modeConnected'), tone: 'success' }),
    failureToast: true,
  });

  return (
    <div className={styles.grid2}>
      <div className={styles.col}>
        <Card padding="lg">
          <div className={styles.cardInner}>
            <div className={styles.head}>
              <h2 className={styles.cardTitle}>{m('conn.mode')}</h2>
              <fieldset className={styles.plainFieldset} disabled={!canEdit || setMode.pending}>
                <SegmentedControl
                  size="sm"
                  ariaLabel={m('conn.mode')}
                  value={mode}
                  onChange={(next) => canEdit && setMode.run({ mode: next })}
                  options={[
                    { value: 'connected', label: m('mode.connected') },
                    { value: 'offline', label: m('mode.offline') },
                  ]}
                />
              </fieldset>
            </div>
            {gate.edit.reason === null ? null : <Reason>{gate.edit.reason}</Reason>}
            {mode === 'connected' ? <ConnectedPanel connection={connection} /> : <OfflinePanel canEdit={canEdit} />}
          </div>
        </Card>
        {mode === 'connected' ? <ProxyCard connection={connection} canEdit={canEdit} /> : null}
      </div>
      {mode === 'connected' ? (
        <aside className={styles.col}>
          <TestCard canEdit={canEdit} />
        </aside>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Connected: what to allow
// ---------------------------------------------------------------------------------------------

function ConnectedPanel({ connection }: { connection: ConnectionView }) {
  const m = useTranslations('admin.updates');
  const when = useWhen();
  const columns: Column<EndpointRow>[] = [
    { key: 'host', header: m('conn.host'), cell: (row) => <span translate="no">{row.hostname}</span> },
    { key: 'port', header: m('conn.port'), align: 'end', cell: (row) => <bdi dir="ltr" translate="no">{row.port}</bdi> },
    { key: 'purpose', header: m('conn.purpose'), hideBelow: 'md', cell: (row) => <DataText>{row.purpose}</DataText> },
    { key: 'copy', header: <span className={styles.srOnly}>{m('conn.copy')}</span>, align: 'end', cell: (row) => <CopyButton value={`${row.hostname}:${row.port}`} label={m('conn.copy')} description={`${row.hostname}:${row.port}`} /> },
  ];
  const all = connection.endpoints.map((endpoint) => `${endpoint.hostname}:${endpoint.port}`).join(', ');
  return (
    <div className={styles.stack}>
      <DescriptionList
        columns={2}
        items={[
          {
            label: m('conn.lastContact'),
            value:
              connection.lastContactAt === null ? (
                '-'
              ) : (
                <span className={styles.inline}>
                  <bdi translate="no">{when.dateTime(connection.lastContactAt)}</bdi>
                  {connection.lastContactResult === 'failed' ? <StatusPill status={m('conn.failed')} tone="danger" size="sm" /> : <StatusPill status={m('conn.ok')} tone="success" size="sm" />}
                </span>
              ),
          },
          { label: m('conn.validUntil'), value: connection.indexValidUntil === null ? '-' : <bdi translate="no">{when.format.date(connection.indexValidUntil)}</bdi> },
        ]}
      />
      <hr className={styles.divider} />
      <div className={styles.stackTight}>
        <div className={styles.between}>
          <span className={styles.label}>{m('conn.allow')}</span>
          <CopyButton value={all} label={m('conn.copyAll')} showLabel variant="secondary" description={all} />
        </div>
        <DataTable dense pageSize={0} caption={m('conn.allow')} columns={columns} rows={[...connection.endpoints]} getRowId={(row) => row.hostname} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Offline: the signed update file
// ---------------------------------------------------------------------------------------------

function OfflinePanel({ canEdit }: { canEdit: boolean }) {
  const m = useTranslations('admin.updates');
  const toast = useToast();
  const url = useUrlState();
  const when = useWhen();
  const gate = useGate(canEdit ? 'edit' : 'view');
  const [outcome, setOutcome] = useState<UploadOutcome | null>(null);
  const [name, setName] = useState<string | null>(null);
  const [tooBig, setTooBig] = useState<string | null>(null);
  const upload = useAdminAction(uploadUpdateFile, { quiet: true, onSuccess: setOutcome });

  async function take(files: File[]) {
    setOutcome(null);
    setTooBig(null);
    const file = files[0];
    if (file === undefined || !canEdit) return;
    setName(file.name);
    // The file is read in the browser and sent as text (the data layer takes text, at most 2,000,000 characters).
    const text = await file.text();
    if (text.length > UPDATE_FILE_MAX_BYTES) {
      setTooBig(file.name);
      return;
    }
    upload.run({ file: text });
  }

  const v = outcome?.verification ?? null;
  const rows: CheckRow[] =
    v === null
      ? []
      : [
          { key: 'c1', tone: v.signatureValid ? 'success' : 'danger', pill: v.signatureValid ? m('pf.passed') : m('st.failed'), title: m('off.c1') },
          { key: 'c2', tone: v.digestsMatch ? 'success' : 'danger', pill: v.digestsMatch ? m('pf.passed') : m('st.failed'), title: m('off.c2') },
          { key: 'c3', tone: v.keyRevoked ? 'danger' : 'success', pill: v.keyRevoked ? m('st.failed') : m('pf.passed'), title: m('off.c3') },
          { key: 'c4', tone: v.olderThanInstalled ? 'danger' : 'success', pill: v.olderThanInstalled ? m('st.failed') : m('pf.passed'), title: m('off.c4') },
          { key: 'c5', tone: 'neutral', pill: m('off.notEnforced'), title: m('off.c5') },
        ];
  const ok = outcome?.accepted === true;

  return (
    <div className={styles.stack}>
      <div className={styles.stackTight}>
        <fieldset className={styles.plainFieldset} disabled={!canEdit}>
          <FileDrop
            accept=".update"
            maxSize={UPDATE_FILE_MAX_BYTES}
            hint={m('off.hintLimit', { max: when.format.int(UPDATE_FILE_MAX_BYTES) })}
            onFiles={(files) => void take(files)}
          />
        </fieldset>
        {gate.edit.reason === null ? null : <Reason>{gate.edit.reason}</Reason>}
        {tooBig === null ? null : <Alert tone="danger">{m('off.tooBig', { name: tooBig })}</Alert>}
        <ActionError error={upload.error} onDismiss={upload.reset} />
      </div>
      {outcome === null ? null : (
        <div className={styles.stackTight}>
          <div className={styles.between}>
            <span className={styles.label}>
              {m('off.checks')} {name === null ? null : <span className={styles.meta} translate="no">{name}</span>}
            </span>
            <StatusPill status={ok ? m('off.verified') : m('off.refused')} tone={ok ? 'success' : 'danger'} size="sm" />
          </div>
          {ok ? null : (
            <Alert tone="danger" title={m('off.failedT')}>
              {m('off.failedB')} {m('off.alertRaised')} {v?.message === null || v === null || v.message.includes(m('off.failedB')) ? null : <DataText>{v.message}</DataText>}
            </Alert>
          )}
          <CheckList label={m('off.checks')} rows={rows} />
          {ok ? (
            <div className={styles.actions}>
              <Button
                variant="primary"
                onClick={() => {
                  toast({ title: m('toast.fileOk.title', { v: outcome.version ?? '' }), description: m('toast.fileOk.desc'), tone: 'success' });
                  url.update({ tab: 'overview', release: outcome.version }, { history: 'push' });
                }}
              >
                {m('off.use')}
              </Button>
            </div>
          ) : null}
        </div>
      )}
      <hr className={styles.divider} />
      <div className={styles.stackTight}>
        <span className={styles.label}>{m('off.portal')}</span>
        <ol className={styles.steps}>
          <li>{m('off.s1')}</li>
          <li>{m('off.s2')}</li>
          <li>{m('off.s3')}</li>
        </ol>
        <div className={styles.actions}>
          <Button variant="ghost" size="sm" endIcon={<ExternalLink />} onClick={() => toast({ title: m('toast.portal'), tone: 'info' })}>
            {m('off.open')}
          </Button>
          <StubTag kind="demo" />
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Proxy
// ---------------------------------------------------------------------------------------------

function ProxyCard({ connection, canEdit }: { connection: ConnectionView; canEdit: boolean }) {
  const m = useTranslations('admin.updates');
  const t = useTranslations();
  const toast = useToast();
  const gate = useGate(canEdit ? 'edit' : 'view');
  const [enabled, setEnabled] = useState(connection.proxy.enabled);
  const [address, setAddress] = useState(connection.proxy.address);
  const [username, setUsername] = useState(connection.proxy.username);
  const [password, setPassword] = useState('');
  const [certificate, setCertificate] = useState('');
  const [certName, setCertName] = useState<string | null>(null);
  const [certError, setCertError] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  const save = useAdminAction(saveProxy, {
    quiet: true,
    onSuccess: () => {
      setPassword('');
      setCertificate('');
      toast({ title: m('toast.proxy'), tone: 'success' });
    },
  });
  const locked = !canEdit || !enabled;
  const needAddress = enabled && address.trim() === '' ? m('proxy.needAddress') : null;
  const reason = gate.edit.reason ?? needAddress;

  async function pickCertificate(file: File | undefined) {
    setCertError(false);
    if (file === undefined) return;
    const text = await file.text();
    if (text.length > CERTIFICATE_MAX) {
      setCertError(true);
      return;
    }
    setCertificate(text);
    setCertName(file.name);
  }

  return (
    <Card padding="lg">
      <div className={styles.cardInner}>
        <div className={styles.head}>
          <h2 className={styles.cardTitle}>{m('proxy.title')}</h2>
          <Switch aria-label={m('proxy.use')} checked={enabled} disabled={!canEdit} onCheckedChange={setEnabled} />
        </div>
        <div className={styles.formGrid}>
          <div className={styles.span2}>
            <Field label={m('proxy.address')}>
              <Input value={address} placeholder="http://proxy.example.test:8080" dir="ltr" translate="no" disabled={locked} onChange={(event) => setAddress(event.target.value)} />
            </Field>
          </div>
          <Field label={m('proxy.user')} optional>
            <Input value={username} dir="ltr" autoComplete="off" disabled={locked} onChange={(event) => setUsername(event.target.value)} />
          </Field>
          <Field label={m('proxy.pass')} optional hint={connection.proxy.hasPassword ? m('proxy.passSet') : undefined}>
            <Input type="password" value={password} dir="ltr" autoComplete="off" disabled={locked} onChange={(event) => setPassword(event.target.value)} />
          </Field>
          <div className={styles.span2}>
            <Field label={m('proxy.cert')} optional hint={certError ? m('proxy.certBig') : connection.proxy.hasCertificate && certName === null ? m('proxy.certSet') : undefined}>
              <div className={styles.inline}>
                <input ref={picker} type="file" accept=".pem,.crt,.cer" className={styles.hidden} onChange={(event) => void pickCertificate(event.target.files?.[0])} />
                <Button variant="secondary" size="sm" startIcon={<Upload />} disabled={locked} onClick={() => picker.current?.click()}>
                  {m('proxy.upload')}
                </Button>
                {certName === null ? null : <span className={styles.meta} translate="no">{certName}</span>}
              </div>
            </Field>
          </div>
        </div>
        <div className={styles.stackTight}>
          <div className={styles.actions}>
            <ReasonHint reason={reason} visible={false}>
              <Button
                variant="primary"
                loading={save.pending}
                onClick={() =>
                  reason === null && save.run({ proxy_enabled: enabled, proxy_address: address, proxy_username: username, proxy_password: password, proxy_certificate: certificate })
                }
              >
                {t('common.save')}
              </Button>
            </ReasonHint>
          </div>
          {reason === null ? null : <Reason icon={needAddress === null ? undefined : <Info />}>{reason}</Reason>}
          <ActionError error={save.error} onDismiss={save.reset} />
        </div>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------------------------
// Test connection
// ---------------------------------------------------------------------------------------------

function TestCard({ canEdit }: { canEdit: boolean }) {
  const m = useTranslations('admin.updates');
  const toast = useToast();
  const gate = useGate(canEdit ? 'edit' : 'view');
  const [result, setResult] = useState<ConnectionTestView | null>(null);
  const test = useAdminAction(testConnection, {
    quiet: true,
    onSuccess: (outcome) => {
      setResult(outcome);
      toast(outcome.ok ? { title: m('toast.testOk'), tone: 'success' } : { title: m('toast.testFailed'), tone: 'danger' });
    },
  });
  const rows: CheckRow[] =
    result === null
      ? []
      : result.steps.map((step) => ({
          key: step.name,
          tone: step.ok ? 'success' : 'danger',
          pill: step.ok ? m('conn.ok') : m('st.failed'),
          title: step.name === 'proxy' ? (step.ok && step.message?.startsWith('No proxy') ? m('test.proxy.none') : m('test.proxy.label')) : step.name === 'dns' ? m('test.dns') : step.name === 'tcp' ? m('test.tcp') : step.name === 'tls' ? m('test.tls') : m('test.sig'),
          meta: step.ok || step.message === null ? undefined : <DataText>{step.message}</DataText>,
        }));
  return (
    <Card padding="lg">
      <div className={styles.cardInner}>
        <div className={styles.head}>
          <h2 className={styles.cardTitle}>{m('test.title')}</h2>
          <StubTag kind="demo" />
        </div>
        <div className={styles.stack}>
          <div className={styles.actions}>
            <ReasonHint reason={gate.edit.reason} visible={false}>
              <Button variant="secondary" startIcon={<Plug />} loading={test.pending} onClick={() => gate.edit.allowed && test.run()}>
                {m('test.button')}
              </Button>
            </ReasonHint>
          </div>
          {gate.edit.reason === null ? null : <Reason>{gate.edit.reason}</Reason>}
          {rows.length === 0 ? null : <CheckList label={m('test.title')} rows={rows} />}
          <ActionError error={test.error} onDismiss={test.reset} />
        </div>
      </div>
    </Card>
  );
}
