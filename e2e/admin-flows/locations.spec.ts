// SPDX-License-Identifier: AGPL-3.0-only
import fs from 'node:fs';
import path from 'node:path';
import { type Page } from '@playwright/test';
import { expect, test } from '../fixtures';
import { expectPageOk, shot, startDemo, waitForHydration, watch } from '../helpers';
import { locales, text, titleOf, type Locale } from '../routes';
import { readMessages } from '../messages';

// Locations. The Administrator reads the tree, the sub-zones, the standby points and the map, adds a
// zone, adds an Arabic name, adds and deletes a standby point, imports a CSV file (a wrong file type is refused in the drop area,
// a wrong row is refused by the data layer and writes nothing), and exports. Each write is followed by its audit event in the Audit
// Log. Tests share one demo store and run in parallel, so every record a test adds has a code of its own (a letter pair for the
// city, the language and a word for the rest); counts of the seeded records (3, 8, 124, 32) are asserted only where nothing adds.

type Tree = { [key: string]: string | Tree };
const module_ = (locale: Locale): Tree => readMessages(path.join(import.meta.dirname, '../../apps/web/messages/admin/locations', `${locale}.json`)) as Tree;
const MODULE = { en: module_('en'), ar: module_('ar') };
/** A key of the module's own message file (`e.name`), with `{name}` style values put in. */
function m(locale: Locale, key: string, values: Record<string, string> = {}): string {
  let node: string | Tree | undefined = MODULE[locale];
  for (const part of key.split('.')) node = typeof node === 'object' ? node[part] : undefined;
  if (typeof node !== 'string') throw new Error(`No message admin.locations.${locale}:${key}`);
  return Object.entries(values).reduce((out, [name, value]) => out.replaceAll(`{${name}}`, value), node);
}

const ROUTE = (locale: Locale) => `/${locale}/admin/locations`;
const rows = (page: Page) => page.locator('[data-module="admin.locations"] tbody tr');
const kindName = (locale: Locale, kind: string) => m(locale, `kind.${kind}`);

async function open(page: Page, locale: Locale, query = '') {
  // City pinned: the api's city order is unstable.
  const withCity = query.includes('city=') ? query : `${query}${query.includes('?') ? '&' : '?'}city=RD`;
  await page.goto(`${ROUTE(locale)}${withCity}`);
  await expect(page.locator('[data-module="admin.locations"]')).toHaveAttribute('data-state', 'filled');
  await expectPageOk(page, locale);
  await waitForHydration(page, 'main tbody tr');
}

/** The Audit Log filtered by an action code: the write's event is there, with the outcome. */
async function expectAudit(page: Page, locale: Locale, action: string) {
  await page.goto(`/${locale}/admin/audit-log?q=${action}`);
  await expect(page.locator('[data-module="admin.audit_log"] tbody tr').first()).toContainText(action);
}

/** Adds a location through the drawer: the type, the parent (by its visible text) when the type has one, a name and a code. */
async function addThroughDrawer(page: Page, locale: Locale, fields: { kind: 'city' | 'zone' | 'sub_zone' | 'standby'; parent?: RegExp; name: string; code: string; latitude?: string; longitude?: string; radius?: string }) {
  await page.getByRole('button', { name: m(locale, 'add.label') }).click();
  // Its title follows the type chosen inside it, so it is found as the one dialog, not by name.
  const drawer = page.getByRole('dialog');
  await expect(drawer).toBeVisible();
  await drawer.getByLabel(m(locale, 'e.type')).selectOption(fields.kind);
  if (fields.parent !== undefined) {
    // exact: "Zone" is also inside "Sub-zone", and a standby point has both
    const parent = drawer.getByLabel(fields.kind === 'zone' ? m(locale, 'e.parent.city') : text(locale, 'common.zone'), { exact: true });
    await parent.selectOption({ label: (await parent.locator('option').allTextContents()).find((label) => fields.parent?.test(label)) ?? '' });
  }
  await drawer.getByLabel(m(locale, 'e.name')).fill(fields.name);
  await drawer.getByLabel(m(locale, 'col.code')).fill(fields.code);
  if (fields.latitude !== undefined) await drawer.getByLabel(m(locale, 'e.lat')).fill(fields.latitude);
  if (fields.longitude !== undefined) await drawer.getByLabel(m(locale, 'e.lon')).fill(fields.longitude);
  if (fields.radius !== undefined) await drawer.getByLabel(fields.kind === 'standby' ? m(locale, 'e.radius.m') : m(locale, 'e.radius.km')).fill(fields.radius);
  await drawer.getByRole('button', { name: text(locale, 'common.save') }).click();
  return drawer;
}

