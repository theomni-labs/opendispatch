// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, vi } from 'vitest';
import { INSTALL_MODES, moduleAccess, rolesForInstallMode, type InstallMode, type Role } from '@/lib/access';
import type { RequestContext } from '@/lib/data/guard';
import ar from '../../../messages/ar.json';
import en from '../../../messages/en.json';
import { ConsoleShell } from './ConsoleShell';
import type { ShellFrameProps } from './ShellFrame';
import type { Translate } from './shell-model';

// The server decision in ConsoleShell: only a role that has Notifications and Alerts gets the bell's count and link. The
// others get 0 and no link, whatever the data layer counts for them (review: this decision had no test, and a
// version that always passed the count survived every other test in this folder).
//
// ConsoleShell is an async Server Component. Called as a function it returns the ShellFrame element with its props, so the
// test reads what the server hands to the client shell without rendering it. Only the framework, the client shell and the
// data layer are replaced: the access model, the menu and the routes are the real ones.

type Tree = { [key: string]: string | Tree };
const translator =
  (messages: Tree): Translate =>
  (key) => {
    let node: string | Tree | undefined = messages;
    for (const part of key.split('.')) node = typeof node === 'object' ? node[part] : undefined;
    if (typeof node !== 'string') throw new Error(`No message ${key}`);
    return node;
  };

vi.mock('next-intl/server', () => ({
  getLocale: async () => auth.locale,
  getTranslations: async (options?: { locale?: string }) => translator((options?.locale === 'ar' ? ar : en) as Tree),
}));

// The client shell is not rendered: the element ConsoleShell returns already carries the props the server decided on.
vi.mock('./ShellFrame', () => ({ ShellFrame: () => null }));

// The count is 3 for everyone: a role with no inbox must still show 0.
const UNREAD = 3;
vi.mock('@/lib/data/notifications', () => ({ countUnreadNotifications: () => 3 }));
const auth = vi.hoisted(() => ({ oidc: false, optionsCalls: 0, locale: 'en' }));
vi.mock('@/lib/data/context', () => ({
  getDemoOptions: () => {
    auth.optionsCalls += 1;
    return { customerName: 'Example Response (synthetic)', customerNameAr: 'مثال للاستجابة (بيانات اصطناعية)', zones: [], rolesByInstallMode: {} };
  },
  demoCustomerName: (o: { customerName: string; customerNameAr: string }, locale: string) => (locale === 'ar' ? o.customerNameAr : o.customerName),
  isOidcMode: () => auth.oidc,
}));

const contextFor = (role: Role, installMode: InstallMode): RequestContext => ({
  customerId: 'customer-1',
  userId: 'user-1',
  role,
  zoneScope: { kind: 'whole_install' },
  installMode,
});

async function bellProps(role: Role, installMode: InstallMode): Promise<Pick<ShellFrameProps, 'unreadCount' | 'notificationsHref'>> {
  const element = await ConsoleShell({ console: 'ops', ctx: contextFor(role, installMode), children: null });
  const props = element.props as ShellFrameProps;
  return { unreadCount: props.unreadCount, notificationsHref: props.notificationsHref };
}

const CASES = INSTALL_MODES.flatMap((mode) => rolesForInstallMode(mode).map((role) => ({ mode, role })));
const hasInbox = (role: Role, mode: InstallMode): boolean => moduleAccess(role, 'admin.notifications_alerts', mode).access !== 'none';

describe('ConsoleShell: the bell', () => {
  it('gives the Administrator the count and the link to Notifications and Alerts', async () => {
    for (const mode of INSTALL_MODES) {
      if (!rolesForInstallMode(mode).includes('administrator')) continue;
      expect(await bellProps('administrator', mode), mode).toEqual({ unreadCount: UNREAD, notificationsHref: '/admin/notifications-alerts' });
    }
  });

  it('gives a role without the notifications module a count of 0 and no link', async () => {
    for (const role of ['dispatcher', 'planner', 'remote_team_lead'] as const) {
      expect(await bellProps(role, 'private'), role).toEqual({ unreadCount: 0, notificationsHref: undefined });
    }
  });

  it.each(CASES)('gives $role in a $mode install the count exactly when the access model gives it the module', async ({ mode, role }) => {
    const bell = await bellProps(role, mode);
    expect(bell.unreadCount).toBe(hasInbox(role, mode) ? UNREAD : 0);
    expect(bell.notificationsHref).toBe(hasInbox(role, mode) ? '/admin/notifications-alerts' : undefined);
  });

  it('covers both outcomes, so the cases above cannot all be the same', () => {
    expect(CASES.some(({ role, mode }) => hasInbox(role, mode))).toBe(true);
    expect(CASES.some(({ role, mode }) => !hasInbox(role, mode))).toBe(true);
  });
});

describe('ConsoleShell: demo switcher data', () => {
  async function shellIn(oidc: boolean): Promise<ShellFrameProps> {
    auth.oidc = oidc;
    auth.optionsCalls = 0;
    try {
      const element = await ConsoleShell({ console: 'ops', ctx: contextFor('planner', 'private'), children: null });
      return element.props as ShellFrameProps;
    } finally {
      auth.oidc = false;
    }
  }

  it('reads the demo options in demo mode and hands the switcher its data', async () => {
    const props = await shellIn(false);
    expect(auth.optionsCalls).toBe(1);
    expect(props.demo?.current).toEqual({ installMode: 'private', role: 'planner', zoneIds: [] });
    expect(props.demo?.options.customerName).toBe('Example Response (synthetic)');
  });

  it('names the customer in Arabic on Arabic pages', async () => {
    auth.locale = 'ar';
    try {
      expect((await shellIn(false)).demo?.options.customerName).toBe('مثال للاستجابة (بيانات اصطناعية)');
    } finally {
      auth.locale = 'en';
    }
  });

  it('never reads the demo options (fixtures) in OIDC sign-in mode', async () => {
    const props = await shellIn(true);
    expect(auth.optionsCalls).toBe(0);
    expect(props.demo).toBeUndefined();
  });
});
