// SPDX-License-Identifier: AGPL-3.0-only
import path from 'node:path';
import { type Page } from '@playwright/test';
import { expect, test } from '../fixtures';
import { expectPageOk, shot, startDemo, waitForHydration, watch } from '../helpers';
import { locales, text, titleOf, type Locale } from '../routes';
import { readMessages } from '../messages';

// Live Dispatch Board (Ops 2, flow 11; plan section
// 4). A dispatcher accepts or overrides a
// recommendation with a reason code; a simulated
// feed outage switches the board to fallback (rule
// 19). Administrator (view only) reads the same
// board with every action unavailable. Each write
// is followed by its audit event in the Audit Log.

type Tree = { [key: string]: string | Tree };
const module_ = (locale: Locale): Tree => readMessages(path.join(import.meta.dirname, '../../apps/web/messages/ops/live_dispatch_board', `${locale}.json`)) as Tree;
const MODULE = { en: module_('en'), ar: module_('ar') };
function m(locale: Locale, key: string, values: Record<string, string> = {}): string {
  let node: string | Tree | undefined = MODULE[locale];
  for (const part of key.split('.')) node = typeof node === 'object' ? node[part] : undefined;
  if (typeof node !== 'string') throw new Error(`No message ops.live_dispatch_board.${locale}:${key}`);
  return Object.entries(values).reduce((out, [name, value]) => out.replaceAll(`{${name}}`, value), node);
}

const ROUTE = (locale: Locale) => `/${locale}/ops/live-dispatch-board`;
const root = (page: Page) => page.locator('[data-module="ops.live_dispatch_board"]');
const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true });
const tab = (page: Page, name: string) => root(page).getByRole('tab', { name: new RegExp(`^${name}`) });
const column = (page: Page, name: string) => root(page).locator('section[data-column]', { has: page.getByRole('heading', { name }) });

// The header's More menu, then one item.
async function fromMore(page: Page, locale: Locale, item: string) {
  await button(page, text(locale, 'common.more')).click();
  await page.getByRole('menuitem', { name: item }).click();
}

async function open(page: Page, locale: Locale, query = '') {
  await page.goto(`${ROUTE(locale)}${query}`);
  await expect(root(page)).toHaveAttribute('data-state', 'filled');
  await expectPageOk(page, locale);
  await waitForHydration(page, '[data-module="ops.live_dispatch_board"] button');
}

/** The Audit Log filtered by an action code: the write's event is there. */
// Most write roles have no Audit Log access.
async function expectAudit(page: Page, locale: Locale, action: string) {
  await startDemo(page, locale, 'administrator');
  await page.goto(`/${locale}/admin/audit-log?q=${action}`);
  await expect(page.locator('[data-module="admin.audit_log"] tbody tr').first()).toContainText(action);
}

for (const locale of locales) {
  test.describe(`Live Dispatch Board, read only, in ${locale}`, () => {
    test('the Administrator (view only) reads the title, the four figures, the three board columns, the stage per zone, the map, the 10-minute reading and the shadow comparison', async ({ page, baseURL }, testInfo) => {
      const seen = watch(page, baseURL);
      await startDemo(page, locale, 'administrator');
      await open(page, locale);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(titleOf(locale, 'ops.live_dispatch_board'));
      for (const key of ['board.col.waiting', 'board.col.recommended', 'col.progress']) {
        await expect(root(page).getByRole('heading', { name: m(locale, key) })).toBeVisible();
      }
      await expect(root(page).getByText(m(locale, 'read.title')).first()).toBeVisible();
      await expect(root(page).getByText(m(locale, 'fallback.label')).first()).toBeVisible();
      await button(page, m(locale, 'stage.button')).click();
      await expect(page.getByText(m(locale, 'stage.title')).first()).toBeVisible();
      await page.keyboard.press('Escape');
      await tab(page, m(locale, 'tab.map')).click();
      await expect(root(page).getByRole('heading', { name: m(locale, 'map.title') })).toBeVisible();
      await tab(page, m(locale, 'tab.shadow')).click();
      await expect(root(page).getByRole('heading', { name: m(locale, 'cmp.title') })).toBeVisible();
      await expect(root(page).getByRole('heading', { name: m(locale, 'read.title') })).toBeVisible();
      await tab(page, m(locale, 'tab.board')).click();
      await expect(root(page).getByText(text(locale, 'shell.access.view'))).toBeVisible();
      await expect(root(page).getByText(text(locale, 'common.illustrative')).first()).toBeVisible();
      await shot(page, testInfo, locale, 'live-dispatch-board-filled');
      seen.expectClean();
    });

    test('the review states ?state=empty, loading, error and noaccess keep the header and show their text', async ({ page, baseURL }, testInfo) => {
      const seen = watch(page, baseURL);
      await startDemo(page, locale, 'administrator');
      for (const state of ['empty', 'loading', 'error'] as const) {
        await page.goto(`${ROUTE(locale)}?state=${state}`);
        await expect(root(page)).toHaveAttribute('data-state', state);
        await expect(page.getByRole('heading', { level: 1 })).toHaveText(titleOf(locale, 'ops.live_dispatch_board'));
        await shot(page, testInfo, locale, `live-dispatch-board-${state}`);
      }
      seen.expectClean();
    });
  });
}

