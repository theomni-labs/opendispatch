// SPDX-License-Identifier: AGPL-3.0-only
import path from 'node:path';
import { type Locator, type Page } from '@playwright/test';
import { expect, test } from '../fixtures';
import { expectPageOk, shot, startDemo, waitForHydration, watch } from '../helpers';
import { locales, text, titleOf, type Locale } from '../routes';
import { readMessages } from '../messages';

// Shift and Break Policies. The Administrator reads the patterns, the week strip and its two ribbons
// (left to right in both languages), the break rule and the Ramadan card (the switch is fixed On and labelled "Not applied"); adds
// and changes a pattern, sets patterns to draft and back from the bulk bar, and edits the break rule. Each write is followed by
// its audit event in the Audit Log. Tests share one demo store and run in parallel, so each language adds a pattern of its own and
// changes patterns other specs do not read.

type Tree = { [key: string]: string | Tree };
const module_ = (locale: Locale): Tree => readMessages(path.join(import.meta.dirname, '../../apps/web/messages/admin/shift_break_policies', `${locale}.json`)) as Tree;
const MODULE = { en: module_('en'), ar: module_('ar') };
function m(locale: Locale, key: string, values: Record<string, string> = {}): string {
  let node: string | Tree | undefined = MODULE[locale];
  for (const part of key.split('.')) node = typeof node === 'object' ? node[part] : undefined;
  if (typeof node !== 'string') throw new Error(`No message admin.shift_break_policies.${locale}:${key}`);
  return Object.entries(values).reduce((out, [name, value]) => out.replaceAll(`{${name}}`, value), node);
}

const ROUTE = (locale: Locale) => `/${locale}/admin/shift-break-policies`;
const rows = (page: Page) => page.locator('[data-module="admin.shift_break_policies"] tbody tr');

async function open(page: Page, locale: Locale, query = '') {
  await page.goto(`${ROUTE(locale)}${query}`);
  await expect(page.locator('[data-module="admin.shift_break_policies"]')).toHaveAttribute('data-state', 'filled');
  await expectPageOk(page, locale);
  await waitForHydration(page, 'main tbody tr');
}

async function expectAudit(page: Page, locale: Locale, action: string) {
  await page.goto(`/${locale}/admin/audit-log?q=${action}`);
  await expect(page.locator('[data-module="admin.audit_log"] tbody tr').first()).toContainText(action);
}

/** A new pattern starts with both hour groups On and the times empty (as in the mockup): the normal and the Ramadan hours are typed before Save. */
async function fillHours(drawer: Locator, locale: Locale) {
  const start = drawer.getByLabel(m(locale, 'dr.from'), { exact: true });
  const end = drawer.getByLabel(m(locale, 'dr.to'), { exact: true });
  await start.nth(0).fill('06:00');
  await end.nth(0).fill('14:00');
  await start.nth(1).fill('06:00');
  await end.nth(1).fill('12:00');
}

