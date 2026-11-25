// SPDX-License-Identifier: AGPL-3.0-only
import { getLocale, getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { moduleHref } from '@/i18n/module-routes';
import { routing } from '@/i18n/routing';
import { askQuestion } from '@/components/opendispatch/assistant/actions';
import { assistantAvailability } from '@/components/opendispatch/assistant/availability';
import { getModule, moduleAccess, type Console } from '@/lib/access';
import { demoCustomerName, getDemoOptions, isOidcMode } from '@/lib/data/context';
import type { RequestContext } from '@/lib/data/guard';
import { countUnreadNotifications } from '@/lib/data/notifications';
import { ShellFrame, type ShellFrameProps } from './ShellFrame';
import { shellConsoles, shellSearchItems } from './shell-model';

/**
 * The shell shared by the Ops and Admin consoles, on the design system's RailShell. The menu is `menuFor(role,
 * installMode)` from the access module (one source: every console the role can open is a rail button with a
 * fly-out (the console switch), and its groups are the headings of that fly-out. A role that sees one console has one
 * rail button and no switch. A role with no access to the console being viewed still gets its own menu; the page then
 * shows the no-access state, never another role's menu.
 *
 * Everything the client shell needs is computed here, on the server, from the request context and handed over as
 * plain data: nothing comes from the browser.
 *
 * Stable hooks for the specs (the design system's own, then ours):
 *   [data-shell="rail"]                        the rail (hidden below 1024px, where the drawer replaces it)
 *   [data-shell-group="ops" | "admin"]         one per console the role can open; its button is [data-shell-trigger]
 *   [data-shell-item="ops.forecast_explorer"]  one link per module (fly-out and drawer); aria-current="page" when active
 *   [data-shell="search"]                      the palette; its input is a combobox, its results are options
 *   [data-shell="bell"]                        the bell; [data-shell="bell-count"] its badge (Administrator only)
 *   [data-console="ops" | "admin"]             the console being viewed
 *   [data-console-switch="ops admin"]          present only when the role sees both consoles
 *   [data-demo-switcher="trigger" | "panel"]   the Demo pill, and the form inside its pop-over
 *   [data-language-toggle]                     the EN / AR pair
 */
// Demo switcher data from Go; demo mode only.
async function demoProps(ctx: RequestContext, locale: string): Promise<ShellFrameProps['demo']> {
  const options = await getDemoOptions();
  return {
    options: { customerName: demoCustomerName(options, locale), zones: options.zones, rolesByInstallMode: options.rolesByInstallMode },
    current: { installMode: ctx.installMode, role: ctx.role, zoneIds: ctx.zoneScope.kind === 'assigned_zones' ? ctx.zoneScope.zoneIds : [] },
  };
}

export async function ConsoleShell({ console: consoleId, ctx, children }: { console: Console; ctx: RequestContext; children: ReactNode }) {
  const [locale, t] = await Promise.all([getLocale(), getTranslations()]);
  const oidc = isOidcMode();
  const unreadCount = await countUnreadNotifications(ctx);
  // Ask the system: Ops only, roles with Ops reads
  const assistant = consoleId === 'ops' ? await assistantAvailability(ctx) : null;

  // The other languages' texts go to the search as keywords, so a module is found by its name in either language.
  const others = await Promise.all(routing.locales.filter((code) => code !== locale).map((code) => getTranslations({ locale: code })));
  const consoles = shellConsoles(ctx.role, ctx.installMode, t);
  const searchItems = shellSearchItems(ctx.role, ctx.installMode, t, others);

  // The bell opens Notifications and Alerts for the roles that have it (the Administrator). The others have no inbox page
  // , so for them the bell is inert and shows no count.
  const notifications = getModule('admin.notifications_alerts');
  const hasInbox = moduleAccess(ctx.role, notifications.id, ctx.installMode).access !== 'none';

  // assumption: the data layer offers no accessor for the signed-in person's display name (the fixtures name them in
  // English only), so the user block reads "Demo user". Swap in the name here when there is one.
  const brandName = t('shell.brand');

  return (
    <ShellFrame
      brand={{ name: brandName, mark: Array.from(brandName).slice(0, 2).join('') }}
      currentConsole={{ id: consoleId, label: t(`shell.console.${consoleId}`) }}
      consoles={consoles}
      searchItems={searchItems}
      searchLabel={t('shell.search')}
      viewOnlyLabel={t('shell.access.view')}
      demo={oidc ? undefined : await demoProps(ctx, locale)}
      unreadCount={hasInbox ? unreadCount : 0}
      notificationsHref={hasInbox ? moduleHref(notifications) : undefined}
      user={{ label: t('demo.user'), initials: t('demo.userInitials') }}
      assistant={assistant !== null && assistant.ask ? { configured: assistant.configured, action: askQuestion } : undefined}
    >
      {children}
    </ShellFrame>
  );
}
