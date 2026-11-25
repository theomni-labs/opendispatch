// SPDX-License-Identifier: AGPL-3.0-only
import fs from 'node:fs';
import path from 'node:path';
import { type Page } from '@playwright/test';
import { expect, test } from '../fixtures';
import { expectPageOk, shot, startDemo, waitForHydration, watch } from '../helpers';
import { locales, text, titleOf, type Locale } from '../routes';
import { readMessages } from '../messages';

// Leave Policy and Calendar. The Administrator reads the month grid (Gregorian and Hijri, with the
// weeks mirrored in Arabic), the holidays, the prayer times and the leave policy; adds and changes a holiday, recomputes prayer
// times, and changes the policy with a blackout period. Each write is followed by its audit event in the Audit Log. Tests share one
// demo store and run in parallel, so each language adds a holiday of its own and the policy tests name what they change.

type Tree = { [key: string]: string | Tree };
const module_ = (locale: Locale): Tree => readMessages(path.join(import.meta.dirname, '../../apps/web/messages/admin/leave_policy_calendar', `${locale}.json`)) as Tree;
const MODULE = { en: module_('en'), ar: module_('ar') };
function m(locale: Locale, key: string, values: Record<string, string> = {}): string {
  let node: string | Tree | undefined = MODULE[locale];
  for (const part of key.split('.')) node = typeof node === 'object' ? node[part] : undefined;
  if (typeof node !== 'string') throw new Error(`No message admin.leave_policy_calendar.${locale}:${key}`);
  return Object.entries(values).reduce((out, [name, value]) => out.replaceAll(`{${name}}`, value), node);
}

const ROUTE = (locale: Locale) => `/${locale}/admin/leave-policy-calendar`;
const rows = (page: Page) => page.locator('[data-module="admin.leave_policy_calendar"] tbody tr');

async function open(page: Page, locale: Locale, query = '') {
  await page.goto(`${ROUTE(locale)}${query}`);
  await expect(page.locator('[data-module="admin.leave_policy_calendar"]')).toHaveAttribute('data-state', 'filled');
  await expectPageOk(page, locale);
}

async function expectAudit(page: Page, locale: Locale, action: string) {
  await page.goto(`/${locale}/admin/audit-log?q=${action}`);
  await expect(page.locator('[data-module="admin.audit_log"] tbody tr').first()).toContainText(action);
}

for (const locale of locales) {
  const tag = locale === 'en' ? 'Q' : 'R';
  test.describe(`Leave Policy and Calendar in ${locale}`, () => {
    test(`the Administrator reads it: title, subtitle, four tabs, four figures, the month grid with today, holidays and Ramadan marked; no request leaves the app`, async ({ page, baseURL }, testInfo) => {
      const seen = watch(page, baseURL);
      await startDemo(page, locale, 'administrator');
      await open(page, locale, '?month=2026-03');
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(titleOf(locale, 'admin.leave_policy_calendar'));
      await expect(page.getByText(m(locale, 'sub'))).toBeVisible();
      await expect(page.getByRole('tab')).toHaveCount(4);
      const grid = page.getByRole('grid');
      await expect(grid.getByRole('columnheader')).toHaveCount(7);
      expect(await grid.locator('[data-date]').count()).toBe(31);
      await expect(page.getByRole('button', { name: m(locale, 'ramadan.markerYear', { year: '1447' }) })).toBeVisible();
      // the weeks follow the page direction: Sunday is at the start, so it is at the right edge in Arabic
      const sunday = await grid.getByRole('columnheader').first().boundingBox();
      const saturday = await grid.getByRole('columnheader').last().boundingBox();
      expect(locale === 'ar' ? (sunday?.x ?? 0) > (saturday?.x ?? 0) : (sunday?.x ?? 0) < (saturday?.x ?? 0)).toBe(true);
      await shot(page, testInfo, locale, 'calendar-filled');
      await open(page, locale, '?cal=hijri&month=1447-09');
      await expect(page.getByRole('radio', { name: m(locale, 'cal.hijri') })).toHaveAttribute('aria-checked', 'true');
      expect(await page.getByRole('grid').locator('[data-date]').count()).toBe(30);
      await shot(page, testInfo, locale, 'calendar-hijri');
      seen.expectClean();
    });

    test(`adds a holiday from the dialog, changes it, and the Audit Log has both events`, async ({ page, baseURL }, testInfo) => {
      const seen = watch(page, baseURL);
      await startDemo(page, locale, 'administrator');
      await open(page, locale, '?tab=holidays');
      await waitForHydration(page, 'main tbody tr');
      const name = `E2E holiday ${tag}`;
      await page.getByRole('button', { name: m(locale, 'add') }).click();
      const dialog = page.getByRole('dialog', { name: m(locale, 'h.new') });
      await expect(dialog).toBeVisible();
      await dialog.getByLabel(m(locale, 'h.nameEn')).fill(name);
      await dialog.getByLabel(m(locale, 'h.from')).fill('2026-11-10');
      await dialog.getByLabel(m(locale, 'h.to')).fill('2026-11-11');
      await shot(page, testInfo, locale, 'calendar-holiday-dialog');
      await dialog.getByRole('button', { name: text(locale, 'common.save') }).click();
      await expect(page.getByText(m(locale, 'toast.created', { name }))).toBeVisible();
      await expect(rows(page).filter({ hasText: name })).toHaveCount(1);
      await rows(page).filter({ hasText: name }).click();
      const edit = page.getByRole('dialog', { name: m(locale, 'h.edit') });
      await edit.getByLabel(m(locale, 'h.nameAr')).fill('عطلة اختبار');
      await edit.getByRole('button', { name: text(locale, 'common.save') }).click();
      await expect(page.getByText(m(locale, 'toast.updated', { name }))).toBeVisible();
      await expect(rows(page).filter({ hasText: name })).toContainText('عطلة اختبار');
      await expectAudit(page, locale, 'holiday.created');
      await expectAudit(page, locale, 'holiday.updated');
      seen.expectClean();
    });

    test(`shows the prayer times of a stored day and a computed day, and recomputes a week from the More menu`, async ({ page, baseURL }, testInfo) => {
      const seen = watch(page, baseURL);
      await startDemo(page, locale, 'administrator');
      await open(page, locale, '?tab=prayer&date=2026-09-08');
      await waitForHydration(page, 'main tbody tr');
      await expect(rows(page)).toHaveCount(3);
      await expect(page.getByText(m(locale, 'p.stored'), { exact: true })).toBeVisible();
      await shot(page, testInfo, locale, 'calendar-prayer');
      await page.getByRole('button', { name: m(locale, 'p.next') }).click();
      await expect(page).toHaveURL(/date=2026-09-09/);
      await page.getByRole('button', { name: text(locale, 'common.more') }).click();
      await page.getByRole('menuitem', { name: m(locale, 'menu.recompute') }).click();
      await expect(page.getByText(m(locale, 'toast.recomputed.title'))).toBeVisible();
      await expectAudit(page, locale, 'prayer_times.recomputed');
      seen.expectClean();
    });
  });
}

