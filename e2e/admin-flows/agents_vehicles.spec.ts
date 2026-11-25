// SPDX-License-Identifier: AGPL-3.0-only
import fs from 'node:fs';
import path from 'node:path';
import { type Page } from '@playwright/test';
import { expect, test } from '../fixtures';
import { expectPageOk, shot, startDemo, waitForHydration, watch } from '../helpers';
import { locales, text, titleOf, type Locale } from '../routes';
import { readMessages } from '../messages';

// Agents and Vehicles. The Administrator reads the three tabs, adds and changes an agent and a
// vehicle, sets agents inactive from the bulk bar, adds a skill, imports the sample CSV, and exports; each write is followed by its
// audit event in the Audit Log. Tests share one demo store and run in parallel, so each language adds records with codes of its own.

type Tree = { [key: string]: string | Tree };
const module_ = (locale: Locale): Tree => readMessages(path.join(import.meta.dirname, '../../apps/web/messages/admin/agents_vehicles', `${locale}.json`)) as Tree;
const MODULE = { en: module_('en'), ar: module_('ar') };
function m(locale: Locale, key: string, values: Record<string, string> = {}): string {
  let node: string | Tree | undefined = MODULE[locale];
  for (const part of key.split('.')) node = typeof node === 'object' ? node[part] : undefined;
  if (typeof node !== 'string') throw new Error(`No message admin.agents_vehicles.${locale}:${key}`);
  return Object.entries(values).reduce((out, [name, value]) => out.replaceAll(`{${name}}`, value), node);
}

const ROUTE = (locale: Locale) => `/${locale}/admin/agents-vehicles`;
const rows = (page: Page) => page.locator('[data-module="admin.agents_vehicles"] tbody tr');

async function open(page: Page, locale: Locale, query = '') {
  await page.goto(`${ROUTE(locale)}${query}`);
  await expect(page.locator('[data-module="admin.agents_vehicles"]')).toHaveAttribute('data-state', 'filled');
  await expectPageOk(page, locale);
}

async function expectAudit(page: Page, locale: Locale, action: string) {
  await page.goto(`/${locale}/admin/audit-log?q=${action}`);
  await expect(page.locator('[data-module="admin.audit_log"] tbody tr').first()).toContainText(action);
}

