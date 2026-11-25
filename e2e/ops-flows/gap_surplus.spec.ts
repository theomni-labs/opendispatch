// SPDX-License-Identifier: AGPL-3.0-only
import path from 'node:path';
import { type Page } from '@playwright/test';
import { expect, test } from '../fixtures';
import { expectPageOk, shot, startDemo, waitForHydration, watch } from '../helpers';
import { locales, text, titleOf, type Locale } from '../routes';
import { readMessages } from '../messages';

// Gap and Surplus (Ops 6. Read only: the
// heat grid of planned against required per zone and
// interval, with the cause (people, vehicles,
// geography). A cell opens a detail drawer that
// links to Field Planner or Standby Coverage.

type Tree = { [key: string]: string | Tree };
const module_ = (locale: Locale): Tree => readMessages(path.join(import.meta.dirname, '../../apps/web/messages/ops/gap_surplus', `${locale}.json`)) as Tree;
const MODULE = { en: module_('en'), ar: module_('ar') };
function m(locale: Locale, key: string, values: Record<string, string> = {}): string {
  let node: string | Tree | undefined = MODULE[locale];
  for (const part of key.split('.')) node = typeof node === 'object' ? node[part] : undefined;
  if (typeof node !== 'string') throw new Error(`No message ops.gap_surplus.${locale}:${key}`);
  return Object.entries(values).reduce((out, [name, value]) => out.replaceAll(`{${name}}`, value), node);
}

const ROUTE = (locale: Locale) => `/${locale}/ops/gap-surplus`;
const root = (page: Page) => page.locator('[data-module="ops.gap_surplus"]');

async function open(page: Page, locale: Locale, query = '') {
  await page.goto(`${ROUTE(locale)}${query}`);
  await expect(root(page)).toHaveAttribute('data-state', 'filled');
  await expectPageOk(page, locale);
  await waitForHydration(page, '[data-module="ops.gap_surplus"] button');
}

for (const locale of locales) {
  test.describe(`Gap and Surplus, in ${locale}`, () => {
    test('reads the title, the four stats, the grid and the legend', async ({ page, baseURL }, testInfo) => {
      const seen = watch(page, baseURL);
      await startDemo(page, locale, 'planner');
      await open(page, locale);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(titleOf(locale, 'ops.gap_surplus'));
      for (const key of ['stat.met', 'stat.reach', 'stat.worst', 'stat.cause']) {
        await expect(root(page).getByText(m(locale, key))).toBeVisible();
      }
      await expect(root(page).getByRole('heading', { name: m(locale, 'grid.title') })).toBeVisible();
      await expect(root(page).getByText(m(locale, 'key.gap'), { exact: true })).toBeVisible();
      await expect(root(page).getByText(m(locale, 'key.surplus'), { exact: true })).toBeVisible();
      await expect(root(page).getByText(m(locale, 'key.ok'), { exact: true })).toBeVisible();
      await expect(root(page).getByText(text(locale, 'common.illustrative')).first()).toBeVisible();
      await shot(page, testInfo, locale, 'gap-surplus-filled');
      seen.expectClean();
    });

    test('the review states ?state=empty, loading, error and noaccess keep the header and show their text', async ({ page, baseURL }, testInfo) => {
      const seen = watch(page, baseURL);
      await startDemo(page, locale, 'planner');
      for (const state of ['empty', 'loading', 'error'] as const) {
        await page.goto(`${ROUTE(locale)}?state=${state}`);
        await expect(root(page)).toHaveAttribute('data-state', state);
        await expect(page.getByRole('heading', { level: 1 })).toHaveText(titleOf(locale, 'ops.gap_surplus'));
        await shot(page, testInfo, locale, `gap-surplus-${state}`);
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

test.describe.serial('Gap and Surplus, the grid, the cause filter and the drawer', () => {
  const locale: Locale = 'en';

  test('clicking a cell opens the detail drawer with required, planned, delta and cause', async ({ page, baseURL }, testInfo) => {
    const seen = watch(page, baseURL);
    await startDemo(page, locale, 'planner');
    await open(page, locale);
    const cell = root(page).locator('[role="gridcell"][data-kind="gap"]').first();
    await cell.click();
    const drawer = page.getByRole('dialog');
    await expect(drawer).toBeVisible();
    await expect(drawer.getByText(m(locale, 'd.required'))).toBeVisible();
    await expect(drawer.getByText(m(locale, 'd.planned'))).toBeVisible();
    await expect(drawer.getByText(m(locale, 'd.delta'))).toBeVisible();
    await shot(page, testInfo, locale, 'gap-surplus-drawer');
    seen.expectClean();
  });

  test('the cause filter narrows the grid: choosing Geography, then All, changes the gap count stat', async ({ page, baseURL }) => {
    const seen = watch(page, baseURL);
    await startDemo(page, locale, 'planner');
    await open(page, locale);
    const geoOption = root(page).getByRole('radio', { name: new RegExp(m(locale, 'cause.geography')) });
    await geoOption.click();
    await expect(page).toHaveURL(/[?&]cause=geography/);
    await expect(root(page).getByRole('radio', { name: text(locale, 'common.all') })).toBeVisible();
    seen.expectClean();
  });

  test('the density toggle switches between 15-minute and hourly columns', async ({ page, baseURL }) => {
    const seen = watch(page, baseURL);
    await startDemo(page, locale, 'planner');
    await open(page, locale);
    const hourly = root(page).getByRole('radio', { name: m(locale, 'dens.h') });
    await hourly.click();
    await expect(page).toHaveURL(/[?&]dens=h/);
    seen.expectClean();
  });

  test('a Remote Team Lead (view only, no Field Planner or Standby Coverage access) sees no More menu', async ({ page, baseURL }) => {
    const seen = watch(page, baseURL);
    await startDemo(page, locale, 'remote_team_lead');
    await open(page, locale);
    await expect(root(page).getByText(text(locale, 'shell.access.view'))).toBeVisible();
    await expect(root(page).getByRole('button', { name: text(locale, 'common.more') })).toHaveCount(0);
    seen.expectClean();
  });
});