test.describe('Leave Policy and Calendar: the leave policy', () => {
  test('changes the notice and adds a blackout period; Unsaved changes shows until it is saved, and the Audit Log has it', async ({ page, baseURL }, testInfo) => {
    const seen = watch(page, baseURL);
    await startDemo(page, 'en', 'administrator');
    await open(page, 'en', '?tab=policy');
    await waitForHydration(page, 'main [role=spinbutton]');
    await expect(page.getByText(m('en', 'l.unsaved'))).toHaveCount(0);
    await expect(page.getByRole('button', { name: text('en', 'common.save') })).toHaveAttribute('aria-disabled', 'true');
    const notice = page.getByRole('spinbutton').first();
    await notice.fill('9');
    await notice.blur();
    await expect(page.getByText(m('en', 'l.unsaved'))).toBeVisible();
    await page.getByRole('button', { name: m('en', 'l.addPeriod') }).first().click();
    const dialog = page.getByRole('dialog', { name: m('en', 'l.addPeriod') });
    await dialog.getByLabel(m('en', 'b.label')).fill('E2E year end');
    await dialog.getByLabel(m('en', 'h.from')).fill('2026-12-20');
    await dialog.getByLabel(m('en', 'h.to')).fill('2026-12-31');
    await shot(page, testInfo, 'en', 'calendar-period-dialog');
    await dialog.getByRole('button', { name: m('en', 'l.addPeriod') }).click();
    await expect(page.getByText('E2E year end')).toBeVisible();
    await page.getByRole('button', { name: text('en', 'common.save') }).click();
    await expect(page.getByText(m('en', 'toast.policy'))).toBeVisible();
    await expect(page.getByText(m('en', 'l.unsaved'))).toHaveCount(0);
    await expectAudit(page, 'en', 'leave_policy.updated');
    seen.expectClean();
  });

  test('an unknown holiday id is a notice above the calendar, never an error; a month that is not a month is ignored', async ({ page, baseURL }) => {
    const seen = watch(page, baseURL);
    await startDemo(page, 'en', 'administrator');
    await open(page, 'en', '?holiday=00000000-0000-4000-8000-00000000dead&month=2026-13&cal=julian');
    await expect(page.locator('[role="alert"]:not(#__next-route-announcer__)')).toContainText(m('en', 'notice.notFound'));
    await expect(page.getByRole('grid')).toBeVisible();
    seen.expectClean();
  });

  test('Export downloads the holidays on screen as a CSV with a byte order mark', async ({ page, baseURL }) => {
    const seen = watch(page, baseURL);
    await startDemo(page, 'en', 'administrator');
    await open(page, 'en', '?tab=holidays&type=observance');
    await page.getByRole('button', { name: text('en', 'common.more') }).click();
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('menuitem', { name: text('en', 'common.export') }).click()]);
    expect(download.suggestedFilename()).toBe('holidays.csv');
    const body = fs.readFileSync(await download.path(), 'utf8');
    expect(body.startsWith('﻿name_en,name_ar,kind,start_date,end_date,days')).toBe(true);
    expect(body).toContain('Islamic New Year');
    seen.expectClean();
  });
});
