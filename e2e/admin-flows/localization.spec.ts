// SPDX-License-Identifier: AGPL-3.0-only
import path from 'node:path';
import { type Page } from '@playwright/test';
import { expect, test } from '../fixtures';
import { expectPageOk, shot, startDemo, waitForHydration, watch } from '../helpers';
import { locales, text, titleOf, type Locale } from '../routes';
import { readMessages } from '../messages';

// Localization. The Administrator reads the settings, the Arabic names coverage and the two previews,
// changes the settings and sees the preview follow, saves them, reloads and finds them stored, resets to the defaults after a
// confirmation, and finds each change in the Audit Log. The settings are STORED AND AUDITED, NOT APPLIED: the spec proves the page
// keeps its own language, digits and calendar (Western digits, the design system's formatter) after the settings change. Tests share
// one demo store and run in parallel, so every test that changes the settings puts the defaults back.

type Tree = { [key: string]: string | Tree };
const module_ = (locale: Locale): Tree => readMessages(path.join(import.meta.dirname, '../../apps/web/messages/admin/localization', `${locale}.json`)) as Tree;
const MODULE = { en: module_('en'), ar: module_('ar') };
/** A key of the module's own message file. */
function m(locale: Locale, key: string): string {
  let node: string | Tree | undefined = MODULE[locale];
  for (const part of key.split('.')) node = typeof node === 'object' ? node[part] : undefined;
  if (typeof node !== 'string') throw new Error(`No message admin.localization.${locale}:${key}`);
  return node;
}

const ROUTE = (locale: Locale) => `/${locale}/admin/localization`;

async function open(page: Page, locale: Locale) {
  await page.goto(ROUTE(locale));
  await expect(page.locator('[data-module="admin.localization"]')).toHaveAttribute('data-state', 'filled');
  await expectPageOk(page, locale);
  await waitForHydration(page, 'main [role=radio]');
}

/** The Audit Log filtered by an action code: the write's event is there. */
async function expectAudit(page: Page, locale: Locale, action: string) {
  await page.goto(`/${locale}/admin/audit-log?q=${action}`);
  await expect(page.locator('[data-module="admin.audit_log"] tbody tr').first()).toContainText(action);
}

async function resetToDefaults(page: Page, locale: Locale) {
  await open(page, locale);
  await page.getByRole('button', { name: text(locale, 'common.more') }).click();
  await page.getByRole('menuitem', { name: m(locale, 'reset') }).click();
  await page.getByRole('dialog', { name: m(locale, 'resetDialog.title') }).getByRole('button', { name: m(locale, 'resetDialog.ok') }).click();
  await expect(page.getByText(m(locale, 'toast.reset'))).toBeVisible();
}

