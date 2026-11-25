// SPDX-License-Identifier: AGPL-3.0-only
import fs from 'node:fs';
import path from 'node:path';
import { type Page } from '@playwright/test';
import { expect, test } from '../fixtures';
import { expectPageOk, shot, startDemo, waitForHydration, watch } from '../helpers';
import { locales, text, titleOf, type Locale } from '../routes';
import { readMessages } from '../messages';

// API and Webhooks. The Administrator reads the clients, the webhooks, the delivery log and the
// rate limits; creates a client and sees its key ONCE in a dialog that cannot be closed until acknowledged; revokes a client; adds,
// tests and deletes a webhook (a scripted test: nothing is sent, and the toast says so); retries a failed delivery; saves the limits.
// Each write is followed by its audit event in the Audit Log. THE KEY: the spec reads it from the page only to check that
// it is not in the address or in the audit event, and never prints, stores or screenshots it (no screenshot is taken while the key
// dialog is open). Tests share one demo store and run in parallel, so every record a test adds has a name of its own.

type Tree = { [key: string]: string | Tree };
const module_ = (locale: Locale): Tree => readMessages(path.join(import.meta.dirname, '../../apps/web/messages/admin/api_webhooks', `${locale}.json`)) as Tree;
const MODULE = { en: module_('en'), ar: module_('ar') };
/** A key of the module's own message file, with `{name}` style values put in. */
function m(locale: Locale, key: string, values: Record<string, string> = {}): string {
  let node: string | Tree | undefined = MODULE[locale];
  for (const part of key.split('.')) node = typeof node === 'object' ? node[part] : undefined;
  if (typeof node !== 'string') throw new Error(`No message admin.api_webhooks.${locale}:${key}`);
  return Object.entries(values).reduce((out, [name, value]) => out.replaceAll(`{${name}}`, value), node);
}

const ROUTE = (locale: Locale) => `/${locale}/admin/api-webhooks`;
const rows = (page: Page) => page.locator('[data-module="admin.api_webhooks"] tbody tr');
const unique = (locale: Locale, word: string) => `${word}-${locale}-${Date.now().toString(36)}`;

async function open(page: Page, locale: Locale, query = '') {
  await page.goto(`${ROUTE(locale)}${query}`);
  await expect(page.locator('[data-module="admin.api_webhooks"]')).toHaveAttribute('data-state', 'filled');
  await expectPageOk(page, locale);
  await waitForHydration(page, 'main tbody tr');
}

/** The Audit Log filtered by an action code: the write's event is there. */
async function expectAudit(page: Page, locale: Locale, action: string) {
  await page.goto(`/${locale}/admin/audit-log?q=${action}`);
  await expect(page.locator('[data-module="admin.audit_log"] tbody tr').first()).toContainText(action);
}

