// SPDX-License-Identifier: AGPL-3.0-only
import path from 'node:path';
import { type Page } from '@playwright/test';
import { expect, test } from '../fixtures';
import { expectPageOk, shot, startDemo, waitForHydration, watch } from '../helpers';
import { locales, text, titleOf, type Locale } from '../routes';
import { readMessages } from '../messages';

// Data Sources and Integrations. The Administrator reads the feeds, the stage
// per zone and the fallback, tests a feed and all feeds (LABELLED STUBS: nothing is sent), switches a feed, changes a stage
// (the automatic one shows the warning and the "Not applied" tag: guardrail 11 is not enforced yet), sends the fallback signal and
// resumes, switches maintenance mode on and off, saves the fallback settings, sets all zones to shadow and exports the stage table.
// Each write is followed by its audit event in the Audit Log. The stage, fallback and feed state is ONE state for the whole run, so
// the write flows are one serial chain; the tests before it only read (both languages).

type Tree = { [key: string]: string | Tree };
const module_ = (locale: Locale): Tree => readMessages(path.join(import.meta.dirname, '../../apps/web/messages/admin/data_sources', `${locale}.json`)) as Tree;
const MODULE = { en: module_('en'), ar: module_('ar') };
/** A key of the module's own message file (`fb.send`), with `{zone}` style values put in. */
function m(locale: Locale, key: string, values: Record<string, string> = {}): string {
  let node: string | Tree | undefined = MODULE[locale];
  for (const part of key.split('.')) node = typeof node === 'object' ? node[part] : undefined;
  if (typeof node !== 'string') throw new Error(`No message admin.data_sources.${locale}:${key}`);
  return Object.entries(values).reduce((out, [name, value]) => out.replaceAll(`{${name}}`, value), node);
}

const ROUTE = (locale: Locale) => `/${locale}/admin/data-sources`;
const root = (page: Page) => page.locator('[data-module="admin.data_sources"]');
const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true });
const stageName = (locale: Locale, stage: string) => text(locale, `opendispatch.stage.${stage}`);

async function open(page: Page, locale: Locale, query = '') {
  await page.goto(`${ROUTE(locale)}${query}`);
  await expect(root(page)).toHaveAttribute('data-state', 'filled');
  await expectPageOk(page, locale);
  await waitForHydration(page, '[data-module="admin.data_sources"] button');
}

/** The Audit Log filtered by an action code: the write's event is there. */
async function expectAudit(page: Page, locale: Locale, action: string) {
  await page.goto(`/${locale}/admin/audit-log?q=${action}`);
  await expect(page.locator('[data-module="admin.audit_log"] tbody tr').first()).toContainText(action);
}

for (const locale of locales) {
  test.describe(`Data Sources, read only, in ${locale}`, () => {
    test(`the Administrator reads the screen: title, Test all and More, four figures, five feeds, the stage table with eight zones, the fallback`, async ({ page, baseURL }, testInfo) => {
      const seen = watch(page, baseURL);
      await startDemo(page, locale, 'administrator');
      await open(page, locale);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(titleOf(locale, 'admin.data_sources'));
      await expect(button(page, m(locale, 'testAll'))).toBeEnabled();
      await expect(button(page, text(locale, 'common.more'))).toBeVisible();
      for (const key of ['stat.healthy', 'stat.degraded', 'stat.off', 'stat.timeout']) await expect(root(page).getByText(m(locale, key), { exact: true }).first()).toBeVisible();
      for (const kind of ['case_feed', 'agent_feed', 'assignment_channel', 'weather_feed', 'routing_feed']) await expect(page.locator(`[data-feed="${kind}"]`)).toBeVisible();
      await expect(page.getByRole('table', { name: m(locale, 'stage.title') }).locator('tbody tr')).toHaveCount(8);
      await expect(root(page).getByText(text(locale, 'common.illustrative')).first()).toBeVisible();
      await expect(page.locator('[data-stub="demo"]').first()).toBeVisible();
      await shot(page, testInfo, locale, 'data-sources-filled');
      seen.expectClean();
    });

    test(`the review states ?state=empty, loading and error keep the header and show their text`, async ({ page, baseURL }, testInfo) => {
      const seen = watch(page, baseURL);
      await startDemo(page, locale, 'administrator');
      for (const state of ['empty', 'loading', 'error'] as const) {
        await page.goto(`${ROUTE(locale)}?state=${state}`);
        await expect(root(page)).toHaveAttribute('data-state', state);
        await expect(page.getByRole('heading', { level: 1 })).toHaveText(titleOf(locale, 'admin.data_sources'));
        await shot(page, testInfo, locale, `data-sources-${state}`);
      }
      await page.goto(`${ROUTE(locale)}?state=empty`);
      await expect(page.getByText(m(locale, 'states.empty.title'))).toBeVisible();
      seen.expectClean();
    });
  });
}

