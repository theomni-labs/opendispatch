// SPDX-License-Identifier: AGPL-3.0-only
import { expect, test } from '@playwright/test';
import { ADMIN_MODULES, adminUrl, frameOf, hydrated, settled, structureProblems, watchStrict } from './admin-helpers';
import { startDemo } from './helpers';
import { locales } from './routes';

// The structure of every Admin module page, in English and Arabic, at 1440 and 390 wide, as the Administrator of
// a private install. One test per module and language signs in once and looks at both widths. Each page must have:
//   - `<html lang dir data-theme="light">` right for the language (OpenDispatch is light only), and no sideways scroll;
//   - exactly one h1, and the landmarks main, banner and navigation (below 1024px the navigation is the drawer: its <nav> is in
//     the page, hidden, and the menu button is visible);
//   - the bundled font of the language really loaded (Figtree, IBM Plex Sans Arabic), checked once per test;
//   - Western digits only (no U+0660-0669 or U+06F0-06F9 outside translate="no" and the Localization page's own Arabic-Indic
//     sample), in both languages;
//   - in Arabic, no English word outside translate="no" and lang="en" subtrees, in text, aria-label, placeholder, title and alt,
//     except the tokens of LATIN_ALLOWED (admin-helpers.ts, each with its reason);
//   - an accessible name on every visible button, link and input (read from the browser's accessibility tree), and an
//     aria-label on every icon-only button;
//   - visible focus on the first three tab stops, and Tab from <main> reaching the first enabled control of the page header;
//   - no console error or warning, and no request to another origin, over the whole test.
// The checks are collected, not stopped at the first failure: a failing run lists everything wrong on the page.
// Not proved here, and why: the focus ring of a control that draws it on a sibling of a hidden input (radio, checkbox, switch)
// is not seen by a computed-style check of the focused element; the mockup comparison (headers, tabs, stats, columns) is the
// pictures of admin-screenshots.spec.ts, reviewed by a person.

const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
] as const;

for (const locale of locales) {
  for (const def of ADMIN_MODULES) {
    test(`${def.id} in ${locale}: structure at 1440 and 390`, async ({ page, baseURL }) => {
      test.setTimeout(180_000);
      const seen = watchStrict(page, baseURL);
      await startDemo(page, locale, 'administrator', 'private');
      let fonts = true;
      for (const { width, height } of VIEWPORTS) {
        await test.step(`${width}px wide`, async () => {
          await page.setViewportSize({ width, height });
          await page.goto(adminUrl(locale, def));
          await expect(frameOf(page, def)).toHaveAttribute('data-state', 'filled');
          await hydrated(page);
          await settled(page);
          expect.soft(await structureProblems(page, def, locale, width, fonts), `${def.id} in ${locale} at ${width}px`).toEqual([]);
          fonts = false;
        });
      }
      seen.expectClean();
    });
  }
}
