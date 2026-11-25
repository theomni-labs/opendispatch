// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment jsdom
import { DesignSystemProvider } from '@opendispatch/ui';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { inLocale } from '@/components/opendispatch/test-utils';
import { getModule, type InstallMode, type Role } from '@/lib/access';
import { fixtureUsers } from '@/lib/data/go-test-reset';
import { buildContext, fixtureTenantId } from '@/lib/data/go-test-reset';
import { sendFallbackSignal, setMaintenanceMode } from '@/lib/data/dispatch';
import type { RequestContext } from '@/lib/data/guard';
import { listIntegrations } from '@/lib/data/system';
import type { ScreenProps, SearchParams } from '@/screens/types';
import * as actions from './actions';
import { DataSourcesScreen } from './Screen';

// Live: skips, never fakes, if OPENDISPATCH_API_URL unset.
// loadSourcesView reads zones, needed by every
// test here that renders the filled screen.
const hasApi = process.env['OPENDISPATCH_API_URL'] !== undefined && process.env['OPENDISPATCH_API_URL'] !== '';
if (!hasApi) console.log('OPENDISPATCH_API_URL is not set: Screen.live.test.tsx is skipped, not faked.');

const env = vi.hoisted(() => ({ locale: 'en' as 'en' | 'ar', query: '', router: { push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }, saved: vi.fn(), navigate: vi.fn() }));

vi.mock('next-intl/server', async () => {
  const { createTranslator } = await import('next-intl');
  const { loadMessages } = await import('@/i18n/messages');
  return { getTranslations: async (namespace?: string) => createTranslator({ locale: env.locale, messages: loadMessages(env.locale, 'admin.data_sources'), ...(namespace === undefined ? {} : { namespace }) }) };
});
vi.mock('@/i18n/navigation', () => ({ usePathname: () => '/admin/data-sources', useRouter: () => env.router }));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams(env.query) }));
vi.mock('./actions', () => ({ testFeed: vi.fn(), testAllFeeds: vi.fn(), switchFeed: vi.fn(), changeStage: vi.fn(), allToShadow: vi.fn(), saveFallback: vi.fn(), saveSuggestions: vi.fn(), sendSignal: vi.fn(), setMaintenance: vi.fn() }));
vi.mock('@/lib/export/download', async (original) => ({ ...(await original<typeof import('@/lib/export/download')>()), saveCsv: env.saved }));

beforeEach(async () => {
  await fetch(`${process.env['OPENDISPATCH_API_URL']}/_internal/test/reset`, { method: 'POST' });
});
afterEach(() => {
  cleanup();
  for (const mock of Object.values(actions)) if (vi.isMockFunction(mock)) mock.mockReset();
  for (const mock of [env.router.replace, env.router.push, env.router.refresh, env.saved, env.navigate]) mock.mockReset();
});

// Fallback card: suggestions has a Save too.
const fallbackCard = () => screen.getByRole('heading', { name: 'Fallback' }).parentElement?.parentElement as HTMLElement;

function ctxOf(role: Role = 'administrator', installMode: InstallMode = 'private'): RequestContext {
  const tenant = fixtureTenantId();
  const built = buildContext({ role, installMode, zoneIds: [] }, fixtureUsers(), tenant);
  if (built === null) throw new Error(`no context for ${role}`);
  return built;
}

interface Options {
  locale?: 'en' | 'ar';
  access?: 'edit' | 'view';
  search?: SearchParams;
  state?: ScreenProps['state'];
}

async function renderScreen({ locale = 'en', access = 'edit', search = {}, state }: Options = {}) {
  env.locale = locale;
  env.query = new URLSearchParams(Object.entries(search).flatMap(([k, v]) => (typeof v === 'string' ? [[k, v] as [string, string]] : []))).toString();
  const element = await DataSourcesScreen({ def: getModule('admin.data_sources'), ctx: ctxOf(), access: { access, reduced: false }, locale, homeHref: '/admin/data-sources', state, searchParams: search });
  return inLocale(locale, <DesignSystemProvider navigate={env.navigate}>{element}</DesignSystemProvider>, { module: 'admin.data_sources' });
}