test.describe.serial('Data Sources, the writes', () => {
  const locale: Locale = 'en';

  test('a feed is tested (a scripted answer), Test all reports, and a feed is switched on and off', async ({ page, baseURL }, testInfo) => {
    const seen = watch(page, baseURL);
    await startDemo(page, locale, 'administrator');
    await open(page, locale);
    await page.locator('[data-feed="case_feed"]').getByRole('button', { name: m(locale, 'test'), exact: true }).click();
    await expect(page.getByText(/^Case feed answered in \d+ ms$/)).toBeVisible();
    await button(page, m(locale, 'testAll')).click();
    await expect(page.getByText(m(locale, 'toast.all.title'))).toBeVisible();
    await shot(page, testInfo, locale, 'data-sources-tested');
    await page.locator('[data-feed="weather_feed"]').getByRole('switch').click();
    await expect(page.getByText(m(locale, 'toast.on', { feed: m(locale, 'feed.weather_feed') }))).toBeVisible();
    await expect(page.locator('[data-feed="weather_feed"]').getByRole('switch')).toHaveAttribute('aria-checked', 'true');
    await page.locator('[data-feed="weather_feed"]').getByRole('switch').click();
    await expect(page.locator('[data-feed="weather_feed"]').getByRole('switch')).toHaveAttribute('aria-checked', 'false');
    for (const action of ['integration.tested', 'integration.updated']) await expectAudit(page, locale, action);
    seen.expectClean();
  });

  test('a stage change asks for confirmation (the automatic one warns and says the guardrail is not applied) and is audited; All zones to shadow undoes them', async ({ page, baseURL }, testInfo) => {
    const seen = watch(page, baseURL);
    await startDemo(page, locale, 'administrator');
    await open(page, locale);
    await page.getByRole('radiogroup', { name: 'RD-E' }).getByRole('radio', { name: stageName(locale, 'automatic') }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText(m(locale, 'm.autoWarn'))).toBeVisible();
    await expect(dialog.locator('[data-stub="notApplied"]')).toBeVisible();
    await shot(page, testInfo, locale, 'data-sources-stage-confirm');
    await dialog.getByRole('textbox').fill('Shadow results look right in the test.');
    await dialog.getByRole('button', { name: text(locale, 'common.confirm'), exact: true }).click();
    await expect(page.getByText(m(locale, 'toast.stage', { zone: 'RD-E', stage: stageName(locale, 'automatic') }))).toBeVisible();
    await expect(page.getByRole('radiogroup', { name: 'RD-E' }).getByRole('radio', { name: stageName(locale, 'automatic') })).toHaveAttribute('aria-checked', 'true');
    // RD-E sits low enough in the zone list that reaching it scrolls the page; a plain click on More would still find and
    // scroll to it, but that scroll is what closes the just-opened menu (it reads as an outside interaction), so scroll first.
    await button(page, text(locale, 'common.more')).scrollIntoViewIfNeeded();
    await button(page, text(locale, 'common.more')).click();
    await page.getByRole('menuitem', { name: m(locale, 'menu.allShadow') }).click();
    await expect(page.getByRole('dialog').getByText(m(locale, 'm.all'))).toBeVisible();
    await page.getByRole('dialog').getByRole('button', { name: text(locale, 'common.confirm'), exact: true }).click();
    await expect(page.getByText(m(locale, 'toast.allShadow'))).toBeVisible();
    await expect(page.getByRole('radiogroup', { name: 'RD-C' }).getByRole('radio', { name: stageName(locale, 'shadow') })).toHaveAttribute('aria-checked', 'true');
    await expectAudit(page, locale, 'settings.zone_stage_changed');
    seen.expectClean();
  });

  test('the fallback: settings are saved, the signal needs a reason and operator dispatch is asked to assign, then OpenDispatch resumes; maintenance mode goes on and off', async ({ page, baseURL }, testInfo) => {
    const seen = watch(page, baseURL);
    await startDemo(page, locale, 'administrator');
    await open(page, locale);
    const timeout = page.getByRole('spinbutton', { name: m(locale, 'fb.timeout') });
    // A value per locale: a shared database keeps the other run's.
    const seconds = locale === 'en' ? '8' : '9';
    await timeout.fill(seconds);
    await timeout.blur();
    await button(page, text(locale, 'common.save')).click();
    await expect(page.getByText(m(locale, 'toast.fbSaved'))).toBeVisible();
    await expect(page.getByText(m(locale, 'fb.meta.armed', { s: seconds }))).toBeVisible();
    await button(page, m(locale, 'fb.send')).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('button', { name: text(locale, 'common.confirm'), exact: true })).toHaveAttribute('aria-disabled', 'true');
    await dialog.getByRole('textbox').fill('Testing the fallback end to end.');
    await dialog.getByRole('button', { name: text(locale, 'common.confirm'), exact: true }).click();
    await expect(page.getByText(m(locale, 'fb.state.active'))).toBeVisible();
    await shot(page, testInfo, locale, 'data-sources-fallback-active');
    await button(page, m(locale, 'fb.resume')).click();
    await page.getByRole('dialog').getByRole('textbox').fill('Back to OpenDispatch.');
    await page.getByRole('dialog').getByRole('button', { name: text(locale, 'common.confirm'), exact: true }).click();
    await expect(page.getByText(m(locale, 'fb.state.armed'))).toBeVisible();
    await page.getByRole('switch', { name: m(locale, 'mnt.switch') }).click();
    await expect(page.getByText(m(locale, 'fb.state.maintenance')).first()).toBeVisible();
    await expect(page.locator('[data-feed="case_feed"]').getByText(m(locale, 'busy'))).toBeVisible();
    await shot(page, testInfo, locale, 'data-sources-maintenance');
    await page.getByRole('switch', { name: m(locale, 'mnt.switch') }).click();
    await expect(page.getByText(m(locale, 'fb.state.armed'))).toBeVisible();
    for (const action of ['settings.live_assignment_changed', 'fallback.signal_sent', 'fallback.maintenance_changed']) await expectAudit(page, locale, action);
    seen.expectClean();
  });

  test('Export saves the stage table as a CSV, and the Arabic page draws what the flows left', async ({ page, baseURL }, testInfo) => {
    const seen = watch(page, baseURL);
    await startDemo(page, locale, 'administrator');
    await open(page, locale);
    await button(page, text(locale, 'common.more')).click();
    const download = page.waitForEvent('download');
    await page.getByRole('menuitem', { name: text(locale, 'common.export') }).click();
    expect((await download).suggestedFilename()).toBe('zone-stages.csv');
    await open(page, 'ar');
    await shot(page, testInfo, 'ar', 'data-sources-after');
    seen.expectClean();
  });
});
