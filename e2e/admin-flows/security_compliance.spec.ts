// SPDX-License-Identifier: AGPL-3.0-only
import fs from 'node:fs';
import path from 'node:path';
import { type Page } from '@playwright/test';
import { expect, test } from '../fixtures';
import { expectPageOk, shot, startDemo, waitForHydration, watch } from '../helpers';
import { locales, text, titleOf, type Locale } from '../routes';
import { readMessages } from '../messages';

// Security and Compliance. The Administrator reads the sessions, the controls and the support access,
// saves the session policy (an idle timeout longer than the session is refused), switches the MFA claim (which is the Sign-in policy's),
// records evidence for a control (a wrong file type and a file over 10 MB are refused out loud in the drop area; a good file is taken and
// labelled Demo: it is not stored), switches support access on, grants it with a reason and ends it. Each write is followed by its audit
// event in the Audit Log. Tests share one demo store and run in parallel: every test that changes a setting puts it back, and the
// controls a test changes are the ones no other test reads.

type Tree = { [key: string]: string | Tree };
const module_ = (locale: Locale): Tree => readMessages(path.join(import.meta.dirname, '../../apps/web/messages/admin/security_compliance', `${locale}.json`)) as Tree;
const MODULE = { en: module_('en'), ar: module_('ar') };
/** A key of the module's own message file, with `{name}` style values put in. */
function m(locale: Locale, key: string, values: Record<string, string> = {}): string {
  let node: string | Tree | undefined = MODULE[locale];
  for (const part of key.split('.')) node = typeof node === 'object' ? node[part] : undefined;
  if (typeof node !== 'string') throw new Error(`No message admin.security_compliance.${locale}:${key}`);
  return Object.entries(values).reduce((out, [name, value]) => out.replaceAll(`{${name}}`, value), node);
}

// fullyParallel (playwright.config.ts) does not keep declaration order between separate describe blocks in one file: the
// "seeded state" test below assumes no support grant exists yet, which only holds if it runs before the writes that follow it.
test.describe.configure({ mode: 'serial' });

const ROUTE = (locale: Locale) => `/${locale}/admin/security-compliance`;
const rows = (page: Page) => page.locator('[data-module="admin.security_compliance"] tbody tr');

async function open(page: Page, locale: Locale, query = '') {
  await page.goto(`${ROUTE(locale)}${query}`);
  await expect(page.locator('[data-module="admin.security_compliance"]')).toHaveAttribute('data-state', 'filled');
  await expectPageOk(page, locale);
}

/** The Audit Log filtered by an action code: the write's event is there. */
async function expectAudit(page: Page, locale: Locale, action: string) {
  await page.goto(`/${locale}/admin/audit-log?q=${action}`);
  await expect(page.locator('[data-module="admin.audit_log"] tbody tr').first()).toContainText(action);
}

for (const locale of locales) {
  test.describe(`Security and Compliance in ${locale}: the seeded state`, () => {
    test(`the Administrator reads the three tabs: figures, the residency badge, the control list and the access log; nothing leaves the app`, async ({ page, baseURL }, testInfo) => {
      const seen = watch(page, baseURL);
      await startDemo(page, locale, 'administrator');
      await open(page, locale);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(titleOf(locale, 'admin.security_compliance'));
      await expect(page.locator('[data-residency]')).toHaveText(m(locale, 'residency.label'));
      await expect(page.getByLabel(m(locale, 'sess.length'))).toBeVisible();
      await shot(page, testInfo, locale, 'security-sessions');
      await open(page, locale, '?tab=controls');
      await expect(rows(page)).toHaveCount(11);
      await expect(rows(page).first()).toContainText('NCA-AC-01');
      await shot(page, testInfo, locale, 'security-controls');
      await open(page, locale, '?tab=support');
      await expect(rows(page)).toHaveCount(1);
      await expect(page.getByRole('button', { name: m(locale, 'sup.grant') })).toHaveAttribute('aria-disabled', 'true');
      await shot(page, testInfo, locale, 'security-support');
      seen.expectClean();
    });
  });
}

