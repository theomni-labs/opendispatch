// SPDX-License-Identifier: AGPL-3.0-only
import { type Page, type TestInfo } from '@playwright/test';
import { expect, test } from './fixtures';
import { expectPageOk, shot, signOutViaSwitcher, startDemo, waitForHydration, watch } from '../helpers';
import { text, type Locale } from '../routes';
import { apiAs, expectAudit, messages, tightLines } from './support';

// Flow 2: build, override, approve, publish.

const FP = messages('ops/field_planner');
// Riyadh Central; no roster on this day yet
const ZONE = '091ff2b2-f0e1-4b97-bfc9-7cdd0698c32a';
const DAY = '2026-09-21';
const QUERY = `?zone=${ZONE}&date=${DAY}`;

const fpRoot = (page: Page) => page.locator('[data-module="ops.field_planner"]');
const gapRoot = (page: Page) => page.locator('[data-module="ops.gap_surplus"]');

async function gaps(page: Page, locale: Locale): Promise<number> {
  await page.goto(`/${locale}/ops/gap-surplus${QUERY}`);
  await expect(gapRoot(page)).toHaveAttribute('data-state', 'filled');
  // gap count sits in the Demand met hint now
  const count = gapRoot(page).locator('[data-gap-intervals]').first();
  await expect(count).toBeVisible();
  return Number(await count.getAttribute('data-gap-intervals'));
}

async function openPlanner(page: Page, locale: Locale, tab = '') {
  await page.goto(`/${locale}/ops/field-planner${QUERY}${tab}`);
  await expect(fpRoot(page)).toHaveAttribute('data-state', /filled|empty/);
  await waitForHydration(page, '[data-module="ops.field_planner"] button');
}

async function runFlow(page: Page, testInfo: TestInfo, baseURL: string | undefined, apiUrl: string | undefined, locale: Locale, recordShots: boolean) {
  const seen = watch(page, baseURL);
  const status = (key: string) => fpRoot(page).getByText(FP(locale, `status.${key}`), { exact: true }).first();

  // A Planner builds the roster on an empty day.
  await startDemo(page, locale, 'planner');
  const gapsEmpty = await gaps(page, locale);
  await openPlanner(page, locale);
  await expect(fpRoot(page)).toHaveAttribute('data-state', 'empty');
  await page.getByRole('button', { name: FP(locale, 'empty.action'), exact: true }).click();
  await expect(fpRoot(page)).toHaveAttribute('data-state', 'filled', { timeout: 30_000 });
  await expect(status('draft')).toBeVisible();
  if (recordShots) await shot(page, testInfo, locale, 'flow2-built');
  const gapsBuilt = await gaps(page, locale);
  expect(gapsBuilt, 'the gap view updates once the roster is built').not.toBe(gapsEmpty);

  // A line on an exactly staffed interval.
  const [tight] = await tightLines(await apiAs(page, apiUrl), ZONE, DAY);
  if (tight === undefined) throw new Error('The built roster has no exactly staffed interval.');

  // An override without a reason is refused.
  await openPlanner(page, locale);
  await fpRoot(page).getByRole('button', { name: FP(locale, 'add'), exact: true }).click();
  const drawer = page.getByRole('dialog', { name: FP(locale, 'add') });
  await drawer.getByLabel(FP(locale, 'd.type')).selectOption('remove_assignment');
  await drawer.getByLabel(FP(locale, 'd.line')).selectOption(tight.line.id);
  const submit = drawer.getByRole('button', { name: FP(locale, 'd.submit'), exact: true });
  await expect(submit).toHaveAttribute('aria-disabled', 'true');
  await submit.click({ force: true });
  await submit.hover();
  await expect(page.getByRole('tooltip')).toContainText(FP(locale, 'need.reason'));
  await expect(drawer).toBeVisible();
  await expect(page.getByText(FP(locale, 'toast.override'))).toHaveCount(0);

  // With a reason it is sent for approval.
  await drawer.getByRole('radio', { name: text(locale, 'opendispatch.reasonCode.agent_unavailable') }).click();
  await expect(submit).not.toHaveAttribute('aria-disabled', 'true');
  if (recordShots) await shot(page, testInfo, locale, 'flow2-override-drawer');
  await submit.click();
  await expect(page.getByText(FP(locale, 'toast.override'))).toBeVisible();

  // The requester cannot approve it.
  await openPlanner(page, locale, '&tab=overrides');
  const ownRow = fpRoot(page).getByRole('table').locator('tbody tr').first();
  await expect(ownRow).toContainText(FP(locale, 'r.own'));
  await expect(ownRow.getByRole('button', { name: text(locale, 'common.approve'), exact: true })).toHaveCount(0);

  // The Planner submits the roster.
  await page.getByRole('button', { name: text(locale, 'common.more'), exact: true }).click();
  await page.getByRole('menuitem', { name: FP(locale, 'menu.submit') }).click();
  await expect(page.getByText(FP(locale, 'toast.submitted'))).toBeVisible();
  await expect(status('submitted')).toBeVisible();
  await signOutViaSwitcher(page, locale);

  // A Dispatch Supervisor approves both.
  await startDemo(page, locale, 'dispatch_supervisor');
  await openPlanner(page, locale, '&tab=overrides');
  await fpRoot(page).getByRole('table').getByRole('button', { name: text(locale, 'common.approve'), exact: true }).first().click();
  await expect(page.getByText(FP(locale, 'toast.oapproved'))).toBeVisible();
  await openPlanner(page, locale);
  await fpRoot(page).getByRole('button', { name: text(locale, 'common.approve'), exact: true }).click();
  await expect(page.getByText(FP(locale, 'toast.approved'), { exact: true })).toBeVisible();
  await expect(status('approved')).toBeVisible();
  const gapsOverridden = await gaps(page, locale);
  expect(gapsOverridden - gapsBuilt, 'its exactly staffed intervals become gaps').toBe(tight.newGaps);

  // Publish is a labelled stub: nothing is sent.
  await openPlanner(page, locale);
  await fpRoot(page).getByRole('button', { name: FP(locale, 'publish'), exact: true }).click();
  await expect(page.getByText(FP(locale, 'toast.publish'))).toBeVisible();
  await expect(page.getByText(FP(locale, 'toast.publishDesc'))).toBeVisible();
  if (recordShots) await shot(page, testInfo, locale, 'flow2-publish-stub');
  await openPlanner(page, locale);
  await expect(status('approved')).toBeVisible();
  await expect(status('published')).toHaveCount(0);
  await signOutViaSwitcher(page, locale);

  await startDemo(page, locale, 'administrator');
  for (const action of ['roster.built', 'override.created', 'roster.submitted', 'override.approved', 'roster.approved', 'roster.publish_stub']) {
    await expectAudit(page, locale, action, action);
  }

  await expectPageOk(page, locale);
  seen.expectClean();
}

test.use({ video: 'on' });
test.setTimeout(180_000);

test.describe('English', () => {
  test('flow 2: a roster is built, an override needs a reason and a supervisor, the gap view updates, Publish is a labelled stub', async ({ page, baseURL, stack }, testInfo) => {
    await runFlow(page, testInfo, baseURL, stack?.apiUrl, 'en', true);
  });
});

test.describe('Arabic', () => {
  test('flow 2: the same steps', async ({ page, baseURL, stack }, testInfo) => {
    await runFlow(page, testInfo, baseURL, stack?.apiUrl, 'ar', false);
  });
});
