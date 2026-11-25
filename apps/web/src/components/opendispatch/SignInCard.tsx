// SPDX-License-Identifier: AGPL-3.0-only
import { Card } from '@opendispatch/ui';
import { useTranslations } from 'next-intl';
import { Suspense, type ReactNode } from 'react';
import { LanguageToggle } from '@/components/shells/LanguageToggle';
import styles from './SignInCard.module.css';

// The frame of the sign-in pages: a bare page, one centred column, and in it
// cards that each open with the brand and the language toggle. No shell, no menu: the person has no session and no role.
//
// PHASE A ONLY. These pages exist to show and test the sign-in flow. The real front door is Keycloak (oidc mode): the pages,
// the mock provider and the demo actions behind them are deleted then.

/** The bare page: a `main` and a centred column that the cards go in. */
export function SignInPage({ children }: { children: ReactNode }) {
  return (
    <main className={styles.page}>
      <div className={styles.column}>{children}</div>
    </main>
  );
}

interface SignInCardProps {
  children: ReactNode;
  /** Which page this is, for the specs and for the CSS: `sign-in`, `emergency`, `refused`, `no-role`, `error`, `signed-out`. */
  page: string;
  /** Extra data attributes of the card, for a state the specs read (the emergency step, for example). */
  state?: string | undefined;
}

/** One card of a sign-in page: the brand and the language toggle, then the content. */
export function SignInCard({ children, page, state }: SignInCardProps) {
  const t = useTranslations('shell');
  return (
    <Card as="section" padding="lg" data-sign-in={page} data-state={state}>
      <div className={styles.stack}>
        <div className={styles.top}>
          <span className={styles.brand} translate="no">
            {t('brand')}
          </span>
          <Suspense fallback={null}>
            <LanguageToggle />
          </Suspense>
        </div>
        {children}
      </div>
    </Card>
  );
}