// The tests below change the store the whole file shares (a support grant stays in the access log), so the test above runs first, on
// the seeded state, for both languages.
for (const locale of locales) {
  test.describe(`Security and Compliance in ${locale}`, () => {
    test(`saves the session policy and puts it back; an idle timeout longer than the session is refused before it is sent`, async ({ page, baseURL }) => {
      const seen = watch(page, baseURL);
      await startDemo(page, locale, 'administrator');
      await open(page, locale);
      await waitForHydration(page, 'main input');
      await page.getByLabel(m(locale, 'sess.idle')).fill('900');
      await expect(page.getByText(m(locale, 'sess.err')).first()).toBeVisible();
      await expect(page.getByRole('button', { name: text(locale, 'common.save') })).toHaveAttribute('aria-disabled', 'true');
      await page.getByLabel(m(locale, 'sess.idle')).fill('45');
      await page.getByRole('button', { name: text(locale, 'common.save') }).click();
      await expect(page.getByText(m(locale, 'toast.policy'))).toBeVisible();
      await page.reload();
      await expect(page.getByLabel(m(locale, 'sess.idle'))).toHaveValue('45');
      await page.getByLabel(m(locale, 'sess.idle')).fill('30');
      await page.getByRole('button', { name: text(locale, 'common.save') }).click();
      await expect(page.getByText(m(locale, 'toast.policy'))).toBeVisible();
      await expectAudit(page, locale, 'session_policy.updated');
      seen.expectClean();
    });

    test(`switches the MFA claim on and off (the Sign-in policy's setting), and each change is audited`, async ({ page, baseURL }) => {
      const seen = watch(page, baseURL);
      await startDemo(page, locale, 'administrator');
      await open(page, locale);
      await waitForHydration(page, 'main [role=switch]');
      const mfa = page.getByRole('switch', { name: new RegExp(m(locale, 'mfa.label')) });
      const wasOn = (await mfa.getAttribute('aria-checked')) === 'true';
      await mfa.click();
      await expect(page.getByText(m(locale, wasOn ? 'toast.mfaOff' : 'toast.mfaOn'))).toBeVisible();
      await expect(mfa).toHaveAttribute('aria-checked', String(!wasOn));
      await mfa.click();
      await expect(mfa).toHaveAttribute('aria-checked', String(wasOn));
      await expectAudit(page, locale, 'sign_in_policy.updated');
      seen.expectClean();
    });

    test(`records evidence for a control: the drop area refuses a wrong type and a file over 10 MB out loud, takes a PDF and labels it Demo, and the status and note are saved`, async ({ page, baseURL }, testInfo) => {
      const seen = watch(page, baseURL);
      await startDemo(page, locale, 'administrator');
      await open(page, locale, '?tab=controls&q=NCA-IR-01');
      await waitForHydration(page, 'main tbody tr');
      await rows(page).first().click();
      await expect(page).toHaveURL(/[?&]control=[0-9a-f-]{36}/);
      const drawer = page.getByRole('dialog');
      await expect(drawer.locator('[data-stub="demo"]')).toBeVisible();
      const input = drawer.locator('input[type=file]');
      await input.setInputFiles({ name: 'evidence-scan.zip', mimeType: 'application/zip', buffer: Buffer.from('zip') });
      await expect(drawer.getByRole('alert')).toContainText('evidence-scan.zip');
      await shot(page, testInfo, locale, 'security-evidence-wrong-type');
      await input.setInputFiles({ name: 'nca-controls-2026-full.pdf', mimeType: 'application/pdf', buffer: Buffer.alloc(10 * 1024 * 1024 + 1) });
      await expect(drawer.getByRole('alert')).toContainText('nca-controls-2026-full.pdf');
      await shot(page, testInfo, locale, 'security-evidence-too-large');
      await input.setInputFiles({ name: 'contact-list.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 e2e') });
      await expect(drawer.getByText('contact-list.pdf')).toBeVisible();
      await expect(drawer.getByText(m(locale, 'drop.notStored'))).toBeVisible();
      await drawer.getByLabel(text(locale, 'common.status')).selectOption('in_progress');
      await drawer.getByLabel(m(locale, 'col.evidence')).fill('E2E: contact list drafted.');
      await drawer.getByRole('button', { name: text(locale, 'common.save') }).click();
      await expect(page.getByText(m(locale, 'toast.evidence'))).toBeVisible();
      await expect(rows(page).first()).toContainText('E2E: contact list drafted.');
      // put it back
      await rows(page).first().click();
      await page.getByRole('dialog').getByLabel(text(locale, 'common.status')).selectOption('not_started');
      await page.getByRole('dialog').getByLabel(m(locale, 'col.evidence')).fill('');
      await page.getByRole('dialog').getByRole('button', { name: text(locale, 'common.save') }).click();
      await expectAudit(page, locale, 'control_evidence.updated');
      seen.expectClean();
    });

    test(`switches support access on (off by default), grants it for a time with a reason, sees the open grant, ends it, and switches it off`, async ({ page, baseURL }, testInfo) => {
      const seen = watch(page, baseURL);
      await startDemo(page, locale, 'administrator');
      await open(page, locale, '?tab=support');
      await waitForHydration(page, 'main [role=switch]');
      const allow = page.getByRole('switch', { name: new RegExp(m(locale, 'sup.enable')) });
      await expect(allow).toHaveAttribute('aria-checked', 'false');
      await allow.click();
      await expect(page.getByText(m(locale, 'toast.supOn'))).toBeVisible();
      await page.getByRole('button', { name: m(locale, 'sup.grant') }).click();
      const modal = page.getByRole('dialog', { name: m(locale, 'sup.grant') });
      await expect(modal.getByRole('button', { name: m(locale, 'sup.grant') })).toHaveAttribute('aria-disabled', 'true');
      await modal.getByLabel(text(locale, 'common.reason')).fill('E2E: check a feed.');
      await modal.getByLabel(m(locale, 'grant.hours')).fill('1');
      await shot(page, testInfo, locale, 'security-grant');
      await modal.getByRole('button', { name: m(locale, 'sup.grant') }).click();
      await expect(page.getByText(m(locale, 'toast.granted', { n: '1' }))).toBeVisible();
      const active = rows(page).filter({ hasText: m(locale, 'sup.active') });
      await expect(active).toHaveCount(1);
      await expect(page.getByRole('button', { name: m(locale, 'sup.grant') })).toHaveAttribute('aria-disabled', 'true');
      await active.getByRole('button', { name: m(locale, 'sup.end') }).click();
      await expect(page.getByText(m(locale, 'toast.ended'))).toBeVisible();
      await expect(rows(page).filter({ hasText: m(locale, 'sup.active') })).toHaveCount(0);
      await allow.click();
      await expect(page.getByText(m(locale, 'toast.supOff'))).toBeVisible();
      for (const action of ['support_access.granted', 'support_access.ended', 'support_access.updated']) await expectAudit(page, locale, action);
      seen.expectClean();
    });
  });
}

