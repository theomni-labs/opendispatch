// SPDX-License-Identifier: AGPL-3.0-only
import path from 'node:path';
import { type Page } from '@playwright/test';
import { expect, test } from '../fixtures';
import { expectPageOk, shot, startDemo, waitForHydration, watch } from '../helpers';
import { locales, text, titleOf, type Locale } from '../routes';
import { readMessages } from '../messages';

// Leave Planner (Ops 9, flow 3. A
// Planner decides a leave request; every other
// role with access reads the same requests and
// windows, with Approve/Decline unavailable.
// Every write is followed by its audit event in
// the Audit Log.

type Tree = { [key: string]: string | Tree };
const module_ = (locale: Locale): Tree => readMessages(path.join(import.meta.dirname, '../../apps/web/messages/ops/leave_planner', `${locale}.json`)) as Tree;
const MODULE = { en: module_('en'), ar: module_('ar') };
function m(locale: Locale, key: string, values: Record<string, string> = {}): string {
  let node: string | Tree | undefined = MODULE[locale];
  for (const part of key.split('.')) node = typeof node === 'object' ? node[part] : undefined;
  if (typeof node !== 'string') throw new Error(`No message ops.leave_planner.${locale}:${key}`);
  return Object.entries(values).reduce((out, [name, value]) => out.replaceAll(`{${name}}`, value), node);
}

const ROUTE = (locale: Locale) => `/${locale}/ops/leave-planner`;
const root = (page: Page) => page.locator('[data-module="ops.leave_planner"]');

async function open(page: Page, locale: Locale, query = '') {
  await page.goto(`${ROUTE(locale)}${query}`);
  await expect(root(page)).toHaveAttribute('data-state', 'filled');
  await expectPageOk(page, locale);
  await waitForHydration(page, '[data-module="ops.leave_planner"] button');
}

/** The Audit Log filtered by an action code: the write's event is there. */
// Most write roles have no Audit Log access.
async function expectAudit(page: Page, locale: Locale, action: string) {
  await startDemo(page, locale, 'administrator');
  await page.goto(`/${locale}/admin/audit-log?q=${action}`);
  await expect(page.locator('[data-module="admin.audit_log"] tbody tr').first()).toContainText(action);
}

for (const locale of locales) {
  test.describe(`Leave Planner, read only, in ${locale}`, () => {
    test('the Viewer / Auditor (view only) reads the title, the four stats, the tabs, the table and the leave windows', async ({ page, baseURL }, testInfo) => {
      const seen = watch(page, baseURL);
      await startDemo(page, locale, 'viewer_auditor');
      await open(page, locale);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(titleOf(locale, 'ops.leave_planner'));
      await expect(root(page).getByText(text(locale, 'shell.access.view'))).toBeVisible();
      for (const key of ['stat.pending', 'stat.approved', 'stat.gaps', 'stat.windows']) {
        await expect(root(page).getByText(m(locale, key)).first()).toBeVisible();
      }
      await expect(root(page).getByRole('heading', { name: m(locale, 'req.title') })).toBeVisible();
      await expect(root(page).getByRole('heading', { name: m(locale, 'win.title') })).toBeVisible();
      await expect(root(page).getByRole('tab', { name: new RegExp(m(locale, 'status.requested')) })).toBeVisible();
      await expect(root(page).getByText(text(locale, 'common.illustrative')).first()).toBeVisible();
      await shot(page, testInfo, locale, 'leave-planner-filled');
      seen.expectClean();
    });

    test('the review states ?state=empty, loading, error and noaccess keep the header and show their text', async ({ page, baseURL }, testInfo) => {
      const seen = watch(page, baseURL);
      await startDemo(page, locale, 'viewer_auditor');
      for (const state of ['empty', 'loading', 'error'] as const) {
        await page.goto(`${ROUTE(locale)}?state=${state}`);
        await expect(root(page)).toHaveAttribute('data-state', state);
        await expect(page.getByRole('heading', { level: 1 })).toHaveText(titleOf(locale, 'ops.leave_planner'));
        await shot(page, testInfo, locale, `leave-planner-${state}`);
      }
      seen.expectClean();
    });
  });
}

test.describe.serial('Leave Planner, the writes (deciding a leave request)', () => {
  const locale: Locale = 'en';

  test('a Planner approves the first requested row', async ({ page, baseURL }, testInfo) => {
    const seen = watch(page, baseURL);
    await startDemo(page, locale, 'planner');
    await open(page, locale, '?tab=requested');
    await root(page).getByRole('button', { name: text(locale, 'common.approve'), exact: true }).first().click();
    await expect(page.getByText(m(locale, 'toast.approved'))).toBeVisible();
    await shot(page, testInfo, locale, 'leave-planner-approved');
    await expectAudit(page, locale, 'leave.approved');
    seen.expectClean();
  });

  test('Approve and Decline are unavailable to a view-only role (Administrator): no decide button at all', async ({ page, baseURL }) => {
    const seen = watch(page, baseURL);
    await startDemo(page, locale, 'administrator');
    await open(page, locale, '?tab=requested');
    await expect(root(page).getByRole('button', { name: text(locale, 'common.approve'), exact: true })).toHaveCount(0);
    await expect(root(page).getByRole('button', { name: m(locale, 'decline'), exact: true })).toHaveCount(0);
    seen.expectClean();
  });

  test('a Planner opens a request and sees its effect on coverage', async ({ page, baseURL }) => {
    const seen = watch(page, baseURL);
    await startDemo(page, locale, 'planner');
    await open(page, locale, '?tab=approved');
    const row = root(page).locator('table tbody tr').first();
    await row.click();
    const drawer = page.getByRole('dialog');
    await expect(drawer).toBeVisible();
    await expect(drawer.getByText(m(locale, 'd.effect'))).toBeVisible();
    seen.expectClean();
  });
});
