// SPDX-License-Identifier: AGPL-3.0-only
import fs from 'node:fs';
import path from 'node:path';
import { type Page } from '@playwright/test';
import { expect, test } from '../fixtures';
import { expectPageOk, shot, startDemo, waitForHydration, watch } from '../helpers';
import { locales, text, titleOf, type InstallMode, type Locale, type Role } from '../routes';
import { readMessages } from '../messages';

// Audit Log. The log is append only: the specs read it,
// filter it, open an event, export it, and check that the sign-in spec's contract holds (the action code of an event shows,
// `?q=` and `?outcome=` are honoured). The seeded log has 23 events; other specs of the same run append theirs, so counts
// are asserted as "at least" and the filters are checked on the rows they return.

type Tree = { [key: string]: string | Tree };
const module_ = (locale: Locale): Tree => readMessages(path.join(import.meta.dirname, '../../apps/web/messages/admin/audit_log', `${locale}.json`)) as Tree;
const MODULE = { en: module_('en'), ar: module_('ar') };
/** A key of the module's own message file, for example `col.time`. */
function m(locale: Locale, key: string): string {
  let node: string | Tree | undefined = MODULE[locale];
  for (const part of key.split('.')) node = typeof node === 'object' ? node[part] : undefined;
  if (typeof node !== 'string') throw new Error(`No message admin.audit_log.${locale}:${key}`);
  return node;
}

const ROUTE = (locale: Locale) => `/${locale}/admin/audit-log`;
const rows = (page: Page) => page.locator('[data-module="admin.audit_log"] tbody tr');

async function open(page: Page, locale: Locale, query = '') {
  await page.goto(`${ROUTE(locale)}${query}`);
  await expect(page.locator('[data-module="admin.audit_log"]')).toHaveAttribute('data-state', 'filled');
  await expectPageOk(page, locale);
}

