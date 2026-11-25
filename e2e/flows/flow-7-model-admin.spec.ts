// SPDX-License-Identifier: AGPL-3.0-only
import path from 'node:path';
import { type Page, type TestInfo } from '@playwright/test';
import { expect, test } from './fixtures';
import { expectPageOk, shot, startDemo, waitForHydration, watch } from '../helpers';
import type { Locale } from '../routes';
import { readMessages } from '../messages';

// Flow 7: switch the forecast version, pause
// it, an alert appears (the bell, Notifications, and the Audit Log). Demo-store only
//: uses the plain ../fixtures, not
// ./fixtures. THE FORECASTER IS A PLACEHOLDER ENGINE: every figure is Illustrative
// (forecast_model/view.ts's own comment). Message-key names below are already proven in
// e2e/admin-flows/forecast_model.spec.ts's own "flow 7" describe block -- reused, not reinvented.

type Tree = { [key: string]: string | Tree };
const module_ = (mod: string, locale: Locale): Tree => readMessages(path.join(import.meta.dirname, `../../apps/web/messages/${mod}`, `${locale}.json`)) as Tree;
const FM = { en: module_('admin/forecast_model', 'en'), ar: module_('admin/forecast_model', 'ar') };

function m(locale: Locale, key: string, values: Record<string, string> = {}): string {
  let node: string | Tree | undefined = FM[locale];
  for (const part of key.split('.')) node = typeof node === 'object' ? node[part] : undefined;
  if (typeof node !== 'string') throw new Error(`No message admin.forecast_model.${locale}:${key}`);
  return Object.entries(values).reduce((out, [name, value]) => out.replaceAll(`{${name}}`, value), node);
}

const ROUTE = (locale: Locale) => `/${locale}/admin/forecast-model`;
const root = (page: Page) => page.locator('[data-module="admin.forecast_model"]');
const rowOf = (page: Page, locale: Locale, version: string) => page.getByRole('table', { name: m(locale, 'v.title') }).getByRole('row').filter({ hasText: version });
const alertBanner = (page: Page, locale: Locale) => page.locator('[role="alert"]:not(#__next-route-announcer__)').filter({ hasText: m(locale, 'alert.title') });

async function open(page: Page, locale: Locale, query = '') {
  await page.goto(`${ROUTE(locale)}${query}`);
  await expect(root(page)).toHaveAttribute('data-state', 'filled');
  await expectPageOk(page, locale);
  await waitForHydration(page, '[data-module="admin.forecast_model"] button');
}

async function expectAudit(page: Page, locale: Locale, action: string) {
  await page.goto(`/${locale}/admin/audit-log?q=${action}`);
  await expect(page.locator('[data-module="admin.audit_log"] tbody tr').first()).toContainText(action);
}

async function runFlow(page: Page, testInfo: TestInfo, baseURL: string | undefined, locale: Locale, recordShots: boolean) {
  const seen = watch(page, baseURL);
  await startDemo(page, locale, 'administrator');
  await open(page, locale);

  const activeBefore = await rowOf(page, locale, 'ensemble-4').getByText(m(locale, 'v.current')).isVisible();
  expect(activeBefore, 'ensemble-4 is the active version before the switch').toBe(true);

  // Switch to ensemble-3.
  await rowOf(page, locale, 'ensemble-3').getByRole('button', { name: m(locale, 'v.makeActive') }).click();
  const switchDialog = page.getByRole('dialog');
  await switchDialog.getByRole('textbox').fill('flow 7 walkthrough: try the previous version.');
  if (recordShots) await shot(page, testInfo, locale, 'flow7-switch-dialog');
  await switchDialog.getByRole('button', { name: m(locale, 'v.makeActive'), exact: true }).click();
  await expect(page.getByText(m(locale, 'toast.switched', { v: 'ensemble-3' }))).toBeVisible();
  await expect(rowOf(page, locale, 'ensemble-3').getByText(m(locale, 'v.current'))).toBeVisible();
  await expectAudit(page, locale, 'model.version_switched');
  if (recordShots) await shot(page, testInfo, locale, 'flow7-switched');

  // Pause it: the alert appears on the page, in Notifications, and in the Audit Log.
  await open(page, locale);
  await page.getByRole('switch', { name: m(locale, 'p.switch') }).click();
  const pauseDialog = page.getByRole('dialog');
  await pauseDialog.getByRole('textbox').fill('flow 7 walkthrough: pausing to check the alert.');
  await pauseDialog.getByRole('button', { name: m(locale, 'p.switch'), exact: true }).click();
  await expect(page.getByText(m(locale, 'toast.notified'))).toBeVisible();
  await expect(alertBanner(page, locale)).toContainText('flow 7 walkthrough: pausing to check the alert.');
  await expect(page.getByRole('button', { name: m(locale, 'run.label'), exact: true }).first()).toHaveAttribute('aria-disabled', 'true');
  if (recordShots) await shot(page, testInfo, locale, 'flow7-paused');
  await expectAudit(page, locale, 'model.paused');

  await page.goto(`/${locale}/admin/notifications-alerts?tab=log`);
  await expect(page.locator('[data-module="admin.notifications_alerts"]')).toContainText('Forecast paused');
  if (recordShots) await shot(page, testInfo, locale, 'flow7-notifications');

  // No dead end: resume puts it back and clears the alert.
  await open(page, locale);
  await alertBanner(page, locale).getByRole('button', { name: m(locale, 'resume'), exact: true }).click();
  await page.getByRole('dialog').getByRole('textbox').fill('Fixed.');
  await page.getByRole('dialog').getByRole('button', { name: m(locale, 'resume'), exact: true }).click();
  await expect(page.getByText(m(locale, 'toast.resumed'), { exact: true })).toBeVisible();
  await expect(alertBanner(page, locale)).toHaveCount(0);
  await expectAudit(page, locale, 'model.resumed');

  // Put the version back too, so this run leaves no state for another flow to trip over.
  await open(page, locale);
  await rowOf(page, locale, 'ensemble-4').getByRole('button', { name: m(locale, 'v.makeActive') }).click();
  await page.getByRole('dialog').getByRole('textbox').fill('Back to the first version.');
  await page.getByRole('dialog').getByRole('button', { name: m(locale, 'v.makeActive'), exact: true }).click();
  await expect(rowOf(page, locale, 'ensemble-4').getByText(m(locale, 'v.current'))).toBeVisible();

  await expectPageOk(page, locale);
  seen.expectClean();
}

// video is a worker-level setting tied to this file's own worker-scoped server fixture --
// Playwright refuses to change it inside a nested describe. Set once, file-wide (matches flow-1's
// own resolved convention: both locales get a video, not just English).
test.use({ video: 'on' });

test.describe('English', () => {
  test('flow 7: switch the forecast version, pause it, the alert appears (the page, Notifications and the Audit Log), then resume', async ({ page, baseURL }, testInfo) => {
    await runFlow(page, testInfo, baseURL, 'en', true);
  });
});

test.describe('Arabic', () => {
  test('flow 7: the same flow works', async ({ page, baseURL }, testInfo) => {
    await runFlow(page, testInfo, baseURL, 'ar', false);
  });
});