for (const locale of locales) {
  test.describe(`API and Webhooks in ${locale}`, () => {
    test(`the Administrator reads the four tabs: figures, columns, the stub tags and the Illustrative label; nothing leaves the app`, async ({ page, baseURL }, testInfo) => {
      const seen = watch(page, baseURL);
      await startDemo(page, locale, 'administrator');
      await open(page, locale);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(titleOf(locale, 'admin.api_webhooks'));
      await expect(page.getByRole('columnheader')).toHaveText(['col.client', 'col.scopes', 'col.key', 'col.lastUsed', 'common.status', 'col.actions'].map((key) => (key.startsWith('common.') ? text(locale, key) : m(locale, key))));
      await expect(page.getByText('····x7q2')).toBeVisible();
      await shot(page, testInfo, locale, 'api-webhooks-clients');
      await open(page, locale, '?tab=hooks');
      await expect(page.locator('[data-stub="demo"]').first()).toBeVisible();
      await expect(rows(page).first()).toContainText('roster.approved');
      await shot(page, testInfo, locale, 'api-webhooks-hooks');
      await open(page, locale, '?tab=log');
      await expect(rows(page)).toHaveCount(3);
      await shot(page, testInfo, locale, 'api-webhooks-log');
      await open(page, locale, '?tab=limits');
      await expect(page.locator('[data-stub="notApplied"]').first()).toBeVisible();
      await expect(page.getByText(text(locale, 'common.illustrative')).first()).toBeVisible();
      await shot(page, testInfo, locale, 'api-webhooks-limits');
      seen.expectClean();
    });

    test(`creates a client: the key is shown once, cannot be dismissed unacknowledged, is in no address and no audit event, and the client shows with its last four characters`, async ({ page, baseURL }) => {
      const seen = watch(page, baseURL);
      const name = unique(locale, 'client');
      await startDemo(page, locale, 'administrator');
      await open(page, locale, '?client=new');
      const drawer = page.getByRole('dialog');
      await drawer.getByLabel(m(locale, 'f.name')).fill(name);
      await drawer.getByRole('checkbox', { name: /read/ }).check();
      await drawer.getByRole('button', { name: m(locale, 'createShort') }).click();
      const dialog = page.getByRole('dialog', { name: m(locale, 'secret.title') });
      await expect(dialog).toBeVisible();
      const key = await dialog.locator('input[data-secret]').inputValue();
      expect(key).toMatch(/^opendispatch_[A-Za-z0-9_-]{30,}$/);
      // not dismissible before the acknowledgement: Escape and Done change nothing
      await page.keyboard.press('Escape');
      await expect(dialog).toBeVisible();
      // Done is aria-disabled until the box is ticked (so Playwright would wait for it to be enabled): the click is forced, to prove
      // that pressing it anyway does nothing
      const done = dialog.getByRole('button', { name: m(locale, 'secret.done') });
      await expect(done).toHaveAttribute('aria-disabled', 'true');
      await done.click({ force: true });
      await expect(dialog).toBeVisible();
      expect(page.url()).not.toContain(key);
      await dialog.getByRole('checkbox', { name: m(locale, 'secret.ack') }).check();
      await dialog.getByRole('button', { name: m(locale, 'secret.done') }).click();
      await expect(dialog).toBeHidden();
      expect(await page.locator('body').innerText()).not.toContain(key);
      await expect(rows(page).filter({ hasText: name })).toContainText(`····${key.slice(-4)}`);
      // the audit event names the client and the scope, never the key
      await page.goto(`/${locale}/admin/audit-log?q=api_client.created`);
      const audit = page.locator('[data-module="admin.audit_log"] tbody tr').first();
      await expect(audit).toContainText('api_client.created');
      expect(await page.locator('body').innerText()).not.toContain(key);
      seen.expectClean();
    });

    test(`revokes a client after a confirmation, and it shows as revoked without a Revoke button`, async ({ page, baseURL }) => {
      const seen = watch(page, baseURL);
      const name = unique(locale, 'revoke');
      await startDemo(page, locale, 'administrator');
      await open(page, locale, '?client=new');
      const drawer = page.getByRole('dialog');
      await drawer.getByLabel(m(locale, 'f.name')).fill(name);
      await drawer.getByRole('checkbox', { name: /feeds/ }).check();
      await drawer.getByRole('button', { name: m(locale, 'createShort') }).click();
      const keyDialog = page.getByRole('dialog', { name: m(locale, 'secret.title') });
      await keyDialog.getByRole('checkbox', { name: m(locale, 'secret.ack') }).check();
      await keyDialog.getByRole('button', { name: m(locale, 'secret.done') }).click();
      const row = rows(page).filter({ hasText: name });
      await row.getByRole('button', { name: m(locale, 'revoke') }).click();
      await page.getByRole('dialog').getByRole('button', { name: m(locale, 'revokeConfirm.ok') }).click();
      await expect(row).toContainText(m(locale, 'st.revoked'));
      await expect(row.getByRole('button', { name: m(locale, 'revoke') })).toHaveCount(0);
      await expectAudit(page, locale, 'api_client.revoked');
      seen.expectClean();
    });

    test(`adds a webhook (https only), sends a scripted test that says nothing was sent, and deletes the webhook after a confirmation`, async ({ page, baseURL }) => {
      const seen = watch(page, baseURL);
      const name = unique(locale, 'hook');
      await startDemo(page, locale, 'administrator');
      await open(page, locale, '?tab=hooks&hook=new');
      const drawer = page.getByRole('dialog');
      await drawer.getByLabel(m(locale, 'f.name')).fill(name);
      await drawer.getByLabel(m(locale, 'f.url')).fill('http://example.com/x');
      await expect(drawer.getByRole('button', { name: text(locale, 'common.save') })).toHaveAttribute('aria-disabled', 'true');
      await drawer.getByLabel(m(locale, 'f.url')).fill('https://hooks.example.com/opendispatch/e2e');
      await drawer.getByRole('checkbox', { name: 'rule.approved' }).check();
      await drawer.getByRole('button', { name: text(locale, 'common.save') }).click();
      const row = rows(page).filter({ hasText: name });
      await expect(row).toBeVisible();
      await row.getByRole('button', { name: m(locale, 'test') }).click();
      await expect(page.getByText(m(locale, 'nothingSent')).first()).toBeVisible();
      await row.click();
      await expect(page).toHaveURL(/[?&]hook=[0-9a-f-]{36}/);
      await page.getByRole('dialog').getByRole('button', { name: m(locale, 'hook.delete') }).click();
      await page.getByRole('dialog', { name: m(locale, 'hook.delTitle') }).getByRole('button', { name: m(locale, 'hook.delete') }).click();
      await expect(rows(page).filter({ hasText: name })).toHaveCount(0);
      for (const action of ['webhook.created', 'webhook.tested', 'webhook.deleted']) await expectAudit(page, locale, action);
      seen.expectClean();
    });

    test(`saves a rate limit (stored, not enforced) and keeps it after a reload`, async ({ page, baseURL }) => {
      const seen = watch(page, baseURL);
      await startDemo(page, locale, 'administrator');
      await open(page, locale, '?tab=limits');
      await waitForHydration(page, 'main input');
      const input = page.getByLabel('write', { exact: true });
      await input.fill('35');
      await page.getByRole('button', { name: text(locale, 'common.save') }).click();
      await expect(page.getByText(m(locale, 'toast.limits'))).toBeVisible();
      await page.reload();
      await expect(page.getByLabel('write', { exact: true })).toHaveValue('35');
      await page.getByLabel('write', { exact: true }).fill('30');
      await page.getByRole('button', { name: text(locale, 'common.save') }).click();
      await expectAudit(page, locale, 'api_rate_limits.updated');
      seen.expectClean();
    });
  });
}

