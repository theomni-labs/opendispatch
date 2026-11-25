// SPDX-License-Identifier: AGPL-3.0-only
import fs from 'node:fs';
import path from 'node:path';
import { type Page } from '@playwright/test';
import { expect, test } from '../fixtures';
import { expectPageOk, shot, startDemo, waitForHydration, watch } from '../helpers';
import { landingOf, locales, text, titleOf, type Locale } from '../routes';
import { readMessages } from '../messages';

// Users and Roles. The module that grants every other role its access: an Administrator
// reads the two tabs (Users, Roles), invites a person through the three-step drawer, edits their name and role, disables
// and re-enables an existing account (never their own, never the last Administrator), bulk-disables from the table,
// exports the list, runs the two LABELLED STUB emergency-administrator resets, and switches the demo session to another
// person's role. Every write is followed by its audit event. Access and no-access shapes for every other role are covered
// by admin-matrix.spec.ts, not repeated here (locations.spec.ts and most module specs follow the same split).

type Tree = { [key: string]: string | Tree };
const module_ = (locale: Locale): Tree => readMessages(path.join(import.meta.dirname, '../../apps/web/messages/admin/users_roles', `${locale}.json`)) as Tree;
const MODULE = { en: module_('en'), ar: module_('ar') };
function m(locale: Locale, key: string, values: Record<string, string> = {}): string {
  let node: string | Tree | undefined = MODULE[locale];
  for (const part of key.split('.')) node = typeof node === 'object' ? node[part] : undefined;
  if (typeof node !== 'string') throw new Error(`No message admin.users_roles.${locale}:${key}`);
  return Object.entries(values).reduce((out, [name, value]) => out.replaceAll(`{${name}}`, value), node);
}

const ROUTE = (locale: Locale) => `/${locale}/admin/users-roles`;
const rows = (page: Page) => page.locator('[data-module="admin.users_roles"] tbody tr');
const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true });

async function open(page: Page, locale: Locale, query = '') {
  await page.goto(`${ROUTE(locale)}${query}`);
  await expect(page.locator('[data-module="admin.users_roles"]')).toHaveAttribute('data-state', 'filled');
  await expectPageOk(page, locale);
  await waitForHydration(page, 'main tbody tr');
}

/** The Audit Log filtered by an action code: the write's event is there. */
async function expectAudit(page: Page, locale: Locale, action: string) {
  await page.goto(`/${locale}/admin/audit-log?q=${action}`);
  await expect(page.locator('[data-module="admin.audit_log"] tbody tr').first()).toContainText(action);
}

