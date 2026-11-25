// SPDX-License-Identifier: AGPL-3.0-only
import { createNavigation } from 'next-intl/navigation';
import { routing } from './routing';

const navigation = createNavigation(routing);

export const { Link, usePathname, useRouter, getPathname } = navigation;

// `redirect` never returns. It gets an explicit type annotation so TypeScript narrows after a call:
// `if (ctx === null) redirect(...)` then treats `ctx` as non-null.
export const redirect: typeof navigation.redirect = navigation.redirect;
