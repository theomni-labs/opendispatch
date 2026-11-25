'use client';
// SPDX-License-Identifier: AGPL-3.0-only

import { useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useTransition } from 'react';
import { usePathname, useRouter } from '@/i18n/navigation';
import { buildHref, type HrefOptions, type UrlPatch } from './url-state';

// The client half of state in the address bar. A list keeps its tab, search, filters, sort, page and the
// open record in search parameters, so a link, a refresh and Back all mean the same thing:
//
//   const url = useUrlState();
//   url.get('tab');                                    // the current value, or undefined
//   url.update({ role: 'planner', q: null });          // sets one, removes one; the list goes back to page 1
//   url.update({ id: userId }, { history: 'push' });   // a drawer opens: Back closes it
//   url.hrefFor({ id: userId });                       // a link to the same page with `id` set
//
// `update` navigates with `router.replace` (or `push`) inside a transition, so typing in a search box keeps its focus
// and `pending` says the server is answering. The server validates every value again (parseSearchParams). Values here
// are strings the person chose; nothing in them says who is asking.

export interface UrlUpdateOptions extends HrefOptions {
  /** `replace` (default) rewrites the current entry; `push` adds one, so the Back button undoes it. */
  readonly history?: 'replace' | 'push' | undefined;
}

export interface UrlState {
  /** The path without the locale, as the next-intl router expects it. */
  readonly pathname: string;
  readonly get: (key: string) => string | undefined;
  readonly update: (patch: UrlPatch, options?: UrlUpdateOptions) => void;
  /** The href that `update` would go to, for a link or a table row. */
  readonly hrefFor: (patch: UrlPatch, options?: HrefOptions) => string;
  /** True while the server is rendering the page for the last update. */
  readonly pending: boolean;
}

export function useUrlState(): UrlState {
  const pathname = usePathname();
  const router = useRouter();
  const search = useSearchParams();
  const [pending, startTransition] = useTransition();
  const current = search.toString();

  // Updates made in quick succession (a chip, then the search box) each build on the one before, not on the address that
  // has not been committed yet. The ref follows the real address whenever it changes.
  const latest = useRef(current);
  useEffect(() => {
    latest.current = current;
  }, [current]);

  const get = useCallback((key: string) => search.get(key) ?? undefined, [search]);

  const update = useCallback(
    (patch: UrlPatch, options: UrlUpdateOptions = {}) => {
      const href = buildHref(pathname, latest.current, patch, options);
      const queryStart = href.indexOf('?');
      latest.current = queryStart === -1 ? '' : href.slice(queryStart + 1);
      startTransition(() => {
        if (options.history === 'push') router.push(href);
        else router.replace(href, { scroll: false });
      });
    },
    [pathname, router],
  );

  const hrefFor = useCallback((patch: UrlPatch, options: HrefOptions = {}) => buildHref(pathname, current, patch, options), [pathname, current]);

  return { pathname, get, update, hrefFor, pending };
}
