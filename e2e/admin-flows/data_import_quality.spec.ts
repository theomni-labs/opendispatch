// SPDX-License-Identifier: AGPL-3.0-only
import fs from 'node:fs';
import path from 'node:path';
import { type Page } from '@playwright/test';
import { expect, test } from '../fixtures';
import { expectPageOk, shot, signOutViaSwitcher, startDemo, waitForHydration, watch } from '../helpers';
import { locales, text, titleOf, type Locale } from '../routes';
import { readMessages } from '../messages';

// Data Import and Quality. The validation, comparison and cut-over run on the parsed CSV
// and the fixtures (scripted, deterministic, offline): the screen says "Demo". The Administrator reads the three fixture jobs (one
// cut over, one workable, one failed on its header), the issues, the mapping; uploads a CSV that this file builds from the mapping
// and the location fixtures (synthetic, nothing real), validates it, compares it, dry-runs it and cuts it over, then finds each step
// in the Audit Log. A file that is not a CSV is refused by the drop area and, if it got past it, by the data layer. The scripted
// partial extract shows a dry run blocked by its three errors, and an issue is ignored with a note and put back.
//
// The import state is ONE state for the whole run (a cut-over adds cases), so the writes are one serial chain, written for a fresh
// demo store. The tests before the chain only read (both languages).

type Tree = { [key: string]: string | Tree };
const module_ = (locale: Locale): Tree => readMessages(path.join(import.meta.dirname, '../../apps/web/messages/admin/data_import_quality', `${locale}.json`)) as Tree;
const MODULE = { en: module_('en'), ar: module_('ar') };
/** A key of the module's own message file (`act.compare`), with `{v}` style values put in. */
function m(locale: Locale, key: string, values: Record<string, string> = {}): string {
  let node: string | Tree | undefined = MODULE[locale];
  for (const part of key.split('.')) node = typeof node === 'object' ? node[part] : undefined;
  if (typeof node !== 'string') throw new Error(`No message admin.data_import_quality.${locale}:${key}`);
  return Object.entries(values).reduce((out, [name, value]) => out.replaceAll(`{${name}}`, value), node);
}

const ROUTE = (locale: Locale) => `/${locale}/admin/data-import-quality`;
const root = (page: Page) => page.locator('[data-module="admin.data_import_quality"]');
const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true });
const PARTIAL = 'synthetic_extract_2026-09-13_partial.csv';
const FAILED = 'synthetic_bad_header.csv';

async function open(page: Page, locale: Locale, query = '') {
  await page.goto(`${ROUTE(locale)}${query}`);
  await expect(root(page)).toHaveAttribute('data-state', 'filled');
  await expectPageOk(page, locale);
  await waitForHydration(page, '[data-module="admin.data_import_quality"] button');
}

/** The Audit Log filtered by an action code: the write's event is there. */
async function expectAudit(page: Page, locale: Locale, action: string) {
  await page.goto(`/${locale}/admin/audit-log?q=${action}`);
  await expect(page.locator('[data-module="admin.audit_log"] tbody tr').first()).toContainText(action);
}

// ---------------------------------------------------------------------------------------------------------------------
// The file this spec uploads: a CSV in the mapping's format, built from the mapping and the location fixtures.
// ---------------------------------------------------------------------------------------------------------------------
const REPO = path.join(import.meta.dirname, '../..');
const json = <T>(...parts: string[]): T => JSON.parse(fs.readFileSync(path.join(REPO, ...parts), 'utf8')) as T;
interface Named {
  id: string;
  external_id: string;
  name_en: string;
}
interface Zone extends Named {
  city_id: string;
}
interface SubZone extends Named {
  zone_id: string;
}