const ok = <T,>(data: T) => ({ ok: true as const, data });
const root = (container: HTMLElement) => container.querySelector<HTMLElement>('[data-module]');
const disabled = (el: HTMLElement) => el.getAttribute('aria-disabled') === 'true';
const mockOf = <T extends (...args: never[]) => unknown>(fn: T) => vi.mocked(fn);
const FORBIDDEN = /"(role|customer|tenant|user|userId|installMode|install_mode|zoneScope|ctx)"/;
const dataText = (container: HTMLElement) => {
  const copy = container.cloneNode(true) as HTMLElement;
  for (const node of copy.querySelectorAll('[translate="no"], [lang="en"]')) node.remove();
  return copy.textContent ?? '';
};
const feedCard = (kind: string) => document.querySelector<HTMLElement>(`[data-feed="${kind}"]`) as HTMLElement;

describe.skipIf(!hasApi)('Data Sources Screen (live, real api and Postgres)', () => {
  describe('filled, English, Administrator (edit)', () => {
    it('carries the four hooks the e2e specs read, the module title, the data source and no View only badge', async () => {
      const { container } = await renderScreen();
      const page = root(container);
      expect([page?.getAttribute('data-module'), page?.getAttribute('data-state'), page?.getAttribute('data-access'), page?.getAttribute('data-reduced')]).toEqual(['admin.data_sources', 'filled', 'edit', 'false']);
      expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Data Sources and Integrations');
      expect(container.querySelector('[data-badge="SYNTHETIC"]')).not.toBeNull();
      expect(screen.queryByText('View only')).toBeNull();
    });

    it('has two header actions, Test all (primary) and More, and four figures with the fallback timeout in seconds', async () => {
      await renderScreen();
      expect(disabled(screen.getByRole('button', { name: 'Test all' }))).toBe(false);
      expect(screen.getByRole('button', { name: 'More' })).toBeTruthy();
      for (const label of ['Healthy', 'Degraded', 'Switched off', 'Fallback timeout']) expect(screen.getAllByText(label).length).toBeGreaterThan(0);
      const stats = [...document.querySelectorAll('[class*="stat"]')].map((el) => el.textContent ?? '').join(' ');
      expect(stats).toMatch(/Fallback timeout\s*5\s*s/);
    });

    it('draws the five feeds with their health, the last event, the latency placeholder and the Illustrative and Demo labels', async () => {
      const { container } = await renderScreen();
      for (const [kind, name, health] of [['case_feed', 'Case feed', 'Healthy'], ['agent_feed', 'Agent feed', 'Degraded'], ['assignment_channel', 'Assignment channel', 'Healthy'], ['weather_feed', 'Weather feed', 'Off'], ['routing_feed', 'Road routing', 'Off']]) {
        const card = feedCard(kind as string);
        expect(within(card).getByRole('heading', { name: name as string })).toBeTruthy();
        expect(within(card).getAllByText(health as string).length).toBeGreaterThan(0);
      }
      expect(within(feedCard('assignment_channel')).getByText('Timeout')).toBeTruthy();
      expect(within(feedCard('assignment_channel')).getByText('5 s')).toBeTruthy();
      expect(within(feedCard('case_feed')).getByText('Latency')).toBeTruthy();
      expect(container.textContent).toContain('Illustrative');
      expect(container.querySelector('[data-stub="demo"]')).not.toBeNull();
      expect(within(feedCard('weather_feed')).getByRole('switch').getAttribute('aria-checked')).toBe('false');
      expect(within(feedCard('case_feed')).getByRole('switch').getAttribute('aria-checked')).toBe('true');
      expect(within(feedCard('case_feed')).getByText('Inbound · Simulated')).toBeTruthy();
      expect(within(feedCard('weather_feed')).queryByText(/Simulated/)).toBeNull();
    });

    it('draws the stage table: eight zones, five columns, a stage chip and three stages to choose from per zone', async () => {
      const { container } = await renderScreen();
      const table = screen.getByRole('table', { name: 'Stage per zone' });
      expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(expect.arrayContaining(['Zone', 'City', 'Stage', 'Set stage', 'Updated']));
      const rows = within(table).getAllByRole('row').filter((row) => within(row).queryAllByRole('cell').length > 0);
      expect(rows).toHaveLength(8);
      expect(container.querySelectorAll('[data-stage]').length).toBeGreaterThanOrEqual(8);
      const group = within(table).getByRole('radiogroup', { name: 'RD-C' });
      expect(within(group).getAllByRole('radio').map((r) => r.textContent)).toEqual(['Shadow', 'Recommend', 'Automatic']);
      expect(within(group).getByRole('radio', { name: 'Recommend' }).getAttribute('aria-checked')).toBe('true');
    });

    it('names each stage control by the zone code in its row (aria-labelledby), never by an aria-label: an attribute cannot be marked translate="no", so a code in one would be English text in an Arabic page', async () => {
      await renderScreen({ locale: 'ar' });
      const groups = screen.getAllByRole('radiogroup');
      expect(groups).toHaveLength(8);
      for (const group of groups) {
        expect(group.hasAttribute('aria-label')).toBe(false);
        const target = document.getElementById(group.getAttribute('aria-labelledby') ?? '');
        expect(target?.getAttribute('translate')).toBe('no');
        expect(target?.textContent).toMatch(/^[A-Z]{2}-[A-Z]$/);
      }
    });

    it('draws the fallback banner (armed, with the timeout), the settings with their numbers and the maintenance switch', async () => {
      await renderScreen();
      expect(screen.getByText('Fallback armed')).toBeTruthy();
      expect(screen.getByText('Operator dispatch takes over after 5 s')).toBeTruthy();
      expect(screen.getByRole('spinbutton', { name: 'Timeout' })).toBeTruthy();
      expect(screen.getByText('None sent')).toBeTruthy();
      expect(disabled(screen.getByRole('button', { name: 'Send fallback signal' }))).toBe(false);
      expect(screen.getByRole('switch', { name: 'Case feed answers busy, retry' }).getAttribute('aria-checked')).toBe('false');
      expect(disabled(within(fallbackCard()).getByRole('button', { name: 'Save' }))).toBe(true);
    });

    it('shows fallback active, with Resume OpenDispatch, after a signal, and maintenance with the Busy, retry badge on the case feed', async () => {
      await sendFallbackSignal(ctxOf(), { signal: 'fallback', reason: 'Test' });
      await renderScreen();
      expect(screen.getByText('Fallback active')).toBeTruthy();
      expect(screen.getByText(/sent by hand/)).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Resume OpenDispatch' })).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'Send fallback signal' })).toBeNull();
      cleanup();
      await setMaintenanceMode(ctxOf(), { enabled: true });
      await renderScreen();
      expect(screen.getAllByText('Maintenance mode').length).toBeGreaterThan(0);
      expect(within(feedCard('case_feed')).getByText('Busy, retry')).toBeTruthy();
      expect(disabled(screen.getByRole('button', { name: 'Send fallback signal' }))).toBe(true);
      expect(screen.getAllByText('Maintenance mode already hands cases to operator dispatch').length).toBeGreaterThan(0);
    });
  });

  describe('what the controls send', () => {
    it('Test sends the feed id; Test all sends nothing; the switch sends the id and the answer', async () => {
      const case_ = (await listIntegrations(ctxOf(), { limit: 10 })).items.find((f) => f.kind === 'case_feed');
      mockOf(actions.testFeed).mockResolvedValue(ok({ integrationId: case_?.id ?? '', ok: true, latencyMs: 42 }));
      mockOf(actions.testAllFeeds).mockResolvedValue(ok({ tested: 3, answered: 2, slow: 1, failed: 0 }));
      mockOf(actions.switchFeed).mockResolvedValue(ok({ integrationId: case_?.id ?? '', enabled: false }));
      await renderScreen();
      fireEvent.click(within(feedCard('case_feed')).getByRole('button', { name: 'Test' }));
      await waitFor(() => expect(actions.testFeed).toHaveBeenCalledWith({ integrationId: case_?.id }));
      expect(await screen.findByText('Case feed answered in 42 ms')).toBeTruthy();
      expect(within(feedCard('case_feed')).getByText('42 ms')).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: 'Test all' }));
      await waitFor(() => expect(actions.testAllFeeds).toHaveBeenCalledWith());
      expect(await screen.findByText('2 answered, 1 slow')).toBeTruthy();
      fireEvent.click(within(feedCard('case_feed')).getByRole('switch'));
      await waitFor(() => expect(actions.switchFeed).toHaveBeenCalledWith({ integrationId: case_?.id, enabled: false }));
      expect(JSON.stringify(mockOf(actions.switchFeed).mock.calls)).not.toMatch(FORBIDDEN);
    });

    it('a stage change opens a confirm dialog with the reason optional; Automatic adds the warning and the Not applied tag; Confirm sends the zone, the stage and the reason', async () => {
      mockOf(actions.changeStage).mockResolvedValue(ok({ zoneId: 'x', stage: 'automatic' as const }));
      await renderScreen();
      fireEvent.click(within(screen.getByRole('radiogroup', { name: 'RD-C' })).getByRole('radio', { name: 'Automatic' }));
      const dialog = screen.getByRole('dialog');
      expect(within(dialog).getByText('Set RD-C to Automatic?')).toBeTruthy();
      expect(within(dialog).getByText('RD-C: Recommend -> Automatic')).toBeTruthy();
      expect(within(dialog).getByText('OpenDispatch assigns without a dispatcher. Fallback stays armed.')).toBeTruthy();
      expect(dialog.querySelector('[data-stub="notApplied"]')).not.toBeNull();
      expect(within(dialog).getByText(/optional/i)).toBeTruthy();
      expect(within(dialog).getByRole('button', { name: 'Confirm' }).getAttribute('aria-disabled')).toBeNull();
      fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: '  Shadow results agree  ' } });
      fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm' }));
      await waitFor(() => expect(actions.changeStage).toHaveBeenCalledTimes(1));
      const call = mockOf(actions.changeStage).mock.calls[0]?.[0];
      expect(call).toMatchObject({ stage: 'automatic', reason: 'Shadow results agree' });
      expect(call?.zoneId).toMatch(/^[0-9a-f-]{36}$/);
      expect(JSON.stringify(call)).not.toMatch(FORBIDDEN);
    });

    it('choosing the stage a zone already has does nothing; a stage that is not the automatic one has no warning', async () => {
      await renderScreen();
      fireEvent.click(within(screen.getByRole('radiogroup', { name: 'RD-C' })).getByRole('radio', { name: 'Recommend' }));
      expect(screen.queryByRole('dialog')).toBeNull();
      fireEvent.click(within(screen.getByRole('radiogroup', { name: 'RD-E' })).getByRole('radio', { name: 'Recommend' }));
      const dialog = screen.getByRole('dialog');
      expect(within(dialog).queryByText('OpenDispatch assigns without a dispatcher. Fallback stays armed.')).toBeNull();
    });

    it('All zones to shadow (in More) says how many zones change and sends the optional reason', async () => {
      mockOf(actions.allToShadow).mockResolvedValue(ok({ changed: 2, failed: 0 }));
      await renderScreen();
      fireEvent.click(screen.getByRole('button', { name: 'More' }));
      fireEvent.click(screen.getByRole('menuitem', { name: 'All zones to shadow' }));
      const dialog = screen.getByRole('dialog');
      expect(within(dialog).getByText('Set all zones to shadow?')).toBeTruthy();
      expect(within(dialog).getByText('2 zones change')).toBeTruthy();
      fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm' }));
      await waitFor(() => expect(actions.allToShadow).toHaveBeenCalledWith({ reason: '' }));
    });

    it('Export in More saves the stage table as a CSV with a header and eight rows', async () => {
      await renderScreen();
      fireEvent.click(screen.getByRole('button', { name: 'More' }));
      fireEvent.click(screen.getByRole('menuitem', { name: 'Export' }));
      expect(env.saved).toHaveBeenCalledTimes(1);
      const [file, table] = env.saved.mock.calls[0] as [string, { header: string[]; rows: string[][] }];
      expect(file).toBe('zone-stages.csv');
      expect(table.header).toEqual(['Zone', 'Stage', 'City', 'Updated']);
      expect(table.rows).toHaveLength(8);
      expect(table.rows[0]?.[1]).toBe('Recommend');
    });

    it('the fallback settings save only when changed and in range, and send the two numbers', async () => {
      mockOf(actions.saveFallback).mockResolvedValue(ok({ timeoutSeconds: 8, deadlineMs: 2000 }));
      await renderScreen();
      const timeout = screen.getByRole('spinbutton', { name: 'Timeout' });
      fireEvent.change(timeout, { target: { value: '8' } });
      fireEvent.blur(timeout);
      expect(screen.getByText('Unsaved changes')).toBeTruthy();
      fireEvent.click(within(fallbackCard()).getByRole('button', { name: 'Save' }));
      await waitFor(() => expect(actions.saveFallback).toHaveBeenCalledWith({ timeoutSeconds: 8, deadlineMs: 2000 }));
    });

    it('Send fallback signal needs a reason; then it sends the signal and the reason; Resume does the same with resume', async () => {
      mockOf(actions.sendSignal).mockResolvedValue(ok({ state: 'active' as const }));
      await renderScreen();
      fireEvent.click(screen.getByRole('button', { name: 'Send fallback signal' }));
      const dialog = screen.getByRole('dialog');
      expect(within(dialog).getByText('Send the fallback signal?')).toBeTruthy();
      expect(within(dialog).getByRole('button', { name: 'Confirm' }).getAttribute('aria-disabled')).toBe('true');
      expect(within(dialog).getByText('Add a reason')).toBeTruthy();
      fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'Testing the fallback' } });
      fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm' }));
      await waitFor(() => expect(actions.sendSignal).toHaveBeenCalledWith({ signal: 'fallback', reason: 'Testing the fallback' }));
    });

    it('the maintenance switch sends the answer', async () => {
      mockOf(actions.setMaintenance).mockResolvedValue(ok({ state: 'maintenance' as const }));
      await renderScreen();
      fireEvent.click(screen.getByRole('switch', { name: 'Case feed answers busy, retry' }));
      await waitFor(() => expect(actions.setMaintenance).toHaveBeenCalledWith({ enabled: true }));
    });

    it('a refusal stays inline with its translated line and the English detail', async () => {
      mockOf(actions.setMaintenance).mockResolvedValue({ ok: false, code: 'forbidden', message: 'planner may not edit admin.data_sources.' });
      await renderScreen();
      fireEvent.click(screen.getByRole('switch', { name: 'Case feed answers busy, retry' }));
      expect(await screen.findByText('Your role cannot do that.')).toBeTruthy();
      expect(screen.getByText('planner may not edit admin.data_sources.').getAttribute('lang')).toBe('en');
    });
  });

  describe('a view-only role', () => {
    it('sees every control disabled with the reason, and no action is called', async () => {
      await renderScreen({ access: 'view' });
      expect(screen.getByText('View only')).toBeTruthy();
      expect(disabled(screen.getByRole('button', { name: 'Test all' }))).toBe(true);
      expect(disabled(within(feedCard('case_feed')).getByRole('button', { name: 'Test' }))).toBe(true);
      expect(within(feedCard('case_feed')).getByRole('switch').matches(':disabled')).toBe(true);
      expect(screen.getByRole('switch', { name: 'Case feed answers busy, retry' }).matches(':disabled')).toBe(true);
      expect(within(screen.getByRole('radiogroup', { name: 'RD-E' })).getByRole('radio', { name: 'Recommend' }).matches(':disabled')).toBe(true);
      expect(disabled(screen.getByRole('button', { name: 'Send fallback signal' }))).toBe(true);
      expect(screen.getAllByText('View only for this role').length).toBeGreaterThan(0);
      fireEvent.click(screen.getByRole('button', { name: 'Test all' }));
      fireEvent.click(screen.getByRole('button', { name: 'Send fallback signal' }));
      expect(actions.testAllFeeds).not.toHaveBeenCalled();
      expect(screen.queryByRole('dialog')).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: 'More' }));
      expect(screen.getByRole('menuitem', { name: 'All zones to shadow' }).getAttribute('aria-disabled')).toBe('true');
    });
  });

  describe('Arabic', () => {
    it('draws the whole screen in Arabic with no English left outside data, Western digits, and the stage names in Arabic', async () => {
      const { container } = await renderScreen({ locale: 'ar' });
      expect(root(container)?.getAttribute('data-state')).toBe('filled');
      expect(dataText(container)).not.toMatch(/[A-Za-z]{3}/);
      expect(container.textContent).not.toMatch(/[٠-٩]/);
      expect(screen.getAllByText('التشغيل الظلّي').length).toBeGreaterThan(0);
    });
  });
});
