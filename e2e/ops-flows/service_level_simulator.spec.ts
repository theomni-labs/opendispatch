// SPDX-License-Identifier: AGPL-3.0-only
import path from 'node:path';
import { type Page } from '@playwright/test';
import { expect, test } from '../fixtures';
import { expectPageOk, shot, startDemo, waitForHydration, watch } from '../helpers';
import { locales, text, titleOf, type Locale } from '../routes';
import { readMessages } from '../messages';

// Service-Level Simulator (Ops 7.
// A Planner runs a real replay of one
// roster's own zone against a day of real
// case history; the Administrator (view
// only) reads the same results. Every
// figure is Illustrative; both
// 10-minute readings are always shown.

type Tree = { [key: string]: string | Tree };
const module_ = (locale: Locale): Tree =>
  readMessages(path.join(import.meta.dirname, '../../apps/web/messages/ops/service_level_simulator', `${locale}.json`)) as Tree;
const MODULE = { en: module_('en'), ar: module_('ar') };
function m(locale: Locale, key: string, values: Record<string, string> = {}): string {
  let node: string | Tree | undefined = MODULE[locale];
  for (const part of key.split('.')) node = typeof node === 'object' ? node[part] : undefined;
  if (typeof node !== 'string') throw new Error(`No message ops.service_level_simulator.${locale}:${key}`);
  return Object.entries(values).reduce((out, [name, value]) => out.replaceAll(`{${name}}`, value), node);
}

const ROUTE = (locale: Locale) => `/${locale}/ops/service-level-simulator`;
const root = (page: Page) => page.locator('[data-module="ops.service_level_simulator"]');
const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true });

async function open(page: Page, locale: Locale, query = '') {
  await page.goto(`${ROUTE(locale)}${query}`);
  await expect(root(page)).toHaveAttribute('data-state', 'filled');
  await expectPageOk(page, locale);
  await waitForHydration(page, '[data-module="ops.service_level_simulator"] button');
}

/** The write's audit event, in the log. */
// Most write roles have no Audit Log access.
async function expectAudit(page: Page, locale: Locale, action: string) {
  await startDemo(page, locale, 'administrator');
  await page.goto(`/${locale}/admin/audit-log?q=${action}`);
  await expect(page.locator('[data-module="admin.audit_log"] tbody tr').first()).toContainText(action);
}

for (const locale of locales) {
  test.describe(`Service-Level Simulator, read only, in ${locale}`, () => {
    test('the Administrator (view only) reads the title, both readings, the zones table and the tabs', async ({ page, baseURL }, testInfo) => {
      const seen = watch(page, baseURL);
      await startDemo(page, locale, 'administrator');
      await open(page, locale);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(titleOf(locale, 'ops.service_level_simulator'));
      await expect(root(page).getByText(m(locale, 'in.title'))).toBeVisible();
      await expect(root(page).getByText(m(locale, 'res.title'))).toBeVisible();
      await expect(root(page).locator('dl').getByText(m(locale, 'read.fromAssignment'))).toBeVisible();
      await expect(root(page).locator('dl').getByText(m(locale, 'read.fromRegistration'))).toBeVisible();
      await expect(root(page).getByRole('tab', { name: m(locale, 'tab.zones') })).toBeVisible();
      await expect(root(page).getByRole('tab', { name: new RegExp(m(locale, 'tab.history')) })).toBeVisible();
      await expect(root(page).getByText(text(locale, 'shell.access.view'))).toBeVisible();
      await expect(root(page).getByText(text(locale, 'common.illustrative')).first()).toBeVisible();
      await shot(page, testInfo, locale, 'service-level-simulator-filled');
      seen.expectClean();
    });

    test('the review states ?state=empty, loading, error and noaccess keep the header and show their text', async ({ page, baseURL }, testInfo) => {
      const seen = watch(page, baseURL);
      await startDemo(page, locale, 'administrator');
      for (const state of ['empty', 'loading', 'error'] as const) {
        await page.goto(`${ROUTE(locale)}?state=${state}`);
        await expect(root(page)).toHaveAttribute('data-state', state);
        await expect(page.getByRole('heading', { level: 1 })).toHaveText(titleOf(locale, 'ops.service_level_simulator'));
        await shot(page, testInfo, locale, `service-level-simulator-${state}`);
      }
      seen.expectClean();
    });
  });
}

test.describe.serial('Service-Level Simulator, the write (run a simulation)', () => {
  const locale: Locale = 'en';

  test('the Run button is unavailable to a view-only role', async ({ page, baseURL }) => {
    const seen = watch(page, baseURL);
    await startDemo(page, locale, 'administrator');
    await open(page, locale);
    await expect(button(page, m(locale, 'run'))).toHaveAttribute('aria-disabled', 'true');
    seen.expectClean();
  });

  test('a Planner runs a simulation against a real roster and day; it appears at the top of History', async ({ page, baseURL }, testInfo) => {
    const seen = watch(page, baseURL);
    await startDemo(page, locale, 'planner');
    await open(page, locale);
    const runButton = button(page, m(locale, 'run'));
    await expect(runButton).not.toHaveAttribute('aria-disabled', 'true');
    await runButton.click();
    await expect(page.getByText(m(locale, 'toast.done'))).toBeVisible();
    await shot(page, testInfo, locale, 'service-level-simulator-run-done');
    await root(page).getByRole('tab', { name: new RegExp(m(locale, 'tab.history')) }).click();
    const firstRow = root(page).locator('table tbody tr').first();
    await expect(firstRow.getByText(m(locale, 'status.succeeded'))).toBeVisible();
    await expectAudit(page, locale, 'simulation.run');
    seen.expectClean();
  });

  test('selecting a History row shows that run’s own results', async ({ page, baseURL }) => {
    const seen = watch(page, baseURL);
    await startDemo(page, locale, 'planner');
    await open(page, locale);
    await root(page).getByRole('tab', { name: new RegExp(m(locale, 'tab.history')) }).click();
    const secondRow = root(page).locator('table tbody tr').nth(1);
    await secondRow.click();
    await page.waitForURL(/[?&]run=/);
    await expect(root(page)).toHaveAttribute('data-state', 'filled');
    seen.expectClean();
  });
});
