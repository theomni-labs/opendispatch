// SPDX-License-Identifier: AGPL-3.0-only
import { type Page, type TestInfo } from '@playwright/test';
import { expect, test } from './fixtures';
import { expectPageOk, shot, signOutViaSwitcher, startDemo, startDemoInZones, waitForHydration, watch } from '../helpers';
import { text, type Locale } from '../routes';
import { auditDetail, expectAudit, messages, pattern } from './support';

// Flow 11: live dispatch, the operator fallback rules-20.

const LD = messages('ops/live_dispatch_board');
const REASON = 'closer_agent_known';
// RD-E is in shadow stage; RD-C, RD-N recommend
const SHADOW_ZONE = 'Riyadh East';

const root = (page: Page) => page.locator('[data-module="ops.live_dispatch_board"]');
const cards = (page: Page) => root(page).getByTestId('live-case-card');
const banner = (page: Page) => root(page).locator('section[role="status"][data-active]');
const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true });
const column = (page: Page, locale: Locale, key: string) => root(page).locator('section[data-column]', { has: page.getByRole('heading', { name: LD(locale, key) }) });
const caseDrawer = (page: Page) => page.locator('[role="dialog"]', { has: page.locator('[data-case-drawer]') });
// Every case the Board tab holds (its count badge).
const boardTotal = async (page: Page, locale: Locale) => Number(((await root(page).getByRole('tab', { name: new RegExp(`^${LD(locale, 'tab.board')}`) }).textContent()) ?? '').replace(/\D/g, '') || '0');

// Opens a card's case drawer by its case number button.
async function openCase(page: Page, caseId: string) {
  await root(page).locator(`[data-case="${caseId}"]`).getByRole('button', { name: /RD-/ }).click();
  await expect(caseDrawer(page)).toBeVisible();
  return caseDrawer(page);
}

// Shows every card: each "Show N more".
async function showAll(page: Page, locale: Locale) {
  const more = root(page).getByRole('button', { name: pattern(LD(locale, 'more')) });
  while ((await more.count()) > 0) await more.first().click();
}

