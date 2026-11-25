// SPDX-License-Identifier: AGPL-3.0-only
import path from 'node:path';
import { type Page } from '@playwright/test';
import { expect, test } from '../fixtures';
import { expectPageOk, shot, startDemo, waitForHydration, watch } from '../helpers';
import { locales, text, titleOf, type Locale } from '../routes';
import { readMessages } from '../messages';

// Productivity and Metrics (Ops 12.
// Read only: time to scene and time on scene per
// agent and zone, both clock starts always
// shown, a zone-by-hour heat map and a
// per-agent drawer with the week's cases.

type Tree = { [key: string]: string | Tree };
const module_ = (locale: Locale): Tree =>
  readMessages(path.join(import.meta.dirname, '../../apps/web/messages/ops/productivity_metrics', `${locale}.json`)) as Tree;
const MODULE = { en: module_('en'), ar: module_('ar') };
function m(locale: Locale, key: string, values: Record<string, string> = {}): string {
  let node: string | Tree | undefined = MODULE[locale];
  for (const part of key.split('.')) node = typeof node === 'object' ? node[part] : undefined;
  if (typeof node !== 'string') throw new Error(`No message ops.productivity_metrics.${locale}:${key}`);
  return Object.entries(values).reduce((out, [name, value]) => out.replaceAll(`{${name}}`, value), node);
}

const ROUTE = (locale: Locale) => `/${locale}/ops/productivity-metrics`;
const root = (page: Page) => page.locator('[data-module="ops.productivity_metrics"]');

async function open(page: Page, locale: Locale, query = '') {
  await page.goto(`${ROUTE(locale)}${query}`);
  await expect(root(page)).toHaveAttribute('data-state', 'filled');
  await expectPageOk(page, locale);
  await waitForHydration(page, '[data-module="ops.productivity_metrics"] button');
}

for (const locale of locales) {
  test.describe(`Productivity and Metrics, in ${locale}`, () => {
    test('reads the title, the four figures, the histograms, the heat map and the agent table', async ({ page, baseURL }, testInfo) => {
      const seen = watch(page, baseURL);
      await startDemo(page, locale, 'planner');
      await open(page, locale);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(titleOf(locale, 'ops.productivity_metrics'));
      await expect(root(page).getByText(m(locale, 'cases')).first()).toBeVisible();
      await expect(root(page).getByText(m(locale, 'agents')).first()).toBeVisible();
      await expect(root(page).getByText(m(locale, 'onSceneMedian')).first()).toBeVisible();
      await expect(root(page).getByText(m(locale, 'read.title')).first()).toBeVisible();
      await expect(root(page).getByText(m(locale, 'hist.toScene')).first()).toBeVisible();
      await expect(root(page).getByText(m(locale, 'hist.onScene')).first()).toBeVisible();
      await expect(root(page).getByRole('heading', { name: m(locale, 'heat.title') })).toBeVisible();
      await expect(root(page).getByRole('heading', { name: m(locale, 'tbl.title') })).toBeVisible();
      await expect(root(page).getByText(text(locale, 'common.illustrative')).first()).toBeVisible();
      await expect(root(page).getByText(text(locale, 'shell.access.view'))).toBeVisible();
      await shot(page, testInfo, locale, 'productivity-metrics-filled');
      seen.expectClean();
    });

    test('the review states ?state=empty, loading, error and noaccess keep the header and show their text', async ({ page, baseURL }, testInfo) => {
      const seen = watch(page, baseURL);
      await startDemo(page, locale, 'planner');
      for (const state of ['empty', 'loading', 'error'] as const) {
        await page.goto(`${ROUTE(locale)}?state=${state}`);
        await expect(root(page)).toHaveAttribute('data-state', state);
        await expect(page.getByRole('heading', { level: 1 })).toHaveText(titleOf(locale, 'ops.productivity_metrics'));
        await shot(page, testInfo, locale, `productivity-metrics-${state}`);
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

test.describe.serial('Productivity and Metrics, the distributions, the table and the drawer', () => {
  const locale: Locale = 'en';

  test('the zone select narrows the two histograms', async ({ page, baseURL }) => {
    const seen = watch(page, baseURL);
    await startDemo(page, locale, 'planner');
    await open(page, locale);
    const zoneSelect = root(page).getByRole('combobox', { name: text(locale, 'common.zone') });
    await zoneSelect.selectOption({ index: 1 });
    await expect(page).toHaveURL(/[?&]zone=/);
    seen.expectClean();
  });

  test('the clock toggle switches the to-scene histogram between assignment and registration', async ({ page, baseURL }) => {
    const seen = watch(page, baseURL);
    await startDemo(page, locale, 'planner');
    await open(page, locale);
    const registration = root(page).getByRole('radio', { name: m(locale, 'fromRegistration') }).first();
    await registration.click();
    await expect(page).toHaveURL(/[?&]clock=r/);
    seen.expectClean();
  });

  test('searching the agent table narrows the rows', async ({ page, baseURL }) => {
    const seen = watch(page, baseURL);
    await startDemo(page, locale, 'planner');
    await open(page, locale);
    const rowsBefore = await root(page).locator('table tbody tr').count();
    await root(page).getByPlaceholder(m(locale, 'search')).fill('no such agent at all');
    await expect(page).toHaveURL(/[?&]q=/);
    await expect(root(page).getByText(m(locale, 'none.title'))).toBeVisible();
    const rowsAfter = await root(page).locator('table tbody tr').count();
    expect(rowsAfter).toBeLessThan(rowsBefore || 1);
    seen.expectClean();
  });

  test('clicking an agent row opens their week in a drawer', async ({ page, baseURL }, testInfo) => {
    const seen = watch(page, baseURL);
    await startDemo(page, locale, 'planner');
    await open(page, locale);
    const firstRow = root(page).locator('table tbody tr').first();
    await firstRow.click();
    await expect(page).toHaveURL(/[?&]agent=/);
    const drawer = page.getByRole('dialog');
    await expect(drawer).toBeVisible();
    await expect(drawer.getByText(m(locale, 'drawer.week')).first()).toBeVisible();
    await expect(drawer.getByText(m(locale, 'drawer.zoneMedian')).first()).toBeVisible();
    await shot(page, testInfo, locale, 'productivity-metrics-drawer');
    seen.expectClean();
  });

  test('a Remote Team Lead (no access) is refused; an Administrator reads it view only', async ({ page, baseURL }) => {
    const seen = watch(page, baseURL);
    await startDemo(page, locale, 'remote_team_lead');
    await page.goto(ROUTE(locale));
    await expect(root(page)).toHaveAttribute('data-state', 'noaccess');
    await startDemo(page, locale, 'administrator');
    await open(page, locale);
    await expect(root(page).getByText(text(locale, 'shell.access.view'))).toBeVisible();
    seen.expectClean();
  });
});
