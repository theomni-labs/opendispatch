// SPDX-License-Identifier: AGPL-3.0-only
import fs from 'node:fs';
import path from 'node:path';
import { type Page } from '@playwright/test';
import { expect, test } from '../fixtures';
import { expectPageOk, shot, startDemo, waitForHydration, watch } from '../helpers';
import { locales, text, titleOf, type Locale } from '../routes';
import { readMessages } from '../messages';

// System Health. The Administrator reads the overview (services, feeds, version), the job runs and the
// storage and backups; sees what the diagnostics file holds, creates it and downloads it (a real zip, made inside the install, with no
// case or personal data); confirms a backup (a record: OpenDispatch runs none in a private install); refreshes. Each write is followed by its
// audit event in the Audit Log. The storage figures are Illustrative and say so.

type Tree = { [key: string]: string | Tree };
const module_ = (locale: Locale): Tree => readMessages(path.join(import.meta.dirname, '../../apps/web/messages/admin/system_health', `${locale}.json`)) as Tree;
const MODULE = { en: module_('en'), ar: module_('ar') };
/** A key of the module's own message file, with `{name}` style values put in. */
function m(locale: Locale, key: string, values: Record<string, string> = {}): string {
  let node: string | Tree | undefined = MODULE[locale];
  for (const part of key.split('.')) node = typeof node === 'object' ? node[part] : undefined;
  if (typeof node !== 'string') throw new Error(`No message admin.system_health.${locale}:${key}`);
  return Object.entries(values).reduce((out, [name, value]) => out.replaceAll(`{${name}}`, value), node);
}

const ROUTE = (locale: Locale) => `/${locale}/admin/system-health`;
const rows = (page: Page) => page.locator('[data-module="admin.system_health"] tbody tr');

async function open(page: Page, locale: Locale, query = '') {
  await page.goto(`${ROUTE(locale)}${query}`);
  await expect(page.locator('[data-module="admin.system_health"]')).toHaveAttribute('data-state', 'filled');
  await expectPageOk(page, locale);
}

/** The Audit Log filtered by an action code: the write's event is there. */
async function expectAudit(page: Page, locale: Locale, action: string) {
  await page.goto(`/${locale}/admin/audit-log?q=${action}`);
  await expect(page.locator('[data-module="admin.audit_log"] tbody tr').first()).toContainText(action);
}

for (const locale of locales) {
  test.describe(`System Health in ${locale}`, () => {
    test(`the Administrator reads the three tabs: eight services, five feeds, the version badge, eleven job runs and the Illustrative storage; nothing leaves the app`, async ({ page, baseURL }, testInfo) => {
      const seen = watch(page, baseURL);
      await startDemo(page, locale, 'administrator');
      await open(page, locale);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(titleOf(locale, 'admin.system_health'));
      await expect(page.locator('[data-version]')).toHaveText(/^v\d+\.\d+\.\d+/);
      await expect(page.locator('[data-service]')).toHaveCount(8);
      await expect(rows(page)).toHaveCount(5);
      await shot(page, testInfo, locale, 'system-health-overview');
      await open(page, locale, '?tab=jobs');
      await expect(rows(page)).toHaveCount(11);
      await shot(page, testInfo, locale, 'system-health-jobs');
      await open(page, locale, '?tab=storage');
      await expect(page.getByText(text(locale, 'common.illustrative')).first()).toBeVisible();
      await expect(page.getByRole('progressbar')).toBeVisible();
      await shot(page, testInfo, locale, 'system-health-storage');
      seen.expectClean();
    });

    test(`shows what the diagnostics file holds, creates it, and downloads a zip with no case or personal data`, async ({ page, baseURL }, testInfo) => {
      const seen = watch(page, baseURL);
      await startDemo(page, locale, 'administrator');
      await open(page, locale, '?diag=1');
      await waitForHydration(page, '[role=dialog] button');
      const drawer = page.getByRole('dialog', { name: m(locale, 'diag.title') });
      await expect(drawer).toBeVisible();
      await expect(drawer.locator('[data-stub="demo"]')).toBeVisible();
      for (const name of ['settings.json', 'health.json', 'jobs.json', 'README.txt']) await expect(drawer.getByText(name)).toBeVisible();
      await shot(page, testInfo, locale, 'system-health-diagnostics');
      const [download] = await Promise.all([page.waitForEvent('download'), drawer.getByRole('button', { name: m(locale, 'diag.create') }).click()]);
      expect(download.suggestedFilename()).toMatch(/^opendispatch-diagnostics-\d{4}-\d{2}-\d{2}\.zip$/);
      const bytes = fs.readFileSync(await download.path());
      expect(bytes.subarray(0, 4).toString('hex')).toBe('504b0304');
      const text_ = bytes.toString('utf8');
      for (const name of ['README.txt', 'settings.json', 'health.json', 'jobs.json']) expect(text_).toContain(name);
      expect(text_).not.toMatch(/@demo-synthetic|"email"|case_id/);
      await expect(page.getByText(m(locale, 'toast.diag'))).toBeVisible();
      await expect(drawer).toBeHidden();
      await expectAudit(page, locale, 'diagnostics.created');
      seen.expectClean();
    });

    test(`confirms a backup from the card: it is no longer overdue, shows who confirmed it, and the confirmation is audited`, async ({ page, baseURL }) => {
      const seen = watch(page, baseURL);
      await startDemo(page, locale, 'administrator');
      await open(page, locale, '?tab=storage');
      await waitForHydration(page, 'main button');
      await page.getByRole('button', { name: m(locale, 'bk.confirm') }).click();
      await expect(page.getByText(m(locale, 'toast.backup'))).toBeVisible();
      await expect(page.getByText(m(locale, 'bk.confirmed'), { exact: true })).toBeVisible();
      await expect(page.getByText('Nadia Al-Ghalani')).toBeVisible();
      await expectAudit(page, locale, 'backup.confirmed');
      seen.expectClean();
    });
  });
}