// The header's More menu, then one item.
async function fromMore(page: Page, locale: Locale, item: string) {
  const entry = page.getByRole('menuitem', { name: item });
  await expect(async () => {
    if (!(await entry.isVisible())) await root(page).getByRole('button', { name: text(locale, 'common.more'), exact: true }).click();
    await entry.click({ timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
}

// Closes the case drawer and waits for it to go.
async function closeCase(page: Page) {
  await page.keyboard.press('Escape');
  await expect(caseDrawer(page)).toBeHidden();
}

async function open(page: Page, locale: Locale) {
  await page.goto(`/${locale}/ops/live-dispatch-board`);
  await expect(root(page)).toHaveAttribute('data-state', 'filled');
  await waitForHydration(page, '[data-module="ops.live_dispatch_board"] button');
}

// Plays the replay until `done` holds, then pauses.
async function playUntil(page: Page, locale: Locale, done: () => Promise<boolean>) {
  await button(page, LD(locale, 'replay.resume')).click();
  await expect(button(page, LD(locale, 'replay.pause'))).toBeVisible();
  await expect(async () => {
    await open(page, locale);
    expect(await done()).toBe(true);
  }).toPass({ timeout: 90_000, intervals: [3_000] });
  await button(page, LD(locale, 'replay.pause')).click();
  await expect(button(page, LD(locale, 'replay.resume'))).toBeVisible();
}

async function runFlow(page: Page, testInfo: TestInfo, baseURL: string | undefined, locale: Locale, recordShots: boolean) {
  const seen = watch(page, baseURL);
  const dispatch = (key: string) => text(locale, `opendispatch.dispatch.${key}`);

  await startDemoInZones(page, locale, 'dispatcher', [SHADOW_ZONE]);
  await open(page, locale);
  await expect(banner(page)).toHaveAttribute('data-active', 'false');

  // The customer's actual choice shows beside OpenDispatch's.
  await root(page).getByRole('tab', { name: LD(locale, 'tab.shadow') }).click();
  await expect(root(page).getByRole('heading', { name: LD(locale, 'cmp.title') })).toBeVisible();
  const pair = root(page).locator('ul[role="list"] > li:not([aria-hidden])').filter({ hasText: dispatch('source.opendispatch') }).filter({ hasText: dispatch('source.customer') }).first();
  await expect(pair).toBeVisible();
  const names = await pair.locator('span[translate="no"]').allTextContents();
  expect(names[2], 'OpenDispatch agent').toMatch(/\p{L}/u);
  expect(names[4], 'Customer agent').toMatch(/\p{L}/u);

  // Cases arrive as the replay day plays.
  await open(page, locale);
  const before = await boardTotal(page, locale);
  const recommendedCount = () => column(page, locale, 'board.col.recommended').getByTestId('live-case-card').count();
  // The customer assigns within minutes: retry.
  await expect(async () => {
    await playUntil(page, locale, async () => (await boardTotal(page, locale)) > before && (await recommendedCount()) > 0);
    await open(page, locale);
    expect(await recommendedCount()).toBeGreaterThan(0);
  }).toPass({ timeout: 240_000 });
  if (recordShots) await shot(page, testInfo, locale, 'flow11-arrived');

  // OpenDispatch picks an agent, with an arrival time.
  const card = column(page, locale, 'board.col.recommended').getByTestId('live-case-card').first();
  await expect(card).toContainText(/\d{2}:\d{2}/);
  const caseId = (await card.getAttribute('data-case')) ?? '';
  const caseNumber = (await card.locator('span[translate="no"]').first().textContent()) ?? '';
  const recommended = (await card.locator('[class*="pickName"]').textContent()) ?? '';
  // The case drawer holds the rest.
  const drawer = await openCase(page, caseId);
  await expect(drawer).toContainText(dispatch('pickOpenDispatch'));
  await expect(drawer).toContainText(recommended);
  await closeCase(page);

  // A second board, left open on the old state.
  const stale = await page.context().newPage();
  await open(stale, locale);

  // A dispatcher reassigns it; a reason is required.
  await card.getByRole('button', { name: dispatch('override'), exact: true }).click();
  const dialog = page.getByRole('dialog', { name: LD(locale, 'override.title') });
  const agent = dialog.getByRole('combobox');
  await agent.fill('a');
  await agent.press('Enter');
  const confirm = dialog.getByRole('button', { name: text(locale, 'common.confirm'), exact: true });
  await expect(confirm).toHaveAttribute('aria-disabled', 'true');
  await dialog.getByRole('radio', { name: text(locale, `opendispatch.reasonCode.${REASON}`) }).click();
  await confirm.click();
  await expect(page.getByText(/^(Reassigned to |أُعيد الإسناد إلى )/)).toBeVisible();
  await open(page, locale);
  await showAll(page, locale);
  await expect(column(page, locale, 'col.progress').locator(`[data-case="${caseId}"]`)).toBeVisible();
  const overridden = await openCase(page, caseId);
  await expect(overridden).toContainText(dispatch('source.manual'));
  await expect(overridden).toContainText(dispatch('reassignedFrom'));
  await expect(overridden).toContainText(recommended);
  if (recordShots) await shot(page, testInfo, locale, 'flow11-overridden');
  await closeCase(page);

  // A second assignment for it is refused.
  await stale.locator(`[data-case="${caseId}"]`).getByRole('button', { name: dispatch('accept'), exact: true }).click();
  // A warning toast (447ae0f): role status.
  await expect(stale.getByRole('status').filter({ hasText: 'ALREADY_ASSIGNED' })).toBeVisible();
  await stale.close();
  await open(page, locale);
  await showAll(page, locale);
  await expect(await openCase(page, caseId)).toContainText(dispatch('source.manual'));
  await closeCase(page);

  // A feed outage: the board switches to fallback.
  await fromMore(page, locale, LD(locale, 'outage.on'));
  await expect(page.getByText(LD(locale, 'toast.outageOn'))).toBeVisible();
  await expect(banner(page)).toHaveAttribute('data-active', 'true');
  await expect(banner(page)).toContainText(LD(locale, 'fallback.activeShort'));
  await expect(root(page).getByText(LD(locale, 'fallback.active'), { exact: true })).toBeVisible();
  // New cases go to the customer's dispatch meanwhile.
  await playUntil(page, locale, async () => Number((await banner(page).locator('b').textContent()) ?? '0') > 0);
  await showAll(page, locale);
  await expect(cards(page).filter({ hasText: dispatch('source.fallback') }).first()).toBeVisible();
  if (recordShots) await shot(page, testInfo, locale, 'flow11-fallback');
  await fromMore(page, locale, LD(locale, 'outage.off'));
  await expect(page.getByText(LD(locale, 'toast.outageOff'))).toBeVisible();
  await expect(banner(page)).toHaveAttribute('data-active', 'false');
  await signOutViaSwitcher(page, locale);

  // Audited: MANUAL with the reason code.
  await startDemo(page, locale, 'administrator');
  const row = await expectAudit(page, locale, caseNumber, 'assignment.overridden');
  const detail = await auditDetail(page, row);
  expect(detail).toMatch(/"source":\s*"MANUAL"/);
  expect(detail).toMatch(new RegExp(`"reason_code":\\s*"${REASON}"`));
  await page.keyboard.press('Escape');
  // The refused second assignment, audited.
  await page.goto(`/${locale}/admin/audit-log?q=${encodeURIComponent(caseNumber)}&outcome=denied`);
  const refusal = page.locator('[data-module="admin.audit_log"] tbody tr').filter({ hasText: 'assignment.accepted' });
  await expect(refusal, 'one denied assignment.accepted for the case').toHaveCount(1);
  const refused = await auditDetail(page, refusal.first());
  expect(refused).toMatch(/"reason":\s*"ALREADY_ASSIGNED"/);
  expect(refused).toMatch(new RegExp(`"case_id":\\s*"${caseId}"`));
  await page.keyboard.press('Escape');
  await expectAudit(page, locale, 'fallback.outage_simulated', 'fallback.outage_simulated');

  await expectPageOk(page, locale);
  seen.expectClean();
}

test.use({ video: 'on' });
test.setTimeout(300_000);

test.describe('English', () => {
  test('flow 11: cases arrive, OpenDispatch picks with an ETA, a reassignment with a reason, a second assignment refused, Customer beside OpenDispatch, fallback in an outage', async ({ page, baseURL }, testInfo) => {
    await runFlow(page, testInfo, baseURL, 'en', true);
  });
});

test.describe('Arabic', () => {
  test('flow 11: the same steps', async ({ page, baseURL }, testInfo) => {
    await runFlow(page, testInfo, baseURL, 'ar', false);
  });
});