/** `count` valid rows. Ids carry the time of the run, so the spec can be run again on the same demo store. */
function syntheticCsv(count: number, tweak: (cells: Record<string, string>, index: number) => void = () => undefined): string {
  const mapping = json<{ columns: Array<{ default_column: string }> }>('config', 'mappings', 'generic_csv_v1.json');
  const zone = json<Zone[]>('fixtures', 'locations', 'zones.json')[0] as Zone;
  const sub = json<SubZone[]>('fixtures', 'locations', 'sub_zones.json').find((s) => s.zone_id === zone.id) as SubZone;
  const city = json<Named[]>('fixtures', 'locations', 'cities.json').find((c) => c.id === zone.city_id) as Named;
  const type = json<Named[]>('fixtures', 'reference', 'case_types.json')[0] as Named;
  const header = mapping.columns.map((c) => c.default_column);
  const stamp = String(Date.now());
  const lines = [header.join(',')];
  for (let i = 0; i < count; i += 1) {
    const cells: Record<string, string> = {
      RecordID: `E2E-${stamp}-${i}`,
      CaseNumber: `RD-260913-9${stamp.slice(-4)}${i}`,
      RegisteredTime: '2026-09-13 08:00:00',
      CityID: city.external_id,
      CityNameEn: city.name_en,
      ZoneID: zone.external_id,
      ZoneNameEn: zone.name_en,
      SubZoneID: sub.external_id,
      SubZoneNameEn: sub.name_en,
      Latitude: '24.7',
      Longitude: '46.7',
      CaseTypeID: type.external_id,
      CaseTypeNameEn: type.name_en,
      PartyCount: '2',
      AssignedTime: '2026-09-13 08:05:00',
      ArrivalTime: '',
      ClosingTime: '',
    };
    tweak(cells, i);
    lines.push(header.map((h) => cells[h] ?? '').join(','));
  }
  return `${lines.join('\n')}\n`;
}

const csv = (name: string, body: string) => ({ name, mimeType: 'text/csv', buffer: Buffer.from(body) });

for (const locale of locales) {
  test.describe(`Data Import and Quality, read only, in ${locale}`, () => {
    test(`the Administrator reads the screen: title, Upload file and More, three tabs, four figures, the newest job with Compare next, the drop area for CSV, the mapping`, async ({ page, baseURL }, testInfo) => {
      const seen = watch(page, baseURL);
      await startDemo(page, locale, 'administrator');
      await open(page, locale);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(titleOf(locale, 'admin.data_import_quality'));
      await expect(root(page).locator('[data-stub="demo"]').first()).toBeVisible();
      await expect(button(page, m(locale, 'upload'))).toBeEnabled();
      await expect(button(page, text(locale, 'common.more'))).toBeVisible();
      await expect(page.getByRole('tab')).toHaveCount(3);
      for (const key of ['stat.rows', 'stat.errors', 'stat.warnings', 'stat.held']) await expect(root(page).getByText(m(locale, key), { exact: true }).first()).toBeVisible();
      await expect(page.getByRole('heading', { name: PARTIAL })).toBeVisible();
      await expect(button(page, m(locale, 'act.compare'))).toBeEnabled();
      await expect(root(page).locator('input[type=file]')).toHaveAttribute('accept', '.csv');
      await expect(page.getByRole('heading', { name: m(locale, 'map.title') })).toBeVisible();
      await expect(root(page).getByText(m(locale, 'map.draft'), { exact: true })).toBeVisible();
      await shot(page, testInfo, locale, 'data-import-filled');
      seen.expectClean();
    });

    test(`the Jobs tab lists the three imports and a row opens that job; the failed one says its header was not read`, async ({ page, baseURL }, testInfo) => {
      const seen = watch(page, baseURL);
      await startDemo(page, locale, 'administrator');
      await open(page, locale, '?tab=jobs');
      const table = page.getByRole('table', { name: m(locale, 'tab.jobs') });
      await expect(table.locator('tbody tr')).toHaveCount(3);
      await shot(page, testInfo, locale, 'data-import-jobs');
      await table.getByRole('row').filter({ hasText: FAILED }).click();
      await expect(page).toHaveURL(/[?&]job=[0-9a-f-]{36}/);
      await expect(page.getByRole('heading', { name: FAILED })).toBeVisible();
      await expect(root(page).getByText(m(locale, 'fail.title'))).toBeVisible();
      await expect(button(page, m(locale, 'act.again'))).toBeEnabled();
      await shot(page, testInfo, locale, 'data-import-failed');
      seen.expectClean();
    });

    test(`the Issues tab lists 141 issues over the two jobs, filters by severity in the address, opens an issue in a drawer with its status choices, and shows a notice for an issue that is not there`, async ({ page, baseURL }, testInfo) => {
      const seen = watch(page, baseURL);
      await startDemo(page, locale, 'administrator');
      await open(page, locale, '?tab=issues');
      const table = page.getByRole('table', { name: m(locale, 'tab.issues') });
      await expect(table.locator('tbody tr')).toHaveCount(25);
      await expect(root(page).getByText(m(locale, 'i.sum', { n: '141', total: '141' }))).toBeVisible();
      await shot(page, testInfo, locale, 'data-import-issues');
      await open(page, locale, '?tab=issues&severity=error');
      await expect(table.locator('tbody tr').first()).toContainText(m(locale, 'sev.error'));
      await table.locator('tbody tr').first().click();
      await expect(page).toHaveURL(/[?&]issue=[0-9a-f-]{36}/);
      const drawer = page.getByRole('dialog');
      await expect(drawer.getByRole('radio')).toHaveCount(4);
      await expect(drawer.getByRole('button', { name: text(locale, 'common.save') })).toBeVisible();
      await shot(page, testInfo, locale, 'data-import-issue');
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await open(page, locale, '?tab=issues&issue=00000000-0000-4000-8000-000000000001');
      await expect(root(page).getByText(m(locale, 'notice.issueNotFound'))).toBeVisible();
      seen.expectClean();
    });

    test(`the Change Approver has no access; the review states ?state=empty, loading and error keep the header`, async ({ page, baseURL }, testInfo) => {
      const seen = watch(page, baseURL);
      await startDemo(page, locale, 'administrator');
      for (const state of ['empty', 'loading', 'error'] as const) {
        await page.goto(`${ROUTE(locale)}?state=${state}`);
        await expect(root(page)).toHaveAttribute('data-state', state);
        await expect(page.getByRole('heading', { level: 1 })).toHaveText(titleOf(locale, 'admin.data_import_quality'));
        await shot(page, testInfo, locale, `data-import-${state}`);
      }
      // The start page sends a signed-in person straight to their landing page: sign out the way a person does, then sign in again.
      await signOutViaSwitcher(page, locale);
      await startDemo(page, locale, 'change_approver');
      await page.goto(ROUTE(locale));
      await expect(root(page)).toHaveAttribute('data-state', 'noaccess');
      seen.expectClean();
    });
  });
}

