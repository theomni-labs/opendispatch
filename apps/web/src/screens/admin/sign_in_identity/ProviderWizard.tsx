'use client';
// SPDX-License-Identifier: AGPL-3.0-only

import { Alert, Button, Field, Input, Modal, Select, Stack, Stepper, Switch, Textarea, useToast } from '@opendispatch/ui';
import { Info, Plug, Save } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { ActionError } from '@/components/opendispatch/patterns/ActionError';
import { StubTag } from '@/components/opendispatch/patterns/StubTag';
import { useAdminAction } from '@/components/opendispatch/patterns/useAdminAction';
import { useUrlState } from '@/components/opendispatch/patterns/useUrlState';
import { Reason, ReasonHint } from '@/components/opendispatch/ReasonHint';
import { removeProvider, saveAndTestProvider, setProviderEnabled } from './actions';
import { FIELD_INPUT, FIELD_LABEL, PRESET_NOTES } from './presets';
import styles from './SignIn.module.css';
import { TestResult } from './TestResult';
import type { Claims, PresetView, ProviderDetail, TestOutcome } from './types';
import type { WizardTarget } from './view';
import { ProtocolBadge } from './ProviderDrawer';

// Add or change a provider from a preset, in four steps: preset, settings, token fields, test (`?wizard=1` adds, `?wizard=<id>`
// changes). The steps are component state; the wizard is open when the server says so.
//
// The connection test (Keycloak fetches the provider's metadata; a LABELLED STUB when Keycloak is not connected) runs on a
// provider the data layer already holds, so pressing
// "Test connection" saves the fields first: a NEW provider is created disabled, a changed one keeps its enabled state, and
// every test after an edit saves again. "Save provider" then enables a new provider. Closing a new provider's wizard before
// that removes the draft it made. Only a passing test unlocks "Save provider", as in the mockup. The client secret is typed
// into a password field, sent to the data layer (which keeps only the fact that one was given) and never shown again.

const STEPS = ['w.preset', 'w.settings', 'w.claims', 'w.test'] as const;
const LAST_STEP = 4;

export interface ProviderWizardProps {
  /** What the address asks for; undefined: closed. The parent gives the component a `key` for it, so a new target starts afresh. */
  readonly target: WizardTarget | undefined;
  readonly presets: readonly PresetView[];
  readonly canEdit: boolean;
  /** Keycloak admin access is configured: the test is real, not the demo stub. */
  readonly keycloakConnected: boolean;
}

interface Form {
  readonly presetId: string | null;
  readonly name: string;
  readonly fields: Readonly<Record<string, string>>;
  readonly secret: string;
  readonly domains: string;
  readonly claims: Claims;
}

const EMPTY_CLAIMS: Claims = { email: '', name: '', groups: '' };

function initialForm(target: WizardTarget | undefined): Form {
  if (target?.mode === 'edit') {
    const provider: ProviderDetail = target.provider;
    return { presetId: provider.presetId, name: provider.name, fields: { ...provider.config }, secret: '', domains: provider.domains.join(', '), claims: { ...provider.claims } };
  }
  return { presetId: null, name: '', fields: {}, secret: '', domains: '', claims: EMPTY_CLAIMS };
}

const parseDomains = (text: string): string[] => text.split(/[,\s]+/).map((domain) => domain.trim()).filter((domain) => domain !== '');

