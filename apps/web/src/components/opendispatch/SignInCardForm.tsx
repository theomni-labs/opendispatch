'use client';
// SPDX-License-Identifier: AGPL-3.0-only

import { Alert, Badge, Button, Card, Divider, Field, Input, RadioGroup, type RadioOption } from '@opendispatch/ui';
import { FlaskConical, KeyRound } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useId, useRef, useState, useTransition, type FormEvent } from 'react';
import { signInMock, type MockSignInInput } from '@/lib/demo/actions';
import { SignInCard } from './SignInCard';
import styles from './SignInCard.module.css';

// The sign-in page: an e-mail, Continue, or, Sign in with SSO, and the Emergency administrator link. In the demo
// the only provider is the labelled mock one, so Continue and Sign in with SSO both open its card below: Subject and Groups
// (what a real provider would assert) and the Outcome it should play. The card's button calls the sign-in action, which
// decides everything on the server: the role and zones come from the group rules and never from anything here.
//
// PHASE A ONLY. The real front door is Keycloak (oidc mode); this page, the mock provider and signInMock are deleted then.

/** The demo's starting values, from the mockup: synthetic fixture people and groups, not real data. */
export const SIGN_IN_DEFAULTS = { email: 'omar.al.fadani@demo.example', groups: 'opendispatch-dispatch-riyadh-core' } as const;

/** The outcomes the mock provider can play (the mockup's Outcome radio group). */
export const MOCK_SCENARIOS = ['signed', 'noRole', 'refused', 'error'] as const;
export type MockScenario = (typeof MOCK_SCENARIOS)[number];

// What each scenario sends. These are the data layer's own scripted triggers (identity.ts, mockSignIn): the provider is
// the labelled mock; a provider that is not there is refused; the subject `provider.error` makes it fail; no groups means
// no matching rule. Only "Signs in" reads the typed groups (the field is disabled for the others). actions.sign-in.test.ts runs
// each one against the real data layer, so a change there shows up here.
const MOCK_PROVIDER = 'mock-provider';
const SWITCHED_OFF_PROVIDER = 'mock-provider-off';
const FAILING_SUBJECT = 'provider.error';

/** The group names of a typed list: commas (Latin or Arabic) and line breaks separate, blanks and repeats go. */
export function parseGroups(text: string): string[] {
  return [...new Set(text.split(/[,،\n]/).map((group) => group.trim()).filter((group) => group !== ''))];
}

/** What the person typed, turned into the body of the sign-in action for the chosen outcome. Only the three typed fields. */
export function mockBodyFor(scenario: MockScenario, subject: string, groups: string): MockSignInInput {
  switch (scenario) {
    case 'signed':
      return { provider_id: MOCK_PROVIDER, subject, groups: parseGroups(groups) };
    case 'noRole':
      return { provider_id: MOCK_PROVIDER, subject, groups: [] };
    case 'refused':
      return { provider_id: SWITCHED_OFF_PROVIDER, subject, groups: [] };
    case 'error':
      return { provider_id: MOCK_PROVIDER, subject: FAILING_SUBJECT, groups: [] };
  }
}

export function SignInCardForm() {
  const t = useTranslations('signIn');
  const tDemo = useTranslations('demo');
  const locale = useLocale();
  const uid = useId();
  const [pending, startTransition] = useTransition();
  const [email, setEmail] = useState<string>(SIGN_IN_DEFAULTS.email);
  const [providerOpen, setProviderOpen] = useState(false);
  const [subject, setSubject] = useState('');
  const [groups, setGroups] = useState<string>(SIGN_IN_DEFAULTS.groups);
  const [scenario, setScenario] = useState<MockScenario>('signed');
  const [error, setError] = useState<string | null>(null);
  const subjectField = useRef<HTMLInputElement>(null);

  // The card opens with the e-mail as its subject; the person is then in it, so focus goes to the subject.
  useEffect(() => {
    if (!providerOpen) return;
    subjectField.current?.focus();
    subjectField.current?.scrollIntoView?.({ block: 'nearest' });
  }, [providerOpen]);

  function openProvider(event?: FormEvent) {
    event?.preventDefault();
    setSubject(email.trim());
    setError(null);
    setProviderOpen(true);
    // The card is already open (the person pressed Continue again): the effect does not run, so move focus here.
    if (providerOpen) subjectField.current?.focus();
  }

  function signIn(event: FormEvent) {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await signInMock(mockBodyFor(scenario, subject.trim(), groups), locale);
      // A sign-in that goes anywhere redirects and never returns a value; a refusal of the input comes back as { ok: false }.
      if (result?.ok === false) setError(result.error === 'unavailable' ? tDemo('errorUnavailable') : tDemo('errorInvalid'));
    });
  }

  const outcomeOptions: RadioOption[] = MOCK_SCENARIOS.map((code) => ({ value: code, label: t(`mock.${code}`) }));
  const isScenario = (value: string): value is MockScenario => (MOCK_SCENARIOS as readonly string[]).includes(value);

  return (
    <>
      <SignInCard page="sign-in">
        <h1 className={styles.title}>{t('title')}</h1>
        <form className={styles.form} noValidate onSubmit={openProvider}>
          <Field label={t('email')}>
            <Input type="email" name="email" autoComplete="off" translate="no" dir="auto" value={email} onChange={(event) => setEmail(event.target.value)} disabled={pending} />
          </Field>
          <Button type="submit" variant="primary" fullWidth disabled={pending}>
            {t('continue')}
          </Button>
          <Divider label={t('or')} />
          <Button variant="secondary" fullWidth startIcon={<KeyRound />} onClick={() => openProvider()} disabled={pending}>
            {t('sso')}
          </Button>
          <Button variant="link" href="/sign-in/emergency" className={styles.centered}>
            {t('emergencyLink')}
          </Button>
        </form>
      </SignInCard>

      {providerOpen ? (
        <Card as="section" padding="lg" aria-labelledby={`${uid}-mock`} data-sign-in="mock-provider" data-state={pending ? 'pending' : error === null ? 'idle' : 'error'}>
          <div className={styles.stack}>
            <div className={styles.badges}>
              <Badge tone="warning" size="sm" icon={<FlaskConical />}>
                {t('mock.badge')}
              </Badge>
            </div>
            <h2 className={styles.title} id={`${uid}-mock`}>
              {t('mock.title')}
            </h2>
            <form className={styles.form} noValidate onSubmit={signIn}>
              <Field label={t('mock.subject')}>
                <Input ref={subjectField} name="subject" autoComplete="off" translate="no" dir="auto" value={subject} onChange={(event) => setSubject(event.target.value)} disabled={pending} />
              </Field>
              <Field label={t('mock.groups')} hint={t('mock.groupsHint')}>
                <Input name="groups" autoComplete="off" translate="no" dir="auto" value={groups} onChange={(event) => setGroups(event.target.value)} disabled={pending || scenario !== 'signed'} />
              </Field>
              <Field label={t('mock.outcome')}>
                <RadioGroup name={`${uid}-outcome`} options={outcomeOptions} value={scenario} onChange={(value) => isScenario(value) && setScenario(value)} disabled={pending} />
              </Field>
              {error === null ? null : <Alert tone="danger">{error}</Alert>}
              <div className={styles.actions}>
                <Button type="submit" variant="primary" loading={pending}>
                  {t('mock.submit')}
                </Button>
              </div>
            </form>
          </div>
        </Card>
      ) : null}
    </>
  );
}
