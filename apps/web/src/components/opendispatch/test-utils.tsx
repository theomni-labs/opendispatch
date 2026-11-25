// SPDX-License-Identifier: AGPL-3.0-only
// Shared by the tests of the OpenDispatch components. Not imported by application code.
import { render } from '@testing-library/react';
import { DesignSystemProvider, ToastProvider } from '@opendispatch/ui';
import { NextIntlClientProvider, useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { buildDsLabels } from '@/i18n/ds-labels';
import { mergeMessages, type Messages } from '@/i18n/message-tree';
import { loadMessages } from '@/i18n/messages';

export type TestLocale = 'en' | 'ar';

/** The design system provider the application builds in Providers.tsx, without the router (which needs Next). */
function DesignSystem({ locale, children }: { locale: TestLocale; children: ReactNode }) {
  const t = useTranslations('ds');
  return (
    <DesignSystemProvider locale={locale} dir={locale === 'ar' ? 'rtl' : 'ltr'} labels={buildDsLabels(t)}>
      <ToastProvider>{children}</ToastProvider>
    </DesignSystemProvider>
  );
}

export interface InLocaleOptions {
  /** An Admin module id (`admin.users_roles`): its message files are added to the core messages, as its layout does. */
  module?: string;
  /** Extra messages laid over the rest, for a test that needs a key no message file has yet. */
  messages?: Messages;
}

/**
 * Renders in one language, the way the app does: next-intl messages (the core ones, plus one module's with `module`),
 * the design system provider with its toasts and (in Arabic) a right-to-left page. Returns what `render` returns.
 */
export function inLocale(locale: TestLocale, ui: ReactNode, options: InLocaleOptions = {}) {
  const messages = mergeMessages(loadMessages(locale, options.module), options.messages ?? {});
  // A wrapper, not part of `ui`, so `rerender(<Component />)` keeps the providers.
  const wrapper = ({ children }: { children: ReactNode }) => (
    <NextIntlClientProvider locale={locale} messages={messages}>
      <DesignSystem locale={locale}>
        <div dir={locale === 'ar' ? 'rtl' : 'ltr'} lang={locale}>
          {children}
        </div>
      </DesignSystem>
    </NextIntlClientProvider>
  );
  return render(ui, { wrapper });
}

/** Every string a person or a screen reader can get from the markup: text, aria-label, title attributes, svg titles. */
export function readableText(root: Element): string {
  const parts: string[] = [root.textContent ?? ''];
  for (const element of root.querySelectorAll('[aria-label], [title]')) {
    parts.push(element.getAttribute('aria-label') ?? '', element.getAttribute('title') ?? '');
  }
  return parts.join(' ');
}

/** True when the text has a Latin letter once the given data values (codes, names) are taken out. */
export function hasLatinLetters(text: string, dataValues: readonly string[] = []): boolean {
  let rest = text;
  for (const value of dataValues) rest = rest.split(value).join(' ');
  return /[A-Za-z]/.test(rest);
}

/** True when the text has an Arabic-Indic digit (٠ to ٩ or the extended range). digits are Western. */
export function hasArabicIndicDigits(text: string): boolean {
  return /[٠-٩۰-۹]/.test(text);
}
