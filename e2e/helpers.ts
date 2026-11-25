// SPDX-License-Identifier: AGPL-3.0-only
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { text, type Console, type InstallMode, type Locale, type Role } from './routes';

/** Watches a page: requests to anything but the app itself, and script errors. Call `expectClean()` at the end of a test. */
export function watch(page: Page, baseURL: string | undefined, options: { allowNotFound?: boolean } = {}) {
  const external: string[] = [];
  const problems: string[] = [];
  page.on('request', (request) => {
    const url = request.url();
    if (!url.startsWith(baseURL ?? '') && !url.startsWith('data:') && !url.startsWith('blob:')) external.push(url);
  });
  page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    // A browser-reported 404 for a missing favicon is not a page error.
    const text = message.text();
    if (message.type() !== 'error' || text.includes('favicon')) return;
    // Opening a page that is meant to be a 404 makes the browser log the status. That is the page under test.
    if (options.allowNotFound === true && text.includes('status of 404')) return;
    problems.push(`console: ${text}`);
  });
  return {
    expectClean() {
      expect(external, 'requests that left the app (fonts and assets must be bundled)').toEqual([]);
      expect(problems, 'script or console errors').toEqual([]);
    },
  };
}

/** lang and dir come from the server on the first paint; the page never scrolls sideways. */
export async function expectPageOk(page: Page, locale: Locale) {
  await expect(page.locator('html')).toHaveAttribute('lang', locale);
  await expect(page.locator('html')).toHaveAttribute('dir', locale === 'ar' ? 'rtl' : 'ltr');
  await page.evaluate(() => document.fonts.ready);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, `horizontal overflow in px on ${page.url()}`).toBeLessThanOrEqual(0);
}

/**
 * The bundled fonts are really in use, not a system fallback. `document.fonts.check` is no proof: it answers true for a
 * family the page never declared, and for a weight the page never asked for. So this reads the font faces themselves: the
 * page's text is set in the language's family, at least one face of it is loaded (for Arabic: one for the Arabic script and one
 * for the Latin letters and Western digits inside Arabic text, the `latin` subset of, and no font file failed to load.
 */
export async function expectFontsLoaded(page: Page, locale: Locale) {
  // A face loads the first time text needs it, so a late-drawn part of the page can still be waiting: retry for a moment.
  await expect(async () => {
    await page.evaluate(() => document.fonts.ready);
    const fonts = await page.evaluate(() => ({
      faces: [...document.fonts].map((face) => ({ family: face.family.replaceAll('"', ''), status: face.status, range: face.unicodeRange })),
      body: getComputedStyle(document.body).fontFamily,
    }));
    expect(
      fonts.faces.filter((face) => face.status === 'error'),
      `font files that failed to load on ${page.url()}`,
    ).toEqual([]);
    const loaded = (family: string) => fonts.faces.filter((face) => face.family === family && face.status === 'loaded');
    if (locale === 'en') {
      expect(fonts.body, 'font of the page text').toMatch(/^"?Figtree"?,/);
      expect(loaded('Figtree').length, `Figtree faces loaded on ${page.url()}`).toBeGreaterThan(0);
    } else {
      expect(fonts.body, 'font of the page text').toMatch(/^"?IBM Plex Sans Arabic"?,/);
      const plex = loaded('IBM Plex Sans Arabic');
      // The browser writes a face's unicode-range in its short form: the Arabic subset starts at U+600, the Latin subset at U+0.
      expect(plex.some((face) => face.range.includes('U+600-6FF')), 'the Arabic subset of IBM Plex Sans Arabic is loaded').toBe(true);
      expect(plex.some((face) => face.range.startsWith('U+0-FF')), 'the Latin subset of IBM Plex Sans Arabic is loaded').toBe(true);
    }
  }).toPass({ timeout: 10_000 });
}

/**
 * Waits until slide-in and fade animations have finished (the skeleton's endless pulse is left alone), so a screenshot or a
 * measurement sees the settled page, not a frame in the middle of a transition. It waits on the animations themselves, not
 * on a timer.
 */
export async function settle(page: Page) {
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity)
        .map((animation) => animation.finished.catch(() => undefined)),
    ),
  );
}

export async function shot(page: Page, testInfo: TestInfo, locale: Locale, name: string, options: { fullPage?: boolean } = {}) {
  // Only a loading shot may show a skeleton.
  if (!name.includes('loading')) await page.waitForFunction(() => document.querySelector('[data-skeleton], [data-state="loading"]') === null, undefined, { timeout: 30_000 });
  await settle(page);
  await page.screenshot({ path: `e2e-output/screenshots/${testInfo.project.name}-${locale}-${name}.png`, fullPage: options.fullPage ?? true });
}

