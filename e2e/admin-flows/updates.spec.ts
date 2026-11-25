// SPDX-License-Identifier: AGPL-3.0-only
import path from 'node:path';
import { type Page } from '@playwright/test';
import { expect, test } from '../fixtures';
import { expectPageOk, shot, signOutViaSwitcher, startDemo, waitForHydration, watch } from '../helpers';
import { locales, text, titleOf, type InstallMode, type Locale, type Role } from '../routes';
import { readMessages } from '../messages';

// Updates. THE UPDATE AGENT IS A SCRIPTED STUB in the demo store: a download takes about 4
// seconds and its verification about 2, a restore request about 7, and every result says "(stub)". The specs wait for those phases
// the way a person does (the screen asks again every second) and never set a pace: `updates.stub_download_pace` has no screen.
//
// The scripted agent is ONE state for the whole run, so the write flows are one serial chain in a fixed order (the tests before
// them only read): 1.2.0 goes the whole way (download, verify, pre-flight, backup, schedule, approve by a Change Approver, apply);
// 1.2.1 fails its verification (a tampered proxy address), is retried and applied as an emergency override; 1.3.0 fails its health
// check and rolls back by itself; 1.3.1 stops partway and is restored, then stops again and is resumed; an offline file goes through
// its checks. After each write the Audit Log shows its action code. Each spec that reads runs in both languages.

type Tree = { [key: string]: string | Tree };
const module_ = (locale: Locale): Tree => readMessages(path.join(import.meta.dirname, '../../apps/web/messages/admin/updates', `${locale}.json`)) as Tree;
const MODULE = { en: module_('en'), ar: module_('ar') };
/** A key of the module's own message file (`rel.title`), with `{v}` style values put in. */
function m(locale: Locale, key: string, values: Record<string, string> = {}): string {
  let node: string | Tree | undefined = MODULE[locale];
  for (const part of key.split('.')) node = typeof node === 'object' ? node[part] : undefined;
  if (typeof node !== 'string') throw new Error(`No message admin.updates.${locale}:${key}`);
  return Object.entries(values).reduce((out, [name, value]) => out.replaceAll(`{${name}}`, value), node);
}

const ROUTE = (locale: Locale) => `/${locale}/admin/updates`;
const root = (page: Page) => page.locator('[data-module="admin.updates"]');
const release = (page: Page) => page.locator('#up-release');
const stage = async (page: Page, want: string, timeout = 20_000) => expect(release(page)).toHaveAttribute('data-stage', want, { timeout });
const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true });

async function open(page: Page, locale: Locale, query = '') {
  await page.goto(`${ROUTE(locale)}${query}`);
  await expect(root(page)).toHaveAttribute('data-state', 'filled');
  await expectPageOk(page, locale);
  await waitForHydration(page, '[data-module="admin.updates"] button');
}

/** The Audit Log filtered by an action code: the write's event is there. */
async function expectAudit(page: Page, locale: Locale, action: string) {
  await page.goto(`/${locale}/admin/audit-log?q=${action}`);
  await expect(page.locator('[data-module="admin.audit_log"] tbody tr').first()).toContainText(action);
}

/**
 * Signs in as a role and opens Updates. A person already signed in signs out first (the start page sends a signed-in person
 * straight to their landing page), through the top bar's Demo pop-over, the way a person does.
 */
async function as(page: Page, locale: Locale, role: Role, query = '', mode: InstallMode = 'private') {
  if (page.url().startsWith('http')) await signOutViaSwitcher(page, locale);
  await startDemo(page, locale, role, mode);
  await open(page, locale, query);
}

