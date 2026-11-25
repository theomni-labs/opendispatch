// SPDX-License-Identifier: AGPL-3.0-only

/** The meaning a coloured element carries. Mapped to Ant Design's status colours. */
export type Tone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'info';

/** Category colours for tags and tiles: Ant Design preset colour names. */
export type CategoryColor = 'gray' | 'red' | 'gold' | 'green' | 'magenta' | 'volcano' | 'geekblue';

export const TONES: readonly Tone[] = ['neutral', 'accent', 'success', 'warning', 'danger', 'info'];

export function isTone(value: unknown): value is Tone {
  return typeof value === 'string' && (TONES as readonly string[]).includes(value);
}

/** Maps a status string to a tone, with a fallback for anything not in the map. */
export function createToneResolver(map: Readonly<Record<string, Tone>>, fallback: Tone = 'neutral'): (status: string) => Tone {
  return (status) => (Object.hasOwn(map, status) ? (map[status] ?? fallback) : fallback);
}

/** Joins class names, skipping empty ones. */
export function cx(...names: ReadonlyArray<string | false | null | undefined>): string | undefined {
  const joined = names.filter(Boolean).join(' ');
  return joined === '' ? undefined : joined;
}
