// SPDX-License-Identifier: AGPL-3.0-only
import path from 'node:path';
import { type Page } from '@playwright/test';
import { expect, test } from '../fixtures';
import { expectPageOk, shot, signOutViaSwitcher, startDemo, waitForHydration, watch } from '../helpers';
import { locales, text, titleOf, type Locale } from '../routes';
import { readMessages } from '../messages';

// Notifications and Alerts. ONLY IN-APP NOTIFICATIONS EXIST (no e-mail is sent) and THE QUIET-HOURS
// WINDOW IS STORED, NOT APPLIED: both are labelled "Not applied". The Administrator reads the 14 rules, the preview, the quiet-hours
// card and the alert log (both languages); switches a rule off and on, edits a rule in its drawer (at least one channel), edits the
// quiet hours, sends a test alert (it lands in the log, addressed to the person who sent it), and marks alerts read one by one
// and all at once (only the person's own; the alerts for other roles stay unread). Each write is followed by its audit event in
// the Audit Log. Marking read is a personal preference and is not audited. The rule, quiet-hours and alert state is ONE state for
// the whole run, so the writes are one serial chain that puts back what it changes; the tests before it only read.

type Tree = { [key: string]: string | Tree };
const module_ = (locale: Locale): Tree => readMessages(path.join(import.meta.dirname, '../../apps/web/messages/admin/notifications_alerts', `${locale}.json`)) as Tree;
const MODULE = { en: module_('en'), ar: module_('ar') };
/** A key of the module's own message file (`toast.rule`), with `{v}` style values put in. */
function m(locale: Locale, key: string, values: Record<string, string> = {}): string {
  let node: string | Tree | undefined = MODULE[locale];
  for (const part of key.split('.')) node = typeof node === 'object' ? node[part] : undefined;
  if (typeof node !== 'string') throw new Error(`No message admin.notifications_alerts.${locale}:${key}`);
  return Object.entries(values).reduce((out, [name, value]) => out.replaceAll(`{${name}}`, value), node);
}

const ROUTE = (locale: Locale) => `/${locale}/admin/notifications-alerts`;
const root = (page: Page) => page.locator('[data-module="admin.notifications_alerts"]');
const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true });
const rulesTable = (page: Page, locale: Locale) => page.getByRole('table', { name: m(locale, 'rules.title') });
const logTable = (page: Page, locale: Locale) => page.getByRole('table', { name: m(locale, 'log.title') });
const ruleRow = (page: Page, locale: Locale, event: string) => rulesTable(page, locale).getByRole('row').filter({ hasText: m(locale, `ev.${event}`) });

async function open(page: Page, locale: Locale, query = '') {
  await page.goto(`${ROUTE(locale)}${query}`);
  await expect(root(page)).toHaveAttribute('data-state', 'filled');
  await expectPageOk(page, locale);
  await waitForHydration(page, '[data-module="admin.notifications_alerts"] button');
}

/** The Audit Log filtered by an action code: the write's event is there. */
async function expectAudit(page: Page, locale: Locale, action: string) {
  await page.goto(`/${locale}/admin/audit-log?q=${action}`);
  await expect(page.locator('[data-module="admin.audit_log"] tbody tr').first()).toContainText(action);
}

