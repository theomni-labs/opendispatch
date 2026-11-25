// SPDX-License-Identifier: AGPL-3.0-only
import { expect, test } from '@playwright/test';

// Flow 8 through a real OIDC sign-in: the page sends the browser to the provider, the provider sends it back,
// the api checks the token, maps the group to a role and starts a session.

test('a person in the administrators group signs in, sees the administrator console and signs out', async ({ page }) => {
  await page.goto('/en');
  await expect(page).toHaveURL(/\/en\/sign-in$/);
  await page.getByRole('button', { name: 'Sign in with SSO' }).click();
  await page.getByRole('link', { name: /Nadia Al-Ghalani/ }).click();
  await expect(page).toHaveURL(/\/en\/admin\//);
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
  await expect(page.locator('[data-demo-switcher]')).toHaveCount(0);
  // A click before hydration is a no-op: retry.
  await expect(async () => {
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/en\/signed-out$/, { timeout: 2000 });
  }).toPass({ timeout: 20000 });
  await page.goto('/en/admin/users');
  await expect(page).toHaveURL(/\/en\/sign-in/);
});

test('a dispatch supervisor lands on the operations side', async ({ page }) => {
  await page.goto('/en/sign-in');
  await page.getByRole('button', { name: 'Sign in with SSO' }).click();
  await page.getByRole('link', { name: /Fahad Al-Musari/ }).click();
  await expect(page).toHaveURL(/\/en\/ops\//);
});

test('a person with no group gets the no-role page and no session', async ({ page }) => {
  await page.goto('/en/sign-in');
  await page.getByRole('button', { name: 'Sign in with SSO' }).click();
  await page.getByRole('link', { name: /No Group/ }).click();
  await expect(page).toHaveURL(/\/en\/sign-in\/message\/no-role$/);
  await page.goto('/en/admin/users');
  await expect(page).toHaveURL(/\/en\/sign-in/);
});

test('the demo cookie is worth nothing in oidc mode', async ({ page, context }) => {
  await context.addCookies([{ name: 'opendispatch_demo_session', value: 'forged', url: 'http://localhost:3223' }]);
  await page.goto('/en/admin/users');
  await expect(page).toHaveURL(/\/en\/sign-in/);
});
