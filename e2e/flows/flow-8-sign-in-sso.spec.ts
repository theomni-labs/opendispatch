// SPDX-License-Identifier: AGPL-3.0-only
import path from 'node:path';
import { type Page, type TestInfo } from '@playwright/test';
import { expect, test } from './fixtures';
import { expectPageOk, shot, signOutViaSwitcher, startDemo, waitForHydration, watch } from '../helpers';
import { text, type Locale } from '../routes';
import { readMessages } from '../messages';

// Flow 8: pick the Entra ID preset, fill it
// in, map a group to a role and zones, test the connection, sign in through the labelled mock
// provider; the emergency admin signs in locally with MFA.
//
// Everything here is scripted/stubbed per demo mode (real Keycloak/SSO is oidc mode) -- demo-store
// only, plain ../fixtures, not ./fixtures. Every piece (the wizard, group rules, the mock
// provider, emergency sign-in) is already proven independently in e2e/admin-flows/
// sign_in_identity.spec.ts and e2e/sign-in.spec.ts; this strings them into one walkthrough with
// its own video, using a group rule this flow creates itself (not a seeded one), so signing in
// through the mock provider is a real proof the just-created rule routes correctly, not a re-check
// of a fixture that was already going to work regardless.

type Tree = { [key: string]: string | Tree };
const module_ = (mod: string, locale: Locale): Tree => readMessages(path.join(import.meta.dirname, `../../apps/web/messages/${mod}`, `${locale}.json`)) as Tree;
const SI = { en: module_('admin/sign_in_identity', 'en'), ar: module_('admin/sign_in_identity', 'ar') };

function m(locale: Locale, key: string, values: Record<string, string> = {}): string {
  let node: string | Tree | undefined = SI[locale];
  for (const part of key.split('.')) node = typeof node === 'object' ? node[part] : undefined;
  if (typeof node !== 'string') throw new Error(`No message admin.sign_in_identity.${locale}:${key}`);
  return Object.entries(values).reduce((out, [name, value]) => out.replaceAll(`{${name}}`, value), node);
}

const SI_ROUTE = (locale: Locale) => `/${locale}/admin/sign-in-identity`;
const AUDIT_ROUTE = (locale: Locale, action: string) => `/${locale}/admin/audit-log?q=${action}`;
const rows = (page: Page) => page.locator('[data-module="admin.sign_in_identity"] tbody tr');
const heading = (page: Page) => page.getByRole('heading', { level: 1 });
const mockCard = (page: Page) => page.locator('[data-sign-in="mock-provider"]');

const password = (): string => {
  const value = process.env['DEMO_EMERGENCY_ADMIN_PASSWORD'];
  if (value === undefined || value === '') throw new Error('DEMO_EMERGENCY_ADMIN_PASSWORD is not set: playwright.config.ts makes it for the run.');
  return value;
};
const totp = (): string => {
  const value = process.env['DEMO_EMERGENCY_ADMIN_TOTP'];
  if (value === undefined || !/^[0-9]{6}$/.test(value)) throw new Error('DEMO_EMERGENCY_ADMIN_TOTP is not set to six digits: playwright.config.ts makes it for the run.');
  return value;
};

async function expectAudit(page: Page, locale: Locale, action: string) {
  await page.goto(AUDIT_ROUTE(locale, action));
  await expect(page.locator('[data-module="admin.audit_log"] tbody tr').first(), `audit event ${action}`).toContainText(action);
}

/** Opens the add-provider wizard, picks the Entra ID (SAML) preset, and fills its two fields. */
async function addEntraProvider(page: Page, locale: Locale, testInfo: TestInfo, name: string) {
  await page.goto(`${SI_ROUTE(locale)}?wizard=1`);
  await waitForHydration(page, '[role=dialog] button');
  const wizard = page.getByRole('dialog');
  await wizard.locator('[data-preset="entra_id_saml"]').click();
  await wizard.getByRole('button', { name: text(locale, 'common.next') }).click();
  await wizard.getByLabel(m(locale, 'w.name')).fill(name);
  await wizard.getByLabel(m(locale, 'f.metadata_url')).fill('https://login.microsoftonline.com/e2e-flow-8/federationmetadata/2007-06/federationmetadata.xml');
  await wizard.getByLabel(m(locale, 'f.entity_id')).fill('https://sts.windows.net/e2e-flow-8/');
  await wizard.getByRole('button', { name: text(locale, 'common.next') }).click();
  await wizard.getByRole('button', { name: text(locale, 'common.next') }).click();
  await shot(page, testInfo, locale, 'flow8-entra-wizard');

  await wizard.getByRole('button', { name: m(locale, 'test.label') }).click();
  await expect(wizard.locator('[data-test-result="passed"]')).toBeVisible();
  await wizard.getByRole('button', { name: m(locale, 'w.save') }).click();
  await expect(page.getByText(m(locale, 'toast.added'))).toBeVisible();
  await expect(rows(page).filter({ hasText: name })).toContainText(m(locale, 'test.pass'));
}

