// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Reads token values from the page, for code that cannot use CSS (a map library's paint properties, a canvas).
 * Only custom property names (`--od-...`) are accepted. Outside a browser every value is an empty string.
 */
export function readTokens<K extends string>(names: readonly K[], root?: Element): Record<K, string> {
  const values = {} as Record<K, string>;
  const target = root ?? (typeof document === 'undefined' ? undefined : document.documentElement);
  const style = target && typeof getComputedStyle === 'function' ? getComputedStyle(target) : undefined;
  for (const name of names) {
    if (!name.startsWith('--')) throw new Error(`readTokens: ${name} is not a custom property`);
    values[name] = style ? style.getPropertyValue(name).trim() : '';
  }
  return values;
}
