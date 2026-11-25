// SPDX-License-Identifier: AGPL-3.0-only
// Fonts are bundled at build time (Fontsource). Nothing loads from Google Fonts or any other internet address:
// installs may be offline. Order matters: the fonts, then tokens.css, then styles.css, each imported once,
// before any OpenDispatch CSS Module, so a single-class override in a module wins.
// Arabic pages contain Latin text and digits, so the combined Plex Arabic files (arabic and latin subsets) are used;
// Figtree needs the Latin subset only.
import '@fontsource/ibm-plex-sans-arabic/400.css';
import '@fontsource/ibm-plex-sans-arabic/500.css';
import '@fontsource/ibm-plex-sans-arabic/600.css';
import '@fontsource/ibm-plex-sans-arabic/700.css';
import '@fontsource/figtree/latin-400.css';
import '@fontsource/figtree/latin-500.css';
import '@fontsource/figtree/latin-600.css';
import '@fontsource/figtree/latin-700.css';
import '@opendispatch/ui/tokens.css';
import '@opendispatch/ui/styles.css';

import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { hasLocale, NextIntlClientProvider } from 'next-intl';
import { setRequestLocale } from 'next-intl/server';
import type { ReactNode } from 'react';
import { Providers } from '@/components/opendispatch/Providers';
import { coreMessages } from '@/i18n/messages';
import { directionOf, routing } from '@/i18n/routing';

export const metadata: Metadata = {
  title: 'OPENDISPATCH',
};

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  // The browser gets the core messages only, on every page. An Admin module's own text is added by that module's layout
  // (app/[locale]/admin/[module]/layout.tsx), so no page carries another module's strings.
  const messages = coreMessages(locale);
  const dir = directionOf(locale);

  return (
    <html lang={locale} dir={dir} data-theme="light">
      <body>
        <NextIntlClientProvider locale={locale} messages={messages}>
          <Providers locale={locale} dir={dir}>
            {children}
          </Providers>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
