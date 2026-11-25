// SPDX-License-Identifier: AGPL-3.0-only
import { expect, test, type Page } from '@playwright/test';
import { expectPageOk, openRailGroup, railConsoles, railItems, railMenu, signOutViaSwitcher, startDemo, watch } from './helpers';
import { INSTALL_MODES, MODULES, ROLES, expectedMenu, landingOf, locales, menuFor, moduleAccess, pathOf, text, type Console, type InstallMode, type Role } from './routes';

// Roles, menus and install modes. The expected menus
// come from menuFor in the access module, which has its own unit tests against an independent table.

const COOKIE = 'opendispatch_session';

// The menu is the design system's RailShell: one rail button per console the role can open, each with a fly-out that
// lists that console's groups (headings) and modules. The helpers in helpers.ts read the fly-outs from the DOM, open or not.
// The console switch is the pair of rail buttons, marked [data-console-switch] on the shell only when the role sees both.
const consoleSwitch = (page: Page) => page.locator('[data-console-switch]');

test.describe('menus (desktop)', () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'the rail is a drawer on phones (see the phone test below)');
  });

  for (const locale of locales) {
    for (const role of ROLES) {
      test(`the menu of ${role} equals menuFor, in ${locale}`, async ({ page, baseURL }) => {
        const seen = watch(page, baseURL);
        await startDemo(page, locale, role, 'private');

        const consoles = menuFor(role, 'private').map((c) => c.console);
        const landing = landingOf(role, 'private');
        expect(landing).toBeDefined();

        // The rail offers one button per console the role can open, and each fly-out lists exactly that console's menu.
        const first = consoles.find((c) => landing?.startsWith(`/${c}/`)) ?? consoles[0];
        expect(first).toBeDefined();
        await expect(page.locator('[data-console]')).toHaveAttribute('data-console', first as Console);
        await expect(page.locator(`[data-shell-trigger="${first}"]`)).toHaveAttribute('data-active', 'true');
        expect(await railConsoles(page)).toEqual(consoles);
        for (const c of consoles) expect(await railMenu(page, c), `${role}: ${c} menu`).toEqual(expectedMenu(role, 'private', c, locale));

        // The console switch exists only for roles that see both consoles.
        await expect(consoleSwitch(page)).toHaveCount(consoles.length > 1 ? 1 : 0);
        if (consoles.length > 1) await expect(consoleSwitch(page)).toHaveAttribute('data-console-switch', consoles.join(' '));

        // Follow the switch (the other console's rail button, then its first module) and check the other console.
        for (const other of consoles.filter((c) => c !== first)) {
          await openRailGroup(page, other);
          await page.locator(`[data-shell-flyout="${other}"] [data-shell-item]`).first().click();
          await page.waitForURL(new RegExp(`/${locale}/${other}/`));
          await expect(page.locator('[data-console]')).toHaveAttribute('data-console', other);
          expect(await railConsoles(page)).toEqual(consoles);
          expect(await railMenu(page, other), `${role}: ${other} menu`).toEqual(expectedMenu(role, 'private', other, locale));
        }
        await expectPageOk(page, locale);
        seen.expectClean();
      });
    }
  }

  test('the active menu item follows the page', async ({ page }) => {
    await startDemo(page, 'en', 'administrator');
    await openRailGroup(page, 'admin');
    await page.locator('[data-shell-flyout="admin"]').getByRole('link', { name: text('en', 'nav.admin.audit_log.menu') }).click();
    await expect(page).toHaveURL(/\/en\/admin\/audit-log$/);
    // One link in the whole rail is the current page, and its console's rail button is the active one.
    const current = page.locator('[data-shell="rail"] a[aria-current="page"]');
    await expect(current).toHaveCount(1);
    await expect(current).toHaveAttribute('data-shell-item', 'admin.audit_log');
    await expect(current).toContainText(text('en', 'nav.admin.audit_log.menu'));
    await expect(page.locator('[data-shell-trigger="admin"]')).toHaveAttribute('data-active', 'true');
    await expect(page.locator('[data-shell-trigger="ops"]')).toHaveAttribute('data-active', 'false');
  });

  test('switching role in the switcher changes the menu', async ({ page }) => {
    await startDemo(page, 'en', 'planner');
    expect(await railMenu(page, 'ops')).toEqual(expectedMenu('planner', 'private', 'ops', 'en'));

    const panel = page.locator('[data-demo-switcher="panel"]');
    const switchTo = async (role: Role, installMode?: InstallMode) => {
      await page.locator('[data-demo-switcher="trigger"]').click();
      if (installMode !== undefined) await panel.locator(`input[type=radio][value="${installMode}"]`).check();
      await panel.locator(`input[type=radio][value="${role}"]`).check();
      await panel.locator('button[type=submit]').click();
    };

    await switchTo('change_approver');
    await expect(page).toHaveURL(/\/en\/admin\/updates$/);
    expect(await railConsoles(page)).toEqual(['admin']);
    expect(await railMenu(page, 'admin')).toEqual(expectedMenu('change_approver', 'private', 'admin', 'en'));
    await expect(consoleSwitch(page)).toHaveCount(0);

    await switchTo('dispatcher');
    await expect(page).toHaveURL(/\/en\/ops\/live-dispatch-board$/);
    expect(await railConsoles(page)).toEqual(['ops']);
    expect(await railMenu(page, 'ops')).toEqual(expectedMenu('dispatcher', 'private', 'ops', 'en'));

    await switchTo('administrator');
    await expect(page).toHaveURL(/\/en\/admin\/users-roles$/);
    expect(await railConsoles(page)).toEqual(['ops', 'admin']);
    expect(await railMenu(page, 'admin')).toEqual(expectedMenu('administrator', 'private', 'admin', 'en'));
    // The pop-over closes after Apply.
    await expect(panel).toBeHidden();
  });

  test('a switch keeps the chosen zones for zone-scoped roles and drops them for the others', async ({ page }) => {
    await startDemo(page, 'en', 'dispatcher');
    await page.locator('[data-demo-switcher="trigger"]').click();
    const panel = page.locator('[data-demo-switcher="panel"]');
    const zones = panel.locator('input[type=checkbox]');
    expect(await zones.count()).toBeGreaterThan(2);
    // The start page preselects the first two zones; the switcher shows the session's zones.
    await expect(zones.first()).toBeChecked();
    await expect(zones.first()).toBeEnabled();

    await panel.locator('input[type=radio][value="administrator"]').check();
    for (const zone of await zones.all()) {
      await expect(zone).toBeDisabled();
      await expect(zone).not.toBeChecked();
    }
    await panel.locator('input[type=radio][value="remote_team_lead"]').check();
    await expect(zones.first()).toBeDisabled();
    await panel.locator('input[type=radio][value="planner"]').check();
    await expect(zones.first()).toBeEnabled();
  });
});