for (const locale of locales) {
  test.describe(`Notifications and Alerts, read only, in ${locale}`, () => {
    test(`the Administrator reads the screen: title, Send test alert and More, two tabs, four figures, the 14 rules, the preview, the quiet-hours card tagged "Not applied"`, async ({ page, baseURL }, testInfo) => {
      const seen = watch(page, baseURL);
      await startDemo(page, locale, 'administrator');
      await open(page, locale);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(titleOf(locale, 'admin.notifications_alerts'));
      await expect(button(page, m(locale, 'send'))).toBeEnabled();
      await expect(button(page, text(locale, 'common.more'))).toBeVisible();
      await expect(page.getByRole('tab')).toHaveCount(2);
      for (const key of ['stat.rules', 'stat.unread', 'stat.critical', 'stat.quiet']) await expect(root(page).getByText(m(locale, key), { exact: true }).first()).toBeVisible();
      await expect(rulesTable(page, locale).locator('tbody tr')).toHaveCount(14);
      await expect(page.getByRole('heading', { name: m(locale, 'pv.title') })).toBeVisible();
      await expect(page.getByRole('heading', { name: m(locale, 'qh.title') })).toBeVisible();
      await expect(root(page).locator('[data-stub="notApplied"]').first()).toBeVisible();
      await shot(page, testInfo, locale, 'notifications-rules');
      // The preview's second example, and what happens at night.
      await page.getByRole('radio', { name: m(locale, 'pv.feed.label') }).click();
      await expect(page.locator('[data-preview="feed"]')).toBeVisible();
      // The row's text sits in one cell with the "Not applied" tag, so it is matched as a substring (it is the only such text on the Rules tab).
      await expect(page.getByText(m(locale, 'pv.night.now'))).toBeVisible();
      await shot(page, testInfo, locale, 'notifications-preview');
      seen.expectClean();
    });

    test(`the Alert log lists the 14 alerts with the unread ones marked and the person's own tagged; a filter in the address narrows it`, async ({ page, baseURL }, testInfo) => {
      const seen = watch(page, baseURL);
      await startDemo(page, locale, 'administrator');
      await open(page, locale, '?tab=log');
      await expect(logTable(page, locale).locator('tbody tr')).toHaveCount(14);
      await expect(logTable(page, locale).getByText(m(locale, 'f.unread'), { exact: true }).first()).toBeVisible();
      await expect(logTable(page, locale).getByText(m(locale, 'log.yours'), { exact: true }).first()).toBeVisible();
      await shot(page, testInfo, locale, 'notifications-log');
      await open(page, locale, '?tab=log&severity=critical');
      await expect(logTable(page, locale).locator('tbody tr')).toHaveCount(2);
      await open(page, locale, '?tab=log&q=zzz-nothing');
      await expect(root(page).getByText(m(locale, 'none'))).toBeVisible();
      seen.expectClean();
    });

    test(`a rule opens in a drawer from its row with its channels and recipients ticked; the quiet-hours drawer opens from the card`, async ({ page, baseURL }, testInfo) => {
      const seen = watch(page, baseURL);
      await startDemo(page, locale, 'administrator');
      await open(page, locale);
      await rulesTable(page, locale).locator('tbody tr').first().click();
      await expect(page).toHaveURL(/[?&]rule=[0-9a-f-]{36}/);
      const drawer = page.getByRole('dialog');
      await expect(drawer.getByRole('checkbox', { checked: true }).first()).toBeVisible();
      await expect(drawer.locator('[data-stub="notApplied"]')).toBeVisible();
      await shot(page, testInfo, locale, 'notifications-rule');
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await open(page, locale, '?quiet=1');
      const quiet = page.getByRole('dialog');
      await expect(quiet.getByLabel(m(locale, 'qd.from'), { exact: true })).toHaveValue('23:00');
      await expect(quiet.getByLabel(m(locale, 'qd.to'), { exact: true })).toHaveValue('05:00');
      await expect(quiet.locator('[data-stub="notApplied"]')).toBeVisible();
      await shot(page, testInfo, locale, 'notifications-quiet');
      await open(page, locale, '?rule=00000000-0000-4000-8000-000000000001');
      await expect(root(page).getByText(m(locale, 'notice.ruleNotFound'))).toBeVisible();
      seen.expectClean();
    });

    test(`the Change Approver has no access; the review states ?state=empty, loading and error keep the header`, async ({ page, baseURL }, testInfo) => {
      const seen = watch(page, baseURL);
      await startDemo(page, locale, 'administrator');
      for (const state of ['empty', 'loading', 'error'] as const) {
        await page.goto(`${ROUTE(locale)}?state=${state}`);
        await expect(root(page)).toHaveAttribute('data-state', state);
        await expect(page.getByRole('heading', { level: 1 })).toHaveText(titleOf(locale, 'admin.notifications_alerts'));
        await shot(page, testInfo, locale, `notifications-${state}`);
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

test.describe.serial('Notifications and Alerts, the writes', () => {
  const locale: Locale = 'en';

  test('the switch of a rule writes at once and is put back; the audit log has the event', async ({ page, baseURL }, testInfo) => {
    const seen = watch(page, baseURL);
    await startDemo(page, locale, 'administrator');
    await open(page, locale);
    const row = ruleRow(page, locale, 'backup_overdue');
    await expect(row.getByRole('switch')).toHaveAttribute('aria-checked', 'true');
    await waitForHydration(page, '[data-module="admin.notifications_alerts"] [role="switch"]');
    await row.getByRole('switch').click();
    // The switch shows the ask only while the write runs.
    await expect(row.getByRole('switch')).toBeEnabled();
    await expect(row.getByRole('switch')).toHaveAttribute('aria-checked', 'false');
    await open(page, locale);
    await expect(ruleRow(page, locale, 'backup_overdue').getByRole('switch')).toHaveAttribute('aria-checked', 'false');
    await shot(page, testInfo, locale, 'notifications-rule-off');
    await expectAudit(page, locale, 'notification_rule.updated');
    await open(page, locale);
    await waitForHydration(page, '[data-module="admin.notifications_alerts"] [role="switch"]');
    await ruleRow(page, locale, 'backup_overdue').getByRole('switch').click();
    await expect(ruleRow(page, locale, 'backup_overdue').getByRole('switch')).toBeEnabled();
    await expect(ruleRow(page, locale, 'backup_overdue').getByRole('switch')).toHaveAttribute('aria-checked', 'true');
    seen.expectClean();
  });

  test('a rule is edited in its drawer: with no channel Save is unavailable, with e-mail added it saves; then it is put back', async ({ page, baseURL }, testInfo) => {
    const seen = watch(page, baseURL);
    await startDemo(page, locale, 'administrator');
    await open(page, locale);
    await ruleRow(page, locale, 'model_switched').click();
    const drawer = page.getByRole('dialog');
    await drawer.getByRole('checkbox', { name: m(locale, 'ch.in_app') }).uncheck();
    await expect(drawer.getByText(m(locale, 'rd.need'))).toBeVisible();
    await expect(drawer.getByRole('button', { name: text(locale, 'common.save'), exact: true })).toHaveAttribute('aria-disabled', 'true');
    await shot(page, testInfo, locale, 'notifications-rule-need-channel');
    await drawer.getByRole('checkbox', { name: m(locale, 'ch.in_app') }).check();
    await drawer.getByRole('checkbox', { name: m(locale, 'ch.email') }).check();
    await drawer.getByRole('button', { name: text(locale, 'common.save'), exact: true }).click();
    await expect(page.getByText(m(locale, 'toast.rule'), { exact: true })).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(ruleRow(page, locale, 'model_switched').getByText(m(locale, 'ch.email'), { exact: true })).toBeVisible();
    // Put it back.
    await ruleRow(page, locale, 'model_switched').click();
    await page.getByRole('dialog').getByRole('checkbox', { name: m(locale, 'ch.email') }).uncheck();
    await page.getByRole('dialog').getByRole('button', { name: text(locale, 'common.save'), exact: true }).click();
    await expect(ruleRow(page, locale, 'model_switched').getByText(m(locale, 'ch.email'), { exact: true })).toHaveCount(0);
    seen.expectClean();
  });

  test('the quiet hours are edited (the start may not equal the end), saved, shown on the card and the stat, tagged "Not applied", and put back', async ({ page, baseURL }, testInfo) => {
    const seen = watch(page, baseURL);
    await startDemo(page, locale, 'administrator');
    await open(page, locale);
    await button(page, text(locale, 'common.more')).click();
    await page.getByRole('menuitem', { name: m(locale, 'menu.quiet') }).click();
    await expect(page).toHaveURL(/[?&]quiet=1/);
    const drawer = page.getByRole('dialog');
    await drawer.getByLabel(m(locale, 'qd.to'), { exact: true }).fill('23:00');
    await expect(drawer.getByText(m(locale, 'qd.same'))).toBeVisible();
    await expect(drawer.getByRole('button', { name: text(locale, 'common.save'), exact: true })).toHaveAttribute('aria-disabled', 'true');
    await drawer.getByLabel(m(locale, 'qd.from'), { exact: true }).fill('22:00');
    await drawer.getByLabel(m(locale, 'qd.to'), { exact: true }).fill('06:30');
    await drawer.getByRole('radio', { name: m(locale, 'qd.both') }).check();
    await shot(page, testInfo, locale, 'notifications-quiet-edit');
    await drawer.getByRole('button', { name: text(locale, 'common.save'), exact: true }).click();
    await expect(page.getByText(m(locale, 'toast.quiet'), { exact: true })).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(root(page).getByText(m(locale, 'range', { from: '22:00', to: '06:30' }), { exact: true }).first()).toBeVisible();
    await expect(root(page).getByText(m(locale, 'qd.both'), { exact: true })).toBeVisible();
    await expectAudit(page, locale, 'quiet_hours.updated');
    // Put it back.
    await open(page, locale, '?quiet=1');
    await page.getByRole('dialog').getByLabel(m(locale, 'qd.from'), { exact: true }).fill('23:00');
    await page.getByRole('dialog').getByLabel(m(locale, 'qd.to'), { exact: true }).fill('05:00');
    await page.getByRole('dialog').getByRole('radio', { name: m(locale, 'qd.emailOnly') }).check();
    await page.getByRole('dialog').getByRole('button', { name: text(locale, 'common.save'), exact: true }).click();
    await expect(root(page).getByText(m(locale, 'range', { from: '23:00', to: '05:00' }), { exact: true }).first()).toBeVisible();
    seen.expectClean();
  });

  test('Send test alert adds an alert for the person who sent it (it heads the log, tagged "Yours"), names the rule in the toast, and is audited', async ({ page, baseURL }, testInfo) => {
    const seen = watch(page, baseURL);
    await startDemo(page, locale, 'administrator');
    await open(page, locale);
    await button(page, m(locale, 'send')).click();
    await expect(page.getByText(m(locale, 'toast.test.title'), { exact: true })).toBeVisible();
    await expect(page.getByText(m(locale, 'toast.test.desc', { event: m(locale, 'ev.model_paused') }))).toBeVisible();
    await shot(page, testInfo, locale, 'notifications-test-sent');
    await expectAudit(page, locale, 'notification_rule.test_sent');
    await open(page, locale, '?tab=log');
    const first = logTable(page, locale).locator('tbody tr').first();
    await expect(first).toContainText('Test: model paused');
    await expect(first).toContainText(m(locale, 'log.yours'));
    await expect(first).toContainText(m(locale, 'f.unread'));
    seen.expectClean();
  });

  test('Mark read on selected alerts, and Mark all read, change only the person\'s own; the alerts for other roles stay unread', async ({ page, baseURL }, testInfo) => {
    const seen = watch(page, baseURL);
    await startDemo(page, locale, 'administrator');
    await open(page, locale, '?tab=log');
    const unreadOthers = logTable(page, locale).getByRole('row').filter({ hasText: m(locale, 'f.unread') }).filter({ hasNotText: m(locale, 'log.yours') });
    const others = await unreadOthers.count();
    expect(others).toBeGreaterThan(0);
    // One of the person's own.
    await logTable(page, locale).getByRole('row').filter({ hasText: 'Test: model paused' }).getByRole('checkbox').check();
    await button(page, m(locale, 'bulk.markRead')).click();
    // `toast.read` is an ICU plural; this chain runs in English, where one alert reads "1 alert marked read".
    await expect(page.getByText('1 alert marked read')).toBeVisible();
    await expect(logTable(page, locale).getByRole('row').filter({ hasText: 'Test: model paused' })).not.toContainText(m(locale, 'f.unread'));
    // One for another role: nothing to mark, and nothing changes.
    await logTable(page, locale).getByRole('row').filter({ hasText: 'Roster waiting for approval' }).getByRole('checkbox').check();
    await button(page, m(locale, 'bulk.markRead')).click();
    await expect(page.getByText(m(locale, 'bulk.nothing'))).toBeVisible();
    // All of the person's own.
    await open(page, locale, '?tab=log');
    await button(page, text(locale, 'common.more')).click();
    await page.getByRole('menuitem', { name: m(locale, 'menu.markAll') }).click();
    await expect(page.getByText(m(locale, 'toast.allRead'), { exact: true })).toBeVisible();
    await open(page, locale, '?tab=log&read=unread');
    await expect(logTable(page, locale).getByText(m(locale, 'log.yours'), { exact: true })).toHaveCount(0);
    await expect(logTable(page, locale).locator('tbody tr')).toHaveCount(others);
    await shot(page, testInfo, locale, 'notifications-marked-read');
    seen.expectClean();
  });

  test('Arabic: the rules and the log read in Arabic after the writes', async ({ page, baseURL }, testInfo) => {
    const seen = watch(page, baseURL);
    await startDemo(page, 'ar', 'administrator');
    await open(page, 'ar');
    await expect(rulesTable(page, 'ar').locator('tbody tr')).toHaveCount(14);
    await shot(page, testInfo, 'ar', 'notifications-rules-after');
    await open(page, 'ar', '?tab=log');
    await expect(logTable(page, 'ar').locator('tbody tr')).toHaveCount(15);
    await shot(page, testInfo, 'ar', 'notifications-log-after');
    seen.expectClean();
  });
});