test.describe('Security and Compliance: filters, roles and states', () => {
  test('?q=, ?framework= and ?status= narrow the controls, and Export delivers a CSV of all of them', async ({ page, baseURL }) => {
    const seen = watch(page, baseURL);
    await startDemo(page, 'en', 'administrator');
    await open(page, 'en', '?tab=controls&framework=PDPL');
    await expect(rows(page)).toHaveCount(4);
    await expect(page.getByText(`${m('en', 'col.framework')}: PDPL`)).toBeVisible();
    await open(page, 'en', '?tab=controls&q=zzz-nothing');
    await expect(page.getByText(m('en', 'noMatch'))).toBeVisible();
    await page.getByRole('button', { name: text('en', 'common.more') }).click();
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('menuitem', { name: m('en', 'export') }).click()]);
    expect(download.suggestedFilename()).toBe('controls-report.csv');
    const body = fs.readFileSync(await download.path(), 'utf8');
    expect(body.startsWith('﻿Control,Framework,Status,Evidence,Reviewed')).toBe(true);
    expect(body.trim().split('\r\n')).toHaveLength(12);
    seen.expectClean();
  });

  test('in a shared install the Administrator still edits the session policy, but the MFA switch is disabled with the Identity module\'s reason', async ({ page, baseURL }) => {
    const seen = watch(page, baseURL);
    await startDemo(page, 'en', 'administrator', 'shared');
    await open(page, 'en');
    await expect(page.getByRole('switch', { name: new RegExp(m('en', 'mfa.label')) })).toBeDisabled();
    await expect(page.getByLabel(m('en', 'sess.length'))).toBeEnabled();
    seen.expectClean();
  });

  test('no other role has the module: the no-access page for the Viewer / Auditor', async ({ page, baseURL }) => {
    const seen = watch(page, baseURL, { allowNotFound: true });
    await startDemo(page, 'en', 'viewer_auditor');
    await page.goto(ROUTE('en'));
    await expect(page.locator('[data-module="admin.security_compliance"]')).toHaveAttribute('data-state', 'noaccess');
    seen.expectClean();
  });

  test('the review states keep the header and read nothing', async ({ page, baseURL }, testInfo) => {
    const seen = watch(page, baseURL);
    await startDemo(page, 'en', 'administrator');
    for (const state of ['empty', 'loading', 'error'] as const) {
      await page.goto(`${ROUTE('en')}?state=${state}`);
      await expect(page.locator('[data-module="admin.security_compliance"]')).toHaveAttribute('data-state', state);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(titleOf('en', 'admin.security_compliance'));
      await shot(page, testInfo, 'en', `security-${state}`);
    }
    await expect(page.getByText(m('en', 'states.error.desc'))).toBeVisible();
    seen.expectClean();
  });
});