test.describe.serial('Data Import and Quality, the writes', () => {
  const locale: Locale = 'en';

  test('a file that is not a CSV, and one over the limit, are refused by the drop area with the file name in the message, and nothing is uploaded', async ({ page, baseURL }, testInfo) => {
    const seen = watch(page, baseURL);
    await startDemo(page, locale, 'administrator');
    await open(page, locale);
    const jobs = await page.getByRole('tab', { name: new RegExp(`^${m(locale, 'tab.jobs')}`) }).textContent();
    const input = root(page).locator('input[type=file]');
    await input.setInputFiles({ name: 'cases.xlsx', mimeType: 'application/vnd.ms-excel', buffer: Buffer.from('not a csv') });
    await expect(root(page).getByRole('alert')).toContainText('cases.xlsx');
    await shot(page, testInfo, locale, 'data-import-wrong-type');
    await input.setInputFiles({ name: 'huge.csv', mimeType: 'text/csv', buffer: Buffer.alloc(8 * 1024 * 1024 + 1, 'a') });
    await expect(root(page).getByRole('alert')).toContainText('huge.csv');
    await shot(page, testInfo, locale, 'data-import-too-large');
    await open(page, locale);
    expect(await page.getByRole('tab', { name: new RegExp(`^${m(locale, 'tab.jobs')}`) }).textContent()).toBe(jobs);
    seen.expectClean();
  });

  test('upload, validate, compare, dry run and cut over a synthetic CSV, each step audited', async ({ page, baseURL }, testInfo) => {
    const seen = watch(page, baseURL);
    await startDemo(page, locale, 'administrator');
    await open(page, locale);
    const name = `synthetic_e2e_${Date.now()}.csv`;
    await root(page).locator('input[type=file]').setInputFiles(csv(name, syntheticCsv(2)));
    await expect(page.getByText(m(locale, 'toast.uploaded'), { exact: true })).toBeVisible();
    await expect(page).toHaveURL(/[?&]job=[0-9a-f-]{36}/);
    await expect(page.getByRole('heading', { name })).toBeVisible();
    await expect(root(page).getByText(m(locale, 'notValidated'))).toBeVisible();
    await shot(page, testInfo, locale, 'data-import-uploaded');

    await button(page, m(locale, 'act.validate')).click();
    await expect(page.getByText(m(locale, 'toast.validated.title'))).toBeVisible();
    await expect(button(page, m(locale, 'act.compare'))).toBeEnabled();
    await shot(page, testInfo, locale, 'data-import-validated');

    await button(page, m(locale, 'act.compare')).click();
    await expect(page.getByText(m(locale, 'toast.compared.title'))).toBeVisible();
    await expect(root(page).getByText(m(locale, 'cmp.before'), { exact: true })).toBeVisible();
    await expect(root(page).getByText(m(locale, 'cmp.after'), { exact: true })).toBeVisible();
    await shot(page, testInfo, locale, 'data-import-compared');

    await button(page, m(locale, 'act.dryrun')).click();
    // toast.dry and dry.passed are the same English sentence, so the toast must be told apart by its region, not its text.
    await expect(page.getByRole('region', { name: text(locale, 'ds.toast.region') }).getByText(m(locale, 'toast.dry'), { exact: true })).toBeVisible();
    await expect(root(page).getByText(m(locale, 'dry.passed'), { exact: true }).first()).toBeVisible();
    await shot(page, testInfo, locale, 'data-import-dry-run');

    await button(page, m(locale, 'act.cutover')).click();
    await expect(page.getByText(m(locale, 'toast.cut'))).toBeVisible();
    await expect(root(page).getByText(m(locale, 'cut.body', { add: '2', upd: '0' }))).toBeVisible();
    await expect(button(page, m(locale, 'act.done'))).toHaveAttribute('aria-disabled', 'true');
    await shot(page, testInfo, locale, 'data-import-cut-over');

    for (const code of ['import.uploaded', 'import.validated', 'import.compared', 'import.dry_run', 'import.cut_over']) await expectAudit(page, locale, code);
    // The new job heads the Jobs tab, cut over.
    await open(page, locale, '?tab=jobs');
    const first = page.getByRole('table', { name: m(locale, 'tab.jobs') }).locator('tbody tr').first();
    await expect(first).toContainText(name);
    await expect(first).toContainText(m(locale, 'status.cut_over'));
    seen.expectClean();
  });

  test('a file with a row that points at nothing is validated with an error, the dry run is blocked, and the error is ignored with a note from the Issues tab', async ({ page, baseURL }, testInfo) => {
    const seen = watch(page, baseURL);
    await startDemo(page, locale, 'administrator');
    await open(page, locale);
    const name = `synthetic_e2e_bad_${Date.now()}.csv`;
    await root(page).locator('input[type=file]').setInputFiles(csv(name, syntheticCsv(2, (cells, i) => {
      if (i === 1) cells['ZoneID'] = '999999';
    })));
    await expect(page.getByText(m(locale, 'toast.uploaded'), { exact: true })).toBeVisible();
    await button(page, m(locale, 'act.validate')).click();
    await expect(page.getByText(m(locale, 'toast.validated.title'))).toBeVisible();
    await button(page, m(locale, 'act.compare')).click();
    await expect(page.getByText(m(locale, 'toast.compared.title'))).toBeVisible();
    await button(page, m(locale, 'act.dryrun')).click();
    await expect(root(page).getByText(m(locale, 'dry.blocked'))).toBeVisible();
    await expect(root(page).getByText(locale === 'en' ? '1 error must be resolved or ignored first.' : 'يجب حل أو تجاهل خطأ واحد أولًا.').first()).toBeVisible();
    await shot(page, testInfo, locale, 'data-import-blocked');

    // "View issues" opens the Issues tab on this job's errors; the one issue is ignored with a note.
    await root(page).getByRole('button', { name: m(locale, 'viewIssues') }).first().click();
    await expect(page).toHaveURL(/tab=issues/);
    const table = page.getByRole('table', { name: m(locale, 'tab.issues') });
    await expect(table.locator('tbody tr').first()).toContainText(m(locale, 'type.unknown_reference'));
    await table.locator('tbody tr').first().click();
    const drawer = page.getByRole('dialog');
    await drawer.getByRole('radio', { name: m(locale, 'st.ignored') }).click();
    await drawer.getByRole('textbox').fill('E2E: the zone is not in this install.');
    await drawer.getByRole('button', { name: text(locale, 'common.save') }).click();
    await expect(page.getByText(m(locale, 'toast.issue', { status: m(locale, 'st.ignored') }))).toBeVisible();
    await expectAudit(page, locale, 'data_quality.issue_updated');
    seen.expectClean();
  });

  test('the scripted partial extract: compare, then a dry run blocked by its three errors, "View issues" filters them; one is ignored with a note and put back to Open', async ({ page, baseURL }, testInfo) => {
    const seen = watch(page, baseURL);
    await startDemo(page, locale, 'administrator');
    await open(page, locale, '?tab=jobs');
    await page.getByRole('table', { name: m(locale, 'tab.jobs') }).getByRole('row').filter({ hasText: PARTIAL }).click();
    await expect(page.getByRole('heading', { name: PARTIAL })).toBeVisible();
    await waitForHydration(page, '[data-module="admin.data_import_quality"] button');
    await button(page, m(locale, 'act.compare')).click();
    await expect(page.getByText(m(locale, 'toast.compared.title'))).toBeVisible();
    await button(page, m(locale, 'act.dryrun')).click();
    await expect(root(page).getByText(m(locale, 'dry.blocked'))).toBeVisible();
    await expect(root(page).getByText(locale === 'en' ? '3 errors must be resolved or ignored first.' : 'يجب حل أو تجاهل 3 أخطاء أولًا.').first()).toBeVisible();
    await shot(page, testInfo, locale, 'data-import-partial-blocked');
    await root(page).getByRole('button', { name: m(locale, 'viewIssues') }).first().click();
    const table = page.getByRole('table', { name: m(locale, 'tab.issues') });
    await expect(table.locator('tbody tr')).toHaveCount(3);
    await table.locator('tbody tr').first().click();
    const drawer = page.getByRole('dialog');
    await drawer.getByRole('radio', { name: m(locale, 'st.ignored') }).click();
    await drawer.getByRole('textbox').fill('E2E: known bad row.');
    await drawer.getByRole('button', { name: text(locale, 'common.save') }).click();
    await expect(page.getByText(m(locale, 'toast.issue', { status: m(locale, 'st.ignored') }))).toBeVisible();
    // Put it back: it is Open again.
    await open(page, locale, `?tab=issues&job=${new URL(page.url()).searchParams.get('job') ?? ''}&severity=error&status=ignored`);
    await table.locator('tbody tr').first().click();
    await page.getByRole('dialog').getByRole('radio', { name: m(locale, 'st.open') }).click();
    await page.getByRole('dialog').getByRole('button', { name: text(locale, 'common.save') }).click();
    await expect(page.getByText(m(locale, 'toast.issue', { status: m(locale, 'st.open') }))).toBeVisible();
    seen.expectClean();
  });

  test('Arabic: the Jobs tab and the newest job read in Arabic after the writes', async ({ page, baseURL }, testInfo) => {
    const seen = watch(page, baseURL);
    await startDemo(page, 'ar', 'administrator');
    await open(page, 'ar', '?tab=jobs');
    const table = page.getByRole('table', { name: m('ar', 'tab.jobs') });
    // PARTIAL by name, not "the newest row": its dry run is blocked, so it stays "compared", never cut over.
    await expect(table.locator('tbody tr').filter({ hasText: PARTIAL })).toContainText(m('ar', 'status.compared'));
    await shot(page, testInfo, 'ar', 'data-import-jobs-after');
    seen.expectClean();
  });
});
