// SPDX-License-Identifier: AGPL-3.0-only
import fs from 'node:fs';
import path from 'node:path';
import { type Page, type Route, type TestInfo } from '@playwright/test';
import { expect, test } from './fixtures';
import { expectPageOk, shot, startDemo, waitForHydration, watch } from '../helpers';
import { type Locale } from '../routes';
import { messages, statValue } from './support';

// Flow 5, large file: parts, progress, retry.

const DQ = messages('admin/data_import_quality');
const root = (page: Page) => page.locator('[data-module="admin.data_import_quality"]');
const CHUNKS = '**/api/import-uploads/*/chunks/*';

// SYNTHETIC rows, generated here; about 30 MB
const REPO = path.join(import.meta.dirname, '../..');
const json = <T,>(...parts: string[]): T => JSON.parse(fs.readFileSync(path.join(REPO, ...parts), 'utf8')) as T;
interface Ref {
  readonly id: string;
  readonly external_id: string;
  readonly name_en: string;
  readonly city_id?: string;
  readonly zone_id?: string;
  readonly latitude?: number;
  readonly longitude?: number;
}

function syntheticFile(testInfo: TestInfo, locale: Locale, rows: number): string {
  const header = json<{ columns: Array<{ default_column: string }> }>('config', 'mappings', 'generic_csv_v1.json').columns.map((c) => c.default_column);
  const zone = json<Ref[]>('fixtures', 'locations', 'zones.json')[0] as Ref;
  const sub = json<Ref[]>('fixtures', 'locations', 'sub_zones.json').find((s) => s.zone_id === zone.id) as Ref;
  const city = json<Ref[]>('fixtures', 'locations', 'cities.json').find((c) => c.id === zone.city_id) as Ref;
  const type = json<Ref[]>('fixtures', 'reference', 'case_types.json')[0] as Ref;
  const stamp = `${locale}${String(Date.now()).slice(-6)}`;
  const lines = [header.join(',')];
  for (let i = 0; i < rows; i += 1) {
    const cells: Record<string, string> = {
      RecordID: `E2EL-${stamp}-${String(i)}`,
      CaseNumber: `RD-260914-${stamp}${String(i).padStart(6, '0')}`,
      RegisteredTime: `2026-09-${String(1 + (i % 28)).padStart(2, '0')} 08:00:00`,
      CityID: city.external_id,
      CityNameEn: city.name_en,
      ZoneID: zone.external_id,
      ZoneNameEn: zone.name_en,
      SubZoneID: sub.external_id,
      SubZoneNameEn: sub.name_en,
      Latitude: String(sub.latitude),
      Longitude: String(sub.longitude),
      CaseTypeID: type.external_id,
      CaseTypeNameEn: type.name_en,
      PartyCount: '2',
      AssignedTime: '',
      ArrivalTime: '',
      ClosingTime: '',
    };
    lines.push(header.map((h) => cells[h] ?? '').join(','));
  }
  const file = testInfo.outputPath(`synthetic_e2e_large_${locale}.csv`);
  fs.writeFileSync(file, `${lines.join('\n')}\n`);
  return file;
}

async function open(page: Page, locale: Locale, query = '') {
  await page.goto(`/${locale}/admin/data-import-quality${query}`);
  await expect(root(page)).toHaveAttribute('data-state', 'filled');
  await waitForHydration(page, '[data-module="admin.data_import_quality"] button');
}

async function run(page: Page, testInfo: TestInfo, baseURL: string | undefined, locale: Locale) {
  const rows = 160_000;
  const file = syntheticFile(testInfo, locale, rows);
  const size = fs.statSync(file).size;
  expect(size).toBeGreaterThan(24 * 2 ** 20);
  await startDemo(page, locale, 'administrator');
  await open(page, locale);

  // Part 1 waits for the shot; part 2 fails once.
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => (release = resolve));
  let failed = false;
  await page.route(CHUNKS, async (route: Route) => {
    const index = Number(new URL(route.request().url()).pathname.split('/').pop());
    if (index === 1) await held;
    if (index === 2 && !failed) {
      failed = true;
      await route.abort('connectionreset');
      return;
    }
    await route.continue();
  });
  await root(page).locator('input[type=file]').setInputFiles(file);

  const bar = root(page).getByRole('progressbar');
  await expect(bar).toHaveAttribute('aria-valuenow', String(8 * 2 ** 20));
  await expect(bar).toHaveAttribute('aria-valuemax', String(size));
  await expect(root(page).getByRole('button', { name: DQ(locale, 'up.cancel'), exact: true })).toBeVisible();
  await shot(page, testInfo, locale, 'flow5-large-uploading', { fullPage: false });
  release();

  await expect(root(page).getByText(DQ(locale, 'up.failed'), { exact: true })).toBeVisible();
  const parts = Math.ceil(size / (8 * 2 ** 20));
  await expect(root(page).getByText(DQ(locale, 'up.failedBody', { part: '3', parts: String(parts) }), { exact: false })).toBeVisible();
  await shot(page, testInfo, locale, 'flow5-large-stopped', { fullPage: false });
  // the dropped part logs a console error
  const seen = watch(page, baseURL);
  await root(page).getByRole('button', { name: DQ(locale, 'up.retry'), exact: true }).click();

  await expect(page.getByText(DQ(locale, 'toast.uploaded'), { exact: true })).toBeVisible({ timeout: 60_000 });
  await expect(page).toHaveURL(/[?&]job=[0-9a-f-]{36}/);
  const jobId = new URL(page.url()).searchParams.get('job') ?? '';
  await page.unroute(CHUNKS);
  await expect(page.getByRole('heading', { name: path.basename(file) })).toBeVisible();

  await root(page).getByRole('button', { name: DQ(locale, 'act.validate'), exact: true }).click();
  await expect(root(page).getByText(DQ(locale, 'run.title', { step: DQ(locale, 'step.validate') }), { exact: true })).toBeVisible();
  await shot(page, testInfo, locale, 'flow5-large-validating', { fullPage: false });
  await expect(page.getByText(DQ(locale, 'toast.validated.title'))).toBeVisible({ timeout: 60_000 });
  await open(page, locale, `?job=${jobId}`);
  expect(await statValue(root(page), DQ(locale, 'stat.rows'))).toBe(rows);
  expect(await statValue(root(page), DQ(locale, 'stat.errors'))).toBe(0);
  await expectPageOk(page, locale);
  seen.expectClean();
}

test.setTimeout(240_000);

test.describe('English', () => {
  test('flow 5, large file: a 30 MB synthetic CSV goes in 8 MB parts with progress, survives a dropped part, and validates', async ({ page, baseURL }, testInfo) => {
    await run(page, testInfo, baseURL, 'en');
  });
});

test.describe('Arabic', () => {
  test('flow 5, large file: the same in Arabic', async ({ page, baseURL }, testInfo) => {
    await run(page, testInfo, baseURL, 'ar');
  });
});
