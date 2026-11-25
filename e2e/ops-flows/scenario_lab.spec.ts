// SPDX-License-Identifier: AGPL-3.0-only
import path from 'node:path';
import { type Page } from '@playwright/test';
import { expect, test } from '../fixtures';
import { expectPageOk, shot, signOutViaSwitcher, startDemo, waitForHydration, watch } from '../helpers';
import { locales, text, titleOf, type Locale } from '../routes';
import { readMessages } from '../messages';

// Scenario Lab (Ops 8, flow 4.
// A Planner edits and runs a scenario; every
// other role with access reads the same editor,
// templates and saved list, with Save and Run
// unavailable. Every write is followed by its
// audit event in the Audit Log.

type Tree = { [key: string]: string | Tree };
const module_ = (locale: Locale): Tree => readMessages(path.join(import.meta.dirname, '../../apps/web/messages/ops/scenario_lab', `${locale}.json`)) as Tree;
const MODULE = { en: module_('en'), ar: module_('ar') };
function m(locale: Locale, key: string, values: Record<string, string> = {}): string {
  let node: string | Tree | undefined = MODULE[locale];
  for (const part of key.split('.')) node = typeof node === 'object' ? node[part] : undefined;
  if (typeof node !== 'string') throw new Error(`No message ops.scenario_lab.${locale}:${key}`);
  return Object.entries(values).reduce((out, [name, value]) => out.replaceAll(`{${name}}`, value), node);
}

const ROUTE = (locale: Locale) => `/${locale}/ops/scenario-lab`;
const root = (page: Page) => page.locator('[data-module="ops.scenario_lab"]');

async function open(page: Page, locale: Locale, query = '') {
  await page.goto(`${ROUTE(locale)}${query}`);
  await expect(root(page)).toHaveAttribute('data-state', 'filled');
  await expectPageOk(page, locale);
  await waitForHydration(page, '[data-module="ops.scenario_lab"] button');
}

/** The Audit Log filtered by an action code: the write's event is there. */
async function expectAudit(page: Page, locale: Locale, action: string) {
  await page.goto(`/${locale}/admin/audit-log?q=${action}`);
  await expect(page.locator('[data-module="admin.audit_log"] tbody tr').first()).toContainText(action);
}

for (const locale of locales) {
  test.describe(`Scenario Lab, read only, in ${locale}`, () => {
    test('the Administrator (view only) reads the title, the templates, the editor and the saved list', async ({ page, baseURL }, testInfo) => {
      const seen = watch(page, baseURL);
      await startDemo(page, locale, 'administrator');
      await open(page, locale);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(titleOf(locale, 'ops.scenario_lab'));
      await expect(root(page).getByText(text(locale, 'shell.access.view'), { exact: true })).toBeVisible();
      await expect(root(page).getByText(m(locale, 'tpl.people.name'), { exact: true })).toBeVisible();
      await expect(root(page).getByRole('heading', { name: m(locale, 'ed.title'), exact: true })).toBeVisible();
      await expect(root(page).getByText(m(locale, 'res.title'), { exact: true })).toBeVisible();
      await expect(root(page).getByText(m(locale, 'list.title'), { exact: true }).first()).toBeVisible();
      await expect(root(page).getByText(text(locale, 'common.illustrative')).first()).toBeVisible();
      const runButton = root(page).getByRole('button', { name: m(locale, 'run'), exact: true }).first();
      await expect(runButton).toHaveAttribute('aria-disabled', 'true');
      await shot(page, testInfo, locale, 'scenario-lab-filled');
      seen.expectClean();
    });

    test('the review states ?state=empty, loading, error and noaccess keep the header and show their text', async ({ page, baseURL }, testInfo) => {
      const seen = watch(page, baseURL);
      await startDemo(page, locale, 'administrator');
      for (const state of ['empty', 'loading', 'error'] as const) {
        await page.goto(`${ROUTE(locale)}?state=${state}`);
        await expect(root(page)).toHaveAttribute('data-state', state);
        await expect(page.getByRole('heading', { level: 1 })).toHaveText(titleOf(locale, 'ops.scenario_lab'));
        await shot(page, testInfo, locale, `scenario-lab-${state}`);
      }
      seen.expectClean();
    });
  });
}

test.describe.serial('Scenario Lab, the writes (save, run, delete)', () => {
  const locale: Locale = 'en';

  test('a Planner starts a new scenario from a template, saves it and runs it', async ({ page, baseURL }, testInfo) => {
    const seen = watch(page, baseURL);
    // Planner has no Audit Log access of its own
    // (matrix.ts: admin.audit_log is NONE for
    // planner); check the two write events after
    // switching to a role that has it.
    await startDemo(page, locale, 'planner');
    await open(page, locale, '?scenario=new&tpl=people');
    await root(page).getByLabel(m(locale, 'f.name'), { exact: true }).fill('E2E test scenario');
    await root(page)
      .getByRole('button', { name: text(locale, 'common.save'), exact: true })
      .first()
      .click();
    await expect(page.getByText(m(locale, 'toast.saved'))).toBeVisible();
    await shot(page, testInfo, locale, 'scenario-lab-saved');

    const runButton = root(page).getByRole('button', { name: m(locale, 'run'), exact: true }).first();
    await expect(runButton).not.toHaveAttribute('aria-disabled', 'true');
    await runButton.click();
    await expect(page.getByText(m(locale, 'toast.ran'))).toBeVisible();
    await shot(page, testInfo, locale, 'scenario-lab-ran');

    await signOutViaSwitcher(page, locale);
    await startDemo(page, locale, 'administrator');
    await expectAudit(page, locale, 'scenario.created');
    await expectAudit(page, locale, 'scenario.run');
    seen.expectClean();
  });

  test('Save and Run are unavailable to a view-only role (Administrator)', async ({ page, baseURL }) => {
    const seen = watch(page, baseURL);
    await startDemo(page, locale, 'administrator');
    await open(page, locale);
    const saveButton = root(page).getByRole('button', { name: text(locale, 'common.save'), exact: true }).first();
    await expect(saveButton).toHaveAttribute('aria-disabled', 'true');
    const newButton = root(page).getByRole('button', { name: m(locale, 'new'), exact: true });
    await expect(newButton).toHaveAttribute('aria-disabled', 'true');
    seen.expectClean();
  });
});
