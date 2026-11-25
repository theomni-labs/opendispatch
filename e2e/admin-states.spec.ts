// SPDX-License-Identifier: AGPL-3.0-only
import { expect, test } from '@playwright/test';
import { ADMIN_MODULES, DEEP_LINKS, adminUrl, frameOf, hasEmptyAction, moduleText, skeletonShape, stateLine, switchRole, watchStrict } from './admin-helpers';
import { expectPageOk, startDemo, waitForHydration } from './helpers';
import { locales, text, titleOf } from './routes';

// The states of every Admin module, and what happens when something cannot be done.
//
//  1. `?state=empty | loading | error | noaccess` (the review hook, decided on the server) on each of the 17 modules as the
//     Administrator in a private install, in English and Arabic: the page answers (never a 500), carries the state in
//     data-state, keeps the one h1, shows no table or tabs behind the state, and has the state's title and its one action: the
//     module's own empty action (enabled: the Administrator edits; Audit Log and Forecast have none, read from the screen's
//     source), no action for loading, Try again for error (which then leaves the state), Go home for no access. Loading is a
//     skeleton of the module's shape with aria-busy and the "Loading" text for screen readers.
//  2. An unknown or malformed record in the address (`?id=`, `?rule=`,...) shows the list with the inline notice (or, for a
//     value the URL check ignores, the plain list), never an error page and never a drawer.
//  3. A view-only role sees the unavailable controls disabled and the reason written next to them, in its language.
//  4. A write the server refuses (the role changed after the page was drawn: a second tab of the same browser switches it)
//     shows the translated error line and changes nothing.

for (const locale of locales) {
  for (const def of ADMIN_MODULES) {
    test(`${def.id}: empty, loading, error and no-access states in ${locale}`, async ({ page, baseURL }) => {
      test.setTimeout(120_000);
      const seen = watchStrict(page, baseURL);
      await startDemo(page, locale, 'administrator', 'private');
      const root = frameOf(page, def);
      const area = root.locator(':scope > :not(header)');
      const actions = area.locator('button, a[href]');
      const open = async (state: string) => {
        const response = await page.goto(adminUrl(locale, def, `?state=${state}`));
        expect(response?.status(), `?state=${state} answers with a page`).toBeLessThan(400);
        await expect(root).toHaveAttribute('data-state', state);
        await expectPageOk(page, locale);
        await expect(page.getByRole('heading', { level: 1 })).toHaveText(titleOf(locale, def.id));
        await expect(root.locator('table, [role="tab"]'), 'no content or tabs behind the state').toHaveCount(0);
      };
      const expectLine = async (state: 'empty' | 'error', part: 'title' | 'desc') => {
        const line = stateLine(locale, def, state, part);
        if (line !== undefined) await expect(area.getByText(line, { exact: true })).toBeVisible();
        else expect(part, `every state has a title (${state})`).toBe('desc');
      };

      await test.step('empty: title, description and the empty action', async () => {
        await open('empty');
        await expectLine('empty', 'title');
        await expectLine('empty', 'desc');
        await expect(actions, 'the empty state has one action, or none for a read-only module').toHaveCount(hasEmptyAction(def) ? 1 : 0);
        if (hasEmptyAction(def)) {
          await expect(actions.first()).toBeVisible();
          await expect(actions.first(), 'the Administrator can use it').not.toHaveAttribute('aria-disabled', 'true');
        }
      });

      await test.step('loading: a skeleton of the module shape, announced once, with no action', async () => {
        await open('loading');
        const busy = root.locator('[aria-busy="true"]');
        await expect(busy).toHaveCount(1);
        await expect(busy).toHaveAttribute('data-skeleton', skeletonShape(def));
        await expect(busy).toContainText(text(locale, 'ds.skeleton.loading'));
        await expect(root.getByRole('alert')).toHaveCount(0);
        await expect(actions).toHaveCount(0);
      });

      await test.step('no access: the panel and Go home', async () => {
        await open('noaccess');
        await expect(area.getByText(text(locale, 'states.noAccess.title'), { exact: true })).toBeVisible();
        await expect(area.getByRole('link', { name: text(locale, 'common.goHome') })).toBeVisible();
      });

      await test.step('error: an alert with the title, the description and Try again, which leaves the state', async () => {
        await open('error');
        const alert = area.getByRole('alert');
        await expect(alert).toHaveCount(1);
        await expectLine('error', 'title');
        await expectLine('error', 'desc');
        await expect(alert.locator('button, a[href]'), 'the error state has exactly one action').toHaveCount(1);
        await waitForHydration(page, '[data-module] [role="alert"] button');
        await alert.getByRole('button', { name: text(locale, 'common.retry') }).click();
        await expect(root).toHaveAttribute('data-state', 'filled');
        await expect(page).not.toHaveURL(/state=/);
      });
      seen.expectClean();
    });
  }
}

