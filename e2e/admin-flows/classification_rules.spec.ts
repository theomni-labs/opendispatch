// SPDX-License-Identifier: AGPL-3.0-only
import path from 'node:path';
import { type Page } from '@playwright/test';
import { expect, test } from '../fixtures';
import { expectPageOk, shot, signOutViaSwitcher, startDemo, waitForHydration, watch } from '../helpers';
import { locales, text, titleOf, type Locale } from '../routes';
import { readMessages } from '../messages';

// Classification Rules. The Administrator drafts and submits a rule version; a Dispatch
// Supervisor approves it (the Administrator cannot, and nobody approves their own submission); the Audit Log holds each step.
// Tests share one demo store and run in parallel, so each language works on a draft rule of its own (RULE-006 in English,
// RULE-007 in Arabic) and on a new rule code of its own.

type Tree = { [key: string]: string | Tree };
const module_ = (locale: Locale): Tree => readMessages(path.join(import.meta.dirname, '../../apps/web/messages/admin/classification_rules', `${locale}.json`)) as Tree;
const MODULE = { en: module_('en'), ar: module_('ar') };
/** A key of the module's own message file (`btn.submit`), with `{name}` style values put in. */
function m(locale: Locale, key: string, values: Record<string, string> = {}): string {
  let node: string | Tree | undefined = MODULE[locale];
  for (const part of key.split('.')) node = typeof node === 'object' ? node[part] : undefined;
  if (typeof node !== 'string') throw new Error(`No message admin.classification_rules.${locale}:${key}`);
  return Object.entries(values).reduce((out, [name, value]) => out.replaceAll(`{${name}}`, value), node);
}

const ROUTE = (locale: Locale) => `/${locale}/admin/classification-rules`;
const rows = (page: Page) => page.locator('[data-module="admin.classification_rules"] tbody tr');

async function open(page: Page, locale: Locale, query = '') {
  await page.goto(`${ROUTE(locale)}${query}`);
  await expect(page.locator('[data-module="admin.classification_rules"]')).toHaveAttribute('data-state', 'filled');
  await expectPageOk(page, locale);
  await waitForHydration(page, 'main tbody tr');
}

/** The Audit Log shows the outcome in words (`Success`, `نجح`): the Audit Log's own message for it, in the page's language. */
const outcomeWord = (locale: Locale): string => {
  const log = readMessages(path.join(import.meta.dirname, '../../apps/web/messages/admin/audit_log', `${locale}.json`)) as { out: { success: string } };
  return log.out.success;
};

async function expectAudit(page: Page, locale: Locale, action: string, outcome?: 'success') {
  await page.goto(`/${locale}/admin/audit-log?q=${action}`);
  const first = page.locator('[data-module="admin.audit_log"] tbody tr').first();
  await expect(first).toContainText(action);
  if (outcome !== undefined) await expect(first).toContainText(outcomeWord(locale));
}

