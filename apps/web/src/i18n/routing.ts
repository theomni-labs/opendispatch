// SPDX-License-Identifier: AGPL-3.0-only
import { defineRouting } from 'next-intl/routing';

export const locales = ['en', 'ar'] as const;
export type Locale = (typeof locales)[number];

export const routing = defineRouting({
  locales,
  defaultLocale: 'en',
  localePrefix: 'always',
});

export const directionOf = (locale: string): 'ltr' | 'rtl' => (locale === 'ar' ? 'rtl' : 'ltr');
