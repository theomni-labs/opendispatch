// SPDX-License-Identifier: AGPL-3.0-only
// Any caller id as one path segment for Go.

const DOT_OR_EMPTY = /^\.{0,2}$/;

/** @pure Go refuses, and audits, a bad id. */
export function pathSegment(id: unknown): string {
  const text = typeof id === 'string' ? id : typeof id === 'number' || typeof id === 'bigint' ? String(id) : '';
  const cut = text.slice(0, 128);
  return DOT_OR_EMPTY.test(cut) ? '-' : encodeURIComponent(cut);
}