test.describe('install modes', () => {
  test('private shows 7 roles, dedicated and shared 6 without Change Approver', async ({ page }) => {
    await page.goto('/en');
    const roles = page.locator('input[type=radio][name$="-role"]');
    for (const mode of INSTALL_MODES) {
      await page.locator(`input[type=radio][value="${mode}"]`).check();
      await expect(roles).toHaveCount(mode === 'private' ? 7 : 6);
      await expect(page.locator('input[type=radio][value="change_approver"]')).toHaveCount(mode === 'private' ? 1 : 0);
    }
  });

  test('choosing an install mode the current role does not exist in moves to the first role', async ({ page }) => {
    await page.goto('/en');
    await page.locator('input[type=radio][value="change_approver"]').check();
    await page.locator('input[type=radio][value="shared"]').check();
    await expect(page.locator('input[type=radio][value="administrator"]')).toBeChecked();
  });

  for (const mode of INSTALL_MODES) {
    test(`Administrator in a ${mode} install: Updates is ${mode === 'private' ? 'the full screen' : 'reduced'}`, async ({ page }) => {
      await startDemo(page, 'en', 'administrator', mode);
      await page.goto('/en/admin/updates');
      const updates = page.locator('[data-module="admin.updates"]');
      await expect(updates).toHaveAttribute('data-reduced', mode === 'private' ? 'false' : 'true');
      await expect(updates).toHaveAttribute('data-access', mode === 'private' ? 'edit' : 'view');
      // The menu item is there in every install mode: open the Admin fly-out and see it.
      await openRailGroup(page, 'admin');
      await expect(page.locator('[data-shell-flyout="admin"]').getByRole('link', { name: text('en', 'nav.admin.updates.menu') })).toBeVisible();
      await expect(page.getByText(text('en', 'shell.access.reduced'))).toHaveCount(mode === 'private' ? 0 : 1);
      // The menu is what the access module says for that mode.
      await page.goto('/en/admin/users-roles');
      expect(await railMenu(page, 'admin')).toEqual(expectedMenu('administrator', mode, 'admin', 'en'));
    });
  }

  test('the matrix decides every module page for the Administrator in every install mode', async ({ page }) => {
    for (const mode of INSTALL_MODES) {
      await startDemo(page, 'en', 'administrator', mode);
      for (const def of MODULES.filter((m) => m.console === 'admin')) {
        await page.goto(`/en${pathOf(def)}`);
        const { access, reduced } = moduleAccess('administrator', def.id, mode);
        await expect(page.locator(`[data-module="${def.id}"]`)).toHaveAttribute('data-access', access);
        await expect(page.locator(`[data-module="${def.id}"]`)).toHaveAttribute('data-reduced', String(reduced));
      }
      await page.context().clearCookies();
    }
  });
});

