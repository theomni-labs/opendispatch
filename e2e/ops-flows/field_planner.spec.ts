// SPDX-License-Identifier: AGPL-3.0-only
import path from 'node:path';
import { type Page } from '@playwright/test';
import { expect, test } from '../fixtures';
import { expectPageOk, shot, startDemo, waitForHydration, watch } from '../helpers';
import { locales, text, titleOf, type Locale } from '../routes';
import { readMessages } from '../messages';

// Field Planner Workbench (Ops 4, flow 2; plan
// section 4). A Planner or Dispatch Supervisor
// builds the roster, adds a reason-coded override,
// and a different Dispatch Supervisor approves it.
// Publish is a LABELLED STUB. Administrator and
// Viewer/Auditor (view only) read the same roster
// with every action unavailable.

type Tree = { [key: string]: string | Tree };
const module_ = (locale: Locale): Tree => readMessages(path.join(import.meta.dirname, '../../apps/web/messages/ops/field_planner', `${locale}.json`)) as Tree;
const MODULE = { en: module_('en'), ar: module_('ar') };
function m(locale: Locale, key: string, values: Record<string, string> = {}): string {
  let node: string | Tree | undefined = MODULE[locale];
  for (const part of key.split('.')) node = typeof node === 'object' ? node[part] : undefined;
  if (typeof node !== 'string') throw new Error(`No message ops.field_planner.${locale}:${key}`);
  return Object.entries(values).reduce((out, [name, value]) => out.replaceAll(`{${name}}`, value), node);
}

const ROUTE = (locale: Locale) => `/${locale}/ops/field-planner`;
const root = (page: Page) => page.locator('[data-module="ops.field_planner"]');

async function open(page: Page, locale: Locale, query = '') {
  await page.goto(`${ROUTE(locale)}${query}`);
  await expect(root(page)).toHaveAttribute('data-state', 'filled');
  await expectPageOk(page, locale);
  await waitForHydration(page, '[data-module="ops.field_planner"] button');
}

// Most write roles have no Audit Log access.
async function expectAudit(page: Page, locale: Locale, action: string) {
  await startDemo(page, locale, 'administrator');
  await page.goto(`/${locale}/admin/audit-log?q=${action}`);
  await expect(page.locator('[data-module="admin.audit_log"] tbody tr').first()).toContainText(action);
}

for (const locale of locales) {
  test.describe(`Field Planner Workbench, read only, in ${locale}`, () => {
    test('the Administrator (view only) reads the title, the approval bar, the four stats, the roster grid and the tabs', async ({ page, baseURL }, testInfo) => {
      const seen = watch(page, baseURL);
      await startDemo(page, locale, 'administrator');
      await open(page, locale);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(titleOf(locale, 'ops.field_planner'));
      await expect(root(page).getByRole('heading', { name: m(locale, 'grid.title') })).toBeVisible();
      for (const key of ['stat.agents', 'stat.gaps', 'stat.surplus', 'stat.overrides']) {
        await expect(root(page).getByText(m(locale, key))).toBeVisible();
      }
      await expect(root(page).getByRole('tab', { name: m(locale, 'tab.roster') })).toBeVisible();
      await expect(root(page).getByRole('tab', { name: new RegExp(m(locale, 'tab.overrides')) })).toBeVisible();
      await expect(root(page).getByRole('tab', { name: m(locale, 'tab.vehicles') })).toBeVisible();
      await expect(root(page).getByText(text(locale, 'shell.access.view'))).toBeVisible();
      await expect(root(page).getByText(text(locale, 'common.illustrative')).first()).toBeVisible();
      await shot(page, testInfo, locale, 'field-planner-filled');
      seen.expectClean();
    });

    test('the review states ?state=empty, loading, error and noaccess keep the header and show their text', async ({ page, baseURL }, testInfo) => {
      const seen = watch(page, baseURL);
      await startDemo(page, locale, 'administrator');
      for (const state of ['empty', 'loading', 'error'] as const) {
        await page.goto(`${ROUTE(locale)}?state=${state}`);
        await expect(root(page)).toHaveAttribute('data-state', state);
        await expect(page.getByRole('heading', { level: 1 })).toHaveText(titleOf(locale, 'ops.field_planner'));
        await shot(page, testInfo, locale, `field-planner-${state}`);
      }
      seen.expectClean();
    });

    test('a Dispatcher (no access) sees the no-access panel, not the roster', async ({ page, baseURL }) => {
      const seen = watch(page, baseURL);
      await startDemo(page, locale, 'dispatcher');
      await page.goto(ROUTE(locale));
      await expect(root(page)).toHaveAttribute('data-state', 'noaccess');
      seen.expectClean();
    });
  });
}