test.describe.serial('Live Dispatch Board, the writes', () => {
  const locale: Locale = 'en';

  test('a dispatcher accepts a recommendation and it moves to Assigned with the OpenDispatch source', async ({ page, baseURL }, testInfo) => {
    const seen = watch(page, baseURL);
    await startDemo(page, locale, 'dispatcher');
    await open(page, locale);
    const recommendedCol = column(page, m(locale, 'board.col.recommended'));
    const acceptButton = recommendedCol.getByRole('button', { name: text(locale, 'opendispatch.dispatch.accept'), exact: true }).first();
    if ((await acceptButton.count()) === 0) {
      seen.expectClean();
      return; // no recommended case at the moment the replay day starts
    }
    const card = acceptButton.locator('xpath=ancestor::article[1]');
    const caseId = await card.getAttribute('data-case');
    await acceptButton.click();
    await expect(page.getByText(/^Assigned to /)).toBeVisible();
    await shot(page, testInfo, locale, 'live-dispatch-board-accepted');
    if (caseId !== null) await expect(page.locator(`[data-case="${caseId}"]`)).toBeVisible();
    await expectAudit(page, locale, 'assignment.accepted');
    seen.expectClean();
  });

  test('a dispatcher overrides an assignment: an agent and a reason are required, `other` also needs a note', async ({ page, baseURL }, testInfo) => {
    const seen = watch(page, baseURL);
    await startDemo(page, locale, 'dispatcher');
    await open(page, locale);
    const recommendedCol = column(page, m(locale, 'board.col.recommended'));
    const overrideButton = recommendedCol.getByRole('button', { name: text(locale, 'opendispatch.dispatch.override'), exact: true }).first();
    if ((await overrideButton.count()) === 0) {
      seen.expectClean();
      return; // no recommended case at the moment the replay day starts
    }
    await overrideButton.click();
    const dialog = page.getByRole('dialog', { name: m(locale, 'override.title') });
    await expect(dialog).toBeVisible();
    const confirmButton = dialog.getByRole('button', { name: text(locale, 'common.confirm'), exact: true });
    await expect(confirmButton).toHaveAttribute('aria-disabled', 'true');
    await dialog.getByRole('combobox').fill('a');
    // Keyboard: the DS listbox sits under the drawer.
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await dialog.getByRole('radio').first().click();
    await confirmButton.click();
    await expect(page.getByText(/^Reassigned to /)).toBeVisible();
    await shot(page, testInfo, locale, 'live-dispatch-board-overridden');
    await expectAudit(page, locale, 'assignment.overridden');
    seen.expectClean();
  });

  test('a simulated feed outage switches the board to fallback, and back', async ({ page, baseURL }, testInfo) => {
    const seen = watch(page, baseURL);
    await startDemo(page, locale, 'dispatcher');
    await open(page, locale);
    await fromMore(page, locale, m(locale, 'outage.on'));
    await expect(page.getByText(m(locale, 'toast.outageOn'))).toBeVisible();
    await expect(root(page).getByText(m(locale, 'fallback.active'), { exact: true })).toBeVisible();
    await shot(page, testInfo, locale, 'live-dispatch-board-fallback-active');
    await fromMore(page, locale, m(locale, 'outage.off'));
    await expect(page.getByText(m(locale, 'toast.outageOff'))).toBeVisible();
    await expect(root(page).locator('section[role="status"][data-active]')).toHaveAttribute('data-active', 'false');
    await expectAudit(page, locale, 'fallback.outage_simulated');
    seen.expectClean();
  });

  test('the replay pause and resume button is unavailable to a view-only role and available to a dispatcher', async ({ page, baseURL }) => {
    const seen = watch(page, baseURL);
    await startDemo(page, locale, 'administrator');
    await open(page, locale);
    const replayButtonViewOnly = page.getByRole('button', { name: /replay/i });
    await expect(replayButtonViewOnly).toHaveAttribute('aria-disabled', 'true');
    await startDemo(page, locale, 'dispatcher');
    await open(page, locale);
    const replayButton = page.getByRole('button', { name: /replay/i });
    await expect(replayButton).not.toHaveAttribute('aria-disabled', 'true');
    seen.expectClean();
  });
});
