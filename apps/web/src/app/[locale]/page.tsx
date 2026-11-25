// SPDX-License-Identifier: AGPL-3.0-only
import { Button, Card, PageHeader } from '@opendispatch/ui';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Suspense } from 'react';
import { DataSourceBadge } from '@/components/opendispatch/DataSourceBadge';
import { DemoBadge } from '@/components/opendispatch/DemoBadge';
import { DemoControls } from '@/components/shells/DemoControls';
import { LanguageToggle } from '@/components/shells/LanguageToggle';
import { landingHref } from '@/components/shells/landing';
import { redirect } from '@/i18n/navigation';
import { demoCustomerName, getDemoOptions, getRequestContext, isOidcMode } from '@/lib/data/context';
import styles from './page.module.css';

// The demo start page: where a person with no
// session lands. Choosing an install mode, a role and zones calls the demo server action, which sets the signed cookie
// and sends them to their landing module. It also writes the signed opendispatch_demo_mode cookie (the install mode) that the
// sign-in pages read after a sign-out. The "Sign-in screens" link leads to the sign-in pages.
// A demo control, marked Demo, deleted in oidc mode when the sign-in server replaces it.
export default async function DemoStart({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  // A valid session goes straight to its landing page (sign out from the switcher to come back here).
  const ctx = await getRequestContext();
  const home = ctx === null ? undefined : landingHref(ctx);
  if (home !== undefined) redirect({ href: home, locale });
  // The demo role picker is for dev, CI and review builds; a real install sends a visitor to the sign-in page.
  if (isOidcMode()) redirect({ href: '/sign-in', locale });

  const t = await getTranslations();
  const options = await getDemoOptions();
  const roles = options.rolesByInstallMode.private;

  return (
    <main className={styles.page}>
      <div className={styles.wide}>
        <div className={styles.top}>
          <span className={styles.brand} translate="no">
            {t('shell.brand')}
          </span>
          <div className={styles.topEnd}>
            <Button variant="link" href="/sign-in">
              {t('signIn.screens')}
            </Button>
            <Suspense fallback={null}>
              <LanguageToggle />
            </Suspense>
          </div>
        </div>
        <Card padding="lg" className={styles.card}>
          <PageHeader title={t('demo.startTitle')} meta={<DemoBadge />} />
          <DemoControls
            variant="page"
            options={{ customerName: demoCustomerName(options, locale), zones: options.zones, rolesByInstallMode: options.rolesByInstallMode }}
            initial={{ installMode: 'private', role: roles[0] ?? 'administrator', zoneIds: options.zones.slice(0, 2).map((zone) => zone.id) }}
            submitLabel={t('demo.start')}
            customerExtra={<DataSourceBadge sources={['SYNTHETIC']} />}
          />
        </Card>
      </div>
    </main>
  );
}
