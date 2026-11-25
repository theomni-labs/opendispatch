// SPDX-License-Identifier: AGPL-3.0-only
// Routes and roles the e2e specs use. The module list and the menus come from the access module (one source;
// the URL slug rule is written out again here on purpose, so the route table is checked and not just reused.
import path from 'node:path';
import { INSTALL_MODES, MODULES, ROLES, defaultLanding, menuFor, moduleAccess, type Console, type InstallMode, type ModuleDef, type Role } from '../apps/web/src/lib/access';
import { readMessages } from './messages';

export const locales = ['en', 'ar'] as const;
export type Locale = (typeof locales)[number];

export { INSTALL_MODES, MODULES, ROLES, defaultLanding, menuFor, moduleAccess };
export type { Console, InstallMode, ModuleDef, Role };

/** '/ops/live-dispatch-board': the module id after the console prefix, underscores turned into hyphens. */
export const pathOf = (m: Pick<ModuleDef, 'id' | 'console'>): string => `/${m.console}/${m.id.slice(m.id.indexOf('.') + 1).replaceAll('_', '-')}`;

/** Pages that need no session. The sign-in pages are here too; their states are in sign-in.spec.ts. */
export const publicRoutes: ReadonlyArray<{ name: string; path: string }> = [
  { name: 'demo-start', path: '' },
  { name: 'sign-in', path: '/sign-in' },
  { name: 'sign-in-emergency', path: '/sign-in/emergency' },
  { name: 'sign-in-refused', path: '/sign-in/message/refused' },
  { name: 'sign-in-no-role', path: '/sign-in/message/no-role' },
  { name: 'sign-in-error', path: '/sign-in/message/error?ref=ODP-9B41C7E0' },
  { name: 'signed-out', path: '/signed-out' },
];

/** The four placeholder states, reviewed on one module (?state=). */
export const STATES = ['empty', 'loading', 'error', 'noaccess'] as const;

// --- messages, read from the files so the specs assert what a person reads -----------------------------------------
type Tree = { [key: string]: string | Tree };
const messages = (locale: Locale): Tree => readMessages(path.join(import.meta.dirname, '../apps/web/messages', `${locale}.json`)) as Tree;
const MESSAGES = { en: messages('en'), ar: messages('ar') };

export function text(locale: Locale, key: string): string {
  let node: string | Tree | undefined = MESSAGES[locale];
  for (const part of key.split('.')) node = typeof node === 'object' ? node[part] : undefined;
  if (typeof node !== 'string') throw new Error(`No message ${locale}:${key}`);
  return node;
}

/** 'nav.ops.forecast_explorer.title' for module id 'ops.forecast_explorer'. */
export const titleOf = (locale: Locale, id: string) => text(locale, `nav.${id}.title`);
export const menuLabelOf = (locale: Locale, id: string) => text(locale, `nav.${id}.menu`);

/** What a role's sidebar shows in one console: groups with their items, from menuFor. */
export function expectedMenu(role: Role, installMode: InstallMode, console: Console, locale: Locale) {
  const groups = menuFor(role, installMode).find((c) => c.console === console)?.groups ?? [];
  return groups.map((g) => ({ label: text(locale, g.groupKey), items: g.items.map((m) => ({ label: menuLabelOf(locale, m.id), href: `/${locale}${pathOf(m)}` })) }));
}

/** The role's landing page as a path without locale, or undefined. */
export function landingOf(role: Role, installMode: InstallMode): string | undefined {
  const landing = defaultLanding(role, installMode);
  const def = landing === null ? undefined : MODULES.find((m) => m.id === landing.moduleId);
  return def === undefined ? undefined : pathOf(def);
}