for (const locale of locales) {
  test.describe(`Audit Log in ${locale}`, () => {
    test(`the Administrator reads the log: title, four figures, seven columns, ten rows, action codes, no request leaves the app`, async ({ page, baseURL }, testInfo) => {
      const seen = watch(page, baseURL);
      await startDemo(page, locale, 'administrator');
      await open(page, locale);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(titleOf(locale, 'admin.audit_log'));
      await expect(page.getByText(m(locale, 'appendOnly'))).toBeVisible();
      for (const key of ['stat.events', 'stat.24h', 'stat.signins', 'stat.denied']) await expect(page.getByText(m(locale, key), { exact: true }).first()).toBeVisible();
      await expect(page.getByRole('columnheader')).toHaveText(['col.time', 'col.actor', 'col.action', 'col.entity', 'col.summary', 'col.outcome', 'col.source'].map((key) => m(locale, key)));
      await expect(rows(page)).toHaveCount(10);
      await expect(page.getByText('auth.sign_in').first()).toBeVisible();
      await expect(page.getByRole('button', { name: text(locale, 'common.export') })).toBeEnabled();
      await shot(page, testInfo, locale, 'audit-log-filled');
      seen.expectClean();
    });

    test(`?q= and ?outcome= narrow the list (the contract the sign-in spec relies on), and the filters show as chips`, async ({ page, baseURL }) => {
      const seen = watch(page, baseURL);
      await startDemo(page, locale, 'administrator');
      await open(page, locale, '?q=auth.emergency');
      await expect(rows(page).first()).toContainText('auth.emergency_sign_in');
      await expect(page.getByRole('searchbox')).toHaveValue('auth.emergency');
      await open(page, locale, '?outcome=denied');
      await expect(rows(page).first()).toContainText('auth.sign_in');
      await expect(rows(page).first()).toContainText(m(locale, 'out.denied'));
      await open(page, locale, '?cat=rules');
      await expect(rows(page).first()).toContainText('rule.approved');
      await expect(page.getByText(`${m(locale, 'f.cat')}: ${m(locale, 'cat.rules')}`)).toBeVisible();
      // a value that is not on an allow-list is ignored: the whole log
      await open(page, locale, '?outcome=root&cat=everything&period=forever&page=-3');
      await expect(rows(page)).toHaveCount(10);
      seen.expectClean();
    });

    test(`the search box writes ?q= (debounced) and Clear all removes the filters`, async ({ page, baseURL }) => {
      const seen = watch(page, baseURL);
      await startDemo(page, locale, 'administrator');
      await open(page, locale);
      await waitForHydration(page, 'main input[type=search], main [role=searchbox]');
      await page.getByRole('searchbox').fill('zzz-nothing');
      await expect(page).toHaveURL(/[?&]q=zzz-nothing/);
      await expect(page.getByText(m(locale, 'nomatch'))).toBeVisible();
      await page.getByRole('button', { name: text(locale, 'common.clearAll') }).last().click();
      await expect(page).not.toHaveURL(/[?&]q=/);
      await expect(rows(page)).toHaveCount(10);
      seen.expectClean();
    });

    test(`pressing a row opens the event's drawer through ?id= (Back closes it); the drawer is read only and has the record as JSON`, async ({ page, baseURL }, testInfo) => {
      const seen = watch(page, baseURL);
      await startDemo(page, locale, 'administrator');
      await open(page, locale, '?cat=rules');
      await waitForHydration(page, 'main tbody tr');
      await rows(page).first().click();
      await expect(page).toHaveURL(/[?&]id=[0-9a-f-]{36}/);
      const drawer = page.getByRole('dialog', { name: 'rule.approved' });
      await expect(drawer).toBeVisible();
      await expect(drawer.locator('pre')).toContainText('"action": "rule.approved"');
      await expect(drawer.getByRole('button', { name: m(locale, 'd.copy') })).toBeVisible();
      await expect(drawer.getByRole('button', { name: /edit|save|delete|تعديل|حفظ|حذف/i })).toHaveCount(0);
      await shot(page, testInfo, locale, 'audit-log-drawer');
      await page.goBack();
      await expect(drawer).toBeHidden();
      // a deep link renders the drawer on first paint, and an unknown id is a notice above the list
      await page.goForward();
      await expect(drawer).toBeVisible();
      await open(page, locale, '?id=00000000-0000-4000-8000-00000000dead');
      await expect(page.locator('[role="alert"]:not(#__next-route-announcer__)')).toContainText(m(locale, 'notice.notFound'));
      await expect(rows(page)).toHaveCount(10);
      seen.expectClean();
    });

    test(`pages through ?page= and the pager shows the range`, async ({ page, baseURL }) => {
      const seen = watch(page, baseURL);
      await startDemo(page, locale, 'administrator');
      await open(page, locale, '?page=3');
      await expect(rows(page).first()).toBeVisible();
      // the design system's pager: a named navigation, and the page shown is the one in the address
      const pager = page.getByRole('navigation', { name: text(locale, 'ds.pagination.label') });
      await expect(pager).toBeVisible();
      await expect(pager.locator('[aria-current="page"]')).toHaveAccessibleName(text(locale, 'ds.pagination.goToPage').replace('{page}', '3'));
      expect(await rows(page).count()).toBeLessThanOrEqual(10);
      seen.expectClean();
    });
  });
}