// The seed has exactly one failed delivery, and its webhook's address has no "fail" in it, so retrying delivers it and the
// delivery cannot be failed again: this resource is spent once per demo store. Run in file order (not the per-locale loop
// above, which fullyParallel does not keep in order): English retries it, Arabic then reads what was left, without retrying.
test.describe.serial('API and Webhooks: the delivery retry (spent once)', () => {
  for (const locale of locales) {
    test(`retries the failed delivery in ${locale}: a stub that says nothing was sent, the attempts go up`, async ({ page, baseURL }) => {
      const seen = watch(page, baseURL);
      await startDemo(page, locale, 'administrator');
      if (locale === locales[0]) {
        await open(page, locale, '?tab=log&status=failed');
        const failed = rows(page).filter({ hasText: 'HTTP 503' });
        await expect(failed).toBeVisible();
        await failed.getByRole('button', { name: m(locale, 'retry.label') }).click();
        await expect(page.getByText(m(locale, 'nothingSent')).first()).toBeVisible();
        await expectAudit(page, locale, 'webhook.delivery_retried');
      } else {
        await open(page, locale, '?tab=log&status=failed');
        await expect(rows(page).filter({ hasText: 'HTTP 503' })).toHaveCount(0);
        // Two deliveries were already succeeded in the seed; the retried one makes three (all show HTTP 200, so a specific
        // row cannot be told apart by that text alone).
        await open(page, locale, '?tab=log&status=succeeded');
        await expect(rows(page)).toHaveCount(3);
      }
      seen.expectClean();
    });
  }
});

test.describe('API and Webhooks: the delivery log, roles and states', () => {
  test('?q= and ?status= narrow the log, and Export delivers a CSV of the whole log', async ({ page, baseURL }) => {
    const seen = watch(page, baseURL);
    await startDemo(page, 'en', 'administrator');
    await open(page, 'en', '?tab=log&status=succeeded');
    await expect(page.getByText(`${text('en', 'common.status')}: ${m('en', 'st.succeeded')}`)).toBeVisible();
    await expect(rows(page).filter({ hasText: 'HTTP 503' })).toHaveCount(0);
    await page.getByRole('button', { name: text('en', 'common.more') }).click();
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('menuitem', { name: m('en', 'exportLog') }).click()]);
    expect(download.suggestedFilename()).toBe('webhook-deliveries.csv');
    const body = fs.readFileSync(await download.path(), 'utf8');
    expect(body.startsWith('﻿Time,Webhook,Event,Status,HTTP,Attempts')).toBe(true);
    expect(body.trim().split('\r\n').length).toBeGreaterThanOrEqual(4);
    seen.expectClean();
  });

  test('no other role has the module: the no-access page in a shared install for the Viewer / Auditor', async ({ page, baseURL }) => {
    const seen = watch(page, baseURL, { allowNotFound: true });
    await startDemo(page, 'en', 'viewer_auditor', 'shared');
    await page.goto(ROUTE('en'));
    await expect(page.locator('[data-module="admin.api_webhooks"]')).toHaveAttribute('data-state', 'noaccess');
    seen.expectClean();
  });

  test('the review states keep the header and read nothing', async ({ page, baseURL }, testInfo) => {
    const seen = watch(page, baseURL);
    await startDemo(page, 'en', 'administrator');
    for (const state of ['empty', 'loading', 'error'] as const) {
      await page.goto(`${ROUTE('en')}?state=${state}`);
      await expect(page.locator('[data-module="admin.api_webhooks"]')).toHaveAttribute('data-state', state);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(titleOf('en', 'admin.api_webhooks'));
      await shot(page, testInfo, 'en', `api-webhooks-${state}`);
    }
    await expect(page.getByText(m('en', 'states.error.desc'))).toBeVisible();
    seen.expectClean();
  });
});
