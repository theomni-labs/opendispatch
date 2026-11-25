// SPDX-License-Identifier: AGPL-3.0-only
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import postgres from 'postgres';
import { demoUsers, fromBase32, localBase, readAccounts, readLogins, readState } from '../../scripts/keycloak/state.mjs';
import { MODULES, defaultLanding, pathOf, type Role } from '../routes';

// Keycloak's real login page

const STATE = process.env['OPENDISPATCH_KC_STATE_DIR'] ?? '';
const ISSUER = process.env['OPENDISPATCH_KC_ISSUER'] ?? '';
const logins = readLogins(STATE);
const users = demoUsers();
const SHOTS = path.join(import.meta.dirname, '../../e2e-output/keycloak/shots');
const TENANT = (JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '../../fixtures/manifest.json'), 'utf8')) as { tenant_id: string }).tenant_id;

function db() {
  const url = process.env['OPENDISPATCH_MIGRATION_DATABASE_URL'];
  if (url === undefined || url === '') throw new Error('OPENDISPATCH_MIGRATION_DATABASE_URL is not set.');
  return postgres(url, { max: 1 });
}

function password(username: string): string {
  const p = logins.get(username);
  if (p === undefined) throw new Error(`no password for ${username} in ${STATE}/logins.txt`);
  return p;
}

// fails the test on any request off this machine
function stayLocal(page: Page): string[] {
  const away: string[] = [];
  page.on('request', (r) => {
    const host = new URL(r.url()).hostname;
    if (host !== 'localhost' && host !== '127.0.0.1') away.push(r.url());
  });
  return away;
}

async function toKeycloak(page: Page, locale: 'en' | 'ar'): Promise<void> {
  await page.goto(`/${locale}/sign-in`);
  // before hydration: a plain form submit
  await page.locator('form[action="/auth/login"] button[type="submit"]').click();
  await expect(page).toHaveURL((u) => u.href.startsWith(`${ISSUER}/`));
  await expect(page.locator('#kc-login')).toBeVisible();
}

async function submit(page: Page, username: string, pass: string): Promise<void> {
  await page.locator('#username').fill(username);
  await page.locator('#password').fill(pass);
  await page.locator('#kc-login').click();
}

function landingPath(role: Role, locale: string): string {
  const landing = defaultLanding(role, 'private');
  if (landing === null) throw new Error(`${role} has no landing page`);
  const m = MODULES.find((x) => x.id === landing.moduleId && x.console === landing.console);
  if (m === undefined) throw new Error(`${landing.moduleId}: unknown module`);
  return `/${locale}${pathOf(m)}`;
}

// RFC 6238, as an authenticator app computes it
function totp(key: string, at = Date.now()): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 30_000)));
  const h = crypto.createHmac('sha1', fromBase32(key)).update(counter).digest();
  const off = (h[h.length - 1] ?? 0) & 15;
  return String((h.readUInt32BE(off) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}

const withRole = users.filter((u) => u.role !== 'none' && !u.username.startsWith('mfa.'));
const noGroup = users.find((u) => u.role === 'none');

for (const locale of ['en', 'ar'] as const) {
  for (const u of withRole) {
    test(`${locale}: ${u.username} signs in on the login page and lands as ${u.role}`, async ({ page }) => {
      const away = stayLocal(page);
      await toKeycloak(page, locale);
      await expect(page.locator('html')).toHaveAttribute('lang', locale);
      await expect(page.locator('html')).toHaveAttribute('dir', locale === 'ar' ? 'rtl' : 'ltr');
      await submit(page, u.username, password(u.username));
      await expect(page).toHaveURL((url) => url.pathname === landingPath(u.role as Role, locale), { timeout: 30_000 });
      await expect(page.locator('[data-demo-switcher]')).toHaveCount(0);
      const sql = db();
      try {
        const rows = await sql<{ assigned_role: string }[]>`SELECT assigned_role FROM users WHERE tenant_id = ${TENANT} AND keycloak_subject = ${u.id}`;
        expect(rows.map((r) => r.assigned_role)).toEqual([u.role]);
      } finally {
        await sql.end();
      }
      expect(away).toEqual([]);
    });
  }
}

test('a person in no group signs in at Keycloak and gets no access', async ({ page }) => {
  if (noGroup === undefined) throw new Error('the realm has no user without a group');
  await toKeycloak(page, 'en');
  await submit(page, noGroup.username, password(noGroup.username));
  await expect(page).toHaveURL(/\/en\/sign-in\/message\/no-role$/);
  await page.goto('/en/admin/users');
  await expect(page).toHaveURL(/\/en\/sign-in/);
  const sql = db();
  try {
    const rows = await sql`SELECT 1 FROM users WHERE tenant_id = ${TENANT} AND keycloak_subject = ${noGroup.id}`;
    expect(rows).toHaveLength(0);
  } finally {
    await sql.end();
  }
});

test('a wrong password stays on the login page with its message, in Arabic', async ({ page }) => {
  await toKeycloak(page, 'ar');
  await submit(page, 'unknown.demo', 'not-the-password');
  await expect(page.locator('[id^="input-error"]').first()).toContainText('غير صالحة');
  await expect(page).toHaveURL((u) => u.href.startsWith(`${ISSUER}/`));
});

test('signing out ends the OpenDispatch session and the Keycloak one', async ({ page }) => {
  await toKeycloak(page, 'en');
  await submit(page, 'admin.demo', password('admin.demo'));
  await expect(page).toHaveURL(/\/en\/admin\//);
  await expect(async () => {
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page).toHaveURL((u) => u.href.startsWith(`${ISSUER}/`), { timeout: 2000 });
  }).toPass({ timeout: 20_000 });
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, 'logout-en-1440.png'), fullPage: true });
  await page.locator('#kc-logout').click();
  await expect(page).toHaveURL(/\/en\/signed-out$/);
  await page.goto('/en/admin/users');
  await expect(page).toHaveURL(/\/en\/sign-in/);
  await toKeycloak(page, 'en');
  await expect(page.locator('#password')).toBeVisible();
});