test.describe('System Health: filters, install modes, roles and states', () => {
  test('?q=, ?status= and ?kind= narrow the job runs; a failed run is in the danger tone', async ({ page, baseURL }) => {
    const seen = watch(page, baseURL);
    await startDemo(page, 'en', 'administrator');
    await open(page, 'en', '?tab=jobs&status=failed');
    await expect(rows(page)).toHaveCount(1);
    await expect(rows(page).first()).toContainText('import-validate');
    await expect(page.getByText(`${text('en', 'common.status')}: ${m('en', 'st.failed')}`)).toBeVisible();
    await open(page, 'en', '?tab=jobs&kind=rollup');
    await expect(rows(page)).toHaveCount(3);
    await open(page, 'en', '?tab=jobs&q=zzz-nothing');
    await expect(page.getByText(m('en', 'none'))).toBeVisible();
    seen.expectClean();
  });

  test('Refresh in the More menu says so', async ({ page, baseURL }) => {
    const seen = watch(page, baseURL);
    await startDemo(page, 'en', 'administrator');
    await open(page, 'en');
    await waitForHydration(page, 'main button');
    await page.getByRole('button', { name: text('en', 'common.more') }).click();
    await page.getByRole('menuitem', { name: m('en', 'refresh') }).click();
    await expect(page.getByText(m('en', 'toast.refreshed'))).toBeVisible();
    seen.expectClean();
  });

  test('in a shared install the update agent is run by OpenDispatch, the backups are OpenDispatch\'s, and the Administrator still edits', async ({ page, baseURL }) => {
    const seen = watch(page, baseURL);
    await startDemo(page, 'en', 'administrator', 'shared');
    await open(page, 'en');
    await expect(page.locator('[data-service="update_agent"]')).toContainText(m('en', 'svc.d.vendor'));
    await expect(page.getByRole('button', { name: m('en', 'diag.button') })).toBeEnabled();
    await open(page, 'en', '?tab=storage');
    await expect(page.getByText(m('en', 'bk.managed'))).toBeVisible();
    seen.expectClean();
  });

  test('no other role has the module: the no-access page for the Viewer / Auditor', async ({ page, baseURL }) => {
    const seen = watch(page, baseURL, { allowNotFound: true });
    await startDemo(page, 'en', 'viewer_auditor');
    await page.goto(ROUTE('en'));
    await expect(page.locator('[data-module="admin.system_health"]')).toHaveAttribute('data-state', 'noaccess');
    seen.expectClean();
  });

  test('the review states keep the header and read nothing', async ({ page, baseURL }, testInfo) => {
    const seen = watch(page, baseURL);
    await startDemo(page, 'en', 'administrator');
    for (const state of ['empty', 'loading', 'error'] as const) {
      await page.goto(`${ROUTE('en')}?state=${state}`);
      await expect(page.locator('[data-module="admin.system_health"]')).toHaveAttribute('data-state', state);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(titleOf('en', 'admin.system_health'));
      await shot(page, testInfo, 'en', `system-health-${state}`);
    }
    await expect(page.getByText(m('en', 'states.error.desc'))).toBeVisible();
    seen.expectClean();
  });
});
