// SPDX-License-Identifier: AGPL-3.0-only

import type { Ref } from 'react';

/** Hands a DOM node to a callback ref or an object ref. */
export function assignRef<T>(ref: Ref<T> | undefined, node: T | null): void {
  if (typeof ref === 'function') ref(node);
  else if (ref) (ref as { current: T | null }).current = node;
}

/**
 * Drops the keys whose value is undefined. Ant Design declares optional props without `| undefined`, which
 * exactOptionalPropertyTypes then refuses; spreading the result passes only the props that are set.
 */
export function defined<T extends Record<string, unknown>>(props: T): { [K in keyof T]?: Exclude<T[K], undefined> } {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(props)) if (value !== undefined) out[key] = value;
  return out as { [K in keyof T]?: Exclude<T[K], undefined> };
}

export const ANT_SIZE = { sm: 'small', md: 'middle', lg: 'large' } as const;
