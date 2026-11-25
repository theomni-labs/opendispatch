// SPDX-License-Identifier: AGPL-3.0-only
import fs from 'node:fs';
import path from 'node:path';
import { type Page, type TestInfo } from '@playwright/test';
import { expect, test } from './fixtures';
import { expectPageOk, shot, startDemo, waitForHydration, watch } from '../helpers';
import { text, type Locale } from '../routes';
import { messages, pattern, statValue } from './support';

// Flow 5: The customer data import, audited.

const DQ = messages('admin/data_import_quality');
const ROUTE = (locale: Locale, query = '') => `/${locale}/admin/data-import-quality${query}`;
const root = (page: Page) => page.locator('[data-module="admin.data_import_quality"]');
const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true });
const toasts = (page: Page, locale: Locale) => page.getByRole('region', { name: text(locale, 'ds.toast.region') });

// Synthetic rows, never real data.
const REPO = path.join(import.meta.dirname, '../..');
const json = <T,>(...parts: string[]): T => JSON.parse(fs.readFileSync(path.join(REPO, ...parts), 'utf8')) as T;
interface Named {
  readonly id: string;
  readonly external_id: string;
  readonly name_en: string;
}
interface Zone extends Named {
  readonly city_id: string;
}
interface SubZone extends Named {
  readonly zone_id: string;
  readonly latitude: number;
  readonly longitude: number;
}

// Lines: good 2-4, bad 5-8, 0 parties 9-110.
const GOOD = 3;
const NO_PARTIES = 102;
const ROWS = GOOD + 4 + NO_PARTIES;
const ADDED = GOOD + 1 + NO_PARTIES;
const SKIPPED = 3;
const UNKNOWN_SUB_ZONE = '99999';

interface Upload {
  readonly csv: string;
  readonly firstId: string;
}

function customerCsv(locale: Locale): Upload {
  const mapping = json<{ columns: Array<{ default_column: string }> }>('config', 'mappings', 'generic_csv_v1.json');
  const zone = json<Zone[]>('fixtures', 'locations', 'zones.json')[0] as Zone;
  const sub = json<SubZone[]>('fixtures', 'locations', 'sub_zones.json').find((s) => s.zone_id === zone.id) as SubZone;
  const city = json<Named[]>('fixtures', 'locations', 'cities.json').find((c) => c.id === zone.city_id) as Named;
  const type = json<Named[]>('fixtures', 'reference', 'case_types.json')[0] as Named;
  const header = mapping.columns.map((c) => c.default_column);
  const stamp = `${locale}${String(Date.now()).slice(-6)}`;
  const id = (i: number) => `E2E-${stamp}-${String(i)}`;
  const lines = [header.join(',')];
  for (let i = 0; i < ROWS; i += 1) {
    const cells: Record<string, string> = {
      RecordID: id(i),
      CaseNumber: `RD-260913-${stamp}${String(i).padStart(3, '0')}`,
      RegisteredTime: '2026-09-13 08:00:00',
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
      AssignedTime: '2026-09-13 08:05:00',
      ArrivalTime: '',
      ClosingTime: '',
    };
    if (i === GOOD) cells['SubZoneID'] = UNKNOWN_SUB_ZONE;
    if (i === GOOD + 1) cells['Latitude'] = '247.0';
    if (i === GOOD + 2) cells['AssignedTime'] = '2026-09-13 07:56:00';
    if (i === GOOD + 3) cells['RecordID'] = id(0);
    if (i >= GOOD + 4) cells['PartyCount'] = '0';
    lines.push(header.map((h) => cells[h] ?? '').join(','));
  }
  return { csv: `${lines.join('\n')}\n`, firstId: id(0) };
}

async function open(page: Page, locale: Locale, query = '') {
  await page.goto(ROUTE(locale, query));
  await expect(root(page)).toHaveAttribute('data-state', 'filled');
  await waitForHydration(page, '[data-module="admin.data_import_quality"] button');
}

const issueTable = (page: Page, locale: Locale) => page.getByRole('table', { name: DQ(locale, 'tab.issues') });

// The issues of this job matching `query`.
async function issues(page: Page, locale: Locale, jobId: string, query: string): Promise<number> {
  await open(page, locale, `?tab=issues&job=${jobId}&${query}`);
  // anchored: Arabic latitude also contains 'عرض'
  const sum = root(page).getByText(new RegExp(`^${pattern(DQ(locale, 'i.sum')).source}$`));
  await expect(sum).toBeVisible();
  const raw = ((await sum.textContent()) ?? '').replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));
  return Number(pattern(DQ(locale, 'i.sum')).exec(raw)?.[1]);
}

