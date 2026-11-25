// SPDX-License-Identifier: AGPL-3.0-only
import { expect, test } from '@playwright/test';
import { expectPageOk, shot, startDemo, watch } from './helpers';
import { MODULES, ROLES, STATES, landingOf, locales, moduleAccess, pathOf, publicRoutes, text, titleOf } from './routes';

// Definition of Done: screenshots of every changed screen, English and Arabic, at 1440px and 390px (the two
// projects in playwright.config.ts). Build first (`pnpm build`), then `pnpm e2e:shots`. Output: e2e-output/screenshots/.

for (const locale of locales) {
  for (const route of publicRoutes) {
    test(`${route.name} in ${locale}`, async ({ page, baseURL }, testInfo) => {
      const seen = watch(page, baseURL);
      await page.goto(`/${locale}${route.path}`);
      await expectPageOk(page, locale);
      seen.expectClean();
      await shot(page, testInfo, locale, route.name);
    });
  }

  // The Administrator sees all 17 Admin modules and (view only) all 12 Ops modules: every route of both consoles.
  test(`every module page as Administrator in ${locale}`, async ({ page, baseURL }, testInfo) => {
    test.setTimeout(180_000);
    const seen = watch(page, baseURL);
    await startDemo(page, locale, 'administrator');
    expect(MODULES).toHaveLength(29);

    for (const def of MODULES) {
      await page.goto(`/${locale}${pathOf(def)}`);
      await expect(page.getByRole('heading', { level: 1 }), pathOf(def)).toHaveText(titleOf(locale, def.id));
      await expectPageOk(page, locale);
      await shot(page, testInfo, locale, `module-${def.console}-${pathOf(def).split("/")[2]}`);
    }
    seen.expectClean();
  });

  // The four placeholder states (?state=), on one module, so each can be reviewed.
  test(`states in ${locale}`, async ({ page, baseURL }, testInfo) => {
    const seen = watch(page, baseURL, { allowNotFound: true });
    await startDemo(page, locale, 'planner');
    for (const state of STATES) {
      await page.goto(`/${locale}/ops/field-planner?state=${state}`);
      await expect(page.locator('[data-module]')).toHaveAttribute('data-state', state);
      await expectPageOk(page, locale);
      await shot(page, testInfo, locale, `state-${state}`);
    }
    // 404 inside the shell, and 404 outside the consoles.
    await page.goto(`/${locale}/ops/not-a-module`);
    await expectPageOk(page, locale);
    await shot(page, testInfo, locale, 'not-found-ops');
    await page.goto(`/${locale}/nothing-here`);
    await expectPageOk(page, locale);
    await shot(page, testInfo, locale, 'not-found');
    seen.expectClean();
  });

  // Each role's landing page, and what a role sees where it has no access.
  for (const role of ROLES) {
    test(`landing of ${role} in ${locale}`, async ({ page, baseURL }, testInfo) => {
      const seen = watch(page, baseURL);
      await startDemo(page, locale, role);
      const landing = landingOf(role, 'private');
      expect(landing, `${role} has a landing page`).toBeDefined();
      await expect(page).toHaveURL(new RegExp(`/${locale}${landing}$`));
      await expectPageOk(page, locale);
      await shot(page, testInfo, locale, `role-${role}`);

      // A console or module the role does not have: the no-access state, still inside the shell.
      const denied = MODULES.find((m) => moduleAccess(role, m.id, 'private').access === 'none');
      if (denied !== undefined) {
        await page.goto(`/${locale}${pathOf(denied)}`);
        await expect(page.getByText(text(locale, 'states.noAccess.title'))).toBeVisible();
        await expectPageOk(page, locale);
        await shot(page, testInfo, locale, `role-${role}-no-access`);
      }
      seen.expectClean();
    });
  }

  // Updates for the Administrator: the full screen in a private install, the reduced one in dedicated and shared.
  for (const mode of ['private', 'dedicated', 'shared'] as const) {
    test(`Updates in a ${mode} install in ${locale}`, async ({ page, baseURL }, testInfo) => {
      const seen = watch(page, baseURL);
      await startDemo(page, locale, 'administrator', mode);
      await page.goto(`/${locale}/admin/updates`);
      await expect(page.locator('[data-module="admin.updates"]')).toHaveAttribute('data-reduced', String(mode !== 'private'));
      await expectPageOk(page, locale);
      await shot(page, testInfo, locale, `updates-${mode}`);
      seen.expectClean();
    });
  }

  // The demo switcher, open: the Demo pill's pop-over (drawn in a portal, so its form is not inside the pill).
  test(`demo switcher in ${locale}`, async ({ page, baseURL }, testInfo) => {
    const seen = watch(page, baseURL);
    await startDemo(page, locale, 'dispatch_supervisor');
    await page.locator('[data-demo-switcher="trigger"]').click();
    await expect(page.locator('[data-demo-switcher="panel"]')).toBeVisible();
    await expectPageOk(page, locale);
    await shot(page, testInfo, locale, 'demo-switcher-open', { fullPage: false });
    seen.expectClean();
  });
}