// an unknown or malformed id shows the list with an inline notice, never an error page. Which values reach the record
// check (and so show the notice) and which the URL check drops first is written per module in DEEP_LINKS (admin-helpers.ts).
for (const [id, links] of Object.entries(DEEP_LINKS)) {
  const def = ADMIN_MODULES.find((m) => m.id === id);
  if (def === undefined) throw new Error(`DEEP_LINKS names ${id}, which is not an Admin module`);
  test(`${id}: ${links.map((deep) => `?${deep.param}=`).join(' and ')} with no such record shows the list, never an error page`, async ({ page, baseURL }) => {
    test.setTimeout(120_000);
    const seen = watchStrict(page, baseURL);
    await startDemo(page, 'en', 'administrator', 'private');
    const root = frameOf(page, def);
    for (const locale of locales) {
      for (const deep of links) {
        for (const kind of ['malformed', 'unknown'] as const) {
          const value = deep[kind];
          const who = `${id} in ${locale} with ${deep.param}=${value}`;
          const query = `?${deep.tab === undefined ? '' : `tab=${deep.tab}&`}${deep.param}=${encodeURIComponent(value)}`;
          const response = await page.goto(adminUrl(locale, def, query));
          expect(response?.status(), `${who}: answers with a page`).toBeLessThan(400);
          await expect(root, `${who}: the screen, not an error`).toHaveAttribute('data-state', 'filled');
          await expectPageOk(page, locale);
          await expect(page.getByRole('heading', { level: 1 }), who).toHaveText(titleOf(locale, def.id));
          await expect(page.getByRole('dialog'), `${who}: no drawer for no record`).toHaveCount(0);
          await expect(root.locator('table, [role="tabpanel"]').first(), `${who}: the list is there`).toBeVisible();
          const notice = root.getByRole('alert').filter({ hasText: moduleText(locale, def, deep.notice) });
          await expect(notice, `${who}: the inline notice`).toHaveCount(kind === 'unknown' || deep.malformedShowsNotice ? 1 : 0);
        }
      }
    }
    seen.expectClean();
  });
}

// A view-only role: controls that cannot be used are disabled and the reason is written beside them.
const updates = ADMIN_MODULES.find((m) => m.id === 'admin.updates');
const identity = ADMIN_MODULES.find((m) => m.id === 'admin.sign_in_identity');
const audit = ADMIN_MODULES.find((m) => m.id === 'admin.audit_log');
if (updates === undefined || identity === undefined || audit === undefined) throw new Error('an Admin module is missing from the access model');

for (const locale of locales) {
  test(`the Change Approver (view only) sees the Updates connection controls disabled, with the reason beside them, in ${locale}`, async ({ page, baseURL }) => {
    const seen = watchStrict(page, baseURL);
    await startDemo(page, locale, 'change_approver', 'private');
    await page.goto(adminUrl(locale, updates, '?tab=connection'));
    const root = frameOf(page, updates);
    await expect(root).toHaveAttribute('data-access', 'view');
    await expect(root.getByText(text(locale, 'opendispatch.gate.viewOnly'), { exact: true }).first(), 'the reason is on the page, not only in a tooltip').toBeVisible();
    expect(await root.locator('fieldset[disabled]').count(), 'the mode control is disabled').toBeGreaterThan(0);
    await expect(root.getByRole('button', { name: moduleText(locale, updates, 'check.label') })).toHaveAttribute('aria-disabled', 'true');
    seen.expectClean();
  });

  test(`the Administrator of a shared install sees the Identity policy switches disabled, with the reason beside them, in ${locale}`, async ({ page, baseURL }) => {
    const seen = watchStrict(page, baseURL);
    await startDemo(page, locale, 'administrator', 'shared');
    await page.goto(adminUrl(locale, identity, '?tab=policy'));
    const root = frameOf(page, identity);
    await expect(root).toHaveAttribute('data-access', 'view');
    await expect(root.getByText(moduleText(locale, identity, 'ro.reason'), { exact: true }).first(), 'the reason is on the page, not only in a tooltip').toBeVisible();
    const switches = root.getByRole('switch');
    expect(await switches.count(), 'the policy has switches').toBeGreaterThan(0);
    for (const control of await switches.all()) await expect(control).toBeDisabled();
    await expect(root.getByRole('button', { name: moduleText(locale, identity, 'add') })).toHaveAttribute('aria-disabled', 'true');
    seen.expectClean();
  });

  // The Export button of the Audit Log reads through the same guarded function as the page. The page is drawn for the
  // Administrator; a second tab of the same browser then switches the session to a Dispatcher (who has no Admin Console), so the
  // click reaches the server with a role that may not read the log: `forbidden`, shown as the translated line, and nothing else.
  test(`a write the server refuses shows the translated error line, in ${locale}`, async ({ page, context, baseURL }) => {
    const seen = watchStrict(page, baseURL);
    await startDemo(page, locale, 'administrator', 'private');
    await page.goto(adminUrl(locale, audit));
    await waitForHydration(page, '[data-module] > header button');
    const exportButton = frameOf(page, audit).getByRole('button', { name: text(locale, 'common.export') });
    await expect(exportButton).toBeEnabled();

    const other = await context.newPage();
    await other.goto(adminUrl(locale, audit));
    await switchRole(other, 'dispatcher', '/ops/live-dispatch-board');
    await other.close();

    await exportButton.click();
    await expect(page.getByText(text(locale, 'patterns.action.error.forbidden'), { exact: true })).toBeVisible();
    seen.expectClean();
  });
}
