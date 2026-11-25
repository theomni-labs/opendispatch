// SPDX-License-Identifier: AGPL-3.0-only
import path from 'node:path';
import { type Page, type TestInfo } from '@playwright/test';
import { expect, test } from './fixtures';
import { expectPageOk, shot, signOutViaSwitcher, startDemo, waitForHydration, watch } from '../helpers';
import { text, type Locale } from '../routes';
import { readMessages } from '../messages';

// Flow 4: scenario headcount change, gap recalc.
// Scenario/simulation records are demo-store.
// Reads live rosters, so needs the api server up.

type Tree = { [key: string]: string | Tree };
const module_ = (mod: string, locale: Locale): Tree => readMessages(path.join(import.meta.dirname, `../../apps/web/messages/${mod}`, `${locale}.json`)) as Tree;
const SC = { en: module_('ops/scenario_lab', 'en'), ar: module_('ops/scenario_lab', 'ar') };
const SL = { en: module_('ops/service_level_simulator', 'en'), ar: module_('ops/service_level_simulator', 'ar') };

function m(tree: Record<Locale, Tree>, locale: Locale, key: string, values: Record<string, string> = {}): string {
  let node: string | Tree | undefined = tree[locale];
  for (const part of key.split('.')) node = typeof node === 'object' ? node[part] : undefined;
  if (typeof node !== 'string') throw new Error(`No message ${key} (${locale})`);
  return Object.entries(values).reduce((out, [name, value]) => out.replaceAll(`{${name}}`, value), node);
}

const SC_ROUTE = (locale: Locale, query = '') => `/${locale}/ops/scenario-lab${query}`;
const SL_ROUTE = (locale: Locale) => `/${locale}/ops/service-level-simulator`;
const AUDIT_ROUTE = (locale: Locale, action: string) => `/${locale}/admin/audit-log?q=${action}`;
const scRoot = (page: Page) => page.locator('[data-module="ops.scenario_lab"]');
const slRoot = (page: Page) => page.locator('[data-module="ops.service_level_simulator"]');

async function open(page: Page, locale: Locale, route: string, moduleSelector: string) {
  await page.goto(route);
  await expect(page.locator(moduleSelector)).toHaveAttribute('data-state', 'filled');
  await waitForHydration(page, `${moduleSelector} button`);
}

async function runFlow(page: Page, testInfo: TestInfo, baseURL: string | undefined, locale: Locale, recordShots: boolean) {
  const seen = watch(page, baseURL);

  await startDemo(page, locale, 'planner');

  // Blank form auto-picks the planner's first zone.
  await open(page, locale, SC_ROUTE(locale), '[data-module="ops.scenario_lab"]');
  await scRoot(page).getByRole('button', { name: m(SC, locale, 'new'), exact: true }).click();
  await expect(page).toHaveURL(/scenario=new/);

  await scRoot(page).getByLabel(m(SC, locale, 'f.name')).fill('E2E flow 4');
  const fieldInput = scRoot(page).getByRole('spinbutton', { name: m(SC, locale, 'f.field') });
  await fieldInput.fill('10');
  await fieldInput.press('Tab');

  if (recordShots) await shot(page, testInfo, locale, 'flow4-editor');
  await scRoot(page).getByRole('button', { name: text(locale, 'common.save'), exact: true }).click();
  await expect(page.getByText(m(SC, locale, 'toast.saved'))).toBeVisible();

  // +10 field agents must move the gap count.
  await expect(scRoot(page).getByText(m(SC, locale, 'res.needsSave'))).toHaveCount(0);
  const delta = await scRoot(page).locator('bdi[dir="ltr"]').first().textContent();
  expect(delta, 'the +10 field change moved the zone gap count').not.toBe('+0');
  if (recordShots) await shot(page, testInfo, locale, 'flow4-comparison');

  await scRoot(page).getByRole('button', { name: m(SC, locale, 'run'), exact: true }).click();
  await expect(page.getByText(m(SC, locale, 'toast.ran'))).toBeVisible();
  await expect(scRoot(page).getByText(m(SC, locale, 'read.fromAssignment'))).toBeVisible();
  if (recordShots) await shot(page, testInfo, locale, 'flow4-run');

  // A real roster replay: history should grow by one.
  await open(page, locale, SL_ROUTE(locale), '[data-module="ops.service_level_simulator"]');
  const historyTab = slRoot(page).getByRole('tab', { name: new RegExp(m(SL, locale, 'tab.history')) });
  const countBefore = (await historyTab.textContent()) ?? '';

  await slRoot(page).getByRole('button', { name: m(SL, locale, 'run'), exact: true }).click();
  await expect(page.getByText(m(SL, locale, 'toast.done'))).toBeVisible();
  if (recordShots) await shot(page, testInfo, locale, 'flow4-simulator');

  // Auto-retry: the count updates via an async push.
  await expect(historyTab).not.toHaveText(countBefore);

  await signOutViaSwitcher(page, locale);
  await startDemo(page, locale, 'administrator');
  for (const action of ['scenario.created', 'scenario.run', 'simulation.run']) {
    await page.goto(AUDIT_ROUTE(locale, action));
    await expect(page.locator('[data-module="admin.audit_log"] tbody tr').first()).toContainText(action);
  }

  await expectPageOk(page, locale);
  seen.expectClean();
}

// Video is worker-scoped; set once, file wide.
test.use({ video: 'on' });

test.describe('English', () => {
  test('flow 4: a scenario changes headcount, the gap view recalculates, a service-level run replays a roster', async ({ page, baseURL }, testInfo) => {
    await runFlow(page, testInfo, baseURL, 'en', true);
  });
});

test.describe('Arabic', () => {
  test('flow 4: the same flow works', async ({ page, baseURL }, testInfo) => {
    await runFlow(page, testInfo, baseURL, 'ar', false);
  });
});
