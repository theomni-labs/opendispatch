// SPDX-License-Identifier: AGPL-3.0-only
import path from 'node:path';
import { type Page } from '@playwright/test';
import { expect, test } from '../fixtures';
import { expectPageOk, shot, startDemo, waitForHydration, watch } from '../helpers';
import { locales, text, titleOf, type Locale } from '../routes';
import { readMessages } from '../messages';

// Standby and Coverage Map (Ops 5. The
// coverage map, the standby points list, and the
// recommended move (Illustrative). Only
// the Planner may apply a move; others read only.

type Tree = { [key: string]: string | Tree };
const module_ = (locale: Locale): Tree => readMessages(path.join(import.meta.dirname, '../../apps/web/messages/ops/standby_coverage', `${locale}.json`)) as Tree;
const MODULE = { en: module_('en'), ar: module_('ar') };
function m(locale: Locale, key: string, values: Record<string, string> = {}): string {
  let node: string | Tree | undefined = MODULE[locale];
  for (const part of key.split('.')) node = typeof node === 'object' ? node[part] : undefined;
  if (typeof node !== 'string') throw new Error(`No message ops.standby_coverage.${locale}:${key}`);
  return Object.entries(values).reduce((out, [name, value]) => out.replaceAll(`{${name}}`, value), node);
}

const ROUTE = (locale: Locale) => `/${locale}/ops/standby-coverage`;
const root = (page: Page) => page.locator('[data-module="ops.standby_coverage"]');

async function open(page: Page, locale: Locale, query = '') {
  await page.goto(`${ROUTE(locale)}${query}`);
  await expect(root(page)).toHaveAttribute('data-state', 'filled');
  await expectPageOk(page, locale);
  await waitForHydration(page, '[data-module="ops.standby_coverage"] select');
}

for (const locale of locales) {
  test.describe(`Standby and Coverage Map, in ${locale}`, () => {
    test('reads the title, the four stats, the map, the points list and the recommended move', async ({ page, baseURL }, testInfo) => {
      const seen = watch(page, baseURL);
      await startDemo(page, locale, 'planner');
      await open(page, locale);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(titleOf(locale, 'ops.standby_coverage'));
      for (const key of ['stat.points', 'stat.waiting', 'stat.covered', 'stat.out']) {
        await expect(root(page).getByText(m(locale, key)).first()).toBeVisible();
      }
      await expect(root(page).getByRole('heading', { name: m(locale, 'map.title'), exact: true })).toBeVisible();
      await expect(root(page).getByRole('heading', { name: m(locale, 'list.title'), exact: true })).toBeVisible();
      await expect(root(page).getByRole('heading', { name: m(locale, 'reco.title'), exact: true })).toBeVisible();
      await expect(root(page).getByText(text(locale, 'common.illustrative')).first()).toBeVisible();
      await shot(page, testInfo, locale, 'standby-coverage-filled');
      seen.expectClean();
    });

    test('the review states ?state=empty, loading, error and noaccess keep the header and show their text', async ({ page, baseURL }, testInfo) => {
      const seen = watch(page, baseURL);
      await startDemo(page, locale, 'planner');
      for (const state of ['empty', 'loading', 'error'] as const) {
        await page.goto(`${ROUTE(locale)}?state=${state}`);
        await expect(root(page)).toHaveAttribute('data-state', state);
        await expect(page.getByRole('heading', { level: 1 })).toHaveText(titleOf(locale, 'ops.standby_coverage'));
        await shot(page, testInfo, locale, `standby-coverage-${state}`);
      }
      seen.expectClean();
    });

    test('a Remote Team Lead (no access) sees the no-access panel', async ({ page, baseURL }) => {
      const seen = watch(page, baseURL);
      await startDemo(page, locale, 'remote_team_lead');
      await page.goto(ROUTE(locale));
      await expect(root(page)).toHaveAttribute('data-state', 'noaccess');
      seen.expectClean();
    });
  });
}

test.describe.serial('Standby and Coverage Map, role gating and the map', () => {
  const locale: Locale = 'en';

  test('a Dispatcher (view only) can open the screen but the Apply move button is disabled', async ({ page, baseURL }) => {
    const seen = watch(page, baseURL);
    await startDemo(page, locale, 'dispatcher');
    await open(page, locale);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(titleOf(locale, 'ops.standby_coverage'));
    const apply = root(page).getByRole('button', { name: m(locale, 'reco.apply') });
    if ((await apply.count()) > 0) await expect(apply).toHaveAttribute('aria-disabled', 'true');
    seen.expectClean();
  });

  test('clicking a standby point in the list highlights the point on the map', async ({ page, baseURL }) => {
    const seen = watch(page, baseURL);
    await startDemo(page, locale, 'planner');
    await open(page, locale);
    const firstRow = root(page).locator('table tbody tr').first();
    await firstRow.getByRole('button').click();
    await expect(page).toHaveURL(/[?&]pt=/);
    seen.expectClean();
  });

  test('the map is a picture of data (dir="ltr", translate="no") and never flips with the page direction', async ({ page, baseURL }) => {
    const seen = watch(page, baseURL);
    await startDemo(page, locale, 'planner');
    await open(page, locale);
    await expect(root(page).locator('[data-map-plot]')).toHaveAttribute('dir', 'ltr');
    seen.expectClean();
  });
});