for (const locale of locales) {
  test.describe(`Users and Roles in ${locale}`, () => {
    test('the Administrator reads it: title, four figures, two tabs, columns, Invite and More; no request leaves the app', async ({ page, baseURL }, testInfo) => {
      const seen = watch(page, baseURL);
      await startDemo(page, locale, 'administrator');
      await open(page, locale);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(titleOf(locale, 'admin.users_roles'));
      // Each tab's accessible name is its label with the section's count appended (UrlTabs), so this is a substring check.
      const tabs = page.getByRole('tab');
      await expect(tabs).toHaveCount(2);
      await expect(tabs.nth(0)).toContainText(m(locale, 'tab.users'));
      await expect(tabs.nth(1)).toContainText(m(locale, 'tab.roles'));
      for (const key of ['st.total', 'status.active', 'status.invited', 'status.disabled']) await expect(page.getByText(m(locale, key), { exact: true }).first()).toBeVisible();
      await expect(page.getByRole('columnheader')).toContainText([m(locale, 'col.name'), m(locale, 'col.role'), m(locale, 'col.scope'), text(locale, 'common.status')]);
      expect(await rows(page).count()).toBeGreaterThanOrEqual(10);
      await expect(button(page, m(locale, 'invite'))).toBeEnabled();
      await expect(button(page, text(locale, 'common.more'))).toBeEnabled();
      await shot(page, testInfo, locale, 'users-roles-filled');
      seen.expectClean();
    });

    test('the Roles tab: install mode switches the matrix, and a role row shows its effective access', async ({ page, baseURL }, testInfo) => {
      const seen = watch(page, baseURL);
      await startDemo(page, locale, 'administrator');
      await open(page, locale, '?tab=roles');
      // Change Approver's row button also carries a "Private installs only" sub-label in its accessible name; the row
      // itself always lists all seven roles (only the matrix and the effective-access panel change with the mode).
      const changeApprover = page.getByRole('button', { name: new RegExp(`^${text(locale, 'roles.change_approver')}`) });
      await expect(changeApprover).toBeVisible();
      await shot(page, testInfo, locale, 'users-roles-roles-tab');
      // Change Approver exists only in a private install: selected in "shared", it reads as not
      // applicable. The message also sits, word for word, in the row's own sub-label, so it is scoped to the
      // effective-access panel's own text style, not the role-picker row.
      await changeApprover.click();
      await page.getByRole('radio', { name: text(locale, 'installModes.shared'), exact: true }).click();
      await expect(page.locator('[class*="meta"]').filter({ hasText: m(locale, 'reason.privateOnly') })).toBeVisible();
      await page.getByRole('radio', { name: text(locale, 'installModes.private'), exact: true }).click();
      await page.getByRole('button', { name: text(locale, 'roles.administrator'), exact: true }).click();
      await expect(page.getByText(m(locale, 'eff.title'))).toBeVisible();
      // The Administrator can edit its own module: a concrete chip that must always be in the "can edit" group.
      const editGroup = page.locator('[data-access-group]').filter({ hasText: m(locale, 'acc.edit') });
      await expect(editGroup).toBeVisible();
      await expect(editGroup.getByText(titleOf(locale, 'admin.users_roles'), { exact: true })).toBeVisible();
      seen.expectClean();
    });

    test('the review states ?state=empty, loading and error keep the header and show their text', async ({ page, baseURL }) => {
      const seen = watch(page, baseURL);
      await startDemo(page, locale, 'administrator');
      for (const state of ['empty', 'loading', 'error'] as const) {
        await page.goto(`${ROUTE(locale)}?state=${state}`);
        await expect(page.getByRole('heading', { level: 1 })).toHaveText(titleOf(locale, 'admin.users_roles'));
        if (state === 'empty') await expect(page.getByText(m(locale, 'states.empty.desc'))).toBeVisible();
        if (state === 'error') await expect(page.getByText(m(locale, 'states.error.desc'))).toBeVisible();
      }
      seen.expectClean();
    });
  });
}

