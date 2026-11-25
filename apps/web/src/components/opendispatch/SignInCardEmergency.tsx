'use client';
// SPDX-License-Identifier: AGPL-3.0-only

import { Alert, Button, Field, Input } from '@opendispatch/ui';
import { ShieldAlert } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useRef, useState, useTransition, type FormEvent } from 'react';
import { signInEmergency } from '@/lib/demo/actions';
import { Reason } from './ReasonHint';
import { SignInCard } from './SignInCard';
import styles from './SignInCard.module.css';

// The emergency administrator page: the local account for when the identity provider is down. Two steps in
// one page: the e-mail and password, then the authenticator code. The step lives in this component's state, not in the URL,
// and so does the password until the second step sends it again with the code (the data layer checks both each time). The
// password and the code are typed into fields, held in memory, and passed to the action: never put in the URL, never stored,
// never logged. A wrong answer says only "Invalid credentials". Five failures lock the account until the demo is reset.
//
// PHASE A ONLY. The real front door is Keycloak (oidc mode); this page and signInEmergency are deleted then.

/** The emergency account of the fixtures, as in the mockup. A synthetic address, not a secret. */
export const EMERGENCY_DEFAULT_EMAIL = 'emergency.admin@demo.example';

const SIX_DIGITS = /^[0-9]{6}$/;

type Step = 'credentials' | 'code';
type Problem = 'invalid_credentials' | 'locked' | 'unavailable' | null;

export function SignInCardEmergency() {
  const t = useTranslations('signIn');
  const tDemo = useTranslations('demo');
  const locale = useLocale();
  const [pending, startTransition] = useTransition();
  const [step, setStep] = useState<Step>('credentials');
  const [email, setEmail] = useState(EMERGENCY_DEFAULT_EMAIL);
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [problem, setProblem] = useState<Problem>(null);
  const [codeError, setCodeError] = useState(false);
  const passwordField = useRef<HTMLInputElement>(null);
  const codeField = useRef<HTMLInputElement>(null);

  // Once locked nothing can be tried: the form stays, disabled, with the reason.
  const locked = problem === 'locked';

  // Where focus goes once the server has answered. A field is disabled while the answer is awaited and cannot take focus
  // then, so the handlers say where to go and this effect does it when the wait is over.
  const focusNext = useRef<'password' | 'code' | null>(null);
  useEffect(() => {
    if (pending || focusNext.current === null) return;
    (focusNext.current === 'code' ? codeField : passwordField).current?.focus();
    focusNext.current = null;
  }, [pending, step]);

  function submitCredentials(event: FormEvent) {
    event.preventDefault();
    setProblem(null);
    startTransition(async () => {
      const result = await signInEmergency({ email: email.trim(), password }, locale);
      // A sign-in never returns on success (it redirects); this is a step or a refusal.
      if (result === undefined) return;
      if (result.ok) {
        focusNext.current = 'code';
        setStep('code');
        return;
      }
      // A refusal of the input is answered like a wrong password: nothing says which of the fields it was.
      setProblem(result.error === 'invalid' ? 'invalid_credentials' : result.error);
      setPassword('');
      focusNext.current = 'password';
    });
  }

  function submitCode(event: FormEvent) {
    event.preventDefault();
    setProblem(null);
    if (!SIX_DIGITS.test(code)) {
      setCodeError(true);
      codeField.current?.focus();
      return;
    }
    setCodeError(false);
    startTransition(async () => {
      const result = await signInEmergency({ email: email.trim(), password, totp_code: code }, locale);
      if (result === undefined) return;
      if (result.ok) return; // the second call never asks for a code again
      setProblem(result.error === 'invalid' ? 'invalid_credentials' : result.error);
      setCode('');
      focusNext.current = 'code';
    });
  }

  const alertText =
    problem === 'invalid_credentials' ? t('emergency.invalid') : problem === 'locked' ? t('emergency.locked') : problem === 'unavailable' ? tDemo('errorUnavailable') : null;
  const alert = alertText === null ? null : <Alert tone="danger">{alertText}</Alert>;

  return (
    <SignInCard page="emergency" state={pending ? `${step}-pending` : locked ? 'locked' : step}>
      {step === 'credentials' ? (
        <>
          <h1 className={styles.title}>{t('emergency.title')}</h1>
          <form className={styles.form} noValidate onSubmit={submitCredentials}>
            <Field label={t('email')}>
              <Input type="email" name="email" autoComplete="off" translate="no" dir="auto" value={email} onChange={(event) => setEmail(event.target.value)} disabled={pending || locked} />
            </Field>
            <Field label={t('emergency.password')}>
              <Input ref={passwordField} type="password" name="password" autoComplete="off" value={password} onChange={(event) => setPassword(event.target.value)} disabled={pending || locked} />
            </Field>
            {alert}
            <Button type="submit" variant="primary" fullWidth loading={pending} disabled={locked}>
              {t('continue')}
            </Button>
          </form>
        </>
      ) : (
        <>
          <h1 className={styles.title}>{t('emergency.mfaTitle')}</h1>
          <form className={styles.form} noValidate onSubmit={submitCode}>
            <Field label={t('emergency.code')} hint={t('emergency.codeHint')} error={codeError ? t('emergency.codeNeeded') : undefined}>
              <Input
                ref={codeField}
                name="code"
                inputMode="numeric"
                maxLength={6}
                placeholder="000000"
                autoComplete="one-time-code"
                translate="no"
                dir="ltr"
                value={code}
                onChange={(event) => {
                  setCode(event.target.value);
                  setCodeError(false);
                }}
                disabled={pending || locked}
              />
            </Field>
            {alert}
            <Button type="submit" variant="primary" fullWidth loading={pending} disabled={locked}>
              {t('mock.submit')}
            </Button>
          </form>
        </>
      )}
      {/* The mockup's reason line sits under the code step's button. Once locked the alert says it, so it is not written twice. */}
      {step === 'code' && !locked ? <Reason icon={<ShieldAlert />}>{t('emergency.locked')}</Reason> : null}
    </SignInCard>
  );
}
