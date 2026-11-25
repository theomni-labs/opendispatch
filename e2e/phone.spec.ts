// SPDX-License-Identifier: AGPL-3.0-only
import { expect, test, type Page } from '@playwright/test';
import { expectPageOk, shot, startDemo } from './helpers';
import { expectedMenu, locales, menuFor, text, type Locale, type Role } from './routes';

// Phone widths (390px): the rail is a navigation drawer below 1024px, opened from the top bar's menu button. The drawer is
// the design system's NavDrawer: a dialog named after the wordmark, one section per console, a close button.

/** Every module label the role's menu lists, console after console, as the drawer must show them. */
const drawerLabels = (role: Role, locale: Locale) =>
  menuFor(role, 'private').flatMap(({ console: consoleId }) => expectedMenu(role, 'private', consoleId, locale).flatMap((group) => group.items.map((item) => item.label)));

const menuButton = (page: Page, locale: Locale) => page.getByRole('button', { name: text(locale, 'ds.railShell.menuOpen') });
const drawerOf = (page: Page, locale: Locale) => page.getByRole('dialog', { name: text(locale, 'shell.brand') });

test.describe('navigation drawer', () => {
  for (const locale of locales) {
    test(`the menu button opens the navigation drawer in ${locale}`, async ({ page }) => {
      await startDemo(page, locale, 'viewer_auditor');
      await expect(page.locator('[data-shell="rail"]')).toBeHidden();
      await menuButton(page, locale).click();
      const drawer = drawerOf(page, locale);
      await expect(drawer).toBeVisible();
      // The drawer lists the role's whole menu: Ops, and the one Admin module a Viewer / Auditor has (in a collapsed section).
      const links = await drawer.locator('[data-shell-item]').evaluateAll((as) => as.map((a) => (a.textContent ?? '').trim()));
      expect(links).toEqual(drawerLabels('viewer_auditor', locale));
      await drawer.locator('[data-shell-item="ops.gap_surplus"]').click();
      await expect(page).toHaveURL(new RegExp(`/${locale}/ops/gap-surplus$`));
      await expect(drawer).toBeHidden();
      await expectPageOk(page, locale);
    });
  }

  // A Planner has all 12 Ops modules: the longest menu. It must be reachable in the drawer, scrolled or not.
  for (const locale of locales) {
    test(`the drawer holds a Planner's 12 modules, all reachable, in ${locale}`, async ({ page }, testInfo) => {
      await startDemo(page, locale, 'planner');
      await menuButton(page, locale).click();
      const drawer = drawerOf(page, locale);
      await expect(drawer).toBeVisible();
      const items = drawer.locator('[data-shell-item]');
      await expect(items).toHaveCount(12);
      await shot(page, testInfo, locale, 'drawer-planner', { fullPage: false });

      // Scroll the menu to its end: the last module is fully inside the drawer, and nothing sticks out sideways.
      await items.last().scrollIntoViewIfNeeded();
      await shot(page, testInfo, locale, 'drawer-planner-end', { fullPage: false });
      const box = await items.last().boundingBox();
      const view = page.viewportSize();
      expect(box).not.toBeNull();
      expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(view?.height ?? 0);
      await expectPageOk(page, locale);
    });
  }

  // The drawer's own labels (dialog name, close button, navigation landmark) are the design system's built-in text: they
  // must be Arabic too.
  test('the open drawer has no English text or labels in ar', async ({ page }) => {
    await startDemo(page, 'ar', 'administrator');
    await menuButton(page, 'ar').click();
    const drawer = drawerOf(page, 'ar');
    await expect(drawer).toBeVisible();
    await expect(drawer.getByRole('button', { name: text('ar', 'ds.drawer.close') })).toBeVisible();
    await expect(drawer.getByRole('navigation', { name: text('ar', 'ds.railShell.nav') })).toBeVisible();
    const strings = await drawer.evaluate((el) => {
      const out: string[] = [(el as HTMLElement).innerText];
      for (const node of el.querySelectorAll('[aria-label]')) out.push(node.getAttribute('aria-label') ?? '');
      out.push(el.getAttribute('aria-label') ?? '');
      return out;
    });
    const latin = strings.join(' ').match(/[A-Za-z][A-Za-z'-]{2,}/g)?.filter((word) => word !== 'OPENDISPATCH') ?? [];
    expect(latin).toEqual([]);
  });
});
