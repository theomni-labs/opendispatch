// SPDX-License-Identifier: AGPL-3.0-only
// The text of a module's page states. A module may write its own line for each in its message file
// (`admin.<module>.states.empty.title`, `.empty.desc`, `.error.title`, `.error.desc`: "Users could not load."); with none,
// the generic core line (`states.*`) is used, so a module with an empty message file still shows sensible states.
// Pure: it takes the translate function `useTranslations()` returns, so it works in a Server and a Client Component.

import type { ModuleId } from '@/lib/access';

/** What `useTranslations()` returns, as far as this file needs it. */
export interface Translate {
  (key: string): string;
  has(key: string): boolean;
}

export type StateName = 'empty' | 'error';
export type StatePart = 'title' | 'desc';

/** The module's own text, else the core text, else nothing (the core has no `states.empty.desc`). */
export function stateText(t: Translate, moduleId: ModuleId | undefined, state: StateName, part: StatePart): string | undefined {
  const own = moduleId === undefined ? undefined : `${moduleId}.states.${state}.${part}`;
  if (own !== undefined && t.has(own)) return t(own);
  const core = `states.${state}.${part}`;
  return t.has(core) ? t(core) : undefined;
}