// One issue of a kind, its row and message.
async function expectOne(page: Page, locale: Locale, jobId: string, type: string, row: number, message: string) {
  expect(await issues(page, locale, jobId, `type=${type}`), `${type} issues`).toBe(1);
  const only = issueTable(page, locale).locator('tbody tr');
  await expect(only).toHaveCount(1);
  await expect(only).toContainText(DQ(locale, `type.${type}`));
  await expect(only).toContainText(message);
  await expect(only.locator('bdi').filter({ hasText: new RegExp(`^${String(row)}$`) })).toHaveCount(1);
}

async function ignoreOpenErrors(page: Page, locale: Locale, jobId: string, count: number) {
  for (let left = count; left > 0; left -= 1) {
    expect(await issues(page, locale, jobId, 'severity=error&status=open')).toBe(left);
    await issueTable(page, locale).locator('tbody tr').first().click();
    const drawer = page.getByRole('dialog');
    await drawer.getByRole('radio', { name: DQ(locale, 'st.ignored') }).click();
    await drawer.getByRole('textbox').fill('E2E: this row stays out.');
    await drawer.getByRole('button', { name: text(locale, 'common.save') }).click();
    await expect(page.getByText(DQ(locale, 'toast.issue', { status: DQ(locale, 'st.ignored') }))).toBeVisible();
  }
  expect(await issues(page, locale, jobId, 'severity=error&status=ignored')).toBe(count);
}

