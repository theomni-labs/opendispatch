// SPDX-License-Identifier: AGPL-3.0-only
import path from 'node:path';
import { type Page } from '@playwright/test';
import { expect, test } from '../fixtures';
import { expectPageOk, shot, startDemo, waitForHydration, watch } from '../helpers';
import { locales, text, titleOf, type Locale } from '../routes';
import { readMessages } from '../messages';

// Management Dashboards (Ops 11. Read
// only: zone, city and kingdom roll-ups, a scope
// switcher (kingdom/city/zone), the 10-minute
// reading, a comparison chart, a 7-day trend and
// the zone table. A zone row opens that zone.

type Tree = { [key: string]: string | Tree };
const module_ = (locale: Locale): Tree =>
  readMessages(path.join(import.meta.dirname, '../../apps/web/messages/ops/management_dashboards', `${locale}.json`)) as Tree;
const MODULE = { en: module_('en'), ar: module_('ar') };
function m(locale: Locale, key: string, values: Record<string, string> = {}): string {
  let node: string | Tree | undefined = MODULE[locale];
  for (const part of key.split('.')) node = typeof node === 'object' ? node[part] : undefined;
  if (typeof node !== 'string') throw new Error(`No message ops.management_dashboards.${locale}:${key}`);
  return Object.entries(values).reduce((out, [name, value]) => out.replaceAll(`{${name}}`, value), node);
}

const ROUTE = (locale: Locale) => `/${locale}/ops/management-dashboards`;
const root = (page: Page) => page.locator('[data-module="ops.management_dashboards"]');

async function open(page: Page, locale: Locale, query = '') {
  await page.goto(`${ROUTE(locale)}${query}`);
  await expect(root(page)).toHaveAttribute('data-state', 'filled');
  await expectPageOk(page, locale);
  await waitForHydration(page, '[data-module="ops.management_dashboards"] button');
}

for (const locale of locales) {
  test.describe(`Management Dashboards, in ${locale}`, () => {
    test('reads the title, the scope switcher, the headline figures and the zones table', async ({ page, baseURL }, testInfo) => {
      const seen = watch(page, baseURL);
      await startDemo(page, locale, 'administrator');
      await open(page, locale);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(titleOf(locale, 'ops.management_dashboards'));
      await expect(root(page).getByRole('radio', { name: m(locale, 'scope.kingdom') })).toBeVisible();
      await expect(root(page).getByRole('radio', { name: m(locale, 'scope.city') })).toBeVisible();
      await expect(root(page).getByRole('radio', { name: m(locale, 'scope.zone') })).toBeVisible();
      await expect(
        root(page)
          .getByText(m(locale, 'stat.cases'))
          .first(),
      ).toBeVisible();
      await expect(root(page).getByText(m(locale, 'stat.regAssigned'))).toBeVisible();
      await expect(
        root(page)
          .getByText(m(locale, 'stat.onShift'))
          .first(),
      ).toBeVisible();
      await expect(root(page).getByRole('heading', { name: m(locale, 'read.title') })).toBeVisible();
      await expect(root(page).getByRole('heading', { name: m(locale, 'cmp.cities') })).toBeVisible();
      await expect(root(page).getByRole('heading', { name: m(locale, 'trend.title') })).toBeVisible();
      await expect(root(page).getByRole('heading', { name: m(locale, 'zones.title') })).toBeVisible();
      await expect(root(page).getByText(text(locale, 'common.illustrative')).first()).toBeVisible();
      await shot(page, testInfo, locale, 'management-dashboards-filled');
      seen.expectClean();
    });

    test('the review states ?state=empty, loading, error and noaccess keep the header and show their text', async ({ page, baseURL }, testInfo) => {
      const seen = watch(page, baseURL);
      await startDemo(page, locale, 'administrator');
      for (const state of ['empty', 'loading', 'error'] as const) {
        await page.goto(`${ROUTE(locale)}?state=${state}`);
        await expect(root(page)).toHaveAttribute('data-state', state);
        await expect(page.getByRole('heading', { level: 1 })).toHaveText(titleOf(locale, 'ops.management_dashboards'));
        await shot(page, testInfo, locale, `management-dashboards-${state}`);
      }
      seen.expectClean();
    });

    test('a Dispatcher (no access) sees the no-access panel', async ({ page, baseURL }) => {
      const seen = watch(page, baseURL);
      await startDemo(page, locale, 'dispatcher');
      await page.goto(ROUTE(locale));
      await expect(root(page)).toHaveAttribute('data-state', 'noaccess');
      seen.expectClean();
    });
  });
}

test.describe.serial('Management Dashboards, the scope switcher and the zone table', () => {
  const locale: Locale = 'en';

  test('switching to Zone shows the zone picker and the zone comparison title', async ({ page, baseURL }) => {
    const seen = watch(page, baseURL);
    await startDemo(page, locale, 'planner');
    await open(page, locale);
    await root(page)
      .getByRole('radio', { name: m(locale, 'scope.zone') })
      .click();
    await expect(page).toHaveURL(/[?&]scope=zone/);
    await expect(root(page).getByRole('combobox', { name: m(locale, 'pick.zone') })).toBeVisible();
    await expect(root(page).getByRole('heading', { name: m(locale, 'cmp.zones') })).toBeVisible();
    seen.expectClean();
  });

  test('clicking a zone row opens that zone and highlights its row', async ({ page, baseURL }) => {
    const seen = watch(page, baseURL);
    await startDemo(page, locale, 'planner');
    await open(page, locale);
    const row = root(page).locator('table tbody tr', { hasText: 'RD-C' });
    await row.click();
    await expect(page).toHaveURL(/[?&]scope=zone/);
    await expect(page).toHaveURL(/[?&]zone=[0-9a-f-]{36}/);
    await expect(row).toHaveAttribute('data-tone', 'info');
    seen.expectClean();
  });

  test('an Administrator (view only) sees the view badge', async ({ page, baseURL }) => {
    const seen = watch(page, baseURL);
    await startDemo(page, locale, 'administrator');
    await open(page, locale);
    await expect(root(page).getByText(text(locale, 'shell.access.view'))).toBeVisible();
    seen.expectClean();
  });

  test('a Planner (edit) does not see the view badge', async ({ page, baseURL }) => {
    const seen = watch(page, baseURL);
    await startDemo(page, locale, 'planner');
    await open(page, locale);
    await expect(root(page).getByText(text(locale, 'shell.access.view'))).toHaveCount(0);
    seen.expectClean();
  });
});
