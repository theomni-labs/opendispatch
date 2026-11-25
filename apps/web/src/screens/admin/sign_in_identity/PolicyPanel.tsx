'use client';
// SPDX-License-Identifier: AGPL-3.0-only

import { Button, Card, Field, FormFooter, Input, Select, Stack, Tag } from '@opendispatch/ui';
import { Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { ActionError } from '@/components/opendispatch/patterns/ActionError';
import { useAdminAction } from '@/components/opendispatch/patterns/useAdminAction';
import { ReasonHint } from '@/components/opendispatch/ReasonHint';
import { ReasonSwitch } from '@/components/opendispatch/ReasonSwitch';
import { saveSignInPolicy } from './actions';
import { SESSION_CHOICES, SESSION_LABEL } from './presets';
import styles from './SignIn.module.css';
import type { PolicyView } from './types';

// The Sign-in policy tab: force SSO for the organisation's e-mail domains, require an MFA claim, the session length (the Security
// module's session policy) and a sticky footer with Discard and Save. The data layer keeps the domains that must use SSO and no
// separate "force" flag, so the switch is on when there are domains and turning it off saves an empty list. Save writes the
// sign-in policy first and the session length second (actions.ts). A view-only Administrator (a shared install) sees every control
// disabled with "Managed by our staff in the shared tier".

const DOMAIN = /^([a-z0-9-]+\.)+[a-z]{2,}$/;

interface Draft {
  readonly force: boolean;
  readonly domains: readonly string[];
  readonly mfa: boolean;
  readonly session: number;
}

const draftOf = (policy: PolicyView): Draft => ({ force: policy.forceDomains.length > 0, domains: [...policy.forceDomains], mfa: policy.requireMfa, session: policy.sessionMinutes });
const same = (a: Draft, b: Draft): boolean => a.force === b.force && a.mfa === b.mfa && a.session === b.session && a.domains.join('\n') === b.domains.join('\n');

export interface PolicyPanelProps {
  readonly policy: PolicyView;
  readonly canEdit: boolean;
}

export function PolicyPanel({ policy, canEdit }: PolicyPanelProps) {
  const m = useTranslations('admin.sign_in_identity');
  const t = useTranslations();
  const [draft, setDraft] = useState<Draft>(() => draftOf(policy));
  const [input, setInput] = useState('');
  const [bad, setBad] = useState(false);
  // What the server holds now; the form starts again from it whenever that changes (after a save, or a change made elsewhere).
  const [held, setHeld] = useState(() => JSON.stringify(policy));
  if (JSON.stringify(policy) !== held) {
    setHeld(JSON.stringify(policy));
    setDraft(draftOf(policy));
  }
  const saved = draftOf(policy);
  const dirty = !same(draft, saved);

  const save = useAdminAction(saveSignInPolicy, { successTitle: m('toast.policy') });

  const roReason = canEdit ? null : m('ro.reason');
  const needDomain = draft.force && draft.domains.length === 0;
  const saveReason = roReason ?? (dirty ? (needDomain ? m('need.domain') : null) : m('need.changes'));

  const sessions = SESSION_CHOICES.includes(draft.session) ? [...SESSION_CHOICES] : [...SESSION_CHOICES, draft.session].sort((a, b) => a - b);

  function addDomain() {
    const value = input.trim().toLowerCase();
    if (value === '') return;
    if (!DOMAIN.test(value)) {
      setBad(true);
      return;
    }
    setBad(false);
    if (!draft.domains.includes(value)) setDraft({ ...draft, domains: [...draft.domains, value] });
    setInput('');
  }

  return (
    <Card padding="lg">
      <Stack gap={20}>
        <Stack gap={12}>
          <ReasonSwitch
            reason={roReason}
            checked={draft.force}
            label={m('pol.force.title')}
            description={m('pol.force.desc')}
            onCheckedChange={(next) => setDraft({ ...draft, force: next })}
          />
          {draft.force ? (
            <Stack gap={8}>
              <div className={styles.domainChips}>
                {draft.domains.map((domain) => (
                  <Tag key={domain} color="gray" {...(canEdit ? { onRemove: () => setDraft({ ...draft, domains: draft.domains.filter((other) => other !== domain) }) } : {})}>
                    <span translate="no">{domain}</span>
                  </Tag>
                ))}
              </div>
              <div className={styles.addDomain}>
                <div className={styles.addDomainInput}>
                  <Field label={m('col.domains')} {...(bad ? { error: m('pol.domainBad') } : {})}>
                    <Input
                      value={input}
                      placeholder="demo.example"
                      autoComplete="off"
                      translate="no"
                      dir="ltr"
                      disabled={!canEdit}
                      invalid={bad}
                      onChange={(event) => {
                        setInput(event.target.value);
                        setBad(false);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault();
                          if (canEdit) addDomain();
                        }
                      }}
                    />
                  </Field>
                </div>
                <ReasonHint reason={roReason} visible={false}>
                  <Button variant="secondary" size="sm" startIcon={<Plus />} onClick={() => roReason === null && addDomain()}>
                    {m('pol.addDomain')}
                  </Button>
                </ReasonHint>
              </div>
            </Stack>
          ) : null}
        </Stack>
        <ReasonSwitch reason={roReason} checked={draft.mfa} label={m('pol.mfa.title')} description={m('pol.mfa.desc')} onCheckedChange={(next) => setDraft({ ...draft, mfa: next })} />
        <div className={styles.narrow}>
          <Field label={m('pol.session')}>
            <Select
              value={String(draft.session)}
              disabled={!canEdit}
              options={sessions.map((minutes) => ({ value: String(minutes), label: SESSION_LABEL[minutes] === undefined ? m('h.min', { n: minutes }) : m(SESSION_LABEL[minutes]) }))}
              onChange={(event) => setDraft({ ...draft, session: Number.parseInt(event.target.value, 10) })}
            />
          </Field>
        </div>
        <ActionError error={save.error} onDismiss={save.reset} />
        <FormFooter dirty={dirty && roReason === null} status={dirty && roReason === null ? (needDomain ? m('need.domain') : undefined) : (roReason ?? m('need.changes'))}>
          <Button variant="ghost" onClick={() => setDraft(draftOf(policy))} disabled={!dirty}>
            {m('pol.discard')}
          </Button>
          <ReasonHint reason={saveReason} visible={false}>
            <Button
              variant="primary"
              loading={save.pending}
              onClick={() => {
                if (saveReason === null) save.run({ force_sso_email_domains: draft.force ? [...draft.domains] : [], require_mfa_claim: draft.mfa, session_length_minutes: draft.session });
              }}
            >
              {t('common.save')}
            </Button>
          </ReasonHint>
        </FormFooter>
      </Stack>
    </Card>
  );
}
