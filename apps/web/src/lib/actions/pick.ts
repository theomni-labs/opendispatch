// SPDX-License-Identifier: AGPL-3.0-only
// What a server action lets through from the browser: only the fields it names, copied into a fresh object. An action's
// argument is typed for the compiler but arrives as anything (a crafted POST can send `null`, an array, extra keys), and
// the data layer's bodies are closed objects that refuse unknown keys, so an action picks what it forwards.
// Pure: no server import, usable in a test.

const hasOwn = (value: object, key: string): boolean => Object.prototype.hasOwnProperty.call(value, key);

/**
 * The listed keys of `input`, when it is a plain object and has them (own properties only; `__proto__` and friends are
 * never copied). Anything else gives `{}`, and the data layer answers `invalid` for the missing fields. Values are not
 * checked here: the data function validates them.
 */
export function pickFields<K extends string>(input: unknown, keys: readonly K[]): Partial<Record<K, unknown>> {
  const out: Partial<Record<K, unknown>> = {};
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return out;
  for (const key of keys) {
    // `out['__proto__'] = x` would replace the prototype of `out`; such a key is never a field an action names.
    if (key === '__proto__' || !hasOwn(input, key)) continue;
    Object.defineProperty(out, key, { value: (input as Readonly<Record<string, unknown>>)[key], enumerable: true, writable: true, configurable: true });
  }
  return out;
}

/** A single field of `input` (an id, a note) when it is a string, else undefined. */
export function pickText(input: unknown, key: string): string | undefined {
  const value = pickFields(input, [key])[key];
  return typeof value === 'string' ? value : undefined;
}

/** A list of strings from `input[key]`: every item a string, at most `max` items; otherwise undefined. */
export function pickTextList(input: unknown, key: string, max = 100): string[] | undefined {
  const value = pickFields(input, [key])[key];
  if (!Array.isArray(value) || value.length > max || !value.every((item) => typeof item === 'string')) return undefined;
  return [...(value as string[])];
}
