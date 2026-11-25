// SPDX-License-Identifier: AGPL-3.0-only
/** Joins class names, skipping the ones that are off. (CSS Module lookups are `string | undefined` under noUncheckedIndexedAccess.) */
export function cx(...parts: readonly (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}