/**
 * Waits until React has taken over the element that matches `selector` (server-rendered markup answers clicks with nothing,
 * or, for a form, with a plain page reload). React marks the DOM nodes it manages, so their presence means the handlers are
 * attached. Call it before the first click on a freshly loaded page.
 */
export async function waitForHydration(page: Page, selector: string) {
  await page.waitForFunction((css) => {
    const element = document.querySelector(css);
    return element !== null && Object.keys(element).some((key) => key.startsWith('__reactProps$'));
  }, selector);
}

/**
 * Signs in through the demo start page, the way a person does: pick the install mode, pick the role, press Start.
 * Resolves when the landing page has loaded and its shell is interactive. Zones stay at the start page's default (the first two).
 */
export async function startDemo(page: Page, locale: Locale, role: Role, installMode: InstallMode = 'private') {
  // A named step, so the JSON report shows what signing in costs.
  await test.step('sign-in', async () => {
    await page.context().clearCookies();
    await page.goto(`/${locale}`);
    await waitForHydration(page, 'form');
    await page.locator(`input[type=radio][value="${installMode}"]`).check();
    await page.locator(`input[type=radio][value="${role}"]`).check();
    await page.locator('form button[type=submit]').click();
    await page.waitForURL(new RegExp(`/${locale}/(ops|admin)/`));
    await waitForHydration(page, '[data-shell="topbar"] button');
  });
}

/** Like startDemo, plus checks extra zone boxes too. */
export async function startDemoInZones(page: Page, locale: Locale, role: Role, extraZoneNames: readonly string[], installMode: InstallMode = 'private') {
  await test.step('sign-in', async () => {
    await page.goto(`/${locale}`);
    await waitForHydration(page, 'form');
    await page.locator(`input[type=radio][value="${installMode}"]`).check();
    await page.locator(`input[type=radio][value="${role}"]`).check();
    for (const name of extraZoneNames) await page.getByRole('checkbox', { name }).check();
    await page.locator('form button[type=submit]').click();
    await page.waitForURL(new RegExp(`/${locale}/(ops|admin)/`));
    await waitForHydration(page, '[data-shell="topbar"] button');
  });
}

/**
 * Signs out the way a person does: opens the Demo pop-over in the top bar and presses Sign out. Resolves on the Signed out
 * page.
 */
export async function signOutViaSwitcher(page: Page, locale: Locale) {
  await page.locator('[data-demo-switcher="trigger"]').click();
  await page.locator('[data-demo-switcher="panel"]').getByRole('button', { name: text(locale, 'common.signOut') }).click();
  await page.waitForURL(new RegExp(`/${locale}/signed-out$`));
}

// --- the rail, as the design system's RailShell draws it (hooks in components/shells/ConsoleShell.tsx) ----------------------

/** One console's menu as listed in its fly-out: the section headings and the links under each. */
export type MenuGroups = Array<{ label: string; items: Array<{ label: string; href: string }> }>;

/** The consoles the rail offers, one button each, in order. Below 1024px CSS hides the rail but the DOM keeps it, so this still answers. */
export async function railConsoles(page: Page): Promise<string[]> {
  return page.locator('[data-shell="rail"] [data-shell-group]').evaluateAll((groups) => groups.map((group) => group.getAttribute('data-shell-group') ?? ''));
}

/**
 * What one console's fly-out lists: the headings and the links (label and href) under them. It reads the DOM, so a closed
 * fly-out (`hidden`) counts, and the check does not depend on the pointer. A console the role cannot open is an empty menu.
 */
export async function railMenu(page: Page, consoleId: Console): Promise<MenuGroups> {
  const flyout = page.locator(`[data-shell="rail"] [data-shell-flyout="${consoleId}"]`);
  if ((await flyout.count()) === 0) return [];
  return flyout.evaluate((element) =>
    // The fly-out's first child is its title; every other child is a run of links under a heading (a div holding a list).
    [...element.children]
      .filter((section) => section.querySelector('ul') !== null)
      .map((section) => ({
        label: (section.querySelector(':scope > div[id]')?.textContent ?? '').trim(),
        items: [...section.querySelectorAll('a[data-shell-item]')].map((link) => ({
          label: (link.textContent ?? '').trim(),
          href: link.getAttribute('href') ?? '',
        })),
      })),
  );
}

/** Every module link in the rail (fly-outs included, open or not), by module id. */
export const railItems = (page: Page) => page.locator('[data-shell="rail"] [data-shell-item]');

/** Opens a console's fly-out with a click on its rail button and waits until it shows. */
export async function openRailGroup(page: Page, consoleId: Console) {
  await page.locator(`[data-shell="rail"] [data-shell-trigger="${consoleId}"]`).click();
  await expect(page.locator(`[data-shell="rail"] [data-shell-flyout="${consoleId}"]`)).toBeVisible();
}
