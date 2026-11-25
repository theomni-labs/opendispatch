// SPDX-License-Identifier: AGPL-3.0-only
import path from 'node:path';
import { type Page } from '@playwright/test';
import { expect, test } from '../fixtures';
import { expectPageOk, shot, signOutViaSwitcher, startDemo, waitForHydration, watch } from '../helpers';
import { locales, text, titleOf, type Locale } from '../routes';
import { readMessages } from '../messages';

// Forecast and Model Admin. THE FORECASTER IS A PLACEHOLDER ENGINE: every figure is
// Illustrative and "Retrain now" is a labelled stub (a Demo toast, no audit). The Administrator reads the versions, the latest run
// and the 10-minute measure (both readings, the primary one from the clock-start setting), runs the forecast, makes a candidate
// version active with a reason and back, pauses the forecast with a reason (which raises the alert that the bell and Notifications
// show: flow 7), resumes, changes the retraining schedule, the clock start and the planning level. Each write is followed by its
// audit event in the Audit Log. The model, pause and settings state is ONE state for the whole run, so the writes are one serial
// chain and put back what they change; the tests before it only read (both languages).

type Tree = { [key: string]: string | Tree };
const module_ = (locale: Locale): Tree => readMessages(path.join(import.meta.dirname, '../../apps/web/messages/admin/forecast_model', `${locale}.json`)) as Tree;
const MODULE = { en: module_('en'), ar: module_('ar') };
/** A key of the module's own message file (`c.pause`), with `{v}` style values put in. */
function m(locale: Locale, key: string, values: Record<string, string> = {}): string {
  let node: string | Tree | undefined = MODULE[locale];
  for (const part of key.split('.')) node = typeof node === 'object' ? node[part] : undefined;
  if (typeof node !== 'string') throw new Error(`No message admin.forecast_model.${locale}:${key}`);
  return Object.entries(values).reduce((out, [name, value]) => out.replaceAll(`{${name}}`, value), node);
}

const ROUTE = (locale: Locale) => `/${locale}/admin/forecast-model`;
const root = (page: Page) => page.locator('[data-module="admin.forecast_model"]');
const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true });

async function open(page: Page, locale: Locale, query = '') {
  await page.goto(`${ROUTE(locale)}${query}`);
  await expect(root(page)).toHaveAttribute('data-state', 'filled');
  await expectPageOk(page, locale);
  await waitForHydration(page, '[data-module="admin.forecast_model"] button');
}

/** The Audit Log filtered by an action code: the write's event is there. */
async function expectAudit(page: Page, locale: Locale, action: string) {
  await page.goto(`/${locale}/admin/audit-log?q=${action}`);
  await expect(page.locator('[data-module="admin.audit_log"] tbody tr').first()).toContainText(action);
}

for (const locale of locales) {
  test.describe(`Forecast and Model Admin, read only, in ${locale}`, () => {
    test(`the Administrator reads the screen: title, the placeholder subtitle, Run forecast and More, four figures, the versions, the latest run, the measure two ways`, async ({ page, baseURL }, testInfo) => {
      const seen = watch(page, baseURL);
      await startDemo(page, locale, 'administrator');
      await open(page, locale);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(titleOf(locale, 'admin.forecast_model'));
      await expect(page.getByText(m(locale, 'sub'))).toBeVisible();
      await expect(page.getByRole('button', { name: m(locale, 'run.label'), exact: true }).first()).toBeEnabled();
      await expect(button(page, text(locale, 'common.more'))).toBeVisible();
      for (const key of ['stat.active', 'stat.last', 'stat.next']) await expect(root(page).getByText(m(locale, key), { exact: true }).first()).toBeVisible();
      await expect(root(page).getByText(/^MAPE[,،] /).first()).toBeVisible();
      await expect(page.getByRole('table', { name: m(locale, 'v.title') }).locator('tbody tr')).toHaveCount(3);
      await expect(page.getByRole('heading', { name: m(locale, 'r.title') })).toBeVisible();
      await expect(root(page).getByText(text(locale, 'common.illustrative')).first()).toBeVisible();
      await expect(page.locator('[data-primary]')).toHaveCount(1);
      await expect(page.getByRole('heading', { name: m(locale, 'h.title') })).toBeVisible();
      await shot(page, testInfo, locale, 'forecast-model-filled');
      seen.expectClean();
    });

    test(`the Change Approver has no access; the review states ?state=empty, loading and error keep the header`, async ({ page, baseURL }, testInfo) => {
      const seen = watch(page, baseURL);
      await startDemo(page, locale, 'administrator');
      for (const state of ['empty', 'loading', 'error'] as const) {
        await page.goto(`${ROUTE(locale)}?state=${state}`);
        await expect(root(page)).toHaveAttribute('data-state', state);
        await expect(page.getByRole('heading', { level: 1 })).toHaveText(titleOf(locale, 'admin.forecast_model'));
        await shot(page, testInfo, locale, `forecast-model-${state}`);
      }
      // The start page sends a signed-in person straight to their landing page: sign out the way a person does, then sign in again.
      await signOutViaSwitcher(page, locale);
      await startDemo(page, locale, 'change_approver');
      await page.goto(ROUTE(locale));
      await expect(root(page)).toHaveAttribute('data-state', 'noaccess');
      seen.expectClean();
    });
  });
}

