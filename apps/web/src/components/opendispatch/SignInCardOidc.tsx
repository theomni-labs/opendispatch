'use client';
// SPDX-License-Identifier: AGPL-3.0-only

import { Button } from '@opendispatch/ui';
import { KeyRound } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { SignInCard } from './SignInCard';
import styles from './SignInCard.module.css';

// The sign-in page of a real install: one button that leaves for the customer's identity provider, and the emergency
// administrator link for when that provider cannot be reached. The leaving is a plain page load of /auth/login, which the api
// answers with a redirect; nothing here touches a role, a group or a token.
export function SignInCardOidc() {
  const t = useTranslations('signIn');
  const locale = useLocale();
  return (
    <SignInCard page="sign-in">
      <h1 className={styles.title}>{t('title')}</h1>
      <form className={styles.form} method="get" action="/auth/login">
        <input type="hidden" name="locale" value={locale} />
        <Button type="submit" variant="primary" fullWidth startIcon={<KeyRound />}>
          {t('sso')}
        </Button>
        <Button variant="link" href="/sign-in/emergency" className={styles.centered}>
          {t('emergencyLink')}
        </Button>
      </form>
    </SignInCard>
  );
}
