// SPDX-License-Identifier: AGPL-3.0-only
import { type Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { expectPageOk, shot, signOutViaSwitcher, startDemo, waitForHydration, watch } from '../helpers';
import { text, type InstallMode, type Locale, type Role } from '../routes';
import { expectAudit, messages } from './support';

// Flow 9: apply an update, private install.

const UP = messages('admin/updates');
// Not the default 03:00, so the change shows
const WINDOW_FROM = '02:30';

const root = (page: Page) => page.locator('[data-module="admin.updates"]');
const release = (page: Page) => page.locator('#up-release');
const stage = async (page: Page, want: string, timeout = 20_000) => expect(release(page)).toHaveAttribute('data-stage', want, { timeout });
const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true });

async function open(page: Page, locale: Locale, query = '') {
  await page.goto(`/${locale}/admin/updates${query}`);
  await expect(root(page)).toHaveAttribute('data-state', 'filled');
  await expectPageOk(page, locale);
  await waitForHydration(page, '[data-module="admin.updates"] button');
}

async function as(page: Page, locale: Locale, role: Role, query = '', mode: InstallMode = 'private') {
  if (page.url().startsWith('http')) await signOutViaSwitcher(page, locale);
  await startDemo(page, locale, role, mode);
  await open(page, locale, query);
}

// Verified, pre-flight, scheduled, approved.
async function toApproved(page: Page, locale: Locale, version: string) {
  await as(page, locale, 'administrator', `?release=${version}`);
  await button(page, UP(locale, 'download')).click();
  await stage(page, 'verified');
  await expect(page.getByRole('list', { name: UP(locale, 'vf.title') }).getByText(UP(locale, 'pf.passed'))).toHaveCount(5);
  await button(page, UP(locale, 'preflight')).click();
  await button(page, UP(locale, 'backup.confirm')).click();
  await stage(page, 'ready');
  await button(page, UP(locale, 'schedule')).click();
  const dialog = page.getByRole('dialog');
  // The next window is offered first and chosen.
  await expect(dialog.getByRole('radio').first()).toBeChecked();
  await expect(dialog.getByRole('radio').first()).toHaveAccessibleName(new RegExp(WINDOW_FROM));
  await dialog.getByRole('button', { name: UP(locale, 'schedule'), exact: true }).click();
  await stage(page, 'awaiting');
  await expect(release(page)).toContainText(WINDOW_FROM);
  await as(page, locale, 'change_approver', `?release=${version}`);
  await button(page, text(locale, 'common.approve')).click();
  await stage(page, 'approved');
  await as(page, locale, 'administrator', `?release=${version}`);
}

function flow(locale: Locale, name: string) {
  test.describe.serial(name, () => {
    test('sets the connection mode and a change window', async ({ page, baseURL }, testInfo) => {
      const seen = watch(page, baseURL);
      await as(page, locale, 'administrator', '?tab=windows');
      await button(page, UP(locale, 'win.edit')).click();
      const drawer = page.getByRole('dialog');
      await drawer.getByLabel(UP(locale, 'from')).fill(WINDOW_FROM);
      await drawer.getByRole('button', { name: text(locale, 'common.save'), exact: true }).click();
      await expect(page.getByText(UP(locale, 'toast.windows'))).toBeVisible();
      await expect(root(page)).toContainText(WINDOW_FROM);
      await shot(page, testInfo, locale, 'flow9-window-set');
      await open(page, locale, '?tab=connection');
      await expect(page.getByRole('radio', { name: UP(locale, 'mode.connected') })).toBeChecked();
      await expectAudit(page, locale, 'update.windows_changed', 'update.windows_changed');
      seen.expectClean();
    });

    test('1.2.0: found, verified, pre-flight passes, scheduled into the window, approved, applied, health checks pass', async ({ page, baseURL }, testInfo) => {
      const seen = watch(page, baseURL);
      await as(page, locale, 'administrator');
      await stage(page, 'available');
      await expect(page.getByRole('heading', { name: /1\.2\.0/ })).toBeVisible();
      await toApproved(page, locale, '1.2.0');
      await button(page, UP(locale, 'applyNow')).click();
      const dialog = page.getByRole('dialog');
      await expect(dialog.getByText(UP(locale, 'pf.passed'), { exact: true })).toHaveCount(6);
      await dialog.getByRole('button', { name: UP(locale, 'applyNow'), exact: true }).click();
      await expect(dialog.getByText(UP(locale, 'run.done'))).toBeVisible();
      await expect(dialog.getByText(UP(locale, 'run.health'))).toBeVisible();
      await shot(page, testInfo, locale, 'flow9-applied');
      await dialog.getByRole('button', { name: UP(locale, 'done'), exact: true }).click();
      await expect(page.getByText('v1.2.0').first()).toBeVisible();
      await open(page, locale, '?tab=history');
      await expect(page.getByRole('table', { name: UP(locale, 'tab.history') })).toContainText('1.2.0');
      for (const action of ['update.download', 'update.backup_confirmed', 'update.schedule', 'update.approve']) await expectAudit(page, locale, action, action);
      await expectAudit(page, locale, '1.2.0 applied', 'update.apply');
      seen.expectClean();
    });

    test('1.3.0: the health check fails and the system rolls back by itself', async ({ page, baseURL }, testInfo) => {
      const seen = watch(page, baseURL);
      await toApproved(page, locale, '1.3.0');
      await button(page, UP(locale, 'applyNow')).click();
      const dialog = page.getByRole('dialog');
      await dialog.getByRole('button', { name: UP(locale, 'applyNow'), exact: true }).click();
      await expect(dialog.getByText(UP(locale, 'rb.why'))).toBeVisible();
      await shot(page, testInfo, locale, 'flow9-rollback-dialog');
      await dialog.getByRole('button', { name: UP(locale, 'done'), exact: true }).click();
      await expect(page.getByText(UP(locale, 'rb.title', { v: '1.3.0', from: '1.2.0' }))).toBeVisible();
      await open(page, locale, '?tab=history');
      await expect(page.getByRole('table', { name: UP(locale, 'tab.history') })).toContainText(UP(locale, 'r.rolled_back'));
      await expectAudit(page, locale, '1.3.0 applied', 'update.apply');
      await expectAudit(page, locale, 'rolled_back', 'update.apply');
      seen.expectClean();
    });

    test('a third run where an offline file is uploaded', async ({ page, baseURL }, testInfo) => {
      const seen = watch(page, baseURL);
      await as(page, locale, 'administrator', '?tab=connection');
      await page.getByRole('radio', { name: UP(locale, 'mode.offline') }).click();
      // Wait for the mode change before uploading.
      await expect(page.getByText(UP(locale, 'toast.modeOffline'))).toBeVisible();
      await page.waitForLoadState('networkidle');
      const input = page.locator('input[type="file"]');
      await expect(input).toBeAttached();
      await input.setInputFiles({ name: 'opendispatch-1.4.0.update', mimeType: 'text/plain', buffer: Buffer.from('opendispatch update 1.4.0') });
      await expect(page.getByText(UP(locale, 'off.verified'), { exact: true }).first()).toBeVisible();
      await shot(page, testInfo, locale, 'flow9-offline-verified');
      await page.getByRole('button', { name: UP(locale, 'off.use') }).click();
      await stage(page, 'verified');
      await expect(page.getByRole('heading', { name: /1\.4\.0/ })).toBeVisible();
      await expectAudit(page, locale, 'update.offline_upload', 'update.offline_upload');
      seen.expectClean();
    });
  });
}

test.use({ video: 'on' });

flow('en', 'English');
flow('ar', 'Arabic');
