'use client';
// SPDX-License-Identifier: AGPL-3.0-only

import { useLocale, useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { Link, usePathname } from '@/i18n/navigation';
import { locales } from '@/i18n/routing';
import styles from './LanguageToggle.module.css';

/**
 * EN / AR, drawn like the mockup's lang (a segmented pair). The other language is a link to the same page (path and
 * query kept), so the server renders <html lang dir> for it and the toggle works before hydration. Wrap in <Suspense>:
 * it reads the query string. Hook for the specs: `[data-language-toggle]`.
 */
export function LanguageToggle() {
  const locale = useLocale();
  const t = useTranslations('language');
  const pathname = usePathname();
  const query = Object.fromEntries(useSearchParams().entries());

  return (
    <div className={styles.group} role="group" aria-label={t('label')} data-language-toggle="">
      {locales.map((code) =>
        code === locale ? (
          <span key={code} className={`${styles.item} ${styles.current}`} lang={code} aria-current="true">
            {code.toUpperCase()}
          </span>
        ) : (
          <Link key={code} href={{ pathname, query }} locale={code} lang={code} hrefLang={code} className={styles.item} aria-label={t(code)}>
            {code.toUpperCase()}
          </Link>
        ),
      )}
    </div>
  );
}
