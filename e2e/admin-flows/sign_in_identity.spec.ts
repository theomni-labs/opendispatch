// SPDX-License-Identifier: AGPL-3.0-only
import path from 'node:path';
import { type Page } from '@playwright/test';
import { expect, test } from '../fixtures';
import { expectPageOk, shot, startDemo, waitForHydration, watch } from '../helpers';
import { locales, text, titleOf, type Locale } from '../routes';
import { readMessages } from '../messages';

// Sign-in and Identity Providers. The Administrator reads the four tabs, adds a provider through
// the four-step wizard (the connection test is a scripted stub and says Demo; a value containing "invalid" fails it), enables and disables
// it, adds and previews group rules (no matching rule means no access), saves the sign-in policy and the session length, and
// switches the emergency sign-in; in a shared install every write control is disabled with the reason and "Request a change" asks our staff.
// Each write is followed by its audit event in the Audit Log. The sign-in PAGES are proved in sign-in.spec.ts. Tests share one demo store
// and run in parallel: every provider and rule a test adds has a name of its own, and every setting a test changes is put back.

type Tree = { [key: string]: string | Tree };
const module_ = (locale: Locale): Tree => readMessages(path.join(import.meta.dirname, '../../apps/web/messages/admin/sign_in_identity', `${locale}.json`)) as Tree;
const MODULE = { en: module_('en'), ar: module_('ar') };
/** A key of the module's own message file, with `{name}` style values put in. */
function m(locale: Locale, key: string, values: Record<string, string> = {}): string {
  let node: string | Tree | undefined = MODULE[locale];
  for (const part of key.split('.')) node = typeof node === 'object' ? node[part] : undefined;
  if (typeof node !== 'string') throw new Error(`No message admin.sign_in_identity.${locale}:${key}`);
  return Object.entries(values).reduce((out, [name, value]) => out.replaceAll(`{${name}}`, value), node);
}

const ROUTE = (locale: Locale) => `/${locale}/admin/sign-in-identity`;
const rows = (page: Page) => page.locator('[data-module="admin.sign_in_identity"] tbody tr');
const unique = (locale: Locale, word: string) => `${word}-${locale}-${Date.now().toString(36)}`;

async function open(page: Page, locale: Locale, query = '') {
  await page.goto(`${ROUTE(locale)}${query}`);
  await expect(page.locator('[data-module="admin.sign_in_identity"]')).toHaveAttribute('data-state', 'filled');
  await expectPageOk(page, locale);
}

/** The Audit Log filtered by an action code: the write's event is there. */
async function expectAudit(page: Page, locale: Locale, action: string) {
  await page.goto(`/${locale}/admin/audit-log?q=${action}`);
  await expect(page.locator('[data-module="admin.audit_log"] tbody tr').first()).toContainText(action);
}

/** Adds an Okta provider through the wizard and stops at step 4 with the fields filled in. */
async function fillWizard(page: Page, locale: Locale, name: string, domain: string) {
  await open(page, locale, '?wizard=1');
  await waitForHydration(page, '[role=dialog] button');
  const wizard = page.getByRole('dialog');
  await wizard.locator('[data-preset="okta"]').click();
  await wizard.getByRole('button', { name: text(locale, 'common.next') }).click();
  await wizard.getByLabel(m(locale, 'w.name')).fill(name);
  await wizard.getByLabel(m(locale, 'f.okta_domain')).fill(domain);
  await wizard.getByLabel(m(locale, 'f.client_id')).fill('opendispatch-e2e');
  await wizard.getByLabel(m(locale, 'f.client_secret')).fill(`e2e-${Date.now().toString(36)}-not-a-real-secret`);
  await wizard.getByRole('button', { name: text(locale, 'common.next') }).click();
  await wizard.getByRole('button', { name: text(locale, 'common.next') }).click();
  return wizard;
}

