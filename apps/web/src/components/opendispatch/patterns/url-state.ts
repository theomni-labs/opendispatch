// SPDX-License-Identifier: AGPL-3.0-only
// Pure helpers for state in the address bar: no React, no Next, so the server and the tests can use them.
// A screen keeps its tab, search text, filters, sort, page and the open record in search parameters; `useUrlState`
// (the hook) writes them, `parseSearchParams` (search-params.ts) reads them on the server against allow-lists.

/** A change to the query string: a string sets a parameter, null or undefined or '' removes it. */
export type UrlPatch = Readonly<Record<string, string | null | undefined>>;

export interface HrefOptions {
  /**
   * Keep `page` when the patch changes something else. By default a change to anything but `page`, `id` and `new` sends
   * the list back to page 1 (a new filter, a new search or a new sort makes the old page number meaningless).
   */
  readonly keepPage?: boolean | undefined;
}

// Parameters that open or close a drawer or move the page: changing them does not change what the list holds.
const KEEPS_PAGE: ReadonlySet<string> = new Set(['page', 'id', 'new']);

/** `?a=1&b=2` without the question mark. Empty string when there is nothing. Later duplicates of a key are dropped. */
export function normaliseQuery(query: string | URLSearchParams): string {
  const params = new URLSearchParams(typeof query === 'string' ? query.replace(/^\?/, '') : query);
  const seen = new Set<string>();
  const out = new URLSearchParams();
  for (const [key, value] of params) {
    if (seen.has(key)) continue;
    seen.add(key);
    out.set(key, value);
  }
  return out.toString();
}

/** The query string after applying a patch to the current one (no leading `?`). Deterministic order: existing keys first. */
export function patchQuery(current: string | URLSearchParams, patch: UrlPatch, options: HrefOptions = {}): string {
  const params = new URLSearchParams(normaliseQuery(current));
  let touchesList = false;
  for (const [key, value] of Object.entries(patch)) {
    if (!KEEPS_PAGE.has(key)) touchesList = true;
    if (value === null || value === undefined || value === '') params.delete(key);
    else params.set(key, value);
  }
  if (touchesList && options.keepPage !== true && !('page' in patch)) params.delete('page');
  return params.toString();
}

/** `pathname?query`, or `pathname` alone when the query is empty. The pathname has no locale prefix (next-intl adds it). */
export function hrefOf(pathname: string, query: string): string {
  return query === '' ? pathname : `${pathname}?${query}`;
}

/** The same, from the current query and a patch. */
export function buildHref(pathname: string, current: string | URLSearchParams, patch: UrlPatch, options: HrefOptions = {}): string {
  return hrefOf(pathname, patchQuery(current, patch, options));
}
