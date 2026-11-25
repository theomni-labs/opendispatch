'use client';
// SPDX-License-Identifier: AGPL-3.0-only

import { CommandPalette, NotificationsBell, RailShell, type CommandPaletteItem, type NavGroup, type NavItem } from '@opendispatch/ui';
import { Eye } from 'lucide-react';
import { Suspense, useMemo, type ReactNode } from 'react';
import type { Console } from '@/lib/access';
import { ConsoleIcon } from './ConsoleIcon';
import type { DemoOptionsView, DemoSelection } from './DemoControls';
import { AskButton, type AskButtonProps } from '@/components/opendispatch/assistant/AskButton';
import { SignOutButton } from '@/components/opendispatch/SignOutButton';
import { DemoSwitcher } from './DemoSwitcher';
import { LanguageToggle } from './LanguageToggle';
import type { ShellConsole } from './shell-model';
import styles from './ShellFrame.module.css';

// Plain data only: this file is a client component, and what crosses from the server layouts must be serialisable
// (design system docs/client-boundary.md). Hrefs have no locale prefix; the provider's link adds it.

export interface ShellFrameProps {
  brand: { readonly name: string; readonly mark: string };
  /** The console being viewed: named after the wordmark in the top bar. */
  currentConsole: { readonly id: Console; readonly label: string };
  /** Every console the role can open. One entry: no console switch. */
  consoles: readonly ShellConsole[];
  searchItems: readonly CommandPaletteItem[];
  searchLabel: string;
  viewOnlyLabel: string;
  /** The demo role switcher; absent when people sign in for real (then a sign-out button takes its place). */
  demo?: { readonly options: DemoOptionsView; readonly current: DemoSelection } | undefined;
  unreadCount: number;
  /** Where the bell leads: Notifications and Alerts, for the roles that have that module. Without it the bell is inert. */
  notificationsHref: string | undefined;
  user: { readonly label: string; readonly initials: string };
  /** Ask the system; absent: no button. */
  assistant?: { readonly configured: boolean; readonly action: AskButtonProps['action'] } | undefined;
  children: ReactNode;
}

function groupsOf(consoles: readonly ShellConsole[], viewOnlyLabel: string): NavGroup[] {
  return consoles.map((entry) => ({
    id: entry.id,
    label: entry.label,
    icon: <ConsoleIcon console={entry.id} />,
    items: entry.sections.flatMap((section) =>
      section.items.map(
        (item): NavItem => ({
          id: item.id,
          label: item.label,
          href: item.href,
          section: section.label,
          ...(item.viewOnly ? { icon: <Eye />, iconLabel: viewOnlyLabel } : {}),
        }),
      ),
    ),
  }));
}

/**
 * The design system's RailShell with the OpenDispatch parts in its slots: the consoles as rail buttons (the console switch, for
 * roles that see both), the search palette, and at the end of the top bar the Demo pill, the bell, the language toggle and
 * the user's initials, in the order of the mockup. It is a client file because RailShell and CommandPalette take
 * functions and read the provider.
 */
export function ShellFrame({ brand, currentConsole, consoles, searchItems, searchLabel, viewOnlyLabel, demo, unreadCount, notificationsHref, user, assistant, children }: ShellFrameProps) {
  const groups = useMemo(() => groupsOf(consoles, viewOnlyLabel), [consoles, viewOnlyLabel]);

  return (
    // The wrapper only carries the specs' hooks; it draws nothing (display: contents).
    <div className={styles.frame} data-console={currentConsole.id} {...(consoles.length > 1 ? { 'data-console-switch': consoles.map((entry) => entry.id).join(' ') } : {})}>
      <RailShell
        groups={groups}
        brand={{ href: '/', label: brand.name, mark: brand.mark, name: brand.name, context: currentConsole.label }}
        search={<CommandPalette items={searchItems} placeholder={searchLabel} aria-label={searchLabel} />}
        end={
          <>
            {demo === undefined ? <SignOutButton /> : <DemoSwitcher options={demo.options} current={demo.current} />}
            {assistant === undefined ? null : <AskButton action={assistant.action} configured={assistant.configured} />}
            {/* Without a target the bell is a static, non-focusable image (roles without the inbox), not a dead button. */}
            <NotificationsBell unreadCount={unreadCount} {...(notificationsHref === undefined ? {} : { href: notificationsHref })} />
            <Suspense fallback={null}>
              <LanguageToggle />
            </Suspense>
            <span className={styles.avatar} role="img" aria-label={user.label} translate="no">
              {user.initials}
            </span>
          </>
        }
      >
        {children}
      </RailShell>
    </div>
  );
}