for (const locale of locales) {
  test.describe(`Sign-in and Identity in ${locale}`, () => {
    test(`the Administrator reads the four tabs: providers with the mock one, eleven group rules with the preview, the policy and the emergency account; nothing leaves the app`, async ({ page, baseURL }, testInfo) => {
      const seen = watch(page, baseURL);
      await startDemo(page, locale, 'administrator');
      await open(page, locale);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(titleOf(locale, 'admin.sign_in_identity'));
      await expect(rows(page).filter({ hasText: 'Mock provider' })).toBeVisible();
      await shot(page, testInfo, locale, 'sign-in-identity-providers');
      await open(page, locale, '?tab=rules');
      await expect(rows(page)).toHaveCount(11);
      await expect(page.getByLabel(m(locale, 'prev.groups'))).toBeVisible();
      await shot(page, testInfo, locale, 'sign-in-identity-rules');
      await open(page, locale, '?tab=policy');
      await expect(page.getByLabel(m(locale, 'pol.session'))).toBeVisible();
      await shot(page, testInfo, locale, 'sign-in-identity-policy');
      await open(page, locale, '?tab=emergency');
      await expect(page.getByText('emergency.admin@demo.example')).toBeVisible();
      await shot(page, testInfo, locale, 'sign-in-identity-emergency');
      seen.expectClean();
    });

    test(`adds a provider through the four steps: the test is a Demo stub, only a passing test unlocks Save provider, and the provider is created, tested and enabled`, async ({ page, baseURL }, testInfo) => {
      const seen = watch(page, baseURL);
      const name = unique(locale, 'okta');
      await startDemo(page, locale, 'administrator');
      const wizard = await fillWizard(page, locale, name, 'e2e.okta.example');
      await expect(wizard.locator('[data-stub="demo"]')).toBeVisible();
      await expect(wizard.getByRole('button', { name: m(locale, 'w.save') })).toHaveAttribute('aria-disabled', 'true');
      await wizard.getByRole('button', { name: m(locale, 'test.label') }).click();
      await expect(wizard.locator('[data-test-result="passed"]')).toBeVisible();
      await shot(page, testInfo, locale, 'sign-in-identity-wizard-test');
      await wizard.getByRole('button', { name: m(locale, 'w.save') }).click();
      await expect(page.getByText(m(locale, 'toast.added'))).toBeVisible();
      const row = rows(page).filter({ hasText: name });
      await expect(row).toContainText(m(locale, 'status.on'));
      await expect(row).toContainText(m(locale, 'test.pass'));
      for (const action of ['identity_provider.created', 'identity_provider.tested', 'identity_provider.updated']) await expectAudit(page, locale, action);
      seen.expectClean();
    });

    test(`a failed test (a value with "invalid" in it) shows its reference code and keeps Save provider locked; closing the wizard removes the draft`, async ({ page, baseURL }) => {
      const seen = watch(page, baseURL);
      const name = unique(locale, 'bad');
      await startDemo(page, locale, 'administrator');
      const wizard = await fillWizard(page, locale, name, 'invalid.okta.example');
      await wizard.getByRole('button', { name: m(locale, 'test.label') }).click();
      await expect(wizard.locator('[data-test-result="failed"]')).toBeVisible();
      await expect(wizard.getByText(/IDP-[0-9A-F]{6}/)).toBeVisible();
      await expect(wizard.getByRole('button', { name: m(locale, 'w.save') })).toHaveAttribute('aria-disabled', 'true');
      await wizard.getByRole('button', { name: text(locale, 'common.close') }).click();
      await expect(page.getByRole('dialog')).toBeHidden();
      await open(page, locale);
      await expect(rows(page).filter({ hasText: name })).toHaveCount(0);
      await expectAudit(page, locale, 'identity_provider.deleted');
      seen.expectClean();
    });

    test(`opens a provider's drawer, tests it (Demo), disables and enables it, and the mock provider cannot be changed`, async ({ page, baseURL }) => {
      const seen = watch(page, baseURL);
      const name = unique(locale, 'toggle');
      await startDemo(page, locale, 'administrator');
      const wizard = await fillWizard(page, locale, name, 'toggle.okta.example');
      await wizard.getByRole('button', { name: m(locale, 'test.label') }).click();
      await expect(wizard.locator('[data-test-result="passed"]')).toBeVisible();
      await wizard.getByRole('button', { name: m(locale, 'w.save') }).click();
      await rows(page).filter({ hasText: name }).click();
      const drawer = page.getByRole('dialog');
      await expect(page).toHaveURL(/[?&]provider=/);
      await drawer.getByRole('button', { name: m(locale, 'test.label') }).click();
      await expect(drawer.locator('[data-test-result="passed"]')).toBeVisible();
      await drawer.getByRole('button', { name: m(locale, 'd.disable') }).click();
      await expect(page.getByText(m(locale, 'toast.disabled'))).toBeVisible();
      await drawer.getByRole('button', { name: m(locale, 'd.enable') }).click();
      await expect(page.getByText(m(locale, 'toast.enabled'))).toBeVisible();
      await page.goBack();
      await rows(page).filter({ hasText: 'Mock provider' }).click();
      await expect(page.getByRole('dialog').getByRole('button', { name: m(locale, 'd.edit') })).toHaveAttribute('aria-disabled', 'true');
      seen.expectClean();
    });

    test(`adds a group rule and previews it (the matching rule is tinted; an unknown group gets no access), toggles it, and deletes it after a confirmation`, async ({ page, baseURL }, testInfo) => {
      const seen = watch(page, baseURL);
      const group = unique(locale, 'opendispatch-e2e');
      await startDemo(page, locale, 'administrator');
      await open(page, locale, '?tab=rules&rule=new');
      await waitForHydration(page, '[role=dialog] input');
      const drawer = page.getByRole('dialog');
      await drawer.getByLabel(m(locale, 'col.group')).fill(group);
      await drawer.getByLabel(m(locale, 'prev.role')).selectOption('viewer_auditor');
      await drawer.getByRole('button', { name: text(locale, 'common.save') }).click();
      await expect(page.getByText(m(locale, 'toast.rule'))).toBeVisible();
      const row = rows(page).filter({ hasText: group });
      await expect(row).toBeVisible();
      await page.getByLabel(m(locale, 'prev.groups')).fill(group);
      await expect(page.getByText(m(locale, 'prev.match', { n: '1' }))).toBeVisible();
      await page.getByLabel(m(locale, 'prev.groups')).fill('no-such-group');
      await expect(page.getByText(m(locale, 'prev.none'))).toBeVisible();
      await shot(page, testInfo, locale, 'sign-in-identity-preview');
      await row.getByRole('switch').click();
      await expect(page.getByText(m(locale, 'toast.rule')).first()).toBeVisible();
      await row.click();
      await page.getByRole('dialog').getByRole('button', { name: m(locale, 'rule.del') }).click();
      await page.getByRole('dialog', { name: m(locale, 'rule.delTitle') }).getByRole('button', { name: m(locale, 'rule.del') }).click();
      await expect(rows(page).filter({ hasText: group })).toHaveCount(0);
      for (const action of ['role_mapping.created', 'role_mapping.updated', 'role_mapping.deleted']) await expectAudit(page, locale, action);
      seen.expectClean();
    });

    test(`saves the sign-in policy and the session length (two audited writes) and puts them back`, async ({ page, baseURL }) => {
      const seen = watch(page, baseURL);
      await startDemo(page, locale, 'administrator');
      await open(page, locale, '?tab=policy');
      await waitForHydration(page, 'main [role=switch]');
      const session = page.getByLabel(m(locale, 'pol.session'));
      const before = await session.inputValue();
      await session.selectOption('720');
      await expect(page.getByRole('group', { name: /./ }).last()).toBeVisible();
      await page.getByRole('button', { name: text(locale, 'common.save') }).click();
      await expect(page.getByText(m(locale, 'toast.policy'))).toBeVisible();
      await page.reload();
      await expect(page.getByLabel(m(locale, 'pol.session'))).toHaveValue('720');
      await page.getByLabel(m(locale, 'pol.session')).selectOption(before);
      await page.getByRole('button', { name: text(locale, 'common.save') }).click();
      await expect(page.getByText(m(locale, 'toast.policy'))).toBeVisible();
      await expectAudit(page, locale, 'sign_in_policy.updated');
      await expectAudit(page, locale, 'session_policy.updated');
      seen.expectClean();
    });

    test(`switches the emergency sign-in off (a warning says only SSO can sign in) and on again, and each change is audited`, async ({ page, baseURL }) => {
      const seen = watch(page, baseURL);
      await startDemo(page, locale, 'administrator');
      await open(page, locale, '?tab=emergency');
      await waitForHydration(page, 'main [role=switch]');
      const enabled = page.getByRole('switch', { name: m(locale, 'em.enabled') });
      await expect(enabled).toHaveAttribute('aria-checked', 'true');
      await enabled.click();
      await expect(page.getByText(m(locale, 'em.off.desc'))).toBeVisible();
      await expect(enabled).toHaveAttribute('aria-checked', 'false');
      await enabled.click();
      await expect(enabled).toHaveAttribute('aria-checked', 'true');
      await expectAudit(page, locale, 'sign_in_policy.updated');
      seen.expectClean();
    });
  });
}