test.describe('access', () => {
  test('no session: any console page leads to the demo start page', async ({ page }) => {
    for (const path of ['/ops/forecast-explorer', '/admin/users-roles', '/ops', '/admin']) {
      await page.goto(`/en${path}`);
      await expect(page).toHaveURL(/\/en$/);
      await expect(page.locator('form button[type=submit]')).toBeVisible();
    }
  });

  test('a tampered or unsigned cookie is no session, never a default role', async ({ page, context, baseURL }) => {
    const url = new URL(baseURL ?? 'http://localhost');
    for (const value of ['garbage', 'a.b', `${Buffer.from('{"role":"administrator"}').toString('base64url')}.AAAA`]) {
      await context.addCookies([{ name: COOKIE, value, domain: url.hostname, path: '/' }]);
      await page.goto('/en/admin/users-roles');
      await expect(page).toHaveURL(/\/en$/);
    }
  });

  test('the cookie is HttpOnly, SameSite=Lax and holds no readable role', async ({ page, context }) => {
    await startDemo(page, 'en', 'planner');
    const cookie = (await context.cookies()).find((c) => c.name === COOKIE);
    expect(cookie).toBeDefined();
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.sameSite).toBe('Lax');
    expect(cookie?.secure).toBe(false);
    expect(await page.evaluate(() => document.cookie)).not.toContain(COOKIE);
  });

  test('a role with no access to a console gets no-access inside the shell, not a redirect', async ({ page }) => {
    await startDemo(page, 'en', 'dispatcher');
    await page.goto('/en/admin/users-roles');
    await expect(page).toHaveURL(/\/en\/admin\/users-roles$/);
    await expect(page.getByText(text('en', 'states.noAccess.title'))).toBeVisible();
    await expect(page.locator('[data-module]')).toHaveCount(0);
    // The rail always shows the role's own menu: the Ops button is there next to the no-access panel, and nothing of Admin.
    await expect(page.locator('[data-shell-trigger="ops"]')).toBeVisible();
    expect(await railConsoles(page)).toEqual(['ops']);
    await expect(railItems(page)).toHaveCount(expectedMenu('dispatcher', 'private', 'ops', 'en').flatMap((group) => group.items).length);
    await expect(page.locator('[data-shell="rail"] [data-shell-group="admin"]')).toHaveCount(0);
    await expect(page.locator('[data-shell="rail"] [data-shell-item^="admin."]')).toHaveCount(0);
    // /admin itself does not loop either.
    await page.goto('/en/admin');
    await expect(page).toHaveURL(/\/en\/admin$/);
    await expect(page.getByText(text('en', 'states.noAccess.title'))).toBeVisible();
    // The way out: home, the role's own landing page.
    await page.getByRole('link', { name: text('en', 'common.goHome') }).click();
    await expect(page).toHaveURL(/\/en\/ops\/live-dispatch-board$/);
  });

  test('a module the role cannot see is the no-access state, in the console it can', async ({ page }) => {
    await startDemo(page, 'en', 'dispatch_supervisor');
    await page.goto('/en/admin/users-roles');
    await expect(page.locator('[data-module="admin.users_roles"]')).toHaveAttribute('data-state', 'noaccess');
    await expect(page.getByText(text('en', 'states.noAccess.title'))).toBeVisible();
    // And ?state= cannot open what the matrix closes.
    await page.goto('/en/admin/users-roles?state=empty');
    await expect(page.locator('[data-module="admin.users_roles"]')).toHaveAttribute('data-state', 'noaccess');
    // The one Admin module the Supervisor has.
    await page.goto('/en/admin/classification-rules');
    // A real screen: the Supervisor reads the rules (view only).
    await expect(page.locator('[data-module="admin.classification_rules"]')).toHaveAttribute('data-state', 'filled');
    await expect(page.locator('[data-module="admin.classification_rules"]')).toHaveAttribute('data-access', 'view');
  });

  test('Change Approver has no Ops Console', async ({ page }) => {
    await startDemo(page, 'en', 'change_approver');
    await page.goto('/en/ops/forecast-explorer');
    await expect(page.getByText(text('en', 'states.noAccess.title'))).toBeVisible();
    await expect(page.locator('[data-module]')).toHaveCount(0);
  });

  test('an unknown module is a 404 inside the console', async ({ page }) => {
    await startDemo(page, 'en', 'administrator');
    const response = await page.goto('/en/ops/no-such-module');
    expect(response?.status()).toBe(404);
    await expect(page.getByText(text('en', 'states.notFound.title'))).toBeVisible();
    await expect(page.locator('[data-shell="rail"]')).toBeVisible();
    // A module id of the other console is not a module here.
    await page.goto('/en/ops/users-roles');
    await expect(page.getByText(text('en', 'states.notFound.title'))).toBeVisible();
  });

  // signing out lands on the Signed out page. The action records `auth.sign_out` first (sign-in.spec.ts reads it in the
  // Audit Log), then clears the SESSION cookie only: the install mode cookie stays, the sign-in pages need it.
  test('Sign out clears the session, keeps the install mode and lands on the Signed out page', async ({ page, context }) => {
    await startDemo(page, 'en', 'planner', 'dedicated');
    expect((await context.cookies()).find((c) => c.name === 'opendispatch_demo_mode')).toBeDefined();
    await signOutViaSwitcher(page, 'en');
    await expect(page).toHaveURL(/\/en\/signed-out$/);
    expect((await context.cookies()).find((c) => c.name === COOKIE)).toBeUndefined();
    expect((await context.cookies()).find((c) => c.name === 'opendispatch_demo_mode')).toBeDefined();
    await page.goto('/en/ops/field-planner');
    await expect(page).toHaveURL(/\/en$/);
  });

  // /ops and /admin lead to the role's landing module when it is in that console, else to the first module of its menu there.
  test('the console roots lead into the console, and to no-access where the role has nothing', async ({ page }) => {
    for (const role of ROLES) {
      await startDemo(page, 'en', role);
      const landing = landingOf(role, 'private');
      for (const console of ['ops', 'admin'] as const) {
        const menu = menuFor(role, 'private').find((c) => c.console === console);
        await page.goto(`/en/${console}`);
        if (menu === undefined) {
          await expect(page, `${role} has no ${console}`).toHaveURL(new RegExp(`/en/${console}$`));
          await expect(page.getByText(text('en', 'states.noAccess.title'))).toBeVisible();
          continue;
        }
        const first = menu.groups[0]?.items[0];
        const expected = landing?.startsWith(`/${console}/`) ? landing : first === undefined ? undefined : pathOf(first);
        await expect(page, `${role} at /${console}`).toHaveURL(new RegExp(`/en${expected}$`));
      }
      await page.context().clearCookies();
    }
  });

  test('a signed-in person opening the start page goes to their landing page', async ({ page }) => {
    await startDemo(page, 'en', 'remote_team_lead');
    await page.goto('/en');
    await expect(page).toHaveURL(/\/en\/ops\/remote-queue$/);
  });
});