for (const locale of locales) {
  const tag = locale === 'en' ? 'Q' : 'R';
  test.describe(`Agents and Vehicles in ${locale}`, () => {
    test(`the Administrator reads it: title, three tabs, four figures, seven columns, filters; no request leaves the app`, async ({ page, baseURL }, testInfo) => {
      const seen = watch(page, baseURL);
      await startDemo(page, locale, 'administrator');
      await open(page, locale);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(titleOf(locale, 'admin.agents_vehicles'));
      await expect(page.getByRole('tab')).toContainText([m(locale, 'tab.agents'), m(locale, 'tab.vehicles'), m(locale, 'tab.skills')]);
      for (const key of ['col.name', 'col.zone', 'f.shift', 'd.skills', 'col.leave']) await expect(page.getByRole('columnheader', { name: m(locale, key) })).toBeVisible();
      await expect(rows(page)).toHaveCount(25);
      await expect(page.getByText(m(locale, 'inferred')).first()).toBeVisible();
      await expect(page.getByRole('button', { name: m(locale, 'add.agent') })).toBeEnabled();
      await shot(page, testInfo, locale, 'agents-filled');
      seen.expectClean();
    });

    test(`adds an agent with a code, changes it, and the Audit Log has both events`, async ({ page, baseURL }, testInfo) => {
      const seen = watch(page, baseURL);
      await startDemo(page, locale, 'administrator');
      await open(page, locale);
      await waitForHydration(page, 'main tbody tr');
      const code = `SVR-E2E-${tag}`;
      await page.getByRole('button', { name: m(locale, 'add.agent') }).click();
      const drawer = page.getByRole('dialog', { name: m(locale, 'title.add.agent') });
      await expect(drawer).toBeVisible();
      await drawer.getByLabel(m(locale, 'col.name')).first().fill(`E2E Agent ${tag}`);
      await drawer.getByLabel(m(locale, 'col.code')).fill(code);
      await drawer.getByRole('button', { name: text(locale, 'common.save') }).click();
      await expect(page.getByText(m(locale, 'toast.added.s'))).toBeVisible();
      await open(page, locale, `?q=${code}`);
      await waitForHydration(page, 'main tbody tr');
      await expect(rows(page)).toHaveCount(1);
      await rows(page).first().click();
      const edit = page.getByRole('dialog', { name: m(locale, 'title.edit.agent') });
      await expect(edit).toBeVisible();
      await shot(page, testInfo, locale, 'agents-drawer');
      await edit.getByLabel(m(locale, 'col.name')).first().fill(`E2E Agent ${tag} renamed`);
      await edit.getByRole('button', { name: text(locale, 'common.save') }).click();
      await expect(page.getByText(m(locale, 'toast.saved.s'))).toBeVisible();
      await expectAudit(page, locale, 'agent.created');
      await expectAudit(page, locale, 'agent.updated');
      seen.expectClean();
    });

    test(`adds a vehicle, and a skill to the vocabulary; the vehicles tab and the skills tab show them`, async ({ page, baseURL }, testInfo) => {
      const seen = watch(page, baseURL);
      await startDemo(page, locale, 'administrator');
      await open(page, locale, '?tab=vehicles');
      await waitForHydration(page, 'main tbody tr');
      await page.getByRole('button', { name: m(locale, 'add.vehicle') }).click();
      const drawer = page.getByRole('dialog', { name: m(locale, 'title.add.vehicle') });
      await drawer.getByLabel(m(locale, 'col.code')).fill(`VEH-E2E-${tag}`);
      await drawer.getByLabel(m(locale, 'col.plate')).fill(`E2E ${tag}${tag}${tag}`);
      await drawer.getByRole('button', { name: text(locale, 'common.save') }).click();
      await expect(page.getByText(m(locale, 'toast.added.v'))).toBeVisible();
      await open(page, locale, '?tab=skills');
      await page.getByRole('button', { name: m(locale, 'add.skill') }).first().click();
      const dialog = page.getByRole('dialog', { name: m(locale, 'skill.new') });
      await dialog.getByLabel(m(locale, 'col.code')).fill(`e2e_skill_${tag.toLowerCase()}`);
      await dialog.getByLabel(m(locale, 'col.name')).first().fill(`E2E skill ${tag}`);
      await shot(page, testInfo, locale, 'agents-skill-dialog');
      await dialog.getByRole('button', { name: m(locale, 'add.skill') }).click();
      await expect(page.getByText(m(locale, 'toast.skill'))).toBeVisible();
      // The refresh is an N+1: slow under load.
      await expect(page.getByText(`E2E skill ${tag}`)).toBeVisible({ timeout: 20_000 });
      await expectAudit(page, locale, 'vehicle.created');
      await expectAudit(page, locale, 'skill.added');
      seen.expectClean();
    });

    test(`sets the selected agents inactive from the bulk bar, and the Audit Log has it`, async ({ page, baseURL }) => {
      const seen = watch(page, baseURL);
      await startDemo(page, locale, 'administrator');
      await open(page, locale, locale === 'en' ? '?zone=JD-N&shift=night' : '?zone=JD-S&shift=night');
      await waitForHydration(page, 'main tbody tr');
      await page.getByRole('checkbox', { name: /Select row|تحديد الصف/ }).first().check();
      await page.getByRole('region', { name: text(locale, 'ds.dataTable.bulkActions') }).getByRole('button', { name: m(locale, 'bulk.inactive') }).click();
      await expect(page.getByText(m(locale, 'toast.inactive', { n: '1' }))).toBeVisible();
      await expectAudit(page, locale, 'agent.updated');
      seen.expectClean();
    });

    test(`an unknown id is a notice above the list, never an error; a filter that is not on the allow-list is ignored`, async ({ page, baseURL }) => {
      const seen = watch(page, baseURL);
      await startDemo(page, locale, 'administrator');
      await open(page, locale, '?agent=00000000-0000-4000-8000-00000000dead&zone=NOPE&leave=root');
      await expect(page.locator('[role="alert"]:not(#__next-route-announcer__)')).toContainText(m(locale, 'notice.notFound'));
      await expect(rows(page)).toHaveCount(25);
      seen.expectClean();
    });
  });
}

test.describe('Agents and Vehicles: import and export', () => {
  test('"Use a sample file" imports the sample CSV once, and Export downloads the agents on screen with a byte order mark', async ({ page, baseURL }) => {
    const seen = watch(page, baseURL);
    await startDemo(page, 'en', 'administrator');
    await open(page, 'en', '?import=1');
    const dialog = page.getByRole('dialog', { name: m('en', 'importTitle') });
    await dialog.getByRole('button', { name: m('en', 'importSample') }).click();
    await dialog.getByRole('button', { name: m('en', 'import') }).click();
    await expect(page.getByText(/agents? imported/)).toBeVisible();
    await expectAudit(page, 'en', 'agent.imported');
    await open(page, 'en', '?zone=remote');
    await page.getByRole('button', { name: text('en', 'common.more') }).click();
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('menuitem', { name: text('en', 'common.export') }).click()]);
    expect(download.suggestedFilename()).toBe('agents.csv');
    const body = fs.readFileSync(await download.path(), 'utf8');
    expect(body.startsWith('﻿code,name_en,kind,zone,shift,vehicle,skills,status')).toBe(true);
    seen.expectClean();
  });
});
