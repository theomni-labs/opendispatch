// SPDX-License-Identifier: AGPL-3.0-only
import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { ADMIN_MODULES, MODES, adminUrl, cellOf, expectOutcome, frameOf, readFacts, rolesIn, settled, startDemoInZone, watchStrict, zoneScopedRoles } from './admin-helpers';
import { startDemo } from './helpers';
import { text, type Locale } from './routes';

// The access matrix, on the running app. For every install mode and every role the demo offers in it (private 7,
// dedicated 6, shared 6: Change Approver is private only), the test signs in through the demo start page ONCE and then opens all
// 17 Admin modules. What each page shows must be what the access model says for that cell (the model is imported, there is no
// second table here): no access is the no-access panel and no module content (a module-level panel where the role has some
// Admin module, one console-level panel where it has none); view access shows the "View only" badge and every header action that
// is not a menu disabled, one of them with its reason; edit access shows the content and an enabled action; the Administrator's
// Updates in a dedicated or shared install is the reduced screen (version and release notes only). Each page also carries the
// four hooks of the frame (data-module, data-state, data-access, data-reduced), exactly one h1, the right lang and dir, no
// sideways scroll, and no console error, warning or request to another origin. English for every role; Arabic for the
// Administrator in each mode. Last, the three zone-scoped roles with ONE zone chosen never see a record of another zone.

test.describe('the access model decides every Admin module page (English)', () => {
  for (const mode of MODES) {
    for (const role of rolesIn(mode)) {
      test(`${mode} install, ${role}: all 17 modules show what the model says`, async ({ page, baseURL }) => {
        test.setTimeout(180_000);
        const seen = watchStrict(page, baseURL);
        await startDemo(page, 'en', role, mode);
        for (const def of ADMIN_MODULES) {
          await page.goto(adminUrl('en', def));
          await settled(page);
          expectOutcome(await readFacts(page, text('en', 'common.goHome')), { mode, role, def, locale: 'en' });
        }
        seen.expectClean();
      });
    }
  }
});

test.describe('the same for the Administrator in Arabic', () => {
  for (const mode of MODES) {
    test(`${mode} install, administrator, Arabic: all 17 modules show what the model says`, async ({ page, baseURL }) => {
      test.setTimeout(180_000);
      const seen = watchStrict(page, baseURL);
      await startDemo(page, 'ar', 'administrator', mode);
      for (const def of ADMIN_MODULES) {
        await page.goto(adminUrl('ar', def));
        await settled(page);
        expectOutcome(await readFacts(page, text('ar', 'common.goHome')), { mode, role: 'administrator', def, locale: 'ar' });
      }
      seen.expectClean();
    });
  }
});

// Zone scope. The three zone-scoped roles (Dispatch Supervisor, Dispatcher, Planner) see only their zones. In the Admin Console
// the model gives them no access to Locations and Agents and Vehicles, so what must hold there is that NO record of any zone
// shows; if the model ever gives one of them access, the page must show the chosen zone's records and none of another zone's.
// The chosen zone is the third one of the demo, so it is not the one the start page would preselect. Zone lists in Ops are module specific.
const ZONE_MODULES = ['admin.locations', 'admin.agents_vehicles'] as const;
type Named = { name_en: string; extra: { code?: string } };
const fixture = <T>(...parts: string[]): T => JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '..', 'fixtures', ...parts), 'utf8')) as T;
const zones = fixture<Named[]>('locations', 'zones.json');
const chosen = zones[2] as Named;
const codeOf = (zone: Named): string => zone.extra.code ?? '';

test.describe('zone-scoped roles with one zone chosen', () => {
  test('the fixture has the zones this test needs', () => {
    expect(zones.length).toBeGreaterThan(3);
    for (const zone of zones) expect(codeOf(zone), `a code for ${zone.name_en}`).toMatch(/^[A-Z]{2}-[A-Z]$/);
  });

  for (const role of zoneScopedRoles('private')) {
    test(`${role} with only ${chosen.name_en} sees no record of another zone in Locations and Agents`, async ({ page, baseURL }) => {
      const locale: Locale = 'en';
      const seen = watchStrict(page, baseURL);
      await startDemoInZone(page, locale, role, 'private', chosen.name_en);
      for (const def of ADMIN_MODULES.filter((m) => (ZONE_MODULES as readonly string[]).includes(m.id))) {
        await page.goto(adminUrl(locale, def));
        await settled(page);
        const body = await page.locator('main').innerText();
        if (cellOf(role, def, 'private').access === 'none') {
          // No access: no record at all, from any zone (zone codes and agent staff codes only ever appear in data).
          for (const zone of zones) expect(body, `${role} in ${def.id}: no record of ${zone.name_en}`).not.toContain(codeOf(zone));
          expect(body, `${role} in ${def.id}: no agent staff code`).not.toContain('SVR-');
          await expect(page.getByText(text(locale, 'states.noAccess.title'), { exact: true }).first()).toBeVisible();
          await expect(frameOf(page, def).locator('table')).toHaveCount(0);
        } else {
          for (const zone of zones.filter((other) => other !== chosen)) expect(body, `${role} in ${def.id}: no record of ${zone.name_en}`).not.toContain(codeOf(zone));
          expect(body, `${role} in ${def.id}: the chosen zone's own records`).toContain(codeOf(chosen));
        }
      }
      seen.expectClean();
    });
  }
});
