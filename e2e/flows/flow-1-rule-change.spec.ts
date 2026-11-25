// SPDX-License-Identifier: AGPL-3.0-only
import { type Page, type TestInfo } from '@playwright/test';
import { expect, test } from './fixtures';
import { expectPageOk, shot, signOutViaSwitcher, startDemo, waitForHydration, watch } from '../helpers';
import { text, type Locale } from '../routes';
import { apiAs, expectAudit, messages } from './support';

// Flow 1: rule change..

const RULES = messages('admin/classification_rules');
const FX = messages('ops/forecast_explorer');
const FM = messages('admin/forecast_model');
// field_mandatory on 4+ parties: moves the split
const RULE = 'RULE-003A';

const rulesRoot = (page: Page) => page.locator('[data-module="admin.classification_rules"]');
const fxRoot = (page: Page) => page.locator('[data-module="ops.forecast_explorer"]');

interface Split {
  readonly field: number;
  readonly ruleSet: string;
}

interface Run {
  readonly id: string;
  readonly horizon_start_date: string;
}

// Latin or Arabic-Indic digits to a number.
function numberOf(raw: string): number {
  const latin = raw.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));
  const match = /\d[\d,٬]*/.exec(latin);
  if (match === null) throw new Error(`No number in "${raw}"`);
  return Number(match[0].replace(/[,٬]/g, ''));
}

async function readSplit(page: Page, locale: Locale): Promise<Split> {
  await page.goto(`/${locale}/ops/forecast-explorer`);
  await expect(fxRoot(page)).toHaveAttribute('data-state', 'filled');
  await waitForHydration(page, 'main');
  const row = fxRoot(page).locator('li', { hasText: FX(locale, 'view.field') }).first();
  const field = numberOf((await row.locator('span[translate="no"]').first().textContent()) ?? '');
  const ruleSet = (await fxRoot(page).getByText(FX(locale, 'ruleset')).first().textContent()) ?? '';
  return { field, ruleSet };
}

// One run's field cases over the zones, one day.
async function runField(page: Page, apiUrl: string | undefined, runId: string, zoneIds: readonly string[], date: string): Promise<number> {
  const api = await apiAs(page, apiUrl);
  let total = 0;
  for (const zoneId of zoneIds) {
    const timeline = await api.get<{ intervals: { field_expected: number }[] }>(`/forecasts/timeline?zone_id=${zoneId}&date=${date}&run_id=${runId}`);
    total += timeline.intervals.reduce((sum, i) => sum + i.field_expected, 0);
  }
  return total;
}

async function latestRun(page: Page, apiUrl: string | undefined): Promise<Run> {
  const api = await apiAs(page, apiUrl);
  const run = (await api.get<{ items: Run[] }>('/forecasts/runs?status=succeeded&limit=1')).items[0];
  if (run === undefined) throw new Error('No succeeded forecast run.');
  return run;
}

async function runFlow(page: Page, testInfo: TestInfo, baseURL: string | undefined, apiUrl: string | undefined, locale: Locale, recordShots: boolean) {
  const seen = watch(page, baseURL);

  await startDemo(page, locale, 'administrator');
  const before = await readSplit(page, locale);
  const earlier = await latestRun(page, apiUrl);
  const zoneIds = (await (await apiAs(page, apiUrl)).get<{ zones: { zone_id: string }[] }>(`/forecasts/split?date=${earlier.horizon_start_date}`)).zones.map((z) => z.zone_id);
  const earlierField = await runField(page, apiUrl, earlier.id, zoneIds, earlier.horizon_start_date);

  // The Administrator submits the draft.
  await page.goto(`/${locale}/admin/classification-rules?rule=${RULE}`);
  await expect(rulesRoot(page)).toHaveAttribute('data-state', 'filled');
  await page.getByRole('dialog', { name: RULE }).getByRole('button', { name: RULES(locale, 'btn.submit') }).click();
  await expect(page.getByText(RULES(locale, 'toast.submitted.title'))).toBeVisible();
  if (recordShots) await shot(page, testInfo, locale, 'flow1-submitted');
  await signOutViaSwitcher(page, locale);

  // A Dispatch Supervisor approves it.
  await startDemo(page, locale, 'dispatch_supervisor');
  await page.goto(`/${locale}/admin/classification-rules?tab=approvals`);
  await rulesRoot(page).locator('tbody tr').filter({ hasText: RULE }).first().getByRole('button', { name: text(locale, 'common.approve') }).click();
  const dialog = page.getByRole('dialog', { name: RULES(locale, 'decide.approve', { code: RULE }) });
  await dialog.getByRole('textbox').fill('Approved in flow 1');
  await dialog.getByRole('button', { name: text(locale, 'common.approve') }).click();
  await expect(page.getByText(RULES(locale, 'toast.approved.title'))).toBeVisible();
  if (recordShots) await shot(page, testInfo, locale, 'flow1-approved');
  await signOutViaSwitcher(page, locale);

  // It takes effect: the rule is active.
  await startDemo(page, locale, 'administrator');
  await page.goto(`/${locale}/admin/classification-rules`);
  await expect(rulesRoot(page).locator('tbody tr').filter({ hasText: RULE }).first()).toContainText(RULES(locale, 'st.active'));

  // The stored run keeps its split and rule set.
  expect(await readSplit(page, locale), 'the earlier run keeps its stored split').toEqual(before);

  // A new forecast run applies the approved rule.
  await page.goto(`/${locale}/admin/forecast-model`);
  await waitForHydration(page, '[data-module="admin.forecast_model"] button');
  await page.getByRole('button', { name: FM(locale, 'run.label'), exact: true }).first().click();
  await expect(page.getByText(FM(locale, 'toast.run.title'), { exact: true })).toBeVisible();
  const next = await readSplit(page, locale);
  expect(next.ruleSet, 'the new run carries the new rule set').not.toBe(before.ruleSet);
  expect(next.field, 'the new run moves cases to the field').toBeGreaterThan(before.field);
  if (recordShots) await shot(page, testInfo, locale, 'flow1-new-run');

  const newer = await latestRun(page, apiUrl);
  expect(newer.id).not.toBe(earlier.id);
  expect(await runField(page, apiUrl, newer.id, zoneIds, earlier.horizon_start_date), 'the new run, same zones and day').toBeGreaterThan(earlierField);
  expect(await runField(page, apiUrl, earlier.id, zoneIds, earlier.horizon_start_date), 'the earlier run keeps its own split').toBeCloseTo(earlierField, 6);

  await expectAudit(page, locale, RULE, 'rule.submitted');
  await expectAudit(page, locale, RULE, 'rule.approved');
  await expectAudit(page, locale, 'forecast.run_created', 'forecast.run_created');

  await expectPageOk(page, locale);
  seen.expectClean();
}

test.use({ video: 'on' });

test.describe('English', () => {
  test('flow 1: a rule is submitted and approved, takes effect, a new run moves its split to the field, the stored run keeps its own, all audited', async ({ page, baseURL, stack }, testInfo) => {
    await runFlow(page, testInfo, baseURL, stack?.apiUrl, 'en', true);
  });
});

test.describe('Arabic', () => {
  test('flow 1: the same steps', async ({ page, baseURL, stack }, testInfo) => {
    await runFlow(page, testInfo, baseURL, stack?.apiUrl, 'ar', false);
  });
});