test.describe.serial('Users and Roles, the writes', () => {
  const locale: Locale = 'en';
  const inviteName = 'E2E Person Q';
  const inviteEmail = 'e2e.person.q@demo.example';

  test('invites a person through the three-step drawer (person, role and zones, review), and the Audit Log has it', async ({ page, baseURL }, testInfo) => {
    const seen = watch(page, baseURL);
    await startDemo(page, locale, 'administrator');
    await open(page, locale);
    await button(page, m(locale, 'invite')).click();
    const drawer = page.getByRole('dialog');
    await expect(drawer).toBeVisible();
    await drawer.getByLabel(m(locale, 'w.name')).fill(inviteName);
    await drawer.getByLabel(m(locale, 'col.email')).fill(inviteEmail);
    await button(page, text(locale, 'common.next')).click();
    // Step 2: the default role (Dispatcher) is zone-scoped, so Next is blocked until a zone is chosen.
    await expect(page.getByText(m(locale, 'need.zone'))).toBeVisible();
    await page.getByRole('checkbox', { name: 'RD-C', exact: true }).check();
    await button(page, text(locale, 'common.next')).click();
    // Step 3: review, with the effective access this role gets.
    await expect(drawer.getByText(inviteName)).toBeVisible();
    await expect(drawer.getByText(m(locale, 'eff.title'))).toBeVisible();
    await shot(page, testInfo, locale, 'users-roles-invite-review');
    await button(page, m(locale, 'w.send')).click();
    await expect(page.getByText(m(locale, 'toast.invited.title'))).toBeVisible();
    await expect(page).toHaveURL(/[?&]id=/);
    await expect(page.getByRole('dialog').getByText(inviteName)).toBeVisible();
    await expectAudit(page, locale, 'user.created');
    seen.expectClean();
  });

  test("edits the invited person's name and role; changing to a role with no zones clears the zone requirement", async ({ page, baseURL }) => {
    const seen = watch(page, baseURL);
    await startDemo(page, locale, 'administrator');
    await open(page, locale);
    await rows(page).filter({ hasText: inviteName }).click();
    const drawer = page.getByRole('dialog');
    await expect(drawer).toBeVisible();
    await drawer.getByRole('button', { name: m(locale, 'd.edit'), exact: true }).click();
    const editedName = 'E2E Person Q Edited';
    await drawer.getByLabel(m(locale, 'w.name')).fill(editedName);
    await drawer.getByRole('radio', { name: text(locale, 'roles.viewer_auditor'), exact: true }).click();
    await expect(page.getByText(m(locale, 'zones.none'))).toBeVisible();
    await button(page, text(locale, 'common.save')).click();
    await expect(page.getByText(m(locale, 'toast.updated'))).toBeVisible();
    await expect(rows(page).filter({ hasText: editedName })).toHaveCount(1);
    await expect(rows(page).filter({ hasText: editedName })).toContainText(text(locale, 'roles.viewer_auditor'));
    await expectAudit(page, locale, 'user.updated');
    seen.expectClean();
  });

  test('the Administrator cannot disable their own account: the reason is on the button, not a confirm dialog', async ({ page, baseURL }) => {
    const seen = watch(page, baseURL);
    await startDemo(page, locale, 'administrator');
    await open(page, locale);
    await rows(page).filter({ hasText: 'Nadia Al-Ghalani' }).click();
    const drawer = page.getByRole('dialog');
    await expect(drawer).toBeVisible();
    await expect(drawer.getByRole('button', { name: m(locale, 'd.disable'), exact: true })).toHaveAttribute('aria-disabled', 'true');
    seen.expectClean();
  });

  test('disables an account after a confirmation, then re-enables it; both audited', async ({ page, baseURL }, testInfo) => {
    const seen = watch(page, baseURL);
    await startDemo(page, locale, 'administrator');
    await open(page, locale);
    await rows(page).filter({ hasText: 'Tariq Al-Dubari' }).click();
    const drawer = page.getByRole('dialog');
    await expect(drawer).toBeVisible();
    await drawer.getByRole('button', { name: m(locale, 'd.disable'), exact: true }).click();
    const confirm = page.getByRole('dialog', { name: m(locale, 'disable.title', { name: 'Tariq Al-Dubari' }) });
    await expect(confirm).toBeVisible();
    await shot(page, testInfo, locale, 'users-roles-disable-confirm');
    await confirm.getByRole('button', { name: m(locale, 'disable.ok'), exact: true }).click();
    await expect(page.getByText(m(locale, 'toast.disabled'))).toBeVisible();
    await expect(rows(page).filter({ hasText: 'Tariq Al-Dubari' })).toContainText(m(locale, 'status.disabled'));
    // Re-enable: the confirm dialog closed, but the record drawer itself stayed open (only the confirm's own state
    // reset), now showing Enable user instead of Disable user.
    await expect(drawer).toBeVisible();
    await drawer.getByRole('button', { name: m(locale, 'd.enable'), exact: true }).click();
    await expect(page.getByText(m(locale, 'toast.enabled'))).toBeVisible();
    await expect(rows(page).filter({ hasText: 'Tariq Al-Dubari' })).toContainText(m(locale, 'status.active'));
    // expectAudit navigates away, so it is last: both events are already written by the time either is checked.
    await expectAudit(page, locale, 'user.disabled');
    await expectAudit(page, locale, 'user.enabled');
    seen.expectClean();
  });

  test('bulk-disables two people from the table, and each has its own audit event', async ({ page, baseURL }) => {
    const seen = watch(page, baseURL);
    await startDemo(page, locale, 'administrator');
    await open(page, locale);
    // The row checkbox is named after the record ("Select row Yousef Al-Musari"), by the design system's own dataTable.selectRow.
    for (const name of ['Yousef Al-Musari', 'Maha Al-Khayani']) await page.getByRole('checkbox', { name: new RegExp(name) }).check();
    await page.getByRole('region', { name: text(locale, 'ds.dataTable.bulkActions') }).getByRole('button', { name: m(locale, 'bulk.disable'), exact: true }).click();
    // toast.disabledN is an ICU plural; this flow runs in English, where two people read "2 users disabled".
    await expect(page.getByText('2 users disabled')).toBeVisible();
    for (const name of ['Yousef Al-Musari', 'Maha Al-Khayani']) await expect(rows(page).filter({ hasText: name })).toContainText(m(locale, 'status.disabled'));
    await page.goto(`/${locale}/admin/audit-log?q=user.disabled`);
    await expect(page.locator('[data-module="admin.audit_log"] tbody tr')).toHaveCount(3); // Tariq (already re-enabled, but the disable event stays), Yousef, Maha
    seen.expectClean();
  });

  test('Export downloads every person as a CSV in the table\'s columns, with a byte order mark', async ({ page, baseURL }) => {
    const seen = watch(page, baseURL);
    await startDemo(page, locale, 'administrator');
    await open(page, locale);
    await button(page, text(locale, 'common.more')).click();
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('menuitem', { name: m(locale, 'export'), exact: true }).click()]);
    expect(download.suggestedFilename()).toBe('users.csv');
    const body = fs.readFileSync(await download.path(), 'utf8');
    expect(body.startsWith(`﻿${m(locale, 'col.name')}`)).toBe(true);
    expect(body).toContain('E2E Person Q Edited');
    await expect(page.getByText(m(locale, 'toast.export'))).toBeVisible();
    seen.expectClean();
  });

  test('the emergency administrator\'s two resets are LABELLED STUBS: a toast that says so, and both audited', async ({ page, baseURL }) => {
    const seen = watch(page, baseURL);
    await startDemo(page, locale, 'administrator');
    await open(page, locale);
    await button(page, text(locale, 'common.more')).click();
    await page.getByRole('menuitem', { name: m(locale, 'reset.password'), exact: true }).click();
    // "Demo" also names the header's own demo-controls pill, so it is scoped to the toast region.
    const toastRegion = page.getByRole('region', { name: text(locale, 'ds.toast.region') });
    await expect(toastRegion.getByText(m(locale, 'toast.pwd'))).toBeVisible();
    await expect(toastRegion.getByText(text(locale, 'patterns.stub.demo'))).toBeVisible();
    await button(page, text(locale, 'common.more')).click();
    await page.getByRole('menuitem', { name: m(locale, 'reset.mfa'), exact: true }).click();
    await expect(page.getByText(m(locale, 'toast.mfa'))).toBeVisible();
    await expectAudit(page, locale, 'emergency_admin.password_reset');
    await expectAudit(page, locale, 'emergency_admin.mfa_reset');
    seen.expectClean();
  });

  test('"Switch to this user" (a Demo stub) signs the session in as that person\'s role, on their landing page', async ({ page, baseURL }) => {
    const seen = watch(page, baseURL);
    await startDemo(page, locale, 'administrator');
    await open(page, locale);
    await rows(page).filter({ hasText: 'Reem Al-Hinari' }).click();
    const drawer = page.getByRole('dialog');
    await expect(drawer).toBeVisible();
    await drawer.getByRole('button', { name: m(locale, 'd.switch'), exact: true }).click();
    await expect(page.getByText(m(locale, 'toast.switched', { role: text(locale, 'roles.planner') }))).toBeVisible();
    const home = landingOf('planner', 'private') ?? '';
    await expect(page).toHaveURL(new RegExp(`${home}$`));
    // "Planner" alone also names three Ops modules; the demo-controls pill's own aria-label is the concrete proof.
    await expect(page.getByRole('button', { name: `${text(locale, 'demo.controls')}: ${text(locale, 'roles.planner')}` })).toBeVisible();
    seen.expectClean();
  });

  test('the Arabic page draws what the flows left: the edited person, in Arabic', async ({ page, baseURL }, testInfo) => {
    const seen = watch(page, baseURL);
    await startDemo(page, 'ar', 'administrator');
    await open(page, 'ar');
    // never signed in: an edit does not change that (users.ts: enableUser)
    await expect(rows(page).filter({ hasText: 'E2E Person Q Edited' })).toContainText(m('ar', 'status.invited'));
    await expect(rows(page).filter({ hasText: 'Tariq Al-Dubari' })).toContainText(m('ar', 'status.active'));
    await shot(page, testInfo, 'ar', 'users-roles-after-writes');
    seen.expectClean();
  });
});
