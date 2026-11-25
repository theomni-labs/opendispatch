// SPDX-License-Identifier: AGPL-3.0-only
// The four page states a module page can show. `?state=` picks one, so each can be reviewed and
// screenshotted. A placeholder page (a module with no screen yet) is empty with no parameter; a real screen shows its
// data with no parameter. The filled state is never a parameter: it is what a page shows when nothing says otherwise.

export const MODULE_STATES = ['empty', 'loading', 'error', 'noaccess'] as const;
export type ModuleState = (typeof MODULE_STATES)[number];

/** What `data-state` on the page root says: one of the four above, or `filled` for real content. */
export type ScreenState = 'filled' | ModuleState;

const firstValue = (value: string | readonly string[] | undefined) => (typeof value === 'string' ? value : value?.[0]);

/** For a placeholder page: the parameter's state, or `empty` for nothing or anything unknown. */
export function parseModuleState(value: string | readonly string[] | undefined): ModuleState {
  const first = firstValue(value);
  return (MODULE_STATES as readonly (string | undefined)[]).includes(first) ? (first as ModuleState) : 'empty';
}

/**
 * PHASE A DEMO TOOLING: the state a person asked to review with
 * `?state=`, or undefined for the real content. Decided on the server, from the URL, and never able to open what the
 * access model closes (the page shows no access first). `empty` cannot be reached from the fixtures any other way, so a
 * real screen needs this hook to be reviewable in every state. in oidc mode this function returns undefined.
 */
export function parseReviewState(value: string | readonly string[] | undefined): ModuleState | undefined {
  const first = firstValue(value);
  return (MODULE_STATES as readonly (string | undefined)[]).includes(first) ? (first as ModuleState) : undefined;
}
