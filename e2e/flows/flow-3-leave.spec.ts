// SPDX-License-Identifier: AGPL-3.0-only
import { type Locator, type Page, type TestInfo } from '@playwright/test';
import { expect, test } from './fixtures';
import { expectPageOk, shot, signOutViaSwitcher, startDemo, startDemoInZones, waitForHydration, watch } from '../helpers';
import { text, type Locale } from '../routes';
import { apiAs, expectAudit, firstHole, messages, pattern, pluralForms, statValue, tightLines } from './support';

// Flow 3: leave and its coverage effect.

const LP = messages('ops/leave_planner');
// Every plural form of a row's gaps chip
const gapsPattern = (locale: Locale) => pattern(pluralForms((values) => LP(locale, 'eff.gaps', values), 'n'));
// The default two zones have no pending request
const EXTRA_ZONES = ['Riyadh South', 'Dammam Central', 'Riyadh West', 'Jeddah North'];
// Exactly the second Planner's zones
const OTHER_PLANNER_ZONES = ['Jeddah North', 'Jeddah South', 'Dammam Central'];
const JEDDAH_NORTH = '73c8608b-21c0-4c43-8b48-cb9da664317e';

const root = (page: Page) => page.locator('[data-module="ops.leave_planner"]');

interface Stats {
  readonly pending: number;
  readonly approved: number;
  readonly gaps: number;
}

async function open(page: Page, locale: Locale, query = '?tab=requested') {
  await page.goto(`/${locale}/ops/leave-planner${query}`);
  await expect(root(page)).toHaveAttribute('data-state', 'filled');
  await waitForHydration(page, '[data-module="ops.leave_planner"] button');
}

async function stats(page: Page, locale: Locale): Promise<Stats> {
  await open(page, locale);
  return {
    pending: await statValue(root(page), LP(locale, 'stat.pending')),
    approved: await statValue(root(page), LP(locale, 'stat.approved')),
    gaps: await statValue(root(page), LP(locale, 'stat.gaps')),
  };
}

// The new gaps a row's effect chip shows.
async function gapsOf(row: Locator, locale: Locale): Promise<number> {
  const match = gapsPattern(locale).exec((await row.textContent()) ?? '');
  return match === null ? 0 : Number(firstHole(match));
}

// Opens the request's drawer; checks the effect.
async function openEffect(page: Page, locale: Locale, row: Locator): Promise<Locator> {
  await row.locator('td').nth(1).click();
  const drawer = page.getByRole('dialog');
  await expect(drawer).toBeVisible({ timeout: 20_000 });
  await expect(drawer.getByText(LP(locale, 'd.effect'))).toBeVisible();
  return drawer;
}

// Signs in with exactly these zones.
async function startDemoInOnly(page: Page, locale: Locale, zoneNames: readonly string[]) {
  await page.goto(`/${locale}`);
  await waitForHydration(page, 'form');
  await page.locator('input[type=radio][value="private"]').check();
  await page.locator('input[type=radio][value="planner"]').check();
  for (const box of await page.getByRole('checkbox').all()) await box.uncheck();
  for (const name of zoneNames) await page.getByRole('checkbox', { name }).check();
  await page.locator('form button[type=submit]').click();
  await page.waitForURL(new RegExp(`/${locale}/(ops|admin)/`));
  await waitForHydration(page, '[data-shell="topbar"] button');
}

// Another Planner enters leave on a tight shift.
async function requestTightLeave(page: Page, locale: Locale, apiUrl: string | undefined): Promise<number> {
  await startDemoInOnly(page, locale, OTHER_PLANNER_ZONES);
  const api = await apiAs(page, apiUrl);
  const rosters = await api.get<{ items: { roster_date: string }[] }>(`/rosters?zone_id=${JEDDAH_NORTH}&limit=100`);
  for (const date of rosters.items.map((r) => r.roster_date).sort().reverse()) {
    for (const { line } of await tightLines(api, JEDDAH_NORTH, date)) {
      const body = { agent_id: line.agent_id, start_date: date, end_date: date, leave_type: 'annual', note: null };
      const created = await api.post<{ id: string }>('/leave-requests', body).catch(() => null);
      if (created === null) continue;
      const effect = await api.get<{ new_gap_intervals: number }>(`/leave-requests/${created.id}/coverage-effect`);
      if (effect.new_gap_intervals === 0) continue;
      await signOutViaSwitcher(page, locale);
      return effect.new_gap_intervals;
    }
  }
  throw new Error('No exactly staffed shift in Jeddah North.');
}