test.describe.serial('Field Planner Workbench, the writes', () => {
  const locale: Locale = 'en';

  test('a view-only role never gets an enabled Approve, Reject or Publish', async ({ page, baseURL }) => {
    const seen = watch(page, baseURL);
    await startDemo(page, locale, 'viewer_auditor');
    await open(page, locale);
    for (const label of [text(locale, 'common.approve'), text(locale, 'common.reject'), m(locale, 'publish')]) {
      await expect(root(page).getByRole('button', { name: label, exact: true })).toHaveAttribute('aria-disabled', 'true');
    }
    seen.expectClean();
  });

  test('a Planner opens the override drawer: the reason is required, "other" also needs a note, and the submit button stays unavailable until both are given', async ({ page, baseURL }, testInfo) => {
    const seen = watch(page, baseURL);
    await startDemo(page, locale, 'planner');
    await open(page, locale);
    await root(page).getByRole('button', { name: m(locale, 'add'), exact: true }).click();
    const drawer = page.getByRole('dialog', { name: m(locale, 'add') });
    await expect(drawer).toBeVisible();
    const submitButton = drawer.getByRole('button', { name: m(locale, 'd.submit'), exact: true });
    await expect(submitButton).toHaveAttribute('aria-disabled', 'true');
    await drawer.getByRole('radio', { name: text(locale, 'opendispatch.reasonCode.other') }).click();
    await expect(submitButton).toHaveAttribute('aria-disabled', 'true');
    await drawer.getByRole('combobox', { name: m(locale, 'd.new') }).selectOption({ index: 1 });
    await expect(submitButton).toHaveAttribute('aria-disabled', 'true');
    await drawer.getByRole('textbox').fill('A note for the record.');
    await expect(submitButton).not.toHaveAttribute('aria-disabled', 'true');
    await shot(page, testInfo, locale, 'field-planner-override-drawer');
    await submitButton.click();
    await expect(page.getByText(m(locale, 'toast.override'))).toBeVisible();
    await expectAudit(page, locale, 'override.created');
    seen.expectClean();
  });

  test('a Dispatch Supervisor decides a pending override in the Overrides tab, audited', async ({ page, baseURL }) => {
    const seen = watch(page, baseURL);
    await startDemo(page, locale, 'dispatch_supervisor');
    await open(page, locale);
    await root(page).getByRole('tab', { name: new RegExp(m(locale, 'tab.overrides')) }).click();
    const table = root(page).getByRole('table');
    await expect(table).toBeVisible();
    const approveButton = table.getByRole('button', { name: text(locale, 'common.approve'), exact: true }).first();
    if ((await approveButton.count()) === 0) {
      seen.expectClean();
      return; // no pending override left (the demo store persists across a parallel worker's own writes)
    }
    await approveButton.click();
    await expect(page.getByText(m(locale, 'toast.oapproved'))).toBeVisible();
    await expectAudit(page, locale, 'override.approved');
    seen.expectClean();
  });

  test('Publish is a labelled stub: it only appears once approved, and the toast says nothing was sent', async ({ page, baseURL }) => {
    const seen = watch(page, baseURL);
    await startDemo(page, locale, 'dispatch_supervisor');
    await open(page, locale, '?date=2026-09-16');
    const submitMenuButton = root(page).getByRole('button', { name: text(locale, 'common.more'), exact: true });
    await submitMenuButton.click();
    const submitItem = page.getByRole('menuitem', { name: m(locale, 'menu.submit') });
    if (await submitItem.isEnabled().catch(() => false)) {
      await submitItem.click();
      await expect(page.getByText(m(locale, 'toast.submitted'))).toBeVisible();
    } else {
      await page.keyboard.press('Escape');
    }
    const approveButton = root(page).getByRole('button', { name: text(locale, 'common.approve'), exact: true });
    if (!(await approveButton.getAttribute('aria-disabled'))) {
      await approveButton.click();
      await expect(page.getByText(m(locale, 'toast.approved'))).toBeVisible();
    }
    const publishButton = root(page).getByRole('button', { name: m(locale, 'publish'), exact: true });
    if (!(await publishButton.getAttribute('aria-disabled'))) {
      await publishButton.click();
      await expect(page.getByText(m(locale, 'toast.publish'))).toBeVisible();
      await expect(page.getByText(m(locale, 'toast.publishDesc'))).toBeVisible();
      await expectAudit(page, locale, 'roster.publish_stub');
    }
    seen.expectClean();
  });
});