// ---------------------------------------------------------------------------------------------------------------------------
// Reading: every role and install mode (both languages)
// ---------------------------------------------------------------------------------------------------------------------------
for (const locale of locales) {
  test.describe(`Updates, read only, in ${locale}`, () => {
    test(`the Administrator of a private install: title, Demo tag, five tabs, Check now and More, four figures, no request leaves the app`, async ({ page, baseURL }, testInfo) => {
      const seen = watch(page, baseURL);
      await startDemo(page, locale, 'administrator');
      await open(page, locale);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(titleOf(locale, 'admin.updates'));
      await expect(page.locator('[data-stub="demo"]').first()).toBeVisible();
      await expect(page.getByRole('tab')).toHaveText(['tab.overview', 'tab.connection', 'tab.windows', 'tab.history', 'tab.settings'].map((key) => m(locale, key)));
      await expect(button(page, m(locale, 'check.label'))).toBeEnabled();
      await expect(button(page, text(locale, 'common.more'))).toBeVisible();
      for (const key of ['stat.version', 'channel', 'stat.mode', 'stat.check']) await expect(root(page).getByText(m(locale, key), { exact: true }).first()).toBeVisible();
      await shot(page, testInfo, locale, 'updates-overview');
      seen.expectClean();
    });

    test(`the Change Approver sees the same screen read only: every control disabled with the reason`, async ({ page, baseURL }, testInfo) => {
      const seen = watch(page, baseURL);
      await startDemo(page, locale, 'change_approver');
      await open(page, locale);
      await expect(root(page)).toHaveAttribute('data-access', 'view');
      await expect(button(page, m(locale, 'check.label'))).toHaveAttribute('aria-disabled', 'true');
      await expect(page.getByText(text(locale, 'shell.access.view')).first()).toBeVisible();
      await shot(page, testInfo, locale, 'updates-view-only');
      seen.expectClean();
    });

    for (const mode of ['dedicated', 'shared'] as const) {
      test(`the Administrator of a ${mode} install sees the reduced screen: the version and the release notes only`, async ({ page, baseURL }, testInfo) => {
        const seen = watch(page, baseURL);
        await startDemo(page, locale, 'administrator', mode);
        await page.goto(ROUTE(locale));
        await expect(root(page)).toHaveAttribute('data-reduced', 'true');
        await expect(page.getByRole('tab')).toHaveCount(0);
        await expect(page.getByText(m(locale, 'rn.title'), { exact: true })).toBeVisible();
        await expect(page.getByText(m(locale, 'rv.managed'))).toBeVisible();
        await expectPageOk(page, locale);
        await shot(page, testInfo, locale, `updates-reduced-${mode}`);
        seen.expectClean();
      });
    }

    test(`the review states ?state=empty, loading and error keep the header and show their text`, async ({ page, baseURL }) => {
      const seen = watch(page, baseURL);
      await startDemo(page, locale, 'administrator');
      for (const state of ['empty', 'loading', 'error'] as const) {
        await page.goto(`${ROUTE(locale)}?state=${state}`);
        await expect(root(page)).toHaveAttribute('data-state', state);
        await expect(page.getByRole('heading', { level: 1 })).toHaveText(titleOf(locale, 'admin.updates'));
      }
      await expect(page.locator('[role="alert"]:not(#__next-route-announcer__)')).toContainText(m(locale, 'states.error.desc'));
      seen.expectClean();
    });
  });
}