test('with the MFA policy on, a password-only sign-in is refused', async ({ page }) => {
  const sql = db();
  try {
    await sql`UPDATE settings SET value = 'true' WHERE tenant_id = ${TENANT} AND key = 'auth.require_mfa_claim'`;
    await toKeycloak(page, 'en');
    await submit(page, 'viewer.demo', password('viewer.demo'));
    await expect(page).toHaveURL(/\/en\/sign-in\/message\/refused$/);
    const denied = await sql`SELECT 1 FROM audit_events WHERE tenant_id = ${TENANT} AND action = 'auth.sign_in' AND outcome = 'denied' AND summary_en LIKE ${'%did not report a second factor%'}`;
    expect(denied.length).toBeGreaterThan(0);
  } finally {
    await sql`UPDATE settings SET value = 'false' WHERE tenant_id = ${TENANT} AND key = 'auth.require_mfa_claim'`;
    await sql.end();
  }
});

test('with the MFA policy on, password and authenticator code sign in (amr otp)', async ({ page }) => {
  const mfa = users.find((u) => u.username.startsWith('mfa.'));
  const key = mfa === undefined ? undefined : readAccounts(STATE).get(mfa.username)?.totp;
  if (mfa === undefined || key === undefined) throw new Error('no authenticator user in the realm or logins file');
  const sql = db();
  try {
    await sql`UPDATE settings SET value = 'true' WHERE tenant_id = ${TENANT} AND key = 'auth.require_mfa_claim'`;
    await toKeycloak(page, 'ar');
    await submit(page, mfa.username, password(mfa.username));
    await expect(page.locator('#otp')).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await page.locator('#otp').fill(totp(key));
    await page.locator('#kc-login').click();
    await expect(page).toHaveURL((url) => url.pathname === landingPath(mfa.role as Role, 'ar'), { timeout: 30_000 });
  } finally {
    await sql`UPDATE settings SET value = 'false' WHERE tenant_id = ${TENANT} AND key = 'auth.require_mfa_claim'`;
    await sql.end();
  }
});

test('login page screenshots, English and Arabic, 1440 and 390', async ({ browser }) => {
  fs.mkdirSync(SHOTS, { recursive: true });
  for (const width of [1440, 390]) {
    for (const locale of ['en', 'ar'] as const) {
      const ctx = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 900 } });
      const page = await ctx.newPage();
      const away = stayLocal(page);
      await toKeycloak(page, locale);
      await page.evaluate(() => document.fonts.ready);
      const font = await page.evaluate(() => getComputedStyle(document.body).fontFamily);
      expect(font).toContain(locale === 'ar' ? 'IBM Plex Sans Arabic' : 'Figtree');
      await page.screenshot({ path: path.join(SHOTS, `login-${locale}-${String(width)}.png`), fullPage: true });
      await submit(page, 'unknown.demo', 'not-the-password');
      await expect(page.locator('[id^="input-error"]').first()).toBeVisible();
      await page.screenshot({ path: path.join(SHOTS, `login-error-${locale}-${String(width)}.png`), fullPage: true });
      const mfa = users.find((u) => u.username.startsWith('mfa.'));
      if (mfa !== undefined) {
        await submit(page, mfa.username, password(mfa.username));
        await expect(page.locator('#otp')).toBeVisible();
        await page.screenshot({ path: path.join(SHOTS, `login-otp-${locale}-${String(width)}.png`), fullPage: true });
      }
      expect(away).toEqual([]);
      await ctx.close();
    }
  }
});

test('five wrong passwords lock the account for a while, even with the right one after', async ({ page }) => {
  if (noGroup === undefined) throw new Error('the realm has no user without a group');
  await toKeycloak(page, 'en');
  for (let i = 0; i < 5; i += 1) await submit(page, noGroup.username, `wrong-${String(i)}-password`);
  await submit(page, noGroup.username, password(noGroup.username));
  await expect(page.locator('[id^="input-error"]').first()).toBeVisible();
  await expect(page).toHaveURL((u) => u.href.startsWith(`${ISSUER}/`));
  const kc = readState(STATE);
  if (kc === null) throw new Error('no Keycloak state');
  const form = new URLSearchParams({ grant_type: 'password', client_id: 'admin-cli', username: 'opendispatch-bootstrap', password: kc.OPENDISPATCH_KC_BOOTSTRAP_PASSWORD ?? '' });
  const token = ((await (await fetch(`${localBase(kc)}/realms/master/protocol/openid-connect/token`, { method: 'POST', body: form })).json()) as { access_token: string }).access_token;
  const status = (await (await fetch(`${localBase(kc)}/admin/realms/opendispatch/attack-detection/brute-force/users/${noGroup.id}`, { headers: { authorization: `Bearer ${token}` } })).json()) as { disabled: boolean };
  expect(status.disabled).toBe(true);
  // unlock for the next run
  await fetch(`${localBase(kc)}/admin/realms/opendispatch/attack-detection/brute-force/users/${noGroup.id}`, { method: 'DELETE', headers: { authorization: `Bearer ${token}` } });
});
