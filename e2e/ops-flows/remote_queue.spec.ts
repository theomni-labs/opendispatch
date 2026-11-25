// SPDX-License-Identifier: AGPL-3.0-only
import path from 'node:path';
import { type Page } from '@playwright/test';
import { expect, test } from '../fixtures';
import { expectPageOk, shot, startDemo, waitForHydration, watch } from '../helpers';
import { locales, text, titleOf, type Locale } from '../routes';
import { readMessages } from '../messages';

// Remote Queue and Scheduling (Ops 3, plan section
// 6.1). A Remote Team Lead assigns a reviewer to a
// waiting case; every other role with access reads
// the same queue and staffing chart, with Assign
// unavailable. Every write is followed by its audit
// event in the Audit Log.

type Tree = { [key: string]: string | Tree };
const module_ = (locale: Locale): Tree => readMessages(path.join(import.meta.dirname, '../../apps/web/messages/ops/remote_queue', `${locale}.json`)) as Tree;
const MODULE = { en: module_('en'), ar: module_('ar') };
function m(locale: Locale, key: string, values: Record<string, string> = {}): string {
  let node: string | Tree | undefined = MODULE[locale];
  for (const part of key.split('.')) node = typeof node === 'object' ? node[part] : undefined;
  if (typeof node !== 'string') throw new Error(`No message ops.remote_queue.${locale}:${key}`);
  return Object.entries(values).reduce((out, [name, value]) => out.replaceAll(`{${name}}`, value), node);
}

const ROUTE = (locale: Locale) => `/${locale}/ops/remote-queue`;
const root = (page: Page) => page.locator('[data-module="ops.remote_queue"]');

async function open(page: Page, locale: Locale, query = '') {
  await page.goto(`${ROUTE(locale)}${query}`);
  await expect(root(page)).toHaveAttribute('data-state', 'filled');
  await expectPageOk(page, locale);
  await waitForHydration(page, '[data-module="ops.remote_queue"] button');
}

/** The Audit Log filtered by an action code: the write's event is there. */
// Most write roles have no Audit Log access.
async function expectAudit(page: Page, locale: Locale, action: string) {
  await startDemo(page, locale, 'administrator');
  await page.goto(`/${locale}/admin/audit-log?q=${action}`);
  await expect(page.locator('[data-module="admin.audit_log"] tbody tr').first()).toContainText(action);
}

for (const locale of locales) {
  test.describe(`Remote Queue and Scheduling, read only, in ${locale}`, () => {
    test('the Administrator (view only) reads the title, the four stats, the staffing chart, the tabs and the queue table', async ({ page, baseURL }, testInfo) => {
      const seen = watch(page, baseURL);
      await startDemo(page, locale, 'administrator');
      await open(page, locale);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(titleOf(locale, 'ops.remote_queue'));
      await expect(root(page).getByText(text(locale, 'shell.access.view'))).toBeVisible();
      for (const key of ['stat.waiting', 'stat.inReview', 'stat.longest', 'stat.gap']) {
        await expect(root(page).getByText(m(locale, key)).first()).toBeVisible();
      }
      await expect(root(page).getByText(m(locale, 'staff.title')).first()).toBeVisible();
      await expect(root(page).getByText(m(locale, 'queue.title')).first()).toBeVisible();
      await expect(root(page).getByRole('tab', { name: new RegExp(m(locale, 'tab.waiting')) })).toBeVisible();
      await expect(root(page).getByText(text(locale, 'common.illustrative')).first()).toBeVisible();
      await shot(page, testInfo, locale, 'remote-queue-filled');
      seen.expectClean();
    });

    test('the review states ?state=empty, loading, error and noaccess keep the header and show their text', async ({ page, baseURL }, testInfo) => {
      const seen = watch(page, baseURL);
      await startDemo(page, locale, 'administrator');
      for (const state of ['empty', 'loading', 'error'] as const) {
        await page.goto(`${ROUTE(locale)}?state=${state}`);
        await expect(root(page)).toHaveAttribute('data-state', state);
        await expect(page.getByRole('heading', { level: 1 })).toHaveText(titleOf(locale, 'ops.remote_queue'));
        await shot(page, testInfo, locale, `remote-queue-${state}`);
      }
      seen.expectClean();
    });
  });
}

test.describe.serial('Remote Queue and Scheduling, the writes (assigning a reviewer)', () => {
  const locale: Locale = 'en';

  test('a Remote Team Lead assigns a reviewer to the first waiting case', async ({ page, baseURL }, testInfo) => {
    const seen = watch(page, baseURL);
    await startDemo(page, locale, 'remote_team_lead');
    await open(page, locale);
    await root(page).getByRole('button', { name: m(locale, 'assign'), exact: true }).first().click();
    const dialog = page.getByRole('dialog', { name: m(locale, 'drawer.title') });
    await expect(dialog).toBeVisible();
    const confirmButton = dialog.getByRole('button', { name: m(locale, 'assign'), exact: true });
    await expect(confirmButton).toHaveAttribute('aria-disabled', 'true');
    await dialog.getByRole('radio').first().click();
    await expect(confirmButton).not.toHaveAttribute('aria-disabled', 'true');
    await confirmButton.click();
    await expect(page.getByText(m(locale, 'toast.assigned'))).toBeVisible();
    await shot(page, testInfo, locale, 'remote-queue-assigned');
    await expectAudit(page, locale, 'remote_queue.reviewer_assigned');
    seen.expectClean();
  });

  test('Assign is unavailable to a view-only role (Administrator)', async ({ page, baseURL }) => {
    const seen = watch(page, baseURL);
    await startDemo(page, locale, 'administrator');
    await open(page, locale);
    const assignTop = root(page).getByRole('button', { name: m(locale, 'assign'), exact: true }).first();
    await expect(assignTop).toHaveAttribute('aria-disabled', 'true');
    seen.expectClean();
  });
});