/** Adds a group rule (default role "dispatcher", zone-scoped) with the first zone checked. */
async function addZoneScopedRule(page: Page, locale: Locale, testInfo: TestInfo, group: string) {
  await page.goto(`${SI_ROUTE(locale)}?tab=rules&rule=new`);
  await waitForHydration(page, '[role=dialog] input');
  const drawer = page.getByRole('dialog');
  await drawer.getByLabel(m(locale, 'col.group')).fill(group);
  // Role stays at its default, "dispatcher" (assigned_zones scope) -- the drawer's own initial
  // state, per RulesPanel.tsx's `useState<Role>(existing?.role ?? 'dispatcher')`.
  const zonePicker = drawer.getByRole('group', { name: text(locale, 'common.zone') });
  await zonePicker.getByRole('checkbox').first().check();
  await shot(page, testInfo, locale, 'flow8-rule-zones');
  await drawer.getByRole('button', { name: text(locale, 'common.save') }).click();
  await expect(page.getByText(m(locale, 'toast.rule'))).toBeVisible();
  await expect(rows(page).filter({ hasText: group })).toBeVisible();
}

async function runFlow(page: Page, testInfo: TestInfo, baseURL: string | undefined, locale: Locale, recordShots: boolean) {
  const seen = watch(page, baseURL);
  const tag = `${locale}-${Date.now().toString(36)}`;
  const providerName = `Entra E2E ${tag}`;
  const group = `opendispatch-flow8-${tag}`;

  await startDemo(page, locale, 'administrator');
  await page.goto(SI_ROUTE(locale));
  await expect(page.locator('[data-module="admin.sign_in_identity"]')).toHaveAttribute('data-state', 'filled');

  await addEntraProvider(page, locale, testInfo, providerName);
  for (const action of ['identity_provider.created', 'identity_provider.tested']) await expectAudit(page, locale, action);

  await addZoneScopedRule(page, locale, testInfo, group);
  await expectAudit(page, locale, 'role_mapping.created');

  await signOutViaSwitcher(page, locale);

  // Sign in through the labelled mock provider, with a group matching the rule just created --
  // real proof the new rule routes correctly, not a re-check of an already-seeded rule.
  await page.goto(`/${locale}/sign-in`);
  await waitForHydration(page, 'form');
  await page.getByRole('button', { name: text(locale, 'signIn.continue') }).click();
  await expect(mockCard(page)).toBeVisible();
  await mockCard(page).locator('input[type=radio][value="signed"]').check();
  await mockCard(page).locator('input[name=subject]').fill(`e2e.flow8.${tag}@demo.example`);
  await mockCard(page).locator('input[name=groups]').fill(group);
  await mockCard(page).getByRole('button', { name: text(locale, 'signIn.mock.submit') }).click();
  await page.waitForURL(new RegExp(`/${locale}/ops/`));
  await waitForHydration(page, '[data-shell="topbar"] button');
  if (recordShots) await shot(page, testInfo, locale, 'flow8-mock-signed-in');

  await signOutViaSwitcher(page, locale);

  // The emergency admin signs in locally with MFA.
  await page.goto(`/${locale}/sign-in/emergency`);
  await waitForHydration(page, 'form');
  await expect(heading(page)).toHaveText(text(locale, 'signIn.emergency.title'));
  await page.getByLabel(text(locale, 'signIn.emergency.password')).fill(password());
  await page.getByRole('button', { name: text(locale, 'signIn.continue') }).click();
  await expect(heading(page)).toHaveText(text(locale, 'signIn.emergency.mfaTitle'));
  await page.getByLabel(text(locale, 'signIn.emergency.code'), { exact: true }).fill(totp());
  await page.getByRole('button', { name: text(locale, 'signIn.mock.submit') }).click();
  await page.waitForURL(new RegExp(`/${locale}/admin/users-roles$`));
  await waitForHydration(page, '[data-shell="topbar"] button');
  if (recordShots) await shot(page, testInfo, locale, 'flow8-emergency-signed-in');

  await expectAudit(page, locale, 'auth.emergency_admin_sign_in');

  await expectPageOk(page, locale);
  seen.expectClean();
}

// `video` is a worker-level setting tied to this file's own worker-scoped server fixture --
// see flow-1's own note on this. Set once, file-wide: both locales get a video.
test.use({ video: 'on' });

test.describe('English', () => {
  test('flow 8: Entra ID provider, a zone-scoped group rule, mock sign-in through it, and the emergency admin with MFA', async ({ page, baseURL }, testInfo) => {
    await runFlow(page, testInfo, baseURL, 'en', true);
  });
});

test.describe('Arabic', () => {
  test('flow 8: the same flow works', async ({ page, baseURL }, testInfo) => {
    await runFlow(page, testInfo, baseURL, 'ar', false);
  });
});