async function runFlow(page: Page, testInfo: TestInfo, baseURL: string | undefined, apiUrl: string | undefined, locale: Locale, recordShots: boolean) {
  const seen = watch(page, baseURL);
  const rows = () => root(page).locator('tbody tr');
  const withGaps = () => rows().filter({ hasText: gapsPattern(locale) });

  const tightGaps = await requestTightLeave(page, locale, apiUrl);
  expect(tightGaps, 'leave on an exactly staffed shift adds gaps').toBeGreaterThan(0);
  await startDemoInZones(page, locale, 'planner', EXTRA_ZONES);
  const s0 = await stats(page, locale);
  expect(s0.gaps, 'pending leave adds gaps').toBeGreaterThanOrEqual(tightGaps);

  // Its effect on coverage, then approve.
  const first = withGaps().first();
  const n1 = await gapsOf(first, locale);
  expect(n1).toBeGreaterThan(0);
  const drawer = await openEffect(page, locale, first);
  await expect(drawer.getByRole('img', { name: LP(locale, 'spark') })).toBeVisible();
  if (recordShots) await shot(page, testInfo, locale, 'flow3-effect');
  await drawer.getByRole('button', { name: text(locale, 'common.approve'), exact: true }).click();
  await expect(page.getByText(LP(locale, 'toast.approved'))).toBeVisible();
  const s1 = await stats(page, locale);
  expect(s1).toEqual({ pending: s0.pending - 1, approved: s0.approved + 1, gaps: s0.gaps - n1 });

  // Another one: its effect, then decline.
  const second = rows().first();
  const n2 = await gapsOf(second, locale);
  const drawer2 = await openEffect(page, locale, second);
  await drawer2.getByRole('button', { name: LP(locale, 'decline'), exact: true }).click();
  await expect(page.getByText(LP(locale, 'toast.declined'))).toBeVisible();
  const s2 = await stats(page, locale);
  expect(s2).toEqual({ pending: s1.pending - 1, approved: s1.approved, gaps: s1.gaps - n2 });
  if (recordShots) await shot(page, testInfo, locale, 'flow3-decided');

  // A request the Planner enters is not theirs to decide.
  await root(page).getByRole('button', { name: LP(locale, 'new'), exact: true }).click();
  const form = page.getByRole('dialog', { name: LP(locale, 'new') });
  await form.getByLabel(text(locale, 'common.agent')).selectOption({ index: 0 });
  await form.getByLabel(LP(locale, 'n.from')).fill('2026-11-01');
  await form.getByLabel(LP(locale, 'n.to')).fill('2026-11-03');
  await form.getByRole('button', { name: LP(locale, 'n.create'), exact: true }).click();
  await expect(page.getByText(LP(locale, 'toast.created'))).toBeVisible();
  const s3 = await stats(page, locale);
  expect(s3.pending).toBe(s2.pending + 1);
  const own = rows().filter({ hasText: LP(locale, 'yours') }).first();
  const ownDrawer = await openEffect(page, locale, own);
  await expect(ownDrawer.getByText(LP(locale, 'own'))).toBeVisible();
  await expect(ownDrawer.getByRole('button', { name: text(locale, 'common.approve'), exact: true })).toHaveAttribute('aria-disabled', 'true');
  if (recordShots) await shot(page, testInfo, locale, 'flow3-own');
  await page.keyboard.press('Escape');
  await expect(ownDrawer).toBeHidden();

  await signOutViaSwitcher(page, locale);
  await startDemo(page, locale, 'administrator');
  for (const action of ['leave.approved', 'leave.declined', 'leave.requested']) await expectAudit(page, locale, action, action);

  await expectPageOk(page, locale);
  seen.expectClean();
}

test.use({ video: 'on' });
// The planner page is an N+1 read.
test.setTimeout(150_000);

test.describe('English', () => {
  test('flow 3: a leave request shows its coverage effect; approving and declining move the coverage figures; all audited', async ({ page, baseURL, stack }, testInfo) => {
    await runFlow(page, testInfo, baseURL, stack?.apiUrl, 'en', true);
  });
});

test.describe('Arabic', () => {
  test('flow 3: the same steps', async ({ page, baseURL, stack }, testInfo) => {
    await runFlow(page, testInfo, baseURL, stack?.apiUrl, 'ar', false);
  });
});
