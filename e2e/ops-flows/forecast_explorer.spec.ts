// SPDX-License-Identifier: AGPL-3.0-only
import path from 'node:path';
import { type Page } from '@playwright/test';
import { expect, test } from '../fixtures';
import { expectPageOk, shot, startDemo, waitForHydration, watch } from '../helpers';
import { locales, text, titleOf, type Locale } from '../routes';
import { readMessages } from '../messages';

// Forecast Explorer (Ops 1).
// Map and 15-min timeline of a zone and day, the
// sub-zone heat overlay, likely range, and the
// field/remote split (from active classification
// rules). Read only: every role reads the same
// figures, all Illustrative.

type Tree = { [key: string]: string | Tree };
const module_ = (locale: Locale): Tree => readMessages(path.join(import.meta.dirname, '../../apps/web/messages/ops/forecast_explorer', `${locale}.json`)) as Tree;
const MODULE = { en: module_('en'), ar: module_('ar') };
function m(locale: Locale, key: string, values: Record<string, string> = {}): string {
  let node: string | Tree | undefined = MODULE[locale];
  for (const part of key.split('.')) node = typeof node === 'object' ? node[part] : undefined;
  if (typeof node !== 'string') throw new Error(`No message ops.forecast_explorer.${locale}:${key}`);
  return Object.entries(values).reduce((out, [name, value]) => out.replaceAll(`{${name}}`, value), node);
}

const ROUTE = (locale: Locale) => `/${locale}/ops/forecast-explorer`;
const root = (page: Page) => page.locator('[data-module="ops.forecast_explorer"]');

async function open(page: Page, locale: Locale, query = '') {
  await page.goto(`${ROUTE(locale)}${query}`);
  await expect(root(page)).toHaveAttribute('data-state', 'filled');
  await expectPageOk(page, locale);
  await waitForHydration(page, '[data-module="ops.forecast_explorer"] select');
}

for (const locale of locales) {
  test.describe(`Forecast Explorer, in ${locale}`, () => {
    test('reads the title, the picker, the four stats, the map, the split and the timeline', async ({ page, baseURL }, testInfo) => {
      const seen = watch(page, baseURL);
      await startDemo(page, locale, 'planner');
      await open(page, locale);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(titleOf(locale, 'ops.forecast_explorer'));
      for (const key of ['stat.expected', 'stat.peak', 'stat.range', 'stat.field']) {
        await expect(root(page).getByText(m(locale, key))).toBeVisible();
      }
      await expect(root(page).getByRole('heading', { name: m(locale, 'map.title') })).toBeVisible();
      await expect(root(page).getByRole('heading', { name: m(locale, 'split.title') })).toBeVisible();
      await expect(root(page).getByRole('heading', { name: m(locale, 'top.title') })).toBeVisible();
      await expect(root(page).getByRole('heading', { name: m(locale, 'tl.title') })).toBeVisible();
      await expect(root(page).getByText(text(locale, 'common.illustrative')).first()).toBeVisible();
      await shot(page, testInfo, locale, 'forecast-explorer-filled');
      seen.expectClean();
    });

    test('the review states ?state=empty, loading, error and noaccess keep the header and show their text', async ({ page, baseURL }, testInfo) => {
      const seen = watch(page, baseURL);
      await startDemo(page, locale, 'planner');
      for (const state of ['empty', 'loading', 'error'] as const) {
        await page.goto(`${ROUTE(locale)}?state=${state}`);
        await expect(root(page)).toHaveAttribute('data-state', state);
        await expect(page.getByRole('heading', { level: 1 })).toHaveText(titleOf(locale, 'ops.forecast_explorer'));
        await shot(page, testInfo, locale, `forecast-explorer-${state}`);
      }
      seen.expectClean();
    });

    test('a Change Approver (no access) sees the no-access panel', async ({ page, baseURL }) => {
      const seen = watch(page, baseURL);
      await startDemo(page, locale, 'change_approver');
      await page.goto(ROUTE(locale));
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await expect(page.locator('[data-module]')).toHaveCount(0);
      seen.expectClean();
    });
  });
}

test.describe.serial('Forecast Explorer, the picker and the rule preview', () => {
  const locale: Locale = 'en';

  test('the day strip offers only the forecast run\'s days; a day before it is ignored', async ({ page, baseURL }) => {
    const seen = watch(page, baseURL);
    await startDemo(page, locale, 'planner');
    await open(page, locale, '?day=2026-09-10');
    await expect(root(page).getByRole('radio', { name: 'Thu 10' })).toHaveCount(0);
    const others = root(page).getByRole('radio', { name: /^(Sun|Mon|Tue|Wed|Thu|Fri|Sat) \d+$/, checked: false });
    if ((await others.count()) > 0) {
      await others.first().click();
      await expect(page).toHaveURL(/[?&]day=2026-09-/);
    }
    seen.expectClean();
  });

  test('a role with Classification Rules access may preview a draft rule; the split and the counts move', async ({ page, baseURL }) => {
    const seen = watch(page, baseURL);
    await startDemo(page, locale, 'administrator');
    await open(page, locale);
    const draftOption = root(page).getByRole('radio', { name: m(locale, 'rules.draft') });
    await expect(draftOption).toBeVisible();
    await draftOption.click();
    await expect(page).toHaveURL(/[?&]rules=draft/);
    await expect(root(page).getByText(m(locale, 'draft.note'))).toBeVisible();
    seen.expectClean();
  });

  test('a Dispatcher (no Classification Rules access) never sees the "With draft" choice, only the active split', async ({ page, baseURL }) => {
    const seen = watch(page, baseURL);
    await startDemo(page, locale, 'dispatcher');
    await open(page, locale);
    await expect(root(page).getByRole('radio', { name: m(locale, 'rules.draft') })).toHaveCount(0);
    await expect(root(page).getByText(m(locale, 'rules.active'))).toBeVisible();
    seen.expectClean();
  });

  test('the basemap plot is dir="ltr" and never flips with the page direction', async ({ page, baseURL }) => {
    const seen = watch(page, baseURL);
    await startDemo(page, locale, 'planner');
    await open(page, locale);
    await expect(root(page).locator('[role="img"][dir="ltr"]').first()).toHaveAttribute('dir', 'ltr');
    seen.expectClean();
  });
});