// ---------------------------------------------------------------------------------------------------------------------------
// Writing: one chain, in order (English writes, Arabic looks at what they left)
// ---------------------------------------------------------------------------------------------------------------------------
test.describe.serial('Updates, the scripted flows', () => {
  const locale: Locale = 'en';

  /** Downloads, verifies, runs the pre-flight, confirms the backup and schedules a release; a Change Approver approves it. */
  async function toApproved(page: Page, version: string) {
    await as(page, locale, 'administrator', `?release=${version}`);
    await button(page, m(locale, 'download')).click();
    await stage(page, 'verified');
    await button(page, m(locale, 'preflight')).click();
    await button(page, m(locale, 'backup.confirm')).click();
    await stage(page, 'ready');
    await button(page, m(locale, 'schedule')).click();
    await page.getByRole('dialog').getByRole('button', { name: m(locale, 'schedule'), exact: true }).click();
    await stage(page, 'awaiting');
    await as(page, locale, 'change_approver', `?release=${version}`);
    await button(page, text(locale, 'common.approve')).click();
    await stage(page, 'approved');
    await as(page, locale, 'administrator', `?release=${version}`);
  }

  test('1.2.0 goes the whole way: download, verify, pre-flight, backup, schedule, approval by a Change Approver, apply', async ({ page, baseURL }, testInfo) => {
    const seen = watch(page, baseURL);
    await as(page, locale, 'administrator');
    await stage(page, 'available');
    await expect(page.getByRole('heading', { name: /1\.2\.0/ })).toBeVisible();
    await shot(page, testInfo, locale, 'updates-available');
    await button(page, m(locale, 'download')).click();
    // The screen asks again while the download runs: the bar moves, then the five checks are shown as running, then they pass.
    await stage(page, 'downloading', 10_000).catch(() => undefined);
    await shot(page, testInfo, locale, 'updates-downloading');
    await stage(page, 'verified');
    await expect(page.getByRole('list', { name: m(locale, 'vf.title') }).getByText(m(locale, 'pf.passed'))).toHaveCount(5);
    await shot(page, testInfo, locale, 'updates-verified');
    // The pre-flight waits for the backup: the mockup has no such step, so the screen has a Confirm backup button.
    await button(page, m(locale, 'preflight')).click();
    await expect(page.getByText(m(locale, 'pf.backupAsk'))).toBeVisible();
    await shot(page, testInfo, locale, 'updates-preflight-wait');
    await button(page, m(locale, 'backup.confirm')).click();
    await stage(page, 'ready');
    await expect(button(page, m(locale, 'apply.label'))).toHaveAttribute('aria-disabled', 'true');
    await button(page, m(locale, 'schedule')).click();
    await page.getByRole('dialog').getByRole('button', { name: m(locale, 'schedule'), exact: true }).click();
    await stage(page, 'awaiting');
    await expect(button(page, text(locale, 'common.approve'))).toHaveAttribute('aria-disabled', 'true');
    await shot(page, testInfo, locale, 'updates-awaiting');
    await as(page, locale, 'change_approver');
    await stage(page, 'awaiting');
    await expect(button(page, text(locale, 'common.approve'))).toBeEnabled();
    await button(page, text(locale, 'common.approve')).click();
    await stage(page, 'approved');
    await as(page, locale, 'administrator');
    await stage(page, 'approved');
    await button(page, m(locale, 'applyNow')).click();
    const dialog = page.getByRole('dialog');
    // exact: the summary line above the list ("{n} of 6 passed") also contains the word, unscoped and case-insensitively
    await expect(dialog.getByText(m(locale, 'pf.passed'), { exact: true })).toHaveCount(6);
    await dialog.getByRole('button', { name: m(locale, 'applyNow'), exact: true }).click();
    await expect(dialog.getByText(m(locale, 'run.done'))).toBeVisible();
    await shot(page, testInfo, locale, 'updates-applied');
    await dialog.getByRole('button', { name: m(locale, 'done'), exact: true }).click();
    await expect(page.getByText('v1.2.0').first()).toBeVisible();
    await open(page, locale, '?tab=history');
    await expect(page.getByRole('table', { name: m(locale, 'tab.history') })).toContainText('1.2.0');
    for (const action of ['update.download', 'update.backup_confirmed', 'update.schedule', 'update.approve', 'update.apply']) await expectAudit(page, locale, action);
    seen.expectClean();
  });

  test('1.2.1 fails its verification (a tampered proxy address), is retried, and goes out as an emergency override with two approvers and a reason', async ({ page, baseURL }, testInfo) => {
    const seen = watch(page, baseURL);
    await as(page, locale, 'administrator', '?tab=connection');
    await page.getByRole('switch', { name: m(locale, 'proxy.use') }).click();
    await page.getByLabel(m(locale, 'proxy.address')).fill('http://tampered.proxy.example:8080');
    await page.getByRole('button', { name: text(locale, 'common.save') }).click();
    await expect(page.getByText(m(locale, 'toast.proxy'))).toBeVisible();
    await open(page, locale, '?release=1.2.1');
    await button(page, m(locale, 'download')).click();
    await stage(page, 'verify_failed');
    await expect(page.locator('[role="alert"]:not(#__next-route-announcer__)').first()).toContainText(m(locale, 'vf.failedT'));
    await shot(page, testInfo, locale, 'updates-verify-failed');
    // Back to a proxy that does not tamper, then Try again.
    await open(page, locale, '?tab=connection');
    await page.getByRole('switch', { name: m(locale, 'proxy.use') }).click();
    await page.getByRole('button', { name: text(locale, 'common.save') }).click();
    await expect(page.getByText(m(locale, 'toast.proxy'))).toBeVisible();
    await open(page, locale, '?release=1.2.1');
    await button(page, text(locale, 'common.retry')).click();
    await stage(page, 'verified');
    // The Connection tab's address field sits low enough that filling it scrolls the page; that position carries over to this
    // tab (a client-side switch, not a fresh navigation). The header's More button ends up out of view: a plain click would
    // still find and scroll to it, but Menu (like most floating menus) treats the resulting scroll as an outside interaction
    // and closes itself before the click lands, since its position is anchored to the trigger and would otherwise go stale.
    await button(page, text(locale, 'common.more')).scrollIntoViewIfNeeded();
    await button(page, text(locale, 'common.more')).click();
    await page.getByRole('menuitem', { name: m(locale, 'menu.emergency') }).click();
    const dialog = page.getByRole('dialog');
    await expect(button(page, m(locale, 'applyNow'))).toHaveAttribute('aria-disabled', 'true');
    await dialog.getByRole('textbox').last().fill('A gap calculation error hits live assignment right now.');
    await shot(page, testInfo, locale, 'updates-emergency');
    await dialog.getByRole('button', { name: m(locale, 'applyNow'), exact: true }).click();
    await expect(page.getByText(m(locale, 'toast.emergency.desc'))).toBeVisible();
    await expect(page.getByText('v1.2.1').first()).toBeVisible();
    await expectAudit(page, locale, 'update.emergency_override');
    seen.expectClean();
  });

  test('1.3.0 fails its health check and rolls back by itself: the alert, no restore needed, and the release can be tried again', async ({ page, baseURL }, testInfo) => {
    const seen = watch(page, baseURL);
    await toApproved(page, '1.3.0');
    await button(page, m(locale, 'applyNow')).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: m(locale, 'applyNow'), exact: true }).click();
    await expect(dialog.getByText(m(locale, 'rb.why'))).toBeVisible();
    await dialog.getByRole('button', { name: m(locale, 'done'), exact: true }).click();
    await expect(page.getByText(m(locale, 'rb.title', { v: '1.3.0', from: '1.2.1' }))).toBeVisible();
    await shot(page, testInfo, locale, 'updates-rolled-back');
    await open(page, locale, '?tab=history');
    await expect(page.getByRole('table', { name: m(locale, 'tab.history') })).toContainText(m(locale, 'r.rolled_back'));
    seen.expectClean();
  });

  test('1.3.1 stops partway: needs attention (in both languages), a restore request that runs its course, then the same failure again and Resume', async ({ page, baseURL }, testInfo) => {
    test.setTimeout(120_000);
    const seen = watch(page, baseURL);
    await toApproved(page, '1.3.1');
    await button(page, m(locale, 'applyNow')).click();
    await page.getByRole('dialog').getByRole('button', { name: m(locale, 'applyNow'), exact: true }).click();
    await expect(page.getByRole('dialog').getByText(m(locale, 'na.title', { v: '1.3.1' }))).toBeVisible();
    await page.getByRole('dialog').getByRole('button', { name: m(locale, 'done'), exact: true }).click();
    await expect(page.locator('[role="alert"]:not(#__next-route-announcer__)').first()).toContainText(m(locale, 'na.title', { v: '1.3.1' }));
    await expect(button(page, m(locale, 'resume'))).toBeEnabled();
    await shot(page, testInfo, locale, 'updates-needs-attention');
    // The same state in Arabic (the session and the demo store are shared).
    await open(page, 'ar');
    await expect(page.locator('[role="alert"]:not(#__next-route-announcer__)').first()).toContainText(m('ar', 'na.title', { v: '1.3.1' }));
    await shot(page, testInfo, 'ar', 'updates-needs-attention');
    // Restore: a reason is needed; the request survives a reload, moves on with time, and ends restored.
    await open(page, locale);
    await button(page, m(locale, 'restore')).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('button', { name: m(locale, 'rst.go'), exact: true })).toHaveAttribute('aria-disabled', 'true');
    await dialog.getByRole('textbox').fill('The migration cannot be fixed today.');
    await dialog.getByRole('button', { name: m(locale, 'rst.go'), exact: true }).click();
    await expect(page.getByRole('heading', { name: m(locale, 'rq.title') })).toBeVisible();
    await expect(button(page, m(locale, 'resume'))).toHaveAttribute('aria-disabled', 'true');
    await page.reload();
    await expect(page.getByRole('heading', { name: m(locale, 'rq.title') })).toBeVisible();
    await shot(page, testInfo, locale, 'updates-restore-request');
    await expect(page.getByText(m(locale, 'rt.title', { v: '1.3.1' }))).toBeVisible({ timeout: 20_000 });
    await shot(page, testInfo, locale, 'updates-restored');
    // The release can go again; this time the failure is resumed.
    await toApproved(page, '1.3.1');
    await button(page, m(locale, 'applyNow')).click();
    await page.getByRole('dialog').getByRole('button', { name: m(locale, 'applyNow'), exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: m(locale, 'done'), exact: true }).click();
    await button(page, m(locale, 'resume')).click();
    await page.getByRole('dialog').getByRole('button', { name: m(locale, 'resume'), exact: true }).click();
    await expect(page.getByText(m(locale, 'rz.title', { v: '1.3.1' }))).toBeVisible();
    await shot(page, testInfo, locale, 'updates-resumed');
    for (const action of ['update.recovery', 'update.restore_completed']) await expectAudit(page, locale, action);
    seen.expectClean();
  });

  test('offline: a file of the wrong type is refused by the drop area, a tampered file fails its checks, a good one is added as a release', async ({ page, baseURL }, testInfo) => {
    const seen = watch(page, baseURL);
    await as(page, locale, 'administrator', '?tab=connection');
    await page.getByRole('radio', { name: m(locale, 'mode.offline') }).click();
    await expect(page.locator('input[type="file"]')).toBeAttached();
    await expect(page.getByText(m(locale, 'off.hintLimit', { max: '2,000,000' }))).toBeVisible();
    await expect(button(page, m(locale, 'check.label'))).toHaveAttribute('aria-disabled', 'true');
    const input = page.locator('input[type="file"]');
    await input.setInputFiles({ name: 'opendispatch-1.4.0.zip', mimeType: 'application/zip', buffer: Buffer.from('x') });
    await expect(page.locator('[role="alert"]:not(#__next-route-announcer__)')).toContainText('opendispatch-1.4.0.zip');
    await input.setInputFiles({ name: 'opendispatch-1.5.0-tampered.update', mimeType: 'text/plain', buffer: Buffer.from('opendispatch update 1.5.0 tampered') });
    await expect(page.getByText(m(locale, 'off.failedT'))).toBeVisible();
    await shot(page, testInfo, locale, 'updates-offline-failed');
    await input.setInputFiles({ name: 'opendispatch-1.4.0.update', mimeType: 'text/plain', buffer: Buffer.from('opendispatch update 1.4.0') });
    await expect(page.getByText(m(locale, 'off.verified'), { exact: true }).first()).toBeVisible();
    await shot(page, testInfo, locale, 'updates-offline-verified');
    await page.getByRole('button', { name: m(locale, 'off.use') }).click();
    await stage(page, 'verified');
    await expect(page.getByRole('heading', { name: /1\.4\.0/ })).toBeVisible();
    await expectAudit(page, locale, 'update.offline_upload');
    // Back to connected, so the rest of the run sees the default.
    await open(page, locale, '?tab=connection');
    await page.getByRole('radio', { name: m(locale, 'mode.connected') }).click();
    // conn.allow also names the endpoints table (its sr-only caption): scope to the span label, not the table's name.
    await expect(page.locator('span').filter({ hasText: m(locale, 'conn.allow') })).toBeVisible();
    seen.expectClean();
  });

  test('change windows and settings: the recurring window, a Gregorian and a Hijri blackout, the second approver, the settings', async ({ page, baseURL }, testInfo) => {
    const seen = watch(page, baseURL);
    await as(page, locale, 'administrator', '?tab=windows');
    await button(page, m(locale, 'win.edit')).click();
    await expect(page).toHaveURL(/window=edit/);
    const drawer = page.getByRole('dialog');
    await drawer.getByLabel(m(locale, 'from')).fill('02:00');
    await drawer.getByRole('button', { name: text(locale, 'common.save'), exact: true }).click();
    await expect(page.getByText(m(locale, 'toast.windows'))).toBeVisible();
    await button(page, m(locale, 'bo.add')).click();
    await expect(page).toHaveURL(/blackout=new/);
    await page.getByRole('dialog').getByLabel(m(locale, 'bo.label')).fill('Month-end');
    await page.getByRole('dialog').getByLabel(m(locale, 'from')).fill('2026-12-29');
    await page.getByRole('dialog').getByLabel(m(locale, 'to')).fill('2026-12-30');
    await shot(page, testInfo, locale, 'updates-blackout-drawer');
    await page.getByRole('dialog').getByRole('button', { name: text(locale, 'common.save'), exact: true }).click();
    await expect(page.getByText(m(locale, 'toast.blackout'), { exact: true })).toBeVisible();
    // A Hijri blackout, entered as three Selects and converted by the data layer with its reference table.
    await button(page, m(locale, 'bo.add')).click();
    const hijri = page.getByRole('dialog');
    await hijri.getByLabel(m(locale, 'bo.label')).fill('Hijri day');
    await hijri.getByRole('radio', { name: m(locale, 'bo.hijri') }).click();
    await shot(page, testInfo, locale, 'updates-blackout-hijri');
    await hijri.getByRole('button', { name: text(locale, 'common.save'), exact: true }).click();
    await expect(page.getByText(m(locale, 'toast.blackout'), { exact: true })).toBeVisible();
    await expect(page.getByRole('table', { name: m(locale, 'bo.title') })).toContainText('Hijri day');
    await page.getByRole('button', { name: m(locale, 'bo.remove') }).first().click();
    await expect(page.getByText(m(locale, 'toast.blackoutGone'))).toBeVisible();
    await page.getByRole('switch', { name: m(locale, 'ap.secondRequired') }).click();
    await expect(page.locator('[role="alert"]:not(#__next-route-announcer__)')).toBeVisible();
    await expectAudit(page, locale, 'update.windows_changed');
    await open(page, locale, '?tab=settings');
    await page.getByRole('radio', { name: m(locale, 'ch.hotfix') }).check();
    await page.getByRole('button', { name: text(locale, 'common.save') }).click();
    await expect(page.getByText(m(locale, 'toast.settings'))).toBeVisible();
    await expectAudit(page, locale, 'update.settings_changed');
    seen.expectClean();
  });

  for (const other of locales.filter((l) => l !== 'en')) {
    test(`what the flows left, in ${other}: the tabs draw, with no request leaving the app`, async ({ page, baseURL }, testInfo) => {
      const seen = watch(page, baseURL);
      await startDemo(page, other, 'administrator');
      for (const tab of ['overview', 'connection', 'windows', 'history', 'settings']) {
        await open(page, other, `?tab=${tab}`);
        await shot(page, testInfo, other, `updates-${tab}-after`);
      }
      seen.expectClean();
    });
  }
});