test.describe('Sign-in and Identity: the shared install and the roles', () => {
  test('in a shared install the Administrator has view: the banner, every write control disabled with the reason, and Request a change', async ({ page, baseURL }, testInfo) => {
    const seen = watch(page, baseURL);
    await startDemo(page, 'en', 'administrator', 'shared');
    await open(page, 'en');
    await expect(page.locator('[data-module="admin.sign_in_identity"]')).toHaveAttribute('data-access', 'view');
    await expect(page.getByText(m('en', 'ro.body'))).toBeVisible();
    await expect(page.getByRole('button', { name: m('en', 'add') })).toHaveAttribute('aria-disabled', 'true');
    await shot(page, testInfo, 'en', 'sign-in-identity-shared');
    await open(page, 'en', '?tab=policy');
    await expect(page.getByRole('switch', { name: new RegExp(m('en', 'pol.mfa.title')) })).toBeDisabled();
    await open(page, 'en', '?tab=emergency');
    await expect(page.getByRole('switch', { name: m('en', 'em.enabled') })).toBeDisabled();
    await open(page, 'en');
    await waitForHydration(page, 'main button');
    await page.getByRole('button', { name: m('en', 'ro.request') }).click();
    const dialog = page.getByRole('dialog', { name: m('en', 'ro.request') });
    await dialog.getByLabel(m('en', 'req.label')).fill('Add our second Entra ID tenant.');
    await dialog.getByRole('button', { name: m('en', 'req.ok') }).click();
    await expect(page.getByText(m('en', 'toast.request.title'))).toBeVisible();
    await expect(page.getByText(/CHG-[0-9A-F]{8}/)).toBeVisible();
    await expectAudit(page, 'en', 'identity.change_requested');
    seen.expectClean();
  });

  test('in a shared install ?wizard=1 opens nothing: the Administrator only reads there', async ({ page, baseURL }) => {
    const seen = watch(page, baseURL);
    await startDemo(page, 'en', 'administrator', 'shared');
    await page.goto(`${ROUTE('en')}?wizard=1`);
    await expect(page.locator('[data-module="admin.sign_in_identity"]')).toHaveAttribute('data-state', 'filled');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    seen.expectClean();
  });

  test('no other role has the module: the no-access page for the Viewer / Auditor', async ({ page, baseURL }) => {
    const seen = watch(page, baseURL, { allowNotFound: true });
    await startDemo(page, 'en', 'viewer_auditor');
    await page.goto(ROUTE('en'));
    await expect(page.locator('[data-module="admin.sign_in_identity"]')).toHaveAttribute('data-state', 'noaccess');
    seen.expectClean();
  });

  test('?provider=, ?rule= and ?wizard= that name nothing show a notice above the list, never a 500; the review states keep the header', async ({ page, baseURL }, testInfo) => {
    const seen = watch(page, baseURL);
    await startDemo(page, 'en', 'administrator');
    await open(page, 'en', '?provider=nobody-3fa89d67');
    await expect(page.locator('[role="alert"]:not(#__next-route-announcer__)')).toContainText(m('en', 'notice.provider'));
    await open(page, 'en', '?tab=rules&rule=00000000-0000-4000-8000-00000000dead');
    await expect(page.locator('[role="alert"]:not(#__next-route-announcer__)')).toContainText(m('en', 'notice.rule'));
    for (const state of ['empty', 'loading', 'error'] as const) {
      await page.goto(`${ROUTE('en')}?state=${state}`);
      await expect(page.locator('[data-module="admin.sign_in_identity"]')).toHaveAttribute('data-state', state);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(titleOf('en', 'admin.sign_in_identity'));
      await shot(page, testInfo, 'en', `sign-in-identity-${state}`);
    }
    seen.expectClean();
  });
});
