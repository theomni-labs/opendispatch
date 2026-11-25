// SPDX-License-Identifier: AGPL-3.0-only
import { expect, test } from '@playwright/test';
import { adminUrl, expectOutcome, readFacts, rolesIn, settled, watchStrict } from './admin-helpers';
import { startDemo } from './helpers';
import { OPS_MODULES } from './ops-helpers';
import { text, type Locale, type Role } from './routes';

// Ops access matrix: 7 roles x 12 modules.

test('the model has 12 Ops modules and 7 private roles', () => {
  expect(OPS_MODULES).toHaveLength(12);
  expect(rolesIn('private')).toHaveLength(7);
});

const runs: ReadonlyArray<{ role: Role; locale: Locale }> = [
  ...rolesIn('private').map((role) => ({ role, locale: 'en' as const })),
  { role: 'planner', locale: 'ar' },
  { role: 'viewer_auditor', locale: 'ar' },
];

for (const { role, locale } of runs) {
  test(`private install, ${role}, ${locale}: all 12 Ops modules show what the model says`, async ({ page, baseURL }) => {
    test.setTimeout(180_000);
    const seen = watchStrict(page, baseURL);
    await startDemo(page, locale, role, 'private');
    for (const def of OPS_MODULES) {
      await page.goto(adminUrl(locale, def));
      await settled(page);
      expectOutcome(await readFacts(page, text(locale, 'common.goHome')), { mode: 'private', role, def, locale });
    }
    seen.expectClean();
  });
}