async function runFlow(page: Page, testInfo: TestInfo, baseURL: string | undefined, locale: Locale, recordShots: boolean) {
  const seen = watch(page, baseURL);
  await startDemo(page, locale, 'administrator');
  await open(page, locale);
  const held = await statValue(root(page), DQ(locale, 'stat.held'));

  // A customer-format CSV with bad rows.
  const name = `synthetic_e2e_flow5_${locale}_${String(Date.now())}.csv`;
  const upload = customerCsv(locale);
  await root(page).locator('input[type=file]').setInputFiles({ name, mimeType: 'text/csv', buffer: Buffer.from(upload.csv) });
  await expect(page.getByText(DQ(locale, 'toast.uploaded'), { exact: true })).toBeVisible();
  await expect(page).toHaveURL(/[?&]job=[0-9a-f-]{36}/);
  const jobId = new URL(page.url()).searchParams.get('job') ?? '';
  await expect(page.getByRole('heading', { name })).toBeVisible();
  if (recordShots) await shot(page, testInfo, locale, 'flow5-uploaded');

  await button(page, DQ(locale, 'act.validate')).click();
  await expect(page.getByText(DQ(locale, 'toast.validated.title'))).toBeVisible();
  await open(page, locale, `?job=${jobId}`);
  expect(await statValue(root(page), DQ(locale, 'stat.rows'))).toBe(ROWS);
  expect(await statValue(root(page), DQ(locale, 'stat.errors'))).toBe(2);
  expect(await statValue(root(page), DQ(locale, 'stat.warnings'))).toBe(2 + NO_PARTIES);

  // Each kind: its count, its row, its message.
  expect(await issues(page, locale, jobId, 'severity=error')).toBe(2);
  await expectOne(page, locale, jobId, 'unknown_reference', GOOD + 2, DQ(locale, 'imsg.unknownRef', { col: 'SubZoneID', value: String(UNKNOWN_SUB_ZONE) }));
  await expectOne(page, locale, jobId, 'out_of_range_coordinate', GOOD + 3, DQ(locale, 'imsg.outside', { col: 'Latitude', value: '247.0', min: '-90', max: '90' }));
  await expectOne(page, locale, jobId, 'assigned_before_registered', GOOD + 4, DQ(locale, 'imsg.assignedBefore', { n: 4 }));
  await expectOne(page, locale, jobId, 'duplicate_external_id', GOOD + 5, DQ(locale, 'imsg.duplicate', { idCol: 'RecordID', value: upload.firstId, row: '2' }));
  // 100 listed per kind, then one summary line.
  expect(await issues(page, locale, jobId, 'type=unusual_parties_count'), 'listed 0-party issues').toBe(101);
  await expect(issueTable(page, locale).locator('tbody tr').filter({ hasText: DQ(locale, 'imsg.parties', { n: 0 }) }).first()).toBeVisible();
  expect(await issues(page, locale, jobId, 'type=unusual_parties_count&q=rows+in+all')).toBe(1);
  await expect(issueTable(page, locale).locator('tbody tr')).toContainText(DQ(locale, 'imsg.cappedLike', { n: String(NO_PARTIES), row: String(GOOD + 6), inner: DQ(locale, 'imsg.parties', { n: 0 }).replace(/\.$/, ''), max: '100' }));
  if (recordShots) await shot(page, testInfo, locale, 'flow5-issues');

  await open(page, locale, `?job=${jobId}`);
  await button(page, DQ(locale, 'act.compare')).click();
  await expect(page.getByText(DQ(locale, 'toast.compared.title'))).toBeVisible();
  await expect(root(page).getByText(DQ(locale, 'cmp.after'), { exact: true })).toBeVisible();
  if (recordShots) await shot(page, testInfo, locale, 'flow5-compared');

  // The open errors block the cut-over.
  await button(page, DQ(locale, 'act.dryrun')).click();
  await expect(root(page).getByText(DQ(locale, 'dry.blocked'), { exact: true })).toBeVisible();
  await ignoreOpenErrors(page, locale, jobId, 2);

  await open(page, locale, `?job=${jobId}`);
  await button(page, DQ(locale, 'act.dryrun')).click();
  await expect(toasts(page, locale).getByText(DQ(locale, 'toast.dry'), { exact: true })).toBeVisible();
  await expect(root(page).getByText(DQ(locale, 'dry.passedBody', { add: String(ADDED), upd: '0', skip: String(SKIPPED) }))).toBeVisible();
  if (recordShots) await shot(page, testInfo, locale, 'flow5-dry-run');

  await button(page, DQ(locale, 'act.cutover')).click();
  await expect(toasts(page, locale).getByText(DQ(locale, 'toast.cut'), { exact: true })).toBeVisible();
  await expect(root(page).getByText(DQ(locale, 'cut.body', { add: String(ADDED), upd: '0' }))).toBeVisible();
  await open(page, locale, `?job=${jobId}`);
  expect(await statValue(root(page), DQ(locale, 'stat.held'))).toBe(held + ADDED);
  if (recordShots) await shot(page, testInfo, locale, 'flow5-cut-over');

  // Roll back: the added cases go again.
  await button(page, DQ(locale, 'act.rollback')).click();
  await page.getByRole('dialog').getByRole('button', { name: DQ(locale, 'rb.ok'), exact: true }).click();
  await expect(toasts(page, locale).getByText(DQ(locale, 'toast.rolledBack'), { exact: true })).toBeVisible();
  await expect(root(page).getByText(DQ(locale, 'rb.doneBody', { del: String(ADDED), res: '0' })).first()).toBeVisible();
  await open(page, locale, `?job=${jobId}`);
  expect(await statValue(root(page), DQ(locale, 'stat.held'))).toBe(held);
  await expect(root(page).getByText(DQ(locale, 'status.rolled_back'), { exact: true }).first()).toBeVisible();
  if (recordShots) await shot(page, testInfo, locale, 'flow5-rolled-back');

  // Each step audited, by this file's name.
  await page.goto(`/${locale}/admin/audit-log?q=${encodeURIComponent(name)}`);
  const audit = page.locator('[data-module="admin.audit_log"] tbody tr');
  const steps: ReadonlyArray<readonly [string, number]> = [
    ['import.upload_started', 1],
    ['import.uploaded', 1],
    ['import.validated', 1],
    ['import.quality_escalated', 1],
    ['import.compared', 1],
    ['import.dry_run', 2],
    ['import.cut_over', 1],
    ['import.rolled_back', 1],
  ];
  for (const [action, count] of steps) await expect(audit.filter({ hasText: action }), `audit ${action} for ${name}`).toHaveCount(count);
  await expect(audit).toHaveCount(9);

  await expectPageOk(page, locale);
  seen.expectClean();
}

// Video is worker-scoped; set once, file wide.
test.use({ video: 'on' });
test.setTimeout(240_000);

test.describe('English', () => {
  test('flow 5: a Customer CSV with bad rows is validated, compared, dry-run, cut over and rolled back, each step audited', async ({ page, baseURL }, testInfo) => {
    await runFlow(page, testInfo, baseURL, 'en', true);
  });
});

test.describe('Arabic', () => {
  test('flow 5: the same steps', async ({ page, baseURL }, testInfo) => {
    await runFlow(page, testInfo, baseURL, 'ar', false);
  });
});
