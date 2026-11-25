// SPDX-License-Identifier: AGPL-3.0-only
// What the shell shows, computed from the access model. Pure: no framework and no I/O, so a test can check it against
// `menuFor` for every role and install mode (the guarantee the e2e specs also make in the browser). The server component
// ConsoleShell calls these with the message function of the request's language and hands the result to the client shell
// as plain data.

import type { CommandPaletteItem } from '@opendispatch/ui';
import { moduleHref } from '@/i18n/module-routes';
import { menuFor, moduleAccess, type Console, type InstallMode, type Role } from '@/lib/access';

/** A message function for one language: `t('nav.ops.forecast_explorer.menu')`. */
export type Translate = (key: string) => string;

export interface ShellItem {
  readonly id: string;
  readonly label: string;
  /** '/ops/forecast-explorer': no locale prefix, the provider's link adds it. */
  readonly href: string;
  /** The role can read the module but not change it: the fly-out shows the "view only" marker. */
  readonly viewOnly: boolean;
}

/** A run of items under one heading in the fly-out (a group of the console: Live, Plan, Analyze). */
export interface ShellSection {
  readonly id: string;
  readonly label: string;
  readonly items: readonly ShellItem[];
}

/** One rail button and its fly-out. */
export interface ShellConsole {
  readonly id: Console;
  readonly label: string;
  readonly sections: readonly ShellSection[];
}

/** Every console the role can open, in the order of `menuFor`: Ops, then Admin. A role with no access gets none. */
export function shellConsoles(role: Role, installMode: InstallMode, t: Translate): ShellConsole[] {
  return menuFor(role, installMode).map((entry) => ({
    id: entry.console,
    label: t(`shell.console.${entry.console}`),
    sections: entry.groups.map((group) => ({
      id: group.group,
      label: t(group.groupKey),
      items: group.items.map((m) => ({
        id: m.id,
        label: t(m.menuKey),
        href: moduleHref(m),
        viewOnly: moduleAccess(role, m.id, installMode).access === 'view',
      })),
    })),
  }));
}

/**
 * The palette's items: the modules the role can open, labelled by title, with the console as secondary text. The texts of
 * the other languages (and the menu label) are `keywords`: matched, never shown, so an Arabic reader can type the English
 * name and the other way round.
 */
export function shellSearchItems(role: Role, installMode: InstallMode, t: Translate, others: readonly Translate[]): CommandPaletteItem[] {
  return menuFor(role, installMode).flatMap((entry) =>
    entry.groups.flatMap((group) =>
      group.items.map((m) => ({
        id: m.id,
        label: t(m.titleKey),
        meta: t(`shell.console.${entry.console}`),
        href: moduleHref(m),
        keywords: [t(m.menuKey), ...others.flatMap((other) => [other(m.titleKey), other(m.menuKey)])].join(' | '),
      })),
    ),
  );
}