for (const locale of locales) {
  test.describe(`Localization in ${locale}`, () => {
    test(`the Administrator reads the settings, the eight kinds of Arabic names, the previews and the fallback; every setting says Not applied; nothing leaves the app`, async ({ page, baseURL }, testInfo) => {
      const seen = watch(page, baseURL);
      await startDemo(page, locale, 'administrator');
      await open(page, locale);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(titleOf(locale, 'admin.localization'));
      await expect(page.locator('[data-stub="notApplied"]')).toHaveCount(4);
      await expect(page.getByText(text(locale, 'common.illustrative'))).toHaveCount(1);
      await expect(page.locator('main tbody tr')).toHaveCount(8);
      await expect(page.locator('[data-preview="ar"]')).toBeVisible();
      await expect(page.locator('[data-preview="en"]')).toBeVisible();
      await expect(page.getByRole('button', { name: text(locale, 'common.save') })).toHaveAttribute('aria-disabled', 'true');
      await shot(page, testInfo, locale, 'localization-filled');
      seen.expectClean();
    });

    test(`changes the settings, saves them, finds them after a reload, and the page keeps its own language, digits and calendar (not applied)`, async ({ page, baseURL }, testInfo) => {
      const seen = watch(page, baseURL);
      await startDemo(page, locale, 'administrator');
      await open(page, locale);
      await page.getByRole('radio', { name: m(locale, 'lang.ar'), exact: true }).check();
      await page.getByRole('radio', { name: m(locale, 'num.arabic'), exact: true }).check();
      await page.getByRole('radio', { name: m(locale, 'cal.hijri'), exact: true }).click();
      await page.getByLabel(m(locale, 'date.week')).selectOption('saturday');
      await expect(page.locator('[data-preview="ar"]')).toContainText(/[٠-٩]/);
      await expect(page.getByRole('button', { name: text(locale, 'common.save') })).not.toHaveAttribute('aria-disabled', 'true');
      await shot(page, testInfo, locale, 'localization-changed');
      await page.getByRole('button', { name: text(locale, 'common.save') }).click();
      await expect(page.getByText(m(locale, 'toast.saved'))).toBeVisible();
      await page.reload();
      await waitForHydration(page, 'main [role=radio]');
      await expect(page.getByRole('radio', { name: m(locale, 'lang.ar'), exact: true })).toBeChecked();
      await expect(page.getByRole('radio', { name: m(locale, 'num.arabic'), exact: true })).toBeChecked();
      await expect(page.getByLabel(m(locale, 'date.week'))).toHaveValue('saturday');
      // not applied: the page itself is still in the language of its address, with Western digits
      await expect(page.locator('html')).toHaveAttribute('lang', locale);
      expect(await page.locator('main table').innerText()).not.toMatch(/[٠-٩]/);
      await expectAudit(page, locale, 'localization.updated');
      await resetToDefaults(page, locale);
      seen.expectClean();
    });

    test(`Reset to defaults asks first, then writes the defaults and audits them`, async ({ page, baseURL }) => {
      const seen = watch(page, baseURL);
      await startDemo(page, locale, 'administrator');
      await open(page, locale);
      await page.getByRole('radio', { name: m(locale, 'lang.ar'), exact: true }).check();
      await page.getByRole('button', { name: text(locale, 'common.save') }).click();
      await expect(page.getByText(m(locale, 'toast.saved'))).toBeVisible();
      await page.getByRole('button', { name: text(locale, 'common.more') }).click();
      await page.getByRole('menuitem', { name: m(locale, 'reset') }).click();
      const confirm = page.getByRole('dialog', { name: m(locale, 'resetDialog.title') });
      await confirm.getByRole('button', { name: text(locale, 'common.cancel') }).click();
      await expect(page.getByRole('radio', { name: m(locale, 'lang.ar'), exact: true })).toBeChecked();
      await resetToDefaults(page, locale);
      await expect(page.getByRole('radio', { name: m(locale, 'lang.en'), exact: true })).toBeChecked();
      await expectAudit(page, locale, 'localization.updated');
      seen.expectClean();
    });
  });
}

test.describe('Localization: roles and states', () => {
  test('the Administrator in a shared install still edits the page', async ({ page, baseURL }) => {
    const seen = watch(page, baseURL);
    await startDemo(page, 'en', 'administrator', 'shared');
    await open(page, 'en');
    await expect(page.getByRole('radio', { name: m('en', 'lang.ar'), exact: true })).toBeEnabled();
    seen.expectClean();
  });

  test('no other role has the module: the no-access page for the Viewer / Auditor', async ({ page, baseURL }) => {
    const seen = watch(page, baseURL, { allowNotFound: true });
    await startDemo(page, 'en', 'viewer_auditor');
    await page.goto(ROUTE('en'));
    await expect(page.locator('[data-module="admin.localization"]')).toHaveAttribute('data-state', 'noaccess');
    seen.expectClean();
  });

  test('the review states keep the header and read nothing; Configure goes back to the page', async ({ page, baseURL }, testInfo) => {
    const seen = watch(page, baseURL);
    await startDemo(page, 'en', 'administrator');
    for (const state of ['empty', 'loading', 'error'] as const) {
      await page.goto(`${ROUTE('en')}?state=${state}`);
      await expect(page.locator('[data-module="admin.localization"]')).toHaveAttribute('data-state', state);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(titleOf('en', 'admin.localization'));
      await shot(page, testInfo, 'en', `localization-${state}`);
    }
    await expect(page.getByText(m('en', 'states.error.desc'))).toBeVisible();
    await page.goto(`${ROUTE('en')}?state=empty`);
    await page.getByRole('link', { name: m('en', 'empty.action') }).click();
    await expect(page.locator('[data-module="admin.localization"]')).toHaveAttribute('data-state', 'filled');
    seen.expectClean();
  });
});