for (const locale of locales) {
  const tag = locale === 'en' ? 'Q' : 'R';
  test.describe(`Shift and Break Policies in ${locale}`, () => {
    test(`the Administrator reads it: title, subtitle, four figures, six columns, the week with both ribbons left to right, the Ramadan card; no request leaves the app`, async ({ page, baseURL }, testInfo) => {
      const seen = watch(page, baseURL);
      await startDemo(page, locale, 'administrator');
      await open(page, locale);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(titleOf(locale, 'admin.shift_break_policies'));
      await expect(page.getByText(m(locale, 'sub'))).toBeVisible();
      for (const key of ['col.pattern', 'col.kind', 'col.normal', 'col.ramadan', 'col.break']) await expect(page.getByRole('columnheader', { name: m(locale, key) })).toBeVisible();
      expect(await rows(page).count()).toBeGreaterThanOrEqual(6);
      const ribbons = page.locator('[role="img"]').filter({ has: page.locator('span[title]') });
      expect(await ribbons.count()).toBeGreaterThanOrEqual(2);
      // a time axis never flips: the ribbon is left to right whatever the page direction
      expect(await ribbons.first().evaluate((el) => getComputedStyle(el.parentElement as HTMLElement).direction)).toBe('ltr');
      await expect(page.getByRole('switch', { name: m(locale, 'ram.auto') })).toBeChecked();
      await expect(page.locator('[data-stub="notApplied"]')).toBeVisible();
      await shot(page, testInfo, locale, 'shifts-filled');
      await open(page, locale, '?hours=ramadan');
      await expect(page.getByRole('radio', { name: m(locale, 'mode.ramadan') })).toHaveAttribute('aria-checked', 'true');
      await shot(page, testInfo, locale, 'shifts-ramadan');
      seen.expectClean();
    });

    test(`adds a pattern as a draft, changes its hours, and the Audit Log has both events`, async ({ page, baseURL }, testInfo) => {
      const seen = watch(page, baseURL);
      await startDemo(page, locale, 'administrator');
      await open(page, locale);
      const code = `E2E-${tag}`;
      await page.getByRole('button', { name: m(locale, 'add') }).click();
      const drawer = page.getByRole('dialog', { name: m(locale, 'dr.new') });
      await expect(drawer).toBeVisible();
      await drawer.getByLabel(m(locale, 'dr.name')).first().fill(`E2E pattern ${tag}`);
      await drawer.getByLabel(m(locale, 'dr.code')).fill(code);
      await fillHours(drawer, locale);
      await drawer.getByRole('button', { name: text(locale, 'common.save') }).click();
      await expect(page.getByText(m(locale, 'toast.created', { code }))).toBeVisible();
      await expect(rows(page).filter({ hasText: code })).toHaveCount(1);
      await expect(rows(page).filter({ hasText: code })).toContainText(m(locale, 'status.draft'));
      await rows(page).filter({ hasText: code }).click();
      const edit = page.getByRole('dialog', { name: m(locale, 'dr.edit') });
      await expect(edit).toBeVisible();
      await shot(page, testInfo, locale, 'shifts-drawer');
      await edit.getByLabel(m(locale, 'dr.to'), { exact: true }).first().fill('17:00');
      await edit.getByRole('button', { name: text(locale, 'common.save') }).click();
      await expect(page.getByText(m(locale, 'toast.draft'))).toBeVisible();
      await expectAudit(page, locale, 'shift_pattern.created');
      await expectAudit(page, locale, 'shift_pattern.updated');
      seen.expectClean();
    });

    test(`sets the pattern it added to active and back to draft from the bulk bar`, async ({ page, baseURL }) => {
      const seen = watch(page, baseURL);
      await startDemo(page, locale, 'administrator');
      const code = `E2E-BULK-${tag}`;
      await open(page, locale, '?pattern=new');
      const drawer = page.getByRole('dialog', { name: m(locale, 'dr.new') });
      await drawer.getByLabel(m(locale, 'dr.name')).first().fill(`E2E bulk ${tag}`);
      await drawer.getByLabel(m(locale, 'dr.code')).fill(code);
      await fillHours(drawer, locale);
      await drawer.getByRole('button', { name: text(locale, 'common.save') }).click();
      await expect(page.getByText(m(locale, 'toast.created', { code }))).toBeVisible();
      // the row's checkbox is named after the record ("Select row E2E bulk Q")
      await page.getByRole('checkbox', { name: new RegExp(`E2E bulk ${tag}`) }).check();
      await page.getByRole('region', { name: text(locale, 'ds.dataTable.bulkActions') }).getByRole('button', { name: m(locale, 'bulk.active') }).click();
      await expect(page.getByText(m(locale, 'toast.bulk', { n: '1', status: m(locale, 'status.active') }))).toBeVisible();
      await expect(rows(page).filter({ hasText: code })).toContainText(m(locale, 'status.active'));
      seen.expectClean();
    });

    test(`edits the break rule from the More menu, and the Audit Log has it`, async ({ page, baseURL }, testInfo) => {
      const seen = watch(page, baseURL);
      await startDemo(page, locale, 'administrator');
      await open(page, locale);
      await page.getByRole('button', { name: text(locale, 'common.more') }).click();
      await page.getByRole('menuitem', { name: m(locale, 'menu.breakRule') }).click();
      const dialog = page.getByRole('dialog', { name: m(locale, 'brk.title') });
      await expect(dialog).toBeVisible();
      await shot(page, testInfo, locale, 'shifts-break-dialog');
      await dialog.getByRole('button', { name: text(locale, 'common.save') }).click();
      await expect(page.getByText(m(locale, 'toast.breakSaved'))).toBeVisible();
      await expectAudit(page, locale, 'break_rule.updated');
      seen.expectClean();
    });

    test(`an unknown pattern id is a notice above the list, never an error`, async ({ page, baseURL }) => {
      const seen = watch(page, baseURL);
      await startDemo(page, locale, 'administrator');
      await open(page, locale, '?pattern=00000000-0000-4000-8000-00000000dead&kind=hybrid');
      await expect(page.locator('[role="alert"]:not(#__next-route-announcer__)')).toContainText(m(locale, 'notice.notFound'));
      seen.expectClean();
    });
  });
}