export function ProviderWizard({ target, presets, canEdit, keycloakConnected }: ProviderWizardProps) {
  const m = useTranslations('admin.sign_in_identity');
  const t = useTranslations();
  const url = useUrlState();
  const toast = useToast();
  const editing = target?.mode === 'edit' ? target.provider : undefined;
  const [step, setStep] = useState(editing === undefined ? 1 : 2);
  const [form, setForm] = useState<Form>(() => initialForm(target));
  const [draftId, setDraftId] = useState<string | undefined>(editing?.id);
  const [result, setResult] = useState<TestOutcome | null>(null);
  const [closed, setClosed] = useState(false);

  const preset = presets.find((candidate) => candidate.id === form.presetId);
  const open = target !== undefined && canEdit && !closed;

  const change = (patch: Partial<Form>) => {
    setForm((current) => ({ ...current, ...patch }));
    setResult(null);
  };

  const testAndSave = useAdminAction(saveAndTestProvider, {
    quiet: true,
    onSuccess: (tested) => {
      setDraftId(tested.provider.id);
      setResult(tested.test);
    },
  });
  // Enabling a new provider is the last write: its success closes the wizard.
  const enable = useAdminAction(setProviderEnabled, { successTitle: m('toast.added'), successDescription: (saved) => saved.name, onSuccess: () => close(true) });
  const discard = useAdminAction(removeProvider, { quiet: true });

  function pickPreset(next: PresetView) {
    if (editing !== undefined) return;
    setForm((current) => ({ ...current, presetId: next.id, name: current.name === '' || presets.some((p) => p.name === current.name) ? next.name : current.name, fields: {}, secret: '', claims: { ...next.claims } }));
    setResult(null);
  }

  function requiredMissing(): boolean {
    if (preset === undefined || form.name.trim() === '') return true;
    return preset.fields.some((field) => {
      if (!field.required) return false;
      if (field.secret) return form.secret.trim() === '' && editing?.hasSecret !== true;
      return (form.fields[field.key] ?? '').trim() === '';
    });
  }

  const passed = result?.ok === true;
  const need = step === 1 && preset === undefined ? m('need.preset') : step === 2 && requiredMissing() ? m('need.fields') : step === LAST_STEP && !passed ? m('need.test') : null;

  function close(saved = false) {
    setClosed(true);
    // A new provider that was tested and never saved is a draft: throw it away.
    if (!saved && editing === undefined && draftId !== undefined) discard.run({ providerId: draftId });
    url.update(saved && editing === undefined ? { wizard: null, tab: null } : { wizard: null }, { history: 'replace' });
  }

  function runTest() {
    if (preset === undefined) return;
    const config = Object.fromEntries(preset.fields.filter((field) => !field.secret).flatMap((field) => ((form.fields[field.key] ?? '').trim() === '' ? [] : [[field.key, (form.fields[field.key] as string).trim()] as const])));
    testAndSave.run({
      ...(draftId === undefined ? {} : { providerId: draftId }),
      preset_id: preset.id,
      display_name: form.name.trim(),
      email_domains: parseDomains(form.domains),
      config,
      ...(form.secret === '' ? {} : { client_secret: form.secret }),
      claim_mapping: { email: form.claims.email.trim(), name: form.claims.name.trim(), groups: form.claims.groups.trim() },
    });
  }

  function save() {
    if (!passed || draftId === undefined) return;
    if (editing !== undefined) {
      toast({ title: m('toast.updated'), description: form.name.trim(), tone: 'success' });
      close(true);
      return;
    }
    enable.run({ providerId: draftId, enabled: true });
  }

  const footer = (
    <div className={styles.footer}>
      {need === null ? null : <Reason icon={<Info />}>{need}</Reason>}
      <span className={styles.push} />
      {step > 1 ? (
        <Button variant="ghost" onClick={() => setStep(step - 1)}>
          {t('common.back')}
        </Button>
      ) : null}
      {step < LAST_STEP ? (
        <ReasonHint reason={need} visible={false}>
          <Button
            variant="primary"
            onClick={() => {
              if (need === null) setStep(step + 1);
            }}
          >
            {t('common.next')}
          </Button>
        </ReasonHint>
      ) : (
        <ReasonHint reason={need} visible={false}>
          <Button variant="primary" startIcon={<Save />} loading={enable.pending} onClick={save}>
            {m('w.save')}
          </Button>
        </ReasonHint>
      )}
    </div>
  );

  const notes = preset === undefined ? undefined : PRESET_NOTES[preset.id];

  return (
    <Modal open={open} onClose={() => close()} title={m(editing === undefined ? 'add' : 'prov.edit')} size="lg" footer={footer}>
      <Stack gap={20}>
        <Stepper steps={STEPS.map((key) => ({ label: m(key) }))} current={step - 1} />
        {step === 1 ? (
          <div className={styles.presetGrid}>
            {presets.map((candidate) => (
              <button key={candidate.id} type="button" className={styles.presetCard} aria-pressed={candidate.id === form.presetId} data-preset={candidate.id} disabled={editing !== undefined && candidate.id !== form.presetId} onClick={() => pickPreset(candidate)}>
                <span className={styles.presetName} translate="no">
                  {candidate.name}
                </span>
                <ProtocolBadge protocol={candidate.protocol} />
              </button>
            ))}
          </div>
        ) : null}
        {step === 2 && preset !== undefined ? (
          <Stack gap={16}>
            <Field label={m('w.name')} required>
              <Input value={form.name} autoComplete="off" translate="no" onChange={(event) => change({ name: event.target.value })} />
            </Field>
            {preset.fields.map((field) => {
              const labelKey = FIELD_LABEL[`${preset.id}.${field.key}`];
              const label = labelKey === undefined ? field.key : m(`f.${labelKey}`);
              const input = FIELD_INPUT[`${preset.id}.${field.key}`];
              const setField = (value: string) => change({ fields: { ...form.fields, [field.key]: value } });
              if (input !== undefined) {
                const options = input.kind === 'select' ? Object.entries(input.options).map(([value, key]) => ({ value, label: m(key) })) : [];
                return (
                  <Field key={field.key} label={label} required={field.required}>
                    {input.kind === 'textarea' ? (
                      <Textarea value={form.fields[field.key] ?? ''} rows={5} placeholder={field.placeholder ?? undefined} autoComplete="off" translate="no" dir="ltr" onChange={(event) => setField(event.target.value)} />
                    ) : (
                      <Select value={form.fields[field.key] || (options[0]?.value ?? '')} options={options} onChange={(event) => setField(event.target.value)} />
                    )}
                  </Field>
                );
              }
              return (
                <Field key={field.key} label={label} required={field.secret ? field.required && editing?.hasSecret !== true : field.required} {...(field.secret && editing?.hasSecret === true ? { hint: m('w.secretKeep') } : {})}>
                  <Input
                    type={field.secret ? 'password' : 'text'}
                    value={field.secret ? form.secret : (form.fields[field.key] ?? '')}
                    placeholder={field.secret ? undefined : (field.placeholder ?? undefined)}
                    autoComplete="off"
                    translate="no"
                    dir="ltr"
                    onChange={(event) => (field.secret ? change({ secret: event.target.value }) : change({ fields: { ...form.fields, [field.key]: event.target.value } }))}
                  />
                </Field>
              );
            })}
            <Field label={m('col.domains')}>
              <Input value={form.domains} placeholder="demo.example" autoComplete="off" translate="no" dir="ltr" onChange={(event) => change({ domains: event.target.value })} />
            </Field>
          </Stack>
        ) : null}
        {step === 3 && preset !== undefined ? (
          <Stack gap={16}>
            {notes?.warning.map((key) => (
              <Alert key={key} tone="warning">
                {m(key)}
              </Alert>
            ))}
            {notes?.hint.map((key) => (
              <span key={key} className={styles.meta}>
                {m(key)}
              </span>
            ))}
            <Field label={m('claim.email')}>
              <Input value={form.claims.email} translate="no" dir="ltr" onChange={(event) => change({ claims: { ...form.claims, email: event.target.value } })} />
            </Field>
            <Field label={m('claim.name')}>
              <Input value={form.claims.name} translate="no" dir="ltr" onChange={(event) => change({ claims: { ...form.claims, name: event.target.value } })} />
            </Field>
            <Field label={m('claim.groups')}>
              <Input value={form.claims.groups} translate="no" dir="ltr" onChange={(event) => change({ claims: { ...form.claims, groups: event.target.value } })} />
            </Field>
            {preset.protocol === 'saml' ? <Switch checked disabled label={m('signed.req')} /> : null}
          </Stack>
        ) : null}
        {step === LAST_STEP ? (
          <Stack gap={12}>
            <div className={styles.inline}>
              <Button variant="secondary" startIcon={<Plug />} loading={testAndSave.pending} onClick={runTest}>
                {m('test.label')}
              </Button>
              {keycloakConnected ? null : <StubTag kind="demo" />}
            </div>
            {result === null ? null : <TestResult result={result} />}
            <ActionError error={testAndSave.error ?? enable.error} onDismiss={() => (testAndSave.error === null ? enable.reset() : testAndSave.reset())} />
          </Stack>
        ) : null}
      </Stack>
    </Modal>
  );
}