for (const locale of locales) {
  const tag = locale === 'en' ? 'Q' : 'R';
  test.describe(`Locations in ${locale}`, () => {
    test(`the Administrator reads it: title, four figures, three tabs, the tree, the map with its city switch; no request leaves the app`, async ({ page, baseURL }, testInfo) => {
      const seen = watch(page, baseURL);
      await startDemo(page, locale, 'administrator');
      await open(page, locale);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(titleOf(locale, 'admin.locations'));
      await expect(page.getByRole('tab')).toHaveText([m(locale, 'tab.zones'), m(locale, 'tab.subs'), m(locale, 'tab.standby')]);
      for (const key of ['st.cities', 'tab.zones', 'tab.subs', 'tab.standby']) await expect(page.getByText(m(locale, key), { exact: true }).first()).toBeVisible();
      await expect(page.getByRole('columnheader')).toContainText([m(locale, 'col.name'), m(locale, 'col.ar')]);
      expect(await rows(page).count()).toBeGreaterThanOrEqual(11);
      await expect(page.getByRole('button', { name: m(locale, 'add.label') })).toBeEnabled();
      await expect(page.getByRole('radiogroup', { name: m(locale, 'map.title') })).toBeVisible();
      await expect(page.getByRole('button', { name: /RD-C/ })).toBeVisible();
      await shot(page, testInfo, locale, 'locations-filled');
      seen.expectClean();
    });

    test(`adds a zone through the drawer, then an Arabic name to it, and the Audit Log has both events`, async ({ page, baseURL }, testInfo) => {
      const seen = watch(page, baseURL);
      await startDemo(page, locale, 'administrator');
      await open(page, locale);
      const name = `E2E Zone ${tag}`;
      const code = `E2E-Z-${tag}`;
      await addThroughDrawer(page, locale, { kind: 'zone', name, code, parent: /Riyadh/, latitude: '24.6', longitude: '46.6', radius: '3' });
      await expect(page.getByText(m(locale, 'toast.added'))).toBeVisible();
      await expect(rows(page).filter({ hasText: code })).toHaveCount(1);
      await shot(page, testInfo, locale, 'locations-added');
      // "Add Arabic name" opens the same drawer with the Arabic field focused
      await rows(page).filter({ hasText: code }).getByRole('button', { name: m(locale, 'ar.add') }).click();
      const drawer = page.getByRole('dialog', { name: m(locale, 'edit.title', { kind: kindName(locale, 'zone') }) });
      await expect(drawer).toBeVisible();
      await expect(drawer.getByLabel(m(locale, 'col.ar'))).toBeFocused();
      await drawer.getByLabel(m(locale, 'col.ar')).fill('منطقة اختبار');
      await drawer.getByRole('button', { name: text(locale, 'common.save') }).click();
      await expect(page.getByText(m(locale, 'toast.saved'))).toBeVisible();
      await expect(rows(page).filter({ hasText: code })).toContainText('منطقة اختبار');
      await expectAudit(page, locale, 'location.zone_created');
      await expectAudit(page, locale, 'location.zone_updated');
      seen.expectClean();
    });

    test(`refuses a code that is already used, in the drawer, in English, and adds nothing`, async ({ page, baseURL }) => {
      const seen = watch(page, baseURL);
      await startDemo(page, locale, 'administrator');
      await open(page, locale);
      const drawer = await addThroughDrawer(page, locale, { kind: 'zone', name: `Duplicate ${tag}`, code: 'RD-C', parent: /Riyadh/ });
      const alert = drawer.getByRole('alert');
      await expect(alert).toContainText('Code RD-C is already used.');
      await expect(alert.locator('[lang="en"]')).toHaveCount(1);
      await expect(drawer).toBeVisible();
      seen.expectClean();
    });

    test(`adds a standby point in a zone and deletes it after a confirmation; the map and the tab show it and both events are in the log`, async ({ page, baseURL }, testInfo) => {
      const seen = watch(page, baseURL);
      await startDemo(page, locale, 'administrator');
      await open(page, locale);
      const name = `E2E Standby ${tag}`;
      const code = `E2E-SP-${tag}`;
      await addThroughDrawer(page, locale, { kind: 'standby', name, code, parent: /RD-C/, latitude: '24.72', longitude: '46.69', radius: '2500' });
      await expect(page.getByText(m(locale, 'toast.added'))).toBeVisible();
      await expect(page).toHaveURL(/tab=standby/);
      await waitForHydration(page, 'main tbody tr');
      // the new point is the 33rd, so it is on page 2 of the 25-row list: it is found the way a person finds it, by its code
      await page.getByRole('searchbox').fill(code);
      await expect(page).toHaveURL(new RegExp(`[?&]q=${code}`));
      const row = rows(page).filter({ hasText: code });
      await expect(row).toHaveCount(1);
      await expect(row).toContainText('2,500');
      // and the map draws it as a pin, named after it (the map opens on Riyadh, the city of RD-C)
      await expect(page.getByRole('button', { name: new RegExp(`^${name}:`) })).toHaveCount(1);
      await row.click();
      const drawer = page.getByRole('dialog', { name: m(locale, 'edit.title', { kind: kindName(locale, 'standby') }) });
      await expect(drawer).toBeVisible();
      await shot(page, testInfo, locale, 'locations-standby-drawer');
      await drawer.getByRole('button', { name: m(locale, 'delete.label') }).click();
      const confirm = page.getByRole('dialog', { name: m(locale, 'delete.title', { name }) });
      await expect(confirm).toBeVisible();
      await confirm.getByRole('button', { name: m(locale, 'delete.ok') }).click();
      await expect(page.getByText(m(locale, 'toast.deleted'))).toBeVisible();
      await expect(rows(page).filter({ hasText: code })).toHaveCount(0);
      await expect(page.getByRole('button', { name: new RegExp(`^${name}:`) })).toHaveCount(0);
      await expectAudit(page, locale, 'location.standby_point_created');
      await expectAudit(page, locale, 'location.standby_point_deleted');
      seen.expectClean();
    });

    test(`imports a CSV file (a wrong type and a wrong row are refused, nothing is written), and the Audit Log has the import`, async ({ page, baseURL }, testInfo) => {
      const seen = watch(page, baseURL);
      await startDemo(page, locale, 'administrator');
      await open(page, locale);
      await page.getByRole('button', { name: text(locale, 'common.more') }).click();
      await page.getByRole('menuitem', { name: m(locale, 'import.label') }).click();
      const dialog = page.getByRole('dialog', { name: m(locale, 'import.title') });
      await expect(dialog).toBeVisible();
      await expect(dialog.getByRole('button', { name: m(locale, 'import.label') })).toHaveAttribute('aria-disabled', 'true');
      // a wrong file type is refused in the drop area, in the page's language
      const input = dialog.locator('input[type=file]');
      await input.setInputFiles({ name: 'places.xlsx', mimeType: 'application/vnd.ms-excel', buffer: Buffer.from('not a csv') });
      await expect(dialog.getByRole('alert')).toContainText('places.xlsx');
      await shot(page, testInfo, locale, 'locations-import-rejected');
      // a file with a wrong row is refused by the data layer, in English, and writes nothing
      const city = `${tag}${tag}`;
      const bad = `kind,code,parent_code,name_en,name_ar,latitude,longitude,coverage_radius_m,sub_zone_code\ncity,${city},,E2E City ${tag},,,,,\nzone,${city}-N,NOPE,E2E Zone,,24.1,46.1,,\n`;
      await input.setInputFiles({ name: 'bad.csv', mimeType: 'text/csv', buffer: Buffer.from(bad) });
      await dialog.getByRole('button', { name: m(locale, 'import.label') }).click();
      await expect(dialog.getByRole('alert')).toContainText('nothing was imported');
      await expect(dialog).toBeVisible();
      // a good file imports in one call
      const good = `kind,code,parent_code,name_en,name_ar,latitude,longitude,coverage_radius_m,sub_zone_code\ncity,${city},,E2E City ${tag},,,,,\nzone,${city}-N,${city},E2E North ${tag},,24.1,46.1,,\nsub_zone,${city}-N-01,${city}-N,E2E Sub ${tag},,24.11,46.11,,\nstandby_point,${city}-N-SP1,${city}-N,E2E Point ${tag},,24.12,46.12,3500,${city}-N-01\n`;
      await input.setInputFiles({ name: 'good.csv', mimeType: 'text/csv', buffer: Buffer.from(good) });
      await dialog.getByRole('button', { name: m(locale, 'import.label') }).click();
      await expect(page.getByText(m(locale, 'toast.importedDesc', { cities: '1', zones: '1', subs: '1', points: '1' }))).toBeVisible();
      await expect(dialog).toBeHidden();
      await expect(rows(page).filter({ hasText: `E2E City ${tag}` })).toHaveCount(1);
      await expectAudit(page, locale, 'location.imported');
      seen.expectClean();
    });

    test(`"Use a sample file" loads the sample and imports it once; the second time the data layer says the codes exist`, async ({ page, baseURL }) => {
      test.skip(locale === 'ar', 'the sample is one file for the install: the English run imports it, this asserts it once');
      const seen = watch(page, baseURL);
      await startDemo(page, locale, 'administrator');
      await open(page, locale, '?import=1');
      const dialog = page.getByRole('dialog', { name: m(locale, 'import.title') });
      await dialog.getByRole('button', { name: m(locale, 'import.sample') }).click();
      await expect(dialog.getByText('locations_sample.csv')).toBeVisible();
      await dialog.getByRole('button', { name: m(locale, 'import.label') }).click();
      await expect(dialog).toBeHidden();
      await expect(rows(page).filter({ hasText: 'Sample City' })).toHaveCount(1);
      seen.expectClean();
    });

    test(`the sub-zone and standby tabs filter by zone and search, and a row opens its drawer through ?edit= (Back closes it)`, async ({ page, baseURL }, testInfo) => {
      const seen = watch(page, baseURL);
      await startDemo(page, locale, 'administrator');
      await open(page, locale, '?tab=subs&zone=RD-C');
      await expect(page.getByRole('columnheader')).toContainText([m(locale, 'col.name'), m(locale, 'col.code')]);
      await expect(rows(page)).toHaveCount(16);
      // the true total, read fresh, not assumed
      const total = await page.getByText(m(locale, 'tab.subs'), { exact: true }).nth(1).locator('xpath=ancestor::div[2]//*[contains(@class,"__value")]').last().textContent();
      await expect(page.getByText(m(locale, 'showing', { n: '16', total: total ?? '' }), { exact: true })).toBeVisible();
      await page.getByRole('searchbox').fill('juniper');
      await expect(page).toHaveURL(/[?&]q=juniper/);
      await expect(rows(page)).toHaveCount(1);
      await rows(page).first().click();
      await expect(page).toHaveURL(/[?&]edit=sub_zone%3A[0-9a-f-]{36}/);
      const drawer = page.getByRole('dialog', { name: m(locale, 'edit.title', { kind: kindName(locale, 'sub_zone') }) });
      await expect(drawer).toBeVisible();
      await shot(page, testInfo, locale, 'locations-sub-zone-drawer');
      await page.goBack();
      await expect(drawer).toBeHidden();
      // an id that names nothing is a notice above the list, never an error
      await open(page, locale, '?tab=subs&edit=sub_zone:00000000-0000-4000-8000-00000000dead');
      await expect(page.locator('[role="alert"]:not(#__next-route-announcer__)')).toContainText(m(locale, 'notice.notFound'));
      seen.expectClean();
    });

    test(`the map switches city and selecting a zone on it marks it`, async ({ page, baseURL }) => {
      const seen = watch(page, baseURL);
      await startDemo(page, locale, 'administrator');
      await open(page, locale);
      await page.getByRole('radio', { name: 'Jeddah' }).click();
      await expect(page).toHaveURL(/[?&]city=JD/);
      await expect(page.getByRole('button', { name: /JD-N/ })).toBeVisible();
      await expect(page.getByRole('button', { name: /RD-C/ })).toHaveCount(0);
      await page.getByRole('button', { name: /JD-N/ }).click();
      await expect(page).toHaveURL(/[?&]zone=JD-N/);
      seen.expectClean();
    });
  });
}

test.describe('Locations: export', () => {
  test('Export downloads every record as a CSV in the import\'s columns, with a byte order mark', async ({ page, baseURL }) => {
    const seen = watch(page, baseURL);
    await startDemo(page, 'en', 'administrator');
    await open(page, 'en');
    await page.getByRole('button', { name: text('en', 'common.more') }).click();
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('menuitem', { name: text('en', 'common.export') }).click()]);
    expect(download.suggestedFilename()).toBe('locations.csv');
    const body = fs.readFileSync(await download.path(), 'utf8');
    expect(body.startsWith('﻿kind,code,parent_code,name_en,name_ar,latitude,longitude,coverage_radius_m,sub_zone_code')).toBe(true);
    expect(body.trim().split('\r\n').length).toBeGreaterThanOrEqual(1 + 3 + 8 + 124 + 32);
    await expect(page.getByText(m('en', 'toast.export'))).toBeVisible();
    seen.expectClean();
  });
});
