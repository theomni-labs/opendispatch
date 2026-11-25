// SPDX-License-Identifier: AGPL-3.0-only
import { hasLocale } from 'next-intl';
import { getRequestConfig } from 'next-intl/server';
import { loadServerMessages } from './messages';
import { routing } from './routing';

// The request config is the same for every route (it reads no header, so it opts no page into dynamic rendering): the
// server gets core plus every module's messages. What the browser gets is decided by the layouts, not here: the root
// layout sends core, a module layout adds its module.
export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = hasLocale(routing.locales, requested) ? requested : routing.defaultLocale;
  return { locale, messages: loadServerMessages(locale) };
});