test.describe('language', () => {
  for (const [from, to] of [['en', 'ar'], ['ar', 'en']] as const) {
    test(`the toggle goes ${from} to ${to} and keeps the path and the query`, async ({ page }) => {
      await startDemo(page, from, 'planner');
      await page.goto(`/${from}/ops/field-planner?state=error`);
      await page.locator('[data-language-toggle]').getByRole('link', { name: text(from, `language.${to}`) }).click();
      await expect(page).toHaveURL(new RegExp(`/${to}/ops/field-planner\\?state=error$`));
      await expectPageOk(page, to);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(text(to, 'nav.ops.field_planner.title'));
    });
  }

  test('the start page has the toggle too, and the role names follow the language', async ({ page }) => {
    await page.goto('/en');
    await page.locator('[data-language-toggle]').getByRole('link', { name: text('en', 'language.ar') }).click();
    await expect(page).toHaveURL(/\/ar$/);
    await expectPageOk(page, 'ar');
    await expect(page.getByText(text('ar', 'roles.planner'), { exact: true })).toBeVisible();
  });

  // English left over in an Arabic page is a bug: every string the shell draws itself (the design system's RailShell,
  // NavDrawer, CommandPalette and bell labels included) must come from the messages.
  test('Arabic pages have no English text or labels left', async ({ page }) => {
    await startDemo(page, 'ar', 'administrator');
    const ALLOWED = new Set(['OPENDISPATCH', 'EN', 'AR', 'English']);
    for (const path of ['/admin/users-roles', '/ops/live-dispatch-board', '/admin/updates?state=error', '/admin/updates?state=loading']) {
      await page.goto(`/ar${path}`);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      const strings = await page.evaluate(() => {
        // The text a person can read, without the parts that are data and stay English on purpose (translate="no", lang="en").
        const clone = document.body.cloneNode(true) as HTMLElement;
        const dataWords = new Set<string>();
        for (const node of clone.querySelectorAll('[translate="no"],[lang="en"]')) {
          for (const word of node.textContent?.match(/[A-Za-z][A-Za-z'-]{2,}/g) ?? []) dataWords.add(word);
          node.remove();
        }
        for (const node of clone.querySelectorAll('script,style,noscript,#__next-route-announcer__')) node.remove();
        const out: string[] = [clone.textContent ?? ''];
        // An accessible name may carry a person's name ("Select row Nadia Al-Ghalani"): a word that is data on this page is fine.
        for (const el of document.querySelectorAll('[aria-label],[placeholder],[title]')) {
          if (el.closest('[translate="no"],[lang="en"]')) continue;
          for (const attr of ['aria-label', 'placeholder', 'title']) {
            const value = el.getAttribute(attr);
            if (value) out.push(value.replace(/[A-Za-z][A-Za-z'-]{2,}/g, (word) => (dataWords.has(word) ? '' : word)));
          }
        }
        return out;
      });
      const latin = strings.join(' ').match(/[A-Za-z][A-Za-z'-]{2,}/g)?.filter((word) => !ALLOWED.has(word)) ?? [];
      expect(latin, `English words on /ar${path}`).toEqual([]);
    }
  });
});

test.describe('search', () => {
  test('the search box goes to the module it names', async ({ page }) => {
    await startDemo(page, 'en', 'administrator');
    // An input with a list (the module suggestions) is a combobox to the accessibility tree, not a searchbox.
    const search = page.getByRole('search').getByRole('combobox');
    await search.fill('audit');
    // Enter goes to the highlighted result: the first module the text names.
    await expect(page.getByRole('option').first()).toBeVisible();
    await search.press('Enter');
    await expect(page).toHaveURL(/\/en\/admin\/audit-log$/);
    await search.fill('zzz nothing');
    await expect(page.getByRole('option')).toHaveCount(0);
    await search.press('Enter');
    await expect(page).toHaveURL(/\/en\/admin\/audit-log$/);
  });
});