test.describe('Audit Log: export and roles', () => {
  test('Export downloads the events of the current filter as a CSV with a byte order mark and the record\'s field names', async ({ page, baseURL }) => {
    const seen = watch(page, baseURL);
    await startDemo(page, 'en', 'administrator');
    await open(page, 'en', '?cat=signin');
    await waitForHydration(page, 'main tbody tr');
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: text('en', 'common.export') }).click()]);
    expect(download.suggestedFilename()).toMatch(/^audit-log-\d{4}-\d{2}-\d{2}\.csv$/);
    const file = await download.path();
    const body = fs.readFileSync(file, 'utf8');
    expect(body.startsWith('﻿occurred_at,actor,actor_type,action,entity_type,entity_id,outcome,summary_en,correlation_id')).toBe(true);
    const lines = body.trim().split('\r\n');
    expect(lines.length).toBeGreaterThanOrEqual(10);
    expect(lines.slice(1).every((line) => /,auth\.|,sign_in\./.test(line))).toBe(true);
    await expect(page.getByText(m('en', 'toast.export.title'))).toBeVisible();
    seen.expectClean();
  });

  test('Refresh in the More menu says so', async ({ page, baseURL }) => {
    const seen = watch(page, baseURL);
    await startDemo(page, 'en', 'administrator');
    await open(page, 'en');
    await waitForHydration(page, 'main tbody tr');
    await page.getByRole('button', { name: text('en', 'common.more') }).click();
    await page.getByRole('menuitem', { name: m('en', 'menu.refresh') }).click();
    await expect(page.getByText(m('en', 'toast.refreshed'))).toBeVisible();
    seen.expectClean();
  });

  const READERS: ReadonlyArray<[Role, InstallMode]> = [
    ['viewer_auditor', 'private'],
    ['viewer_auditor', 'shared'],
    ['change_approver', 'private'],
  ];
  for (const [role, mode] of READERS) {
    test(`${role} in a ${mode} install reads the same log with the actors' names, and Export works`, async ({ page, baseURL }) => {
      const seen = watch(page, baseURL);
      await startDemo(page, 'en', role, mode);
      await open(page, 'en', '?cat=rules');
      await expect(page.locator('[data-module="admin.audit_log"]')).toHaveAttribute('data-access', 'view');
      await expect(rows(page).first()).toContainText('Fahad Al-Musari');
      await expect(page.getByText(text('en', 'shell.access.view'), { exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: text('en', 'common.export') })).toBeEnabled();
      seen.expectClean();
    });
  }

  test('a Dispatch Supervisor has the Admin Console but no Audit Log: the module frame is the no-access state, and no event is read', async ({ page, baseURL }) => {
    const seen = watch(page, baseURL, { allowNotFound: true });
    await startDemo(page, 'en', 'dispatch_supervisor', 'private');
    await page.goto(ROUTE('en'));
    const frame = page.locator('[data-module="admin.audit_log"]');
    await expect(frame).toHaveAttribute('data-state', 'noaccess');
    await expect(frame).toHaveAttribute('data-access', 'none');
    await expect(frame).toContainText(text('en', 'states.noAccess.title'));
    await expect(rows(page)).toHaveCount(0);
    await expect(page.getByRole('button', { name: text('en', 'common.export') })).toHaveCount(0);
    seen.expectClean();
  });

  test('a Planner has nothing in the Admin Console: the console shows one no-access panel, with no Audit Log frame and no event read', async ({ page, baseURL }) => {
    const seen = watch(page, baseURL, { allowNotFound: true });
    await startDemo(page, 'en', 'planner', 'private');
    await page.goto(ROUTE('en'));
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(text('en', 'states.noAccess.title'));
    await expect(page.locator('[data-module="admin.audit_log"]')).toHaveCount(0);
    await expect(rows(page)).toHaveCount(0);
    await expect(page.getByRole('button', { name: text('en', 'common.export') })).toHaveCount(0);
    seen.expectClean();
  });

  test('the review states: ?state=empty, loading and error keep the header and read nothing', async ({ page, baseURL }, testInfo) => {
    const seen = watch(page, baseURL);
    await startDemo(page, 'en', 'administrator');
    for (const state of ['empty', 'loading', 'error'] as const) {
      await page.goto(`${ROUTE('en')}?state=${state}`);
      await expect(page.locator('[data-module="admin.audit_log"]')).toHaveAttribute('data-state', state);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(titleOf('en', 'admin.audit_log'));
      await expect(rows(page)).toHaveCount(0);
      await shot(page, testInfo, 'en', `audit-log-${state}`);
    }
    await expect(page.getByText(m('en', 'states.error.desc'))).toBeVisible();
    seen.expectClean();
  });
});
