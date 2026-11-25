// SPDX-License-Identifier: AGPL-3.0-only
import { expect, test } from '@playwright/test';
import { adminUrl, cellOf, frameOf, settled, skeletonShape, stateLine, watchStrict } from './admin-helpers';
import { expectPageOk, startDemo, waitForHydration } from './helpers';
import { OPS_MODULES, hasStateEmptyAction } from './ops-helpers';
import { locales, text, titleOf } from './routes';

// Ops states per module, EN and AR.

for (const locale of locales) {
  for (const def of OPS_MODULES) {
    test(`${def.id}: empty, loading, error and no-access states in ${locale}`, async ({ page, baseURL }) => {
      test.setTimeout(120_000);
      const seen = watchStrict(page, baseURL);
      await startDemo(page, locale, 'planner', 'private');
      const root = frameOf(page, def);
      const area = root.locator(':scope > :not(header)');
      const actions = area.locator('button, a[href]');
      const open = async (state: string) => {
        const response = await page.goto(adminUrl(locale, def, `?state=${state}`));
        expect(response?.status(), `?state=${state} answers with a page`).toBeLessThan(400);
        await expect(root).toHaveAttribute('data-state', state);
        await expectPageOk(page, locale);
        await expect(page.getByRole('heading', { level: 1 })).toHaveText(titleOf(locale, def.id));
        await expect(root.locator('table, [role="tab"]'), 'no content or tabs behind the state').toHaveCount(0);
      };
      const expectLine = async (state: 'empty' | 'error', part: 'title' | 'desc') => {
        const line = stateLine(locale, def, state, part);
        if (line !== undefined) await expect(area.getByText(line, { exact: true })).toBeVisible();
        else expect(part, `every state has a title (${state})`).toBe('desc');
      };

      await test.step('empty: title, description and the empty action', async () => {
        await open('empty');
        await expectLine('empty', 'title');
        await expectLine('empty', 'desc');
        await expect(actions, 'the empty action, where the ?state= branch passes one').toHaveCount(hasStateEmptyAction(def) ? 1 : 0);
      });

      await test.step('loading: a skeleton, announced once, no action', async () => {
        await open('loading');
        const busy = root.locator('[aria-busy="true"]');
        await expect(busy).toHaveCount(1);
        await expect(busy).toHaveAttribute('data-skeleton', skeletonShape(def));
        await expect(busy).toContainText(text(locale, 'ds.skeleton.loading'));
        await expect(root.getByRole('alert')).toHaveCount(0);
        await expect(actions).toHaveCount(0);
      });

      await test.step('no access: the panel and Go home', async () => {
        await open('noaccess');
        await expect(area.getByText(text(locale, 'states.noAccess.title'), { exact: true })).toBeVisible();
        await expect(area.getByRole('link', { name: text(locale, 'common.goHome') })).toBeVisible();
      });

      await test.step('error: an alert with Try again, which leaves the state', async () => {
        await open('error');
        const alert = area.getByRole('alert');
        await expect(alert).toHaveCount(1);
        await expectLine('error', 'title');
        await expectLine('error', 'desc');
        await expect(alert.locator('button, a[href]'), 'the error state has exactly one action').toHaveCount(1);
        await waitForHydration(page, '[data-module] [role="alert"] button');
        await alert.getByRole('button', { name: text(locale, 'common.retry') }).click();
        await expect(root).toHaveAttribute('data-state', 'filled');
        await expect(page).not.toHaveURL(/state=/);
      });
      seen.expectClean();
    });
  }

  // Disabled: Viewer and Auditor, view on all 12.
  test(`view only: header writes are disabled with their reason, in ${locale}`, async ({ page, baseURL }) => {
    test.setTimeout(240_000);
    const seen = watchStrict(page, baseURL);
    await startDemo(page, locale, 'viewer_auditor', 'private');
    const reason = text(locale, 'opendispatch.gate.viewOnly');
    let gatedModules = 0;
    for (const def of OPS_MODULES) {
      expect(cellOf('viewer_auditor', def, 'private').access, def.id).toBe('view');
      await page.goto(adminUrl(locale, def));
      await settled(page);
      const root = frameOf(page, def);
      await expect(root).toHaveAttribute('data-access', 'view');
      const gated = root.locator(':scope > header [data-gated] button, :scope > header [data-gated] a[href]');
      const count = await gated.count();
      if (count === 0) continue;
      gatedModules += 1;
      await waitForHydration(page, '[data-module] > header [data-gated] button');
      for (const control of await gated.all()) await expect(control, `${def.id}: gated control`).toHaveAttribute('aria-disabled', 'true');
      const first = gated.first();
      const dialogs = await page.getByRole('dialog').count();
      await first.click({ force: true });
      await expect(page.getByRole('dialog'), `${def.id}: a gated click opens nothing`).toHaveCount(dialogs);
      await first.hover();
      await expect(page.getByRole('tooltip').filter({ hasText: reason }), `${def.id}: the reason in the tooltip`).toBeVisible();
    }
    expect(gatedModules, 'modules with a gated header action').toBeGreaterThanOrEqual(7);
    seen.expectClean();
  });
}