test.describe.serial('Forecast and Model Admin, the writes', () => {
  const locale: Locale = 'en';

  test('Run forecast finishes at once, the previous version is made active with a reason and then the active one again, and Retrain now is a Demo', async ({ page, baseURL }, testInfo) => {
    const seen = watch(page, baseURL);
    await startDemo(page, locale, 'administrator');
    await open(page, locale);
    await page.getByRole('button', { name: m(locale, 'run.label'), exact: true }).first().click();
    await expect(page.getByText(m(locale, 'toast.run.title'))).toBeVisible();
    await expectAudit(page, locale, 'forecast.run_created');
    await open(page, locale);
    const rowOf = (version: string) => page.getByRole('table', { name: m(locale, 'v.title') }).getByRole('row').filter({ hasText: version });
    await rowOf('ensemble-3').getByRole('button', { name: m(locale, 'v.makeActive') }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('button', { name: m(locale, 'v.makeActive'), exact: true })).toHaveAttribute('aria-disabled', 'true');
    await dialog.getByRole('textbox').fill('The previous model is better on the test days.');
    await shot(page, testInfo, locale, 'forecast-model-switch');
    await dialog.getByRole('button', { name: m(locale, 'v.makeActive'), exact: true }).click();
    await expect(page.getByText(m(locale, 'toast.switched', { v: 'ensemble-3' }))).toBeVisible();
    await expect(rowOf('ensemble-3').getByText(m(locale, 'v.current'))).toBeVisible();
    await rowOf('ensemble-4').getByRole('button', { name: m(locale, 'v.makeActive') }).click();
    await page.getByRole('dialog').getByRole('textbox').fill('Back to the first version.');
    await page.getByRole('dialog').getByRole('button', { name: m(locale, 'v.makeActive'), exact: true }).click();
    await expect(rowOf('ensemble-4').getByText(m(locale, 'v.current'))).toBeVisible();
    await expectAudit(page, locale, 'model.version_switched');
    await open(page, locale);
    await button(page, text(locale, 'common.more')).click();
    await page.getByRole('menuitem', { name: m(locale, 'menu.retrain') }).click();
    await expect(page.getByText(m(locale, 'toast.retrain.title'))).toBeVisible();
    seen.expectClean();
  });

  test('pausing needs a reason and raises the alert (the page, the audit log and Notifications show it); Run forecast is unavailable while paused; Resume puts it back', async ({ page, baseURL }, testInfo) => {
    const seen = watch(page, baseURL);
    await startDemo(page, locale, 'administrator');
    await open(page, locale);
    await page.getByRole('switch', { name: m(locale, 'p.switch') }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('button', { name: m(locale, 'p.switch'), exact: true })).toHaveAttribute('aria-disabled', 'true');
    await dialog.getByRole('textbox').fill('The case feed is being fixed.');
    await dialog.getByRole('button', { name: m(locale, 'p.switch'), exact: true }).click();
    await expect(page.getByText(m(locale, 'toast.notified'))).toBeVisible();
    await expect(page.locator('[role="alert"]:not(#__next-route-announcer__)').filter({ hasText: m(locale, 'alert.title') })).toContainText('The case feed is being fixed.');
    await expect(page.getByRole('button', { name: m(locale, 'run.label'), exact: true }).first()).toHaveAttribute('aria-disabled', 'true');
    await shot(page, testInfo, locale, 'forecast-model-paused');
    await expectAudit(page, locale, 'model.paused');
    // Flow 7: the alert is in Notifications too.
    await page.goto(`/${locale}/admin/notifications-alerts?tab=log`);
    await expect(page.locator('[data-module="admin.notifications_alerts"]')).toContainText('Forecast paused');
    await open(page, locale);
    await page.locator('[role="alert"]:not(#__next-route-announcer__)').getByRole('button', { name: m(locale, 'resume'), exact: true }).click();
    await page.getByRole('dialog').getByRole('textbox').fill('Fixed.');
    await page.getByRole('dialog').getByRole('button', { name: m(locale, 'resume'), exact: true }).click();
    // exact: "Forecast resumed: Fixed." (the alert-history line, now shown for the just-closed alert) also starts with this text
    await expect(page.getByText(m(locale, 'toast.resumed'), { exact: true })).toBeVisible();
    await expect(page.locator('[role="alert"]:not(#__next-route-announcer__)').filter({ hasText: m(locale, 'alert.title') })).toHaveCount(0);
    await expectAudit(page, locale, 'model.resumed');
    seen.expectClean();
  });

  test('the retraining schedule, the clock start (the primary reading follows it) and the planning level are saved, audited and put back', async ({ page, baseURL }, testInfo) => {
    const seen = watch(page, baseURL);
    await startDemo(page, locale, 'administrator');
    await open(page, locale);
    await page.getByLabel(m(locale, 't.time')).fill('03:30');
    await page.getByRole('button', { name: text(locale, 'common.save'), exact: true }).click();
    await expect(page.getByText(m(locale, 'toast.retrain.saved'), { exact: true })).toBeVisible();
    await expectAudit(page, locale, 'model.retraining_schedule_changed');
    await open(page, locale);
    await page.getByRole('radio', { name: new RegExp(m(locale, 'm.fromRegistration')) }).click();
    await expect(page.getByText(m(locale, 'toast.clock'), { exact: true })).toBeVisible();
    await expect(page.locator('[data-primary]')).toContainText(m(locale, 'm.fromRegistration'));
    await shot(page, testInfo, locale, 'forecast-model-registration');
    await page.getByRole('radio', { name: new RegExp(m(locale, 'm.fromAssignment')) }).click();
    await expect(page.locator('[data-primary]')).toContainText(m(locale, 'm.fromAssignment'));
    await page.getByRole('combobox', { name: m(locale, 'm.level') }).selectOption('city');
    await expect(page.getByText(m(locale, 'toast.level'), { exact: true })).toBeVisible();
    await page.getByRole('combobox', { name: m(locale, 'm.level') }).selectOption('zone');
    for (const action of ['settings.clock_start_changed', 'settings.planning_level_changed']) await expectAudit(page, locale, action);
    // Put the schedule back.
    await open(page, locale);
    await page.getByLabel(m(locale, 't.time')).fill('02:00');
    await page.getByRole('button', { name: text(locale, 'common.save'), exact: true }).click();
    await expect(page.getByText(m(locale, 'toast.retrain.saved'), { exact: true })).toBeVisible();
    seen.expectClean();
  });

  test('the Arabic page draws what the flows left', async ({ page, baseURL }, testInfo) => {
    const seen = watch(page, baseURL);
    await startDemo(page, 'ar', 'administrator');
    await open(page, 'ar');
    await shot(page, testInfo, 'ar', 'forecast-model-after');
    seen.expectClean();
  });
});
