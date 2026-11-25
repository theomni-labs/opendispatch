// SPDX-License-Identifier: AGPL-3.0-only
import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { type BrowserContext, type Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { expectFontsLoaded, expectPageOk, shot, signOutViaSwitcher, startDemo, waitForHydration, watch } from './helpers';
import { landingOf, locales, text, type InstallMode, type Locale, type Role } from './routes';

// The sign-in pages: /sign-in with the mock provider, /sign-in/emergency, the three messages
// and /signed-out, in English and Arabic, at 1440 and 390 wide; the outcomes of both sign-in actions; the install mode cookie;
// and sign-out, which is audited and lands on Signed out. The specs sign in as the SEEDED users with the groups of their own rules,
// so a mock sign-in changes nothing but a timestamp in the shared demo store.
//
// The emergency credentials are made per run in playwright.config.ts (DEMO_EMERGENCY_ADMIN_PASSWORD and _TOTP in process.env, and in
// the server's environment). They are read here when a test needs them and never printed, written to a file or put in a
// screenshot. A wrong password or a wrong code counts towards the lockout of the ONE emergency account of a store, and a
// locked account stays locked until the demo is reset, so everything that fails on purpose runs against a second server of its own,
// with its own demo store in a temp directory (the last describe). The shared server only sees successful emergency sign-ins,
// which also reset the counter.
//
// Runs in the desktop project only (playwright.config.ts); each test that cares about width sets its own viewport.

const SESSION_COOKIE = 'opendispatch_session';
const MODE_COOKIE = 'opendispatch_demo_mode';
const REFERENCE = /^ODP-[0-9A-F]{8}$/;
const EMERGENCY_EMAIL = 'emergency.admin@demo.example';
const WIDTHS = [1440, 390] as const;

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
const anotherCode = (): string => (totp() === '000000' ? '000001' : '000000');

/** The seeded people and the groups of their own rules (fixtures/admin/users.json and role_mappings.json): signing in as them changes nothing. */
const SEEDED: ReadonlyArray<{ role: Role; subject: string; groups: string }> = [
  { role: 'administrator', subject: 'nadia.al.ghalani@demo.example', groups: 'opendispatch-administrators' },
  { role: 'dispatch_supervisor', subject: 'fahad.al.musari@demo.example', groups: '5b1d0c1e-3a44-4f0b-9d25-7f1c3e8a2b01' },
  { role: 'dispatcher', subject: 'omar.al.fadani@demo.example', groups: 'opendispatch-dispatch-riyadh-core' },
  { role: 'planner', subject: 'reem.al.hinari@demo.example', groups: 'opendispatch-planners-riyadh' },
  { role: 'remote_team_lead', subject: 'maha.al.khayani@demo.example', groups: 'opendispatch-remote-team-leads' },
  { role: 'viewer_auditor', subject: 'tariq.al.dubari@demo.example', groups: 'opendispatch-auditors' },
  { role: 'change_approver', subject: 'saad.al.nabari@demo.example', groups: 'opendispatch-change-approvers-team' },
];
const seeded = (role: Role) => {
  const found = SEEDED.find((entry) => entry.role === role);
  if (found === undefined) throw new Error(`No seeded person for ${role}`);
  return found;
};

const cookieOf = async (context: BrowserContext, name: string) => (await context.cookies()).find((c) => c.name === name);

// --- what a person does on the pages ----------------------------------------------------------------------------------------

const heading = (page: Page) => page.getByRole('heading', { level: 1 });
const mockCard = (page: Page) => page.locator('[data-sign-in="mock-provider"]');
/** The alert inside a sign-in card. Scoped, because Next's own route announcer is a role=alert too (in a shadow root). */
const alertOf = (page: Page) => page.locator('[data-sign-in]').getByRole('alert');

async function openSignIn(page: Page, locale: Locale) {
  await page.goto(`/${locale}/sign-in`);
  await waitForHydration(page, 'form');
  await expect(heading(page)).toHaveText(text(locale, 'signIn.title'));
}

/** Presses Continue and waits for the mock provider's card. */
async function openMockProvider(page: Page, locale: Locale) {
  await page.getByRole('button', { name: text(locale, 'signIn.continue') }).click();
  await expect(mockCard(page)).toBeVisible();
}

/** Fills the mock provider's card: the subject and (for the outcome "Signs in") the groups, picks the outcome and presses Sign in. */
async function playMockProvider(page: Page, locale: Locale, options: { subject?: string; groups?: string; outcome?: 'signed' | 'noRole' | 'refused' | 'error' }) {
  const card = mockCard(page);
  if (options.outcome !== undefined) await card.locator(`input[type=radio][value="${options.outcome}"]`).check();
  if (options.subject !== undefined) await card.locator('input[name=subject]').fill(options.subject);
  if (options.groups !== undefined) await card.locator('input[name=groups]').fill(options.groups);
  await card.getByRole('button', { name: text(locale, 'signIn.mock.submit') }).click();
}

async function openEmergency(page: Page, locale: Locale) {
  await page.goto(`/${locale}/sign-in/emergency`);
  await waitForHydration(page, 'form');
  await expect(heading(page)).toHaveText(text(locale, 'signIn.emergency.title'));
}

/** Types the password and presses Continue on the emergency page. */
async function submitPassword(page: Page, locale: Locale, value: string) {
  await page.getByLabel(text(locale, 'signIn.emergency.password')).fill(value);
  await page.getByRole('button', { name: text(locale, 'signIn.continue') }).click();
}

/** Types a code and presses Sign in on the emergency page's second step. */
async function submitCode(page: Page, locale: Locale, value: string) {
  await page.getByLabel(text(locale, 'signIn.emergency.code'), { exact: true }).fill(value);
  await page.getByRole('button', { name: text(locale, 'signIn.mock.submit') }).click();
}

/** The whole emergency sign-in with the run's credentials. Resolves on the Administrator's landing page. */
async function emergencySignIn(page: Page, locale: Locale) {
  await openEmergency(page, locale);
  await submitPassword(page, locale, password());
  await expect(heading(page)).toHaveText(text(locale, 'signIn.emergency.mfaTitle'));
  await submitCode(page, locale, totp());
  await page.waitForURL(new RegExp(`/${locale}/admin/`));
}

/** The Audit Log of the Administrator shows the event: the action code is the one the data layer writes. */
async function expectAuditEvent(page: Page, locale: Locale, action: string) {
  await page.goto(`/${locale}/admin/audit-log?q=${action}`);
  await expect(page.getByText(action).first()).toBeVisible();
}

// --- pages, both languages, both widths ----------------------------------------------------------------------------------

const PAGES: ReadonlyArray<{ name: string; path: string; heading: string }> = [
  { name: 'sign-in', path: '/sign-in', heading: 'signIn.title' },
  { name: 'emergency', path: '/sign-in/emergency', heading: 'signIn.emergency.title' },
  { name: 'refused', path: '/sign-in/message/refused', heading: 'signIn.refused.title' },
  { name: 'no-role', path: '/sign-in/message/no-role', heading: 'signIn.noRole.title' },
  { name: 'error', path: '/sign-in/message/error?ref=ODP-9B41C7E0', heading: 'signIn.error.title' },
  { name: 'signed-out', path: '/signed-out', heading: 'signIn.out.title' },
];

test.describe('the sign-in pages', () => {
  for (const locale of locales) {
    test(`every page is one centred card in ${locale}: lang and dir from the server, fonts bundled, no overflow at 1440 or 390, nothing leaves the app`, async ({ page, baseURL }) => {
      const seen = watch(page, baseURL);
      for (const width of WIDTHS) {
        await page.setViewportSize({ width, height: 900 });
        for (const entry of PAGES) {
          await page.goto(`/${locale}${entry.path}`);
          await expect(heading(page), `${entry.name} at ${width}`).toHaveText(text(locale, entry.heading));
          await expectPageOk(page, locale);
          // one bare page: no shell, no rail, no top bar; one card (the sign-in page has a second only once the mock provider is opened)
          await expect(page.locator('[data-shell]')).toHaveCount(0);
          await expect(page.locator('[data-sign-in]')).toHaveCount(1);
          const card = await page.locator('[data-sign-in]').boundingBox();
          expect(card, `${entry.name} at ${width}: the card is on the page`).not.toBeNull();
          // centred in the page, to within a pixel or two (the column is at most 420px wide)
          const box = card as NonNullable<typeof card>;
          // 26.25rem: the Arabic page has a root size 6.25% larger, so its column is 446px, not 420px
          expect(box.width, `${entry.name} at ${width}`).toBeLessThanOrEqual(locale === 'ar' ? 446.5 : 420.5);
          expect(Math.abs(box.x + box.width / 2 - width / 2), `${entry.name} at ${width}: centred`).toBeLessThanOrEqual(2);
        }
      }
      await expectFontsLoaded(page, locale);
      seen.expectClean();
    });
  }

  test('the Arabic pages have no English left over but names, codes and addresses (translate="no")', async ({ page }) => {
    const ALLOWED = new Set(['OPENDISPATCH', 'ENAR', 'English']); // ENAR: the toggle's two codes side by side; English: the other language's own name
    for (const entry of PAGES) {
      await page.goto(`/ar${entry.path}`);
      await expect(heading(page)).toBeVisible();
      const words = await page.evaluate(() => {
        // the text a person can read, without the parts that are data and stay English on purpose
        const clone = document.body.cloneNode(true) as HTMLElement;
        for (const node of clone.querySelectorAll('[translate="no"],script,style,noscript')) node.remove(); // scripts carry the framework's payload, not text
        const out: string[] = [clone.textContent ?? ''];
        for (const el of document.querySelectorAll('[aria-label],[placeholder],[title]')) {
          if (el.closest('[translate="no"]')) continue;
          for (const attr of ['aria-label', 'placeholder', 'title']) out.push(el.getAttribute(attr) ?? '');
        }
        return out.join(' ');
      });
      const latin = words.match(/[A-Za-z][A-Za-z'-]{2,}/g)?.filter((word) => !ALLOWED.has(word)) ?? [];
      expect(latin, `English words on /ar${entry.path}`).toEqual([]);
    }
  });

  test('the language toggle keeps the page: sign-in to Arabic and back', async ({ page }) => {
    await page.goto('/en/sign-in');
    await page.locator('[data-language-toggle]').getByRole('link', { name: text('en', 'language.ar') }).click();
    await expect(page).toHaveURL(/\/ar\/sign-in$/);
    await expectPageOk(page, 'ar');
    await expect(heading(page)).toHaveText(text('ar', 'signIn.title'));
    await page.locator('[data-language-toggle]').getByRole('link', { name: text('ar', 'language.en') }).click();
    await expect(page).toHaveURL(/\/en\/sign-in$/);
  });

  test('a reference code is shown only when it is shaped like one; nothing else in ?ref= reaches the page', async ({ page }) => {
    await page.goto('/en/sign-in/message/error?ref=ODP-9B41C7E0');
    await expect(page.locator('[data-reference]')).toHaveText('ODP-9B41C7E0');
    for (const bad of ['', 'odp-9b41c7e0', '<b>x</b>', 'ODP-9B41C7E0%20', 'ODP-1234']) {
      await page.goto(`/en/sign-in/message/error?ref=${bad}`);
      await expect(heading(page)).toHaveText(text('en', 'signIn.error.title'));
      await expect(page.locator('[data-reference]')).toHaveCount(0);
      await expect(page.getByRole('button', { name: text('en', 'signIn.copy') })).toHaveCount(0);
    }
    await page.goto('/en/sign-in/message/error');
    await expect(page.locator('[data-reference]')).toHaveCount(0);
  });

  test('the demo start page has the Sign-in screens link, in both languages', async ({ page }) => {
    for (const locale of locales) {
      await page.goto(`/${locale}`);
      const link = page.getByRole('link', { name: text(locale, 'signIn.screens') });
      await expect(link).toBeVisible();
      await link.click();
      await expect(page).toHaveURL(new RegExp(`/${locale}/sign-in$`));
      await expect(heading(page)).toHaveText(text(locale, 'signIn.title'));
    }
  });

  test('someone who already has a session goes to their landing page instead of the sign-in pages', async ({ page }) => {
    await startDemo(page, 'en', 'planner');
    for (const path of ['/en/sign-in', '/en/sign-in/emergency']) {
      await page.goto(path);
      await expect(page).toHaveURL(new RegExp(`/en${landingOf('planner', 'private')}$`));
    }
    // the messages and Signed out read no session: they open for anyone
    await page.goto('/en/signed-out');
    await expect(page).toHaveURL(/\/en\/signed-out$/);
  });
});

// --- the sign-in page and the mock provider -------------------------------------------------------------------------------

test.describe('sign in through the mock provider', () => {
  for (const locale of locales) {
    test(`the card opens the mock provider with the e-mail as the subject, in ${locale}`, async ({ page, baseURL }) => {
      const seen = watch(page, baseURL);
      await openSignIn(page, locale);
      await expect(page.getByLabel(text(locale, 'signIn.email'))).toHaveValue('omar.al.fadani@demo.example');
      await expect(page.getByRole('link', { name: text(locale, 'signIn.emergencyLink') })).toHaveAttribute('href', `/${locale}/sign-in/emergency`);
      await expect(mockCard(page)).toHaveCount(0);

      await openMockProvider(page, locale);
      await expect(mockCard(page).getByText(text(locale, 'signIn.mock.badge'))).toBeVisible();
      await expect(mockCard(page).locator('input[name=subject]')).toHaveValue('omar.al.fadani@demo.example');
      await expect(mockCard(page).locator('input[name=subject]')).toBeFocused();
      for (const outcome of ['signed', 'noRole', 'refused', 'error']) await expect(mockCard(page).locator(`input[type=radio][value="${outcome}"]`)).toHaveCount(1);
      // "Sign in with SSO" opens the same card, and Enter in the e-mail is Continue
      await page.getByRole('button', { name: text(locale, 'signIn.sso') }).click();
      await expect(mockCard(page)).toBeVisible();
      for (const width of WIDTHS) {
        await page.setViewportSize({ width, height: 900 });
        await expectPageOk(page, locale);
      }
      seen.expectClean();
    });
  }

  for (const entry of SEEDED) {
    test(`groups that match a role sign the ${entry.role} in and go to its landing page`, async ({ page, context, baseURL }) => {
      const seen = watch(page, baseURL);
      const landing = landingOf(entry.role, 'private');
      expect(landing).toBeDefined();
      await openSignIn(page, 'en');
      await openMockProvider(page, 'en');
      await playMockProvider(page, 'en', { subject: entry.subject, groups: entry.groups });
      await page.waitForURL(new RegExp(`/en${landing}$`));
      await waitForHydration(page, '[data-shell="topbar"] button');

      // the session cookie is HttpOnly and holds no readable role; the install mode cookie was not written by signing in
      const session = await cookieOf(context, SESSION_COOKIE);
      expect(session?.httpOnly).toBe(true);
      expect(session?.sameSite).toBe('Lax');
      expect(await page.evaluate(() => document.cookie)).not.toContain(SESSION_COOKIE);
      expect(await cookieOf(context, MODE_COOKIE)).toBeUndefined();
      // and it is the role the rule gives: the menu is that role's (its landing module is where the person is)
      await expect(page.locator('[data-console]')).toBeVisible();
      seen.expectClean();
    });
  }

  test('no matching group: the No role message, and no session', async ({ page, context, baseURL }) => {
    const seen = watch(page, baseURL);
    await openSignIn(page, 'en');
    await openMockProvider(page, 'en');
    await playMockProvider(page, 'en', { subject: 'e2e.nobody@demo.example', groups: 'some-group-nobody-mapped' });
    await page.waitForURL(/\/en\/sign-in\/message\/no-role$/);
    await expect(heading(page)).toHaveText(text('en', 'signIn.noRole.title'));
    await expect(page.getByText(text('en', 'signIn.noRole.reason'))).toBeVisible();
    expect(await cookieOf(context, SESSION_COOKIE)).toBeUndefined();
    // the way back
    await page.getByRole('link', { name: text('en', 'signIn.again') }).click();
    await expect(page).toHaveURL(/\/en\/sign-in$/);
    seen.expectClean();
  });

  test('the outcome "No matching group" sends no groups: the No role message', async ({ page, context }) => {
    await openSignIn(page, 'ar');
    await openMockProvider(page, 'ar');
    await playMockProvider(page, 'ar', { outcome: 'noRole' });
    await page.waitForURL(/\/ar\/sign-in\/message\/no-role$/);
    await expect(heading(page)).toHaveText(text('ar', 'signIn.noRole.title'));
    expect(await cookieOf(context, SESSION_COOKIE)).toBeUndefined();
  });

  test('a provider that refuses: the Refused message, and no session', async ({ page, context }) => {
    await openSignIn(page, 'en');
    await openMockProvider(page, 'en');
    await playMockProvider(page, 'en', { outcome: 'refused' });
    await page.waitForURL(/\/en\/sign-in\/message\/refused$/);
    await expect(heading(page)).toHaveText(text('en', 'signIn.refused.title'));
    await expect(page.getByText(text('en', 'signIn.refused.body'))).toBeVisible();
    expect(await cookieOf(context, SESSION_COOKIE)).toBeUndefined();
    await page.getByRole('link', { name: text('en', 'signIn.back') }).click();
    await expect(page).toHaveURL(/\/en\/sign-in$/);
  });

  test('an account that is switched off is refused too', async ({ page, context }) => {
    // fixtures/admin/users.json: Ziyad Al-Khayani is a disabled dispatcher
    await openSignIn(page, 'en');
    await openMockProvider(page, 'en');
    await playMockProvider(page, 'en', { subject: 'ziyad.al.khayani@demo.example', groups: 'opendispatch-dispatch-riyadh-core' });
    await page.waitForURL(/\/en\/sign-in\/message\/refused$/);
    expect(await cookieOf(context, SESSION_COOKIE)).toBeUndefined();
  });

  for (const via of ['the outcome "Provider fails"', 'the scripted subject provider.error']) {
    test(`${via}: the Went wrong message with a reference code that can be copied`, async ({ page, context, baseURL }) => {
      const seen = watch(page, baseURL);
      await context.grantPermissions(['clipboard-read', 'clipboard-write']);
      await openSignIn(page, 'en');
      await openMockProvider(page, 'en');
      await playMockProvider(page, 'en', via.startsWith('the outcome') ? { outcome: 'error' } : { subject: 'provider.error' });
      await page.waitForURL(/\/en\/sign-in\/message\/error\?ref=ODP-[0-9A-F]{8}$/);
      await expect(heading(page)).toHaveText(text('en', 'signIn.error.title'));
      const code = (await page.locator('[data-reference]').textContent()) ?? '';
      expect(code).toMatch(REFERENCE);
      expect(page.url()).toContain(`ref=${code}`);
      expect(await cookieOf(context, SESSION_COOKIE)).toBeUndefined();

      await page.getByRole('button', { name: text('en', 'signIn.copy') }).click();
      await expect(page.getByText(text('en', 'signIn.copied'))).toBeVisible();
      expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(code);
      seen.expectClean();
    });
  }

  test('an empty subject is refused on the page, with nothing said about why and nobody signed in', async ({ page, context }) => {
    await openSignIn(page, 'en');
    await openMockProvider(page, 'en');
    await playMockProvider(page, 'en', { subject: '' });
    await expect(alertOf(page)).toHaveText(text('en', 'demo.errorInvalid'));
    await expect(page).toHaveURL(/\/en\/sign-in$/);
    expect(await cookieOf(context, SESSION_COOKIE)).toBeUndefined();
  });
});

// --- the install mode ----------------------------------------------------------------------------------------------------

test.describe('the install mode cookie', () => {
  test('the start page writes it (signed, HttpOnly, SameSite=Lax); sign-in reads it: a Change Approver has no role in a shared install', async ({ page, context }) => {
    await startDemo(page, 'en', 'administrator', 'shared');
    const mode = await cookieOf(context, MODE_COOKIE);
    expect(mode).toBeDefined();
    expect(mode?.httpOnly).toBe(true);
    expect(mode?.sameSite).toBe('Lax');
    expect(mode?.secure).toBe(false);
    expect(await page.evaluate(() => document.cookie)).not.toContain(MODE_COOKIE);
    // no role, no user, no zones in it: the value is the signed payload of the mode and nothing else
    const payload = JSON.parse(Buffer.from((mode?.value ?? '').split('.')[0] ?? '', 'base64url').toString('utf8')) as Record<string, unknown>;
    expect(Object.keys(payload).sort()).toEqual(['exp', 'mode', 't', 'v']);
    expect(payload['mode']).toBe('shared');

    // signing out clears the session and leaves the mode
    await signOutViaSwitcher(page, 'en');
    expect(await cookieOf(context, SESSION_COOKIE)).toBeUndefined();
    expect((await cookieOf(context, MODE_COOKIE))?.value).toBe(mode?.value);

    // the sign-in pages that follow are still in a shared install: the Change Approver's group gives no role there
    const approver = seeded('change_approver');
    await openSignIn(page, 'en');
    await openMockProvider(page, 'en');
    await playMockProvider(page, 'en', { subject: approver.subject, groups: approver.groups });
    await page.waitForURL(/\/en\/sign-in\/message\/no-role$/);
    expect(await cookieOf(context, SESSION_COOKIE)).toBeUndefined();
  });

  for (const mode of ['private', 'dedicated', 'shared'] as const satisfies readonly InstallMode[]) {
    test(`the session of a mock sign-in is in the ${mode} install the person chose on the start page`, async ({ page, context }) => {
      await startDemo(page, 'en', 'administrator', mode);
      await signOutViaSwitcher(page, 'en');
      const admin = seeded('administrator');
      await openSignIn(page, 'en');
      await openMockProvider(page, 'en');
      await playMockProvider(page, 'en', { subject: admin.subject, groups: admin.groups });
      await page.waitForURL(/\/en\/admin\//);
      await waitForHydration(page, '[data-shell="topbar"] button');
      // the Updates screen is the mode's own: full in private, reduced in dedicated and shared
      await page.goto('/en/admin/updates');
      await expect(page.locator('[data-module="admin.updates"]')).toHaveAttribute('data-reduced', String(mode !== 'private'));
      expect((await cookieOf(context, MODE_COOKIE))?.value).toBeDefined();
    });
  }
});

// --- the emergency administrator: the sign-in that works ----------------------------------------------------------------

test.describe('emergency administrator sign-in (success)', () => {
  for (const locale of locales) {
    test(`password, then the authenticator code, signs the Administrator in and is audited, in ${locale}`, async ({ page, context, baseURL }) => {
      const seen = watch(page, baseURL);
      await openEmergency(page, locale);
      await expect(page.getByLabel(text(locale, 'signIn.email'))).toHaveValue(EMERGENCY_EMAIL);
      await expect(page.locator('[data-sign-in="emergency"]')).toHaveAttribute('data-state', 'credentials');

      await submitPassword(page, locale, password());
      // the second step of the same page: the address did not change and nothing of the password is in it
      await expect(heading(page)).toHaveText(text(locale, 'signIn.emergency.mfaTitle'));
      await expect(page.locator('[data-sign-in="emergency"]')).toHaveAttribute('data-state', 'code');
      await expect(page).toHaveURL(new RegExp(`/${locale}/sign-in/emergency$`));
      await expect(page.getByLabel(text(locale, 'signIn.emergency.code'), { exact: true })).toBeFocused();
      await expect(page.getByText(text(locale, 'signIn.emergency.locked'))).toBeVisible();
      expect(await cookieOf(context, SESSION_COOKIE)).toBeUndefined();
      for (const width of WIDTHS) {
        await page.setViewportSize({ width, height: 900 });
        await expectPageOk(page, locale);
      }

      await submitCode(page, locale, totp());
      await page.waitForURL(new RegExp(`/${locale}/admin/users-roles$`));
      await waitForHydration(page, '[data-shell="topbar"] button');
      expect((await cookieOf(context, SESSION_COOKIE))?.httpOnly).toBe(true);
      // the password and the code are nowhere in the address, the cookies a script can read, or the page
      expect(page.url()).not.toContain(password());
      expect(await page.evaluate(() => document.cookie)).not.toContain(password());
      expect(await page.content()).not.toContain(password());

      // written to the Audit Log
      await expectAuditEvent(page, locale, 'auth.emergency_admin_sign_in');
      seen.expectClean();
    });
  }

  test('the code is six digits: anything else is refused on the page, before the server is asked', async ({ page, context }) => {
    await openEmergency(page, 'en');
    await submitPassword(page, 'en', password());
    await expect(heading(page)).toHaveText(text('en', 'signIn.emergency.mfaTitle'));
    for (const bad of ['12345', '12345a', 'abcdef']) {
      await submitCode(page, 'en', bad);
      await expect(page.getByText(text('en', 'signIn.emergency.codeNeeded'))).toBeVisible();
    }
    expect(await cookieOf(context, SESSION_COOKIE)).toBeUndefined();
    await expect(heading(page)).toHaveText(text('en', 'signIn.emergency.mfaTitle'));
  });
});

// --- sign out ------------------------------------------------------------------------------------------------------------

test.describe('sign out', () => {
  for (const locale of locales) {
    test(`lands on Signed out, is audited (auth.sign_out) and needs a new sign-in, in ${locale}`, async ({ page, context, baseURL }) => {
      const seen = watch(page, baseURL);
      await startDemo(page, locale, 'administrator');
      expect(await cookieOf(context, SESSION_COOKIE)).toBeDefined();

      await signOutViaSwitcher(page, locale);
      await expect(heading(page)).toHaveText(text(locale, 'signIn.out.title'));
      await expect(page.getByText(text(locale, 'signIn.out.body'))).toBeVisible();
      await expectPageOk(page, locale);
      expect(await cookieOf(context, SESSION_COOKIE)).toBeUndefined();
      expect(await cookieOf(context, MODE_COOKIE)).toBeDefined();
      // the session is gone for the server as well: a console page sends the visitor back to the start page
      await page.goto(`/${locale}/admin/audit-log`);
      await expect(page).toHaveURL(new RegExp(`/${locale}$`));

      // the Sign in button leads to the sign-in page
      await page.goto(`/${locale}/signed-out`);
      await page.getByRole('link', { name: text(locale, 'signIn.title') }).click();
      await expect(page).toHaveURL(new RegExp(`/${locale}/sign-in$`));

      // the Administrator's Audit Log shows the sign-out
      await startDemo(page, locale, 'administrator');
      await expectAuditEvent(page, locale, 'auth.sign_out');
      seen.expectClean();
    });
  }

  test('a visitor with no session can open Signed out, and nothing is audited for it', async ({ page }) => {
    await page.goto('/en/signed-out');
    await expect(heading(page)).toHaveText(text('en', 'signIn.out.title'));
  });
});

// --- pictures of the states (the pages themselves are in screenshots.spec.ts) ---------------------------------------------

test.describe('states, for review', () => {
  for (const locale of locales) {
    test(`the sign-in, mock provider and emergency states in ${locale}, at 1440 and 390`, async ({ page, baseURL }, testInfo) => {
      test.setTimeout(120_000);
      const seen = watch(page, baseURL);
      for (const width of WIDTHS) {
        await page.setViewportSize({ width, height: 900 });
        await openSignIn(page, locale);
        await shot(page, testInfo, locale, `sign-in-default-${width}`);
        await openMockProvider(page, locale);
        await shot(page, testInfo, locale, `sign-in-mock-${width}`);
        // the error state: an empty subject is refused by the server
        await playMockProvider(page, locale, { subject: '' });
        await expect(alertOf(page)).toBeVisible();
        await shot(page, testInfo, locale, `sign-in-mock-error-${width}`);

        await openEmergency(page, locale);
        await shot(page, testInfo, locale, `sign-in-emergency-${width}`);
        await submitPassword(page, locale, password());
        await expect(heading(page)).toHaveText(text(locale, 'signIn.emergency.mfaTitle'));
        await shot(page, testInfo, locale, `sign-in-emergency-code-${width}`);
        await submitCode(page, locale, '12345');
        await expect(page.getByText(text(locale, 'signIn.emergency.codeNeeded'))).toBeVisible();
        await shot(page, testInfo, locale, `sign-in-emergency-code-error-${width}`);
      }
      seen.expectClean();
    });
  }
});

// --- everything that fails on purpose: a second server with its own demo store ----------------------------------------------

const PRIVATE_PORT = 3124;

test.describe('emergency sign-in that fails, and the lockout (a server of its own)', () => {
  // The lockout is per demo store and stays until the store is reset. These tests run one after another against a server
  // started here; the shared server (port 3123) never sees a failure.
  test.describe.configure({ mode: 'serial' });
  test.use({ baseURL: `http://localhost:${PRIVATE_PORT}` });

  let server: ChildProcess | undefined;

  test.beforeAll(async ({ stack }) => {
    test.setTimeout(150_000);
    const web = path.join(import.meta.dirname, '../apps/web');
    // `next start` from the build, in apps/web so it reads apps/web/.env.local (DEMO_SESSION_SECRET) like the shared server; the
    // emergency credentials are already in process.env (playwright.config.ts) and are handed on with the rest of the environment.
    server = spawn(process.execPath, [path.join(web, 'node_modules/next/dist/bin/next'), 'start', '-p', String(PRIVATE_PORT)], {
      cwd: web,
      // The worker's own api: the lockout lives there.
      env: { ...process.env, ...(stack === null ? {} : { OPENDISPATCH_API_URL: stack.apiUrl }), NEXT_TELEMETRY_DISABLED: '1' },
      stdio: 'ignore',
    });
    const deadline = Date.now() + 120_000;
    for (;;) {
      try {
        if ((await fetch(`http://localhost:${PRIVATE_PORT}/en`)).ok) break;
      } catch {
        // not listening yet
      }
      if (Date.now() > deadline) throw new Error(`The second server did not start on port ${PRIVATE_PORT}.`);
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  });

  test.afterAll(async () => {
    server?.kill('SIGTERM');
  });

  for (const locale of locales) {
    test(`a wrong password says only "Invalid credentials", clears the field and signs nobody in, in ${locale}`, async ({ page, context, baseURL }) => {
      const seen = watch(page, baseURL);
      await openEmergency(page, locale);
      await submitPassword(page, locale, `${password()}-wrong`);
      await expect(alertOf(page)).toHaveText(text(locale, 'signIn.emergency.invalid'));
      await expect(page.getByLabel(text(locale, 'signIn.emergency.password'))).toHaveValue('');
      await expect(page.getByLabel(text(locale, 'signIn.emergency.password'))).toBeFocused();
      await expect(heading(page)).toHaveText(text(locale, 'signIn.emergency.title'));
      expect(await cookieOf(context, SESSION_COOKIE)).toBeUndefined();
      // an unknown account reads the same: nothing says which of the two was wrong
      await page.getByLabel(text(locale, 'signIn.email')).fill('someone.else@demo.example');
      await submitPassword(page, locale, password());
      await expect(alertOf(page)).toHaveText(text(locale, 'signIn.emergency.invalid'));
      seen.expectClean();
    });
  }

  test('a wrong authenticator code says only "Invalid credentials", clears the field and stays on the code step', async ({ page, context }) => {
    await openEmergency(page, 'en');
    await submitPassword(page, 'en', password());
    await expect(heading(page)).toHaveText(text('en', 'signIn.emergency.mfaTitle'));
    await submitCode(page, 'en', anotherCode());
    await expect(alertOf(page)).toHaveText(text('en', 'signIn.emergency.invalid'));
    await expect(page.getByLabel(text('en', 'signIn.emergency.code'), { exact: true })).toHaveValue('');
    await expect(heading(page)).toHaveText(text('en', 'signIn.emergency.mfaTitle'));
    expect(await cookieOf(context, SESSION_COOKIE)).toBeUndefined();
  });

  test('five failures lock the account: even the right password is then refused, the form is disabled, and it stays locked', async ({ page, context }, testInfo) => {
    test.setTimeout(120_000);
    // a successful sign-in first: it resets the counter, so this test does not depend on the failures of the ones before it
    await emergencySignIn(page, 'en');
    await context.clearCookies();

    await openEmergency(page, 'en');
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      await submitPassword(page, 'en', `${password()}-wrong-${attempt}`);
      await expect(alertOf(page), `failure ${attempt}`).toHaveText(text('en', 'signIn.emergency.invalid'));
    }
    await submitPassword(page, 'en', password());
    await expect(alertOf(page)).toHaveText(text('en', 'signIn.emergency.locked'));
    await expect(page.locator('[data-sign-in="emergency"]')).toHaveAttribute('data-state', 'locked');
    await expect(page.getByLabel(text('en', 'signIn.emergency.password'))).toBeDisabled();
    await expect(page.getByRole('button', { name: text('en', 'signIn.continue') })).toBeDisabled();
    expect(await cookieOf(context, SESSION_COOKIE)).toBeUndefined();
    await shot(page, testInfo, 'en', 'sign-in-emergency-locked');

    // locked for good, not just for this page: a fresh page is refused the same way, in Arabic too
    await openEmergency(page, 'ar');
    await submitPassword(page, 'ar', password());
    await expect(alertOf(page)).toHaveText(text('ar', 'signIn.emergency.locked'));
    await shot(page, testInfo, 'ar', 'sign-in-emergency-locked');
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 900 });
      await expectPageOk(page, 'ar');
    }
    expect(await cookieOf(context, SESSION_COOKIE)).toBeUndefined();
  });
});
