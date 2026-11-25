// SPDX-License-Identifier: AGPL-3.0-only
// Pure helpers of the mapping suggestion drawer

import type { MappingSuggestionView } from './types';

export const VERSION_PATTERN = /^[a-z][a-z0-9_]{2,63}$/;

/** @pure generic_csv_v1 -> generic_csv_v2 (first free). */
export function nextVersion(base: string, taken: readonly string[]): string {
  const match = /^(.*_v)(\d+)$/.exec(base);
  const stem = match === null ? `${base}_v` : (match[1] ?? `${base}_v`);
  let n = match === null ? 2 : Number(match[2]) + 1;
  while (taken.includes(`${stem}${n}`)) n += 1;
  return `${stem}${n}`;
}

/** @pure Required fields no file column maps to. */
export function missingRequired(view: MappingSuggestionView, fields: Readonly<Record<string, string>>): string[] {
  const mapped = new Set(Object.values(fields).filter((f) => f !== ''));
  return view.fields.filter((f) => f.required && !mapped.has(f.field)).map((f) => f.field);
}

/** @pure The renames to save: changed columns only. */
export function renamesOf(view: MappingSuggestionView, fields: Readonly<Record<string, string>>): { source_column: string; internal_field: string }[] {
  const usual = new Map(view.fields.map((f) => [f.field, f.column] as const));
  return Object.entries(fields)
    .filter(([source, field]) => field !== '' && usual.get(field) !== source)
    .map(([source, field]) => ({ source_column: source, internal_field: field }));
}
