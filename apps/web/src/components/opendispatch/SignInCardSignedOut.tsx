// SPDX-License-Identifier: AGPL-3.0-only
import { Button, EmptyState } from '@opendispatch/ui';
import { LogOut } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { SignInCard } from './SignInCard';
import styles from './SignInCard.module.css';

// The Signed out page: where signing out lands. The session cookie is already gone (the sign-out action cleared
// it after recording `auth.sign_out`), so this page reads nothing and works for anyone who opens it.
export function SignInCardSignedOut() {
  const t = useTranslations('signIn');
  return (
    <SignInCard page="signed-out">
      <div className={styles.signedOutHost}>
        <EmptyState
          icon={<LogOut />}
          headingLevel={1}
          title={t('out.title')}
          description={t('out.body')}
          action={
            <Button variant="primary" href="/sign-in">
              {t('title')}
            </Button>
          }
        />
      </div>
    </SignInCard>
  );
}