for (const locale of locales) {
  const draft = locale === 'en' ? 'RULE-006' : 'RULE-007';
  const created = locale === 'en' ? 'RULE-090' : 'RULE-091';
  test.describe(`Classification Rules in ${locale}`, () => {
    test(`the Administrator reads it: title, tabs, three figures, six columns, the precedence and approval cards; no request leaves the app`, async ({ page, baseURL }, testInfo) => {
      const seen = watch(page, baseURL);
      await startDemo(page, locale, 'administrator');
      await open(page, locale);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(titleOf(locale, 'admin.classification_rules'));
      await expect(page.getByRole('tab')).toContainText([m(locale, 'tab.rules'), m(locale, 'tab.approvals')]);
      for (const key of ['col.rule', 'col.cond', 'col.outcome', 'col.version']) await expect(page.getByRole('columnheader', { name: m(locale, key) })).toBeVisible();
      expect(await rows(page).count()).toBeGreaterThanOrEqual(10);
      await expect(page.getByRole('heading', { name: m(locale, 'prec.title') })).toBeVisible();
      await expect(page.getByRole('heading', { name: m(locale, 'wf.title') })).toBeVisible();
      await expect(page.getByRole('button', { name: m(locale, 'new') })).toBeEnabled();
      await shot(page, testInfo, locale, 'rules-filled');
      seen.expectClean();
    });

    test(`flow 1: the Administrator submits ${draft}, cannot approve it, a Dispatch Supervisor approves it, and the Audit Log has every step`, async ({ page, baseURL }, testInfo) => {
      const seen = watch(page, baseURL);
      await startDemo(page, locale, 'administrator');
      await open(page, locale, `?rule=${draft}`);
      const drawer = page.getByRole('dialog', { name: draft });
      await expect(drawer).toBeVisible();
      await expect(drawer.getByRole('button', { name: m(locale, 'btn.saveDraft') })).toBeEnabled();
      await drawer.getByRole('button', { name: m(locale, 'btn.submit') }).click();
      await expect(page.getByText(m(locale, 'toast.submitted.title'))).toBeVisible();
      // the Approvals tab shows it pending, and the Administrator's Approve is disabled with the reason
      await open(page, locale, '?tab=approvals');
      const pending = rows(page).filter({ hasText: draft }).first();
      await expect(pending).toContainText(m(locale, 'st.pending'));
      await expect(pending.getByRole('button', { name: text(locale, 'common.approve') })).toHaveAttribute('aria-disabled', 'true');
      await shot(page, testInfo, locale, 'rules-approvals-admin');
      await signOutViaSwitcher(page, locale);
      // the Dispatch Supervisor approves it
      await startDemo(page, locale, 'dispatch_supervisor');
      await open(page, locale, '?tab=approvals');
      const theirs = rows(page).filter({ hasText: draft }).first();
      await expect(theirs.getByRole('button', { name: text(locale, 'common.approve') })).toBeEnabled();
      await theirs.getByRole('button', { name: text(locale, 'common.approve') }).click();
      const dialog = page.getByRole('dialog', { name: m(locale, 'decide.approve', { code: draft }) });
      await dialog.getByRole('textbox').fill('Approved for the pilot');
      await shot(page, testInfo, locale, 'rules-approve-dialog');
      await dialog.getByRole('button', { name: text(locale, 'common.approve') }).click();
      await expect(page.getByText(m(locale, 'toast.approved.title'))).toBeVisible();
      await open(page, locale);
      await expect(rows(page).filter({ hasText: draft })).toContainText(m(locale, 'st.active'));
      await signOutViaSwitcher(page, locale);
      await startDemo(page, locale, 'administrator');
      await expectAudit(page, locale, 'rule.submitted', 'success');
      await expectAudit(page, locale, 'rule.approved', 'success');
      seen.expectClean();
    });

    test(`drafts a new rule with a condition built from rows, and the Audit Log has it`, async ({ page, baseURL }, testInfo) => {
      const seen = watch(page, baseURL);
      await startDemo(page, locale, 'administrator');
      await open(page, locale, '?rule=new');
      const drawer = page.getByRole('dialog', { name: m(locale, 'title.new') });
      await expect(drawer.getByRole('button', { name: m(locale, 'btn.saveDraft') })).toHaveAttribute('aria-disabled', 'true');
      await drawer.getByPlaceholder('RULE-010').fill(created);
      await drawer.getByLabel(m(locale, 'f.name')).fill(`E2E rule ${created}`);
      await drawer.getByLabel(m(locale, 'col.cond'), { exact: false }).last().fill('Five or more parties');
      await drawer.getByLabel(m(locale, 'cond.operator')).selectOption('gte');
      await drawer.getByLabel(m(locale, 'cond.value')).fill('5');
      await drawer.getByRole('button', { name: m(locale, 'addCond') }).click();
      // exact: the outcome choices "Field mandatory" and "Field preferred" also contain the word
      await expect(drawer.getByLabel(m(locale, 'cond.field'), { exact: true })).toHaveCount(2);
      await shot(page, testInfo, locale, 'rules-new-drawer');
      await drawer.getByRole('button', { name: m(locale, 'btn.saveDraft') }).click();
      await expect(page.getByText(m(locale, 'toast.created'))).toBeVisible();
      await expect(rows(page).filter({ hasText: created })).toHaveCount(1);
      await expectAudit(page, locale, 'rule.created', 'success');
      seen.expectClean();
    });

    test(`an unknown rule code is a notice above the list, never an error`, async ({ page, baseURL }) => {
      const seen = watch(page, baseURL);
      await startDemo(page, locale, 'administrator');
      await open(page, locale, '?rule=RULE-999');
      await expect(page.locator('[role="alert"]:not(#__next-route-announcer__)')).toContainText(m(locale, 'notice.notFound'));
      seen.expectClean();
    });
  });
}
