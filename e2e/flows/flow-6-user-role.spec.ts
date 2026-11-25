// SPDX-License-Identifier: AGPL-3.0-only
import { type Locator, type Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { expectPageOk, signOutViaSwitcher, startDemo, waitForHydration, watch } from '../helpers';
import { landingOf, text, type Locale } from '../routes';
import { auditDetail, expectAudit, messages } from './support';

// Flow 6: a two-zone user, switched to.

const USERS = messages('admin/users_roles');
const ZONES = ['RD-C', 'RD-N'];
const OTHER_ZONES = ['RD-E', 'RD-S', 'RD-W'];
const ZONE_IDS = ['091ff2b2-f0e1-4b97-bfc9-7cdd0698c32a', 'eecf5c7f-237c-443c-b331-b75ba3fb26fc'];
// Seeded rule: dispatcher in RD-C and RD-N
const GROUP = 'opendispatch-dispatch-riyadh-core';

const usersRoot = (page: Page) => page.locator('[data-module="admin.users_roles"]');
const button = (scope: Page | Locator, name: string) => scope.getByRole('button', { name, exact: true });

async function openUser(page: Page, locale: Locale, name: string): Promise<Locator> {
  await page.goto(`/${locale}/admin/users-roles`);
  await expect(usersRoot(page)).toHaveAttribute('data-state', 'filled');
  await waitForHydration(page, 'main');
  await page.getByRole('row', { name: new RegExp(name) }).click();
  const drawer = page.getByRole('dialog');
  await expect(drawer).toBeVisible();
  for (const zone of ZONES) await expect(drawer.getByText(zone, { exact: true })).toBeVisible();
  for (const zone of OTHER_ZONES) await expect(drawer.getByText(zone, { exact: true })).toHaveCount(0);
  return drawer;
}

async function runFlow(page: Page, baseURL: string | undefined, locale: Locale) {
  const seen = watch(page, baseURL);
  const name = `E2E Flow6 ${locale.toUpperCase()}`;
  const email = `e2e.flow6.${locale}@demo.example`;
  const dispatcher = text(locale, 'roles.dispatcher');

  // The Administrator creates a two-zone user.
  await startDemo(page, locale, 'administrator');
  await page.goto(`/${locale}/admin/users-roles`);
  await expect(usersRoot(page)).toHaveAttribute('data-state', 'filled');
  await waitForHydration(page, 'main');
  await button(page, USERS(locale, 'invite')).click();
  const wizard = page.getByRole('dialog');
  await wizard.getByLabel(USERS(locale, 'w.name')).fill(name);
  await wizard.getByLabel(USERS(locale, 'col.email')).fill(email);
  await button(page, text(locale, 'common.next')).click();
  for (const zone of ZONES) await page.getByRole('checkbox', { name: zone, exact: true }).check();
  await button(page, text(locale, 'common.next')).click();
  await button(page, USERS(locale, 'w.send')).click();
  await expect(page.getByText(USERS(locale, 'toast.invited.title'))).toBeVisible();

  // Invited, not yet active: no switch yet.
  const invited = await openUser(page, locale, name);
  await expect(invited.getByText(USERS(locale, 'status.invited')).first()).toBeVisible();
  await expect(button(invited, USERS(locale, 'd.switch'))).toHaveAttribute('aria-disabled', 'true');
  await page.keyboard.press('Escape');
  await expect(invited).toBeHidden();
  await signOutViaSwitcher(page, locale);

  // Their first sign-in, through the mock provider.
  await page.goto(`/${locale}/sign-in`);
  await waitForHydration(page, 'form');
  await page.getByRole('button', { name: text(locale, 'signIn.continue') }).click();
  const mock = page.locator('[data-sign-in="mock-provider"]');
  await mock.locator('input[type=radio][value="signed"]').check();
  await mock.locator('input[name=subject]').fill(email);
  await mock.locator('input[name=groups]').fill(GROUP);
  await mock.getByRole('button', { name: text(locale, 'signIn.mock.submit') }).click();
  await page.waitForURL(new RegExp(`/${locale}/ops/`));
  await waitForHydration(page, '[data-shell="topbar"] button');
  await expect(page.getByRole('button', { name: `${text(locale, 'demo.controls')}: ${dispatcher}` })).toBeVisible();
  await signOutViaSwitcher(page, locale);

  // Now active: the Administrator switches to them.
  await startDemo(page, locale, 'administrator');
  const active = await openUser(page, locale, name);
  await expect(active.getByText(USERS(locale, 'status.active')).first()).toBeVisible();
  await button(active, USERS(locale, 'd.switch')).click();
  await expect(page.getByText(USERS(locale, 'toast.switched', { role: dispatcher }))).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`${landingOf('dispatcher', 'private') ?? ''}$`), { timeout: 15_000 });
  await expect(page.getByRole('button', { name: `${text(locale, 'demo.controls')}: ${dispatcher}` })).toBeVisible();

  // What they can do: only their two zones.
  await page.goto(`/${locale}/ops/forecast-explorer`);
  await expect(page.locator('[data-module="ops.forecast_explorer"]')).toHaveAttribute('data-state', 'filled');
  const options = await page.getByLabel(text(locale, 'common.zone')).locator('option').allTextContents();
  for (const zone of ZONES) expect(options.some((label) => label.includes(zone)), `${zone} is offered`).toBe(true);
  for (const zone of OTHER_ZONES) expect(options.some((label) => label.includes(zone)), `${zone} is not offered`).toBe(false);
  // And what they cannot: no Field Planner.
  await page.goto(`/${locale}/ops/field-planner`);
  await expect(page.locator('[data-module="ops.field_planner"]')).toHaveAttribute('data-state', 'noaccess');
  await signOutViaSwitcher(page, locale);

  await startDemo(page, locale, 'administrator');
  const created = await expectAudit(page, locale, name, 'user.created');
  const detail = await auditDetail(page, created);
  for (const id of ZONE_IDS) expect(detail, 'saved with both zones').toContain(id);
  await page.keyboard.press('Escape');
  await expectAudit(page, locale, name, 'auth.mock_sign_in');

  await expectPageOk(page, locale);
  seen.expectClean();
}

test.use({ video: 'on' });

test.describe('English', () => {
  test('flow 6: a user scoped to two zones signs in, is switched to, sees only those zones and nothing their role lacks', async ({ page, baseURL }) => {
    await runFlow(page, baseURL, 'en');
  });
});

test.describe('Arabic', () => {
  test('flow 6: the same steps', async ({ page, baseURL }) => {
    await runFlow(page, baseURL, 'ar');
  });
});
