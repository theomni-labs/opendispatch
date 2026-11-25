// SPDX-License-Identifier: AGPL-3.0-only
import createMiddleware from 'next-intl/middleware';
import { routing } from './i18n/routing';

// Next 16 renamed middleware to proxy. Redirects "/" and unprefixed paths to a locale.
export default createMiddleware(routing);

export const config = {
  matcher: ['/((?!api|auth|_next|_vercel|.*\\..*).*)'],
};
