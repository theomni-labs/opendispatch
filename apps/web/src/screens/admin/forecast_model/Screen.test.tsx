// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment jsdom
import { DesignSystemProvider } from '@opendispatch/ui';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { inLocale } from '@/components/opendispatch/test-utils';
import { getModule, type InstallMode, type Role } from '@/lib/access';
import { buildContext, fixtureTenantId } from '@/lib/data/go-test-reset';
import type { RequestContext } from '@/lib/data/guard';
import { listModelVersions, pauseModel } from '@/lib/data/models';
import { updateClockStart } from '@/lib/data/settings';
import { fixtureUsers, resetGoTestState } from '@/lib/data/go-test-reset';
import type { ScreenProps, SearchParams } from '@/screens/types';
import * as actions from './actions';
import { ForecastModelScreen } from './Screen';

// The screen as the module route renders it: the async Server Component is called with the props ModuleRoute builds, and the
// element it returns is rendered in each language. The data layer is real (fixtures, a temp demo store); the router, the actions
// and next-intl's server translator are stood in for. Every call an action gets is checked to carry only what a person chose.
const env = vi.hoisted(() => ({ locale: 'en' as 'en' | 'ar', query: '', router: { push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }, saved: vi.fn(), navigate: vi.fn() }));

vi.mock('next-intl/server', async () => {
  const { createTranslator } = await import('next-intl');
  const { loadMessages } = await import('@/i18n/messages');
  return { getTranslations: async (namespace?: string) => createTranslator({ locale: env.locale, messages: loadMessages(env.locale, 'admin.forecast_model'), ...(namespace === undefined ? {} : { namespace }) }) };
});
vi.mock('@/i18n/navigation', () => ({ usePathname: () => '/admin/forecast-model', useRouter: () => env.router, Link: ({ href, children, className }: { href: string; children: unknown; className?: string }) => <a href={href} className={className}>{children as never}</a> }));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams(env.query) }));
vi.mock('./actions', () => ({ runForecast: vi.fn(), switchVersion: vi.fn(), pauseForecast: vi.fn(), resumeForecast: vi.fn(), saveSchedule: vi.fn(), changeClockStart: vi.fn(), changePlanningLevel: vi.fn(), changeOptimizer: vi.fn(), changeRemoteHandling: vi.fn(), changeChallenger: vi.fn(), changeGateBaseline: vi.fn(), changeHorizon: vi.fn(), changeAutoRetrain: vi.fn(), retrainNow: vi.fn(), startBacktest: vi.fn() }));
vi.mock('@/lib/export/download', async (original) => ({ ...(await original<typeof import('@/lib/export/download')>()), saveCsv: env.saved }));

beforeEach(async () => {
  await resetGoTestState();
});
afterEach(() => {
  cleanup();
  for (const mock of Object.values(actions)) if (vi.isMockFunction(mock)) mock.mockReset();
  for (const mock of [env.router.replace, env.router.push, env.router.refresh, env.saved, env.navigate]) mock.mockReset();
});

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
  const element = await ForecastModelScreen({ def: getModule('admin.forecast_model'), ctx: ctxOf(), access: { access, reduced: false }, locale, homeHref: '/admin/forecast-model', state, searchParams: search });
  return inLocale(locale, <DesignSystemProvider navigate={env.navigate}>{element}</DesignSystemProvider>, { module: 'admin.forecast_model' });
}

const ok = <T,>(data: T) => ({ ok: true as const, data });
const root = (container: HTMLElement) => container.querySelector<HTMLElement>('[data-module]');
const disabled = (el: HTMLElement) => el.getAttribute('aria-disabled') === 'true';
const mockOf = <T extends (...args: never[]) => unknown>(fn: T) => vi.mocked(fn);
const FORBIDDEN = /"(role|customer|tenant|user|userId|installMode|install_mode|zoneScope|ctx)"/;
const dataText = (container: HTMLElement) => {
  const copy = container.cloneNode(true) as HTMLElement;
  for (const node of copy.querySelectorAll('[translate="no"], [lang="en"]')) node.remove();
  // acronyms and OR-Tools stay Latin in Arabic
  return (copy.textContent ?? '').replace(/\b(MAPE|WAPE|OR-Tools)\b/g, '');
};

describe('Forecast and Model Admin: filled, English, Administrator (edit)', () => {
  it('carries the four hooks the e2e specs read, the module title, the placeholder subtitle, the data source and the Demo tag', async () => {
    const { container } = await renderScreen();
    const page = root(container);
    expect([page?.getAttribute('data-module'), page?.getAttribute('data-state'), page?.getAttribute('data-access'), page?.getAttribute('data-reduced')]).toEqual(['admin.forecast_model', 'filled', 'edit', 'false']);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Forecast and Model Admin');
    expect(screen.getByText('Placeholder forecaster')).toBeTruthy();
    expect(container.querySelector('[data-badge="SYNTHETIC"]')).not.toBeNull();
    expect(container.querySelector('[data-stub="demo"]')).not.toBeNull();
    expect(screen.queryByText('View only')).toBeNull();
  });

  it('has two header actions, Run forecast (primary) and More, and four figures', async () => {
    await renderScreen();
    expect(disabled(screen.getAllByRole('button', { name: 'Run forecast' })[0] as HTMLElement)).toBe(false);
    expect(screen.getByRole('button', { name: 'More' })).toBeTruthy();
    for (const label of ['Active version', 'MAPE, rolling 28 days', 'Last run', 'Next retraining']) expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    expect(screen.getAllByText('ensemble-4').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Running').length).toBeGreaterThan(0);
  });

  it('lists the model versions with the active one highlighted, "Current" for it and "Make active" for the others, and the Illustrative label', async () => {
    const { container } = await renderScreen();
    const table = screen.getByRole('table', { name: 'Model versions' });
    expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(expect.arrayContaining(['Version', 'Status', 'Trained', 'Engine']));
    const rows = within(table).getAllByRole('row').filter((row) => within(row).queryAllByRole('cell').length > 0);
    expect(rows).toHaveLength(3);
    expect(within(table).getByText('Current')).toBeTruthy();
    expect(within(table).getAllByRole('button', { name: 'Make active' })).toHaveLength(1);
    expect(within(table).queryAllByText('Placeholder model')).toHaveLength(0);
    expect(within(table).queryByText(/^placeholder-/)).toBeNull();
    expect(container.textContent).toContain('Illustrative');
  });

  it('shows the latest run: model, engine, rule set, horizon, the likely range as Illustrative, the times and the data source', async () => {
    await renderScreen();
    expect(screen.getByRole('heading', { name: 'Latest run' })).toBeTruthy();
    expect(within(screen.getByRole('heading', { name: 'Latest run' }).parentElement as HTMLElement).getByText('Succeeded')).toBeTruthy();
    for (const label of ['Model version', 'Engine', 'Rule set', 'Horizon', 'Likely range', 'Started, finished', 'Input data']) expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    expect(screen.getAllByText('80%').length).toBeGreaterThan(0);
  });

  it('shows the 10-minute measure both ways with the primary one from the setting, and the planning level', async () => {
    const { container } = await renderScreen();
    expect(screen.getByRole('heading', { name: '10-minute measure' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: /From assignment/ }).getAttribute('aria-checked') ?? (screen.getByRole('radio', { name: /From assignment/ }) as HTMLInputElement).checked.toString()).toMatch(/true/);
    const readings = container.querySelectorAll('[data-primary]');
    expect(readings).toHaveLength(1);
    expect(readings[0]?.textContent).toContain('From assignment');
    expect(container.querySelectorAll('dl [class*="item"]').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByRole('combobox', { name: 'Planning level' })).toBeTruthy();
    cleanup();
    await updateClockStart(ctxOf(), { clock_start: 'registration' });
    const again = await renderScreen();
    expect(again.container.querySelector('[data-primary]')?.textContent).toContain('From registration');
  });

  it('shows Recent changes for the Administrator with a link to the Audit Log', async () => {
    await renderScreen();
    expect(screen.getByRole('heading', { name: 'Recent changes' })).toBeTruthy();
    expect(screen.getByRole('link', { name: /Audit log/ }).getAttribute('href')).toBe('/admin/audit-log');
  });

  it('shows the retraining card: cadence, day, time, and Save unavailable until something changes', async () => {
    await renderScreen();
    expect(screen.getByRole('radio', { name: 'Weekly' }).getAttribute('aria-checked')).toBe('true');
    expect((screen.getByRole('combobox', { name: 'Day' }) as HTMLSelectElement).value).toBe('5');
    expect((screen.getByLabelText('Time') as HTMLInputElement).value).toBe('02:00');
    const saves = screen.getAllByRole('button', { name: 'Save' });
    expect(saves.every(disabled)).toBe(true);
  });
});

describe('Forecast and Model Admin: what the controls send', () => {
  it('Run forecast sends nothing (the server finds the horizon) and says the run finished', async () => {
    mockOf(actions.runForecast).mockResolvedValue(ok({ runId: 'r', model: 'placeholder-0.1', horizonStart: '2026-09-14', horizonDays: 1 }));
    await renderScreen();
    fireEvent.click(screen.getAllByRole('button', { name: 'Run forecast' })[0] as HTMLElement);
    await waitFor(() => expect(actions.runForecast).toHaveBeenCalledWith());
    expect(await screen.findByText('Forecast run finished')).toBeTruthy();
  });

  it('while the run is pending the buttons are disabled and busy, say Running, and the card pill says Running; it recovers after', async () => {
    let finish: (value: ReturnType<typeof ok>) => void = () => undefined;
    mockOf(actions.runForecast).mockReturnValue(new Promise((resolve) => (finish = resolve)) as never);
    await renderScreen();
    fireEvent.click(screen.getAllByRole('button', { name: 'Run forecast' })[0] as HTMLElement);
    await waitFor(() => expect(screen.queryAllByRole('button', { name: 'Run forecast' })).toHaveLength(0));
    const buttons = screen.getAllByRole('button', { name: 'Running' });
    expect(buttons).toHaveLength(2);
    for (const button of buttons) {
      expect((button as HTMLButtonElement).disabled).toBe(true);
      expect(button.getAttribute('aria-busy')).toBe('true');
    }
    expect(screen.getByRole('status', { hidden: true }).textContent).toBe('Running');
    finish(ok({ runId: 'r', model: 'placeholder-0.1', horizonStart: '2026-09-14', horizonDays: 1 }));
    expect(await screen.findByText('Forecast run finished')).toBeTruthy();
    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Run forecast' })).toHaveLength(2));
  });

  it('labels the start of the horizon as a forecast start, in both languages, with no left-to-right isolation in Arabic', async () => {
    await renderScreen();
    expect(screen.getByText(/^From \d{1,2} Sept? 2026, \d+ days?$/)).toBeTruthy();
    cleanup();
    await renderScreen({ locale: 'ar' });
    const line = screen.getByText(/^من \d{1,2} سبتمبر 2026, /);
    expect(line.querySelector('[dir="ltr"]')).toBeNull();
    expect(line.closest('[dir="ltr"]')).toBeNull();
  });

  it('Make active opens a dialog with the change and needs a reason; then it sends the version id and the reason', async () => {
    mockOf(actions.switchVersion).mockResolvedValue(ok({ paused: false, active: 'ensemble-3' }));
    await renderScreen();
    const candidate = (await listModelVersions(ctxOf(), { limit: 10 })).items.find((v) => v.version === 'ensemble-3');
    const row = screen.getAllByRole('row').find((r) => r.textContent?.includes('ensemble-3')) as HTMLElement;
    fireEvent.click(within(row).getByRole('button', { name: 'Make active' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Make ensemble-3 active?')).toBeTruthy();
    expect(within(dialog).getByText('ensemble-4 -> ensemble-3')).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Make active' }).getAttribute('aria-disabled')).toBe('true');
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: '  Better on the test days  ' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Make active' }));
    await waitFor(() => expect(actions.switchVersion).toHaveBeenCalledWith({ versionId: candidate?.id, reason: 'Better on the test days' }));
    expect(JSON.stringify(mockOf(actions.switchVersion).mock.calls)).not.toMatch(FORBIDDEN);
  });

  it('the pause switch opens a dialog that needs a reason; then it sends the reason, and the toast says who is notified', async () => {
    mockOf(actions.pauseForecast).mockResolvedValue(ok({ paused: true, active: 'placeholder-0.1' }));
    await renderScreen();
    fireEvent.click(screen.getByRole('switch', { name: 'Pause forecast' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Pause the forecast?')).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Pause forecast' }).getAttribute('aria-disabled')).toBe('true');
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'The case feed is being fixed' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Pause forecast' }));
    await waitFor(() => expect(actions.pauseForecast).toHaveBeenCalledWith({ reason: 'The case feed is being fixed' }));
    expect(await screen.findByText('Administrator and Planner notified')).toBeTruthy();
  });

  it('while paused: the warning alert with who, when and why, Resume in the alert and in the switch, Run forecast disabled with its reason', async () => {
    await pauseModel(ctxOf(), { reason: 'The case feed is being fixed' });
    mockOf(actions.resumeForecast).mockResolvedValue(ok({ paused: false, active: 'placeholder-0.1' }));
    await renderScreen();
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('Forecast paused');
    expect(alert.textContent).toContain('Nadia Al-Ghalani paused it at');
    expect(alert.textContent).toContain('The case feed is being fixed');
    expect(screen.getAllByText('Paused').length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: 'Run forecast' }).every(disabled)).toBe(true);
    fireEvent.click(within(alert).getByRole('button', { name: 'Resume' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Resume the forecast?')).toBeTruthy();
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'Fixed' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Resume' }));
    await waitFor(() => expect(actions.resumeForecast).toHaveBeenCalledWith({ reason: 'Fixed' }));
  });

  it('Retrain now starts a retrain with nothing sent and says the results appear in Experiments', async () => {
    mockOf(actions.retrainNow).mockResolvedValue(ok({ experimentId: 'x' }));
    await renderScreen();
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Retrain now' }));
    await waitFor(() => expect(actions.retrainNow).toHaveBeenCalledWith());
    expect(await screen.findByText('Retraining started')).toBeTruthy();
  });

  it('Export saves the versions as a CSV', async () => {
    await renderScreen();
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Export' }));
    const [file, table] = env.saved.mock.calls[0] as [string, { header: string[]; rows: string[][] }];
    expect(file).toBe('model-versions.csv');
    expect(table.header).toEqual(['Version', 'Status', 'Trained', 'Engine']);
    expect(table.rows.map((row) => row[0])).toEqual(['ensemble-4', 'lightgbm-1', 'ensemble-3']);
  });

  it('Save on the retraining card sends the cadence, the day and the time; a bad time is refused with a line and cannot be saved', async () => {
    mockOf(actions.saveSchedule).mockResolvedValue(ok({ paused: false, active: 'placeholder-0.1' }));
    await renderScreen();
    fireEvent.change(screen.getByLabelText('Time'), { target: { value: '99:99' } });
    expect(screen.getAllByText('Time is not valid').length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: 'Save' }).every(disabled)).toBe(true);
    fireEvent.change(screen.getByLabelText('Time'), { target: { value: '03:30' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Day' }), { target: { value: '2' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Save' }).find((b) => !disabled(b)) as HTMLElement);
    await waitFor(() => expect(actions.saveSchedule).toHaveBeenCalledWith({ cadence: 'weekly', day_of_week: 2, time_of_day: '03:30' }));
    cleanup();
    await renderScreen();
    fireEvent.click(screen.getByRole('radio', { name: 'Manual' }));
    expect(screen.queryByLabelText('Time')).toBeNull();
  });

  it('the clock start and the planning level are saved as soon as they are changed, and send only the choice', async () => {
    mockOf(actions.changeClockStart).mockResolvedValue(ok({ clockStart: 'registration' }));
    mockOf(actions.changePlanningLevel).mockResolvedValue(ok({ planningLevel: 'city' }));
    await renderScreen();
    fireEvent.click(screen.getByRole('radio', { name: /From registration/ }));
    await waitFor(() => expect(actions.changeClockStart).toHaveBeenCalledWith({ clock_start: 'registration' }));
    expect(await screen.findByText('Clock start changed')).toBeTruthy();
    fireEvent.change(screen.getByRole('combobox', { name: 'Planning level' }), { target: { value: 'city' } });
    await waitFor(() => expect(actions.changePlanningLevel).toHaveBeenCalledWith({ planning_level: 'city' }));
    expect(JSON.stringify(mockOf(actions.changePlanningLevel).mock.calls)).not.toMatch(FORBIDDEN);
  });

  it('the optimizer model is saved on change from the four the engine accepts, and sends only the choice', async () => {
    mockOf(actions.changeOptimizer).mockResolvedValue(ok({ optimizerModel: 'greedy-ls-0.3' }));
    await renderScreen();
    const select = screen.getByRole('combobox', { name: 'Optimizer model' });
    expect([...select.querySelectorAll('option')].map((o) => o.getAttribute('value'))).toEqual(['cpsat-1', 'greedy-ls-0.3', 'greedy-ls-0.2', 'greedy-ls-0.1']);
    fireEvent.change(select, { target: { value: 'greedy-ls-0.3' } });
    await waitFor(() => expect(actions.changeOptimizer).toHaveBeenCalledWith({ optimizer_model: 'greedy-ls-0.3' }));
    expect(await screen.findByText('Optimizer model changed')).toBeTruthy();
    expect(JSON.stringify(mockOf(actions.changeOptimizer).mock.calls)).not.toMatch(FORBIDDEN);
  });

  it('the remote handling time is saved on change, the source from the select and the minutes on blur', async () => {
    mockOf(actions.changeRemoteHandling).mockResolvedValue(ok({ source: 'fixed', fixedMinutes: 31.5 }));
    await renderScreen();
    const select = screen.getByRole('combobox', { name: 'Remote handling time' }) as HTMLSelectElement;
    expect([...select.options].map((o) => o.value)).toEqual(['measured', 'fixed']);
    expect(select.value).toBe('measured');
    fireEvent.change(select, { target: { value: 'fixed' } });
    await waitFor(() => expect(actions.changeRemoteHandling).toHaveBeenCalledWith({ handling_source: 'fixed' }));
    expect(await screen.findByText('Remote handling time changed')).toBeTruthy();
    const minutes = screen.getByRole('spinbutton', { name: 'Fixed minutes per case' }) as HTMLInputElement;
    expect(minutes.value).toBe('31.5');
    fireEvent.change(minutes, { target: { value: '2' } });
    fireEvent.blur(minutes);
    expect(minutes.value).toBe('31.5');
    fireEvent.change(minutes, { target: { value: '40' } });
    fireEvent.blur(minutes);
    await waitFor(() => expect(actions.changeRemoteHandling).toHaveBeenCalledWith({ handling_fixed_minutes: 40 }));
    expect(JSON.stringify(mockOf(actions.changeRemoteHandling).mock.calls)).not.toMatch(FORBIDDEN);
  });

  it('the challenger and the gate baseline are saved on change, from the registered models other than the champion', async () => {
    mockOf(actions.changeChallenger).mockResolvedValue(ok({ challenger: 'sarima-1' }));
    mockOf(actions.changeGateBaseline).mockResolvedValue(ok({ gateBaseline: 'naive' }));
    await renderScreen();
    const challenger = screen.getByRole('combobox', { name: 'Challenger' }) as HTMLSelectElement;
    expect(challenger.value).toBe('lightgbm-1');
    expect([...challenger.options].map((o) => o.value)).toEqual(['', 'ensemble-6', 'ensemble-5', 'ensemble-3', 'ensemble-2', 'seasonal-profile-1', 'lightgbm-1', 'ets-1', 'sarima-1', 'prophet-1', 'mlp-1']);
    expect((screen.getByRole('combobox', { name: 'Backtest baseline' }) as HTMLSelectElement).value).toBe('segment');
    fireEvent.change(challenger, { target: { value: 'sarima-1' } });
    await waitFor(() => expect(actions.changeChallenger).toHaveBeenCalledWith({ challenger_model: 'sarima-1' }));
    expect(await screen.findByText('Challenger changed')).toBeTruthy();
    fireEvent.change(screen.getByRole('combobox', { name: 'Backtest baseline' }), { target: { value: 'naive' } });
    await waitFor(() => expect(actions.changeGateBaseline).toHaveBeenCalledWith({ gate_baseline: 'naive' }));
    expect(JSON.stringify([...mockOf(actions.changeChallenger).mock.calls, ...mockOf(actions.changeGateBaseline).mock.calls])).not.toMatch(FORBIDDEN);
  });

  it('a refusal stays inline with its translated line and the English detail', async () => {
    mockOf(actions.pauseForecast).mockResolvedValue({ ok: false, code: 'conflict', message: 'The forecast is already paused.' });
    await renderScreen();
    fireEvent.click(screen.getByRole('switch', { name: 'Pause forecast' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'x' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Pause forecast' }));
    expect(await within(dialog).findByText('That is not possible in its current state.')).toBeTruthy();
    expect(within(dialog).getByText('The forecast is already paused.').getAttribute('lang')).toBe('en');
  });
});

describe('Forecast and Model Admin: a view-only role', () => {
  it('sees every control disabled with the reason, and no action is called', async () => {
    await renderScreen({ access: 'view' });
    expect(screen.getByText('View only')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Run forecast' }).every(disabled)).toBe(true);
    expect(screen.getAllByRole('button', { name: 'Make active' }).every(disabled)).toBe(true);
    expect((screen.getByRole('switch', { name: 'Pause forecast' }) as HTMLInputElement).matches(':disabled')).toBe(true);
    expect(screen.getAllByRole('button', { name: 'Save' }).every(disabled)).toBe(true);
    expect((screen.getByRole('combobox', { name: 'Planning level' }) as HTMLSelectElement).matches(':disabled')).toBe(true);
    expect((screen.getByRole('combobox', { name: 'Challenger' }) as HTMLSelectElement).matches(':disabled')).toBe(true);
    expect((screen.getByRole('combobox', { name: 'Backtest baseline' }) as HTMLSelectElement).matches(':disabled')).toBe(true);
    expect(screen.getAllByText('View only for this role').length).toBeGreaterThan(0);
    fireEvent.click(screen.getAllByRole('button', { name: 'Run forecast' })[0] as HTMLElement);
    fireEvent.click(screen.getAllByRole('button', { name: 'Make active' })[0] as HTMLElement);
    expect(actions.runForecast).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('Forecast and Model Admin: the review states (?state=)', () => {
  it.each(['empty', 'loading', 'error'] as const)('?state=%s shows that state, keeps the header, and reads nothing', async (state) => {
    const { container } = await renderScreen({ state });
    expect(root(container)?.getAttribute('data-state')).toBe(state);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Forecast and Model Admin');
    if (state === 'empty') {
      expect(screen.getByText('No model versions')).toBeTruthy();
      expect(screen.getByText('A version appears after the first training.')).toBeTruthy();
    }
    if (state === 'error') {
      expect(screen.getByRole('alert').textContent).toContain('The model state could not load.');
      expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
    }
    if (state === 'loading') expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
  });
});

describe('Forecast and Model Admin: Arabic', () => {
  it('draws the whole screen in Arabic, filled and paused, with no English left outside data and Western digits', async () => {
    const filled = await renderScreen({ locale: 'ar' });
    expect(root(filled.container)?.getAttribute('data-state')).toBe('filled');
    expect(dataText(filled.container)).not.toMatch(/[A-Za-z]{3}/);
    expect(filled.container.textContent).not.toMatch(/[٠-٩]/);
    cleanup();
    await pauseModel(ctxOf(), { reason: 'The case feed is being fixed' });
    const paused = await renderScreen({ locale: 'ar' });
    expect(dataText(paused.container)).not.toMatch(/[A-Za-z]{3}/);
    expect(paused.container.textContent).not.toMatch(/[٠-٩]/);
  });

  it('has no English word in an attribute a person sees or hears (placeholder, aria-label, title) outside data: the time field says ساعة:دقيقة, not HH:MM', async () => {
    const { container } = await renderScreen({ locale: 'ar' });
    const words: string[] = [];
    for (const el of container.querySelectorAll('[aria-label], [placeholder], [title]')) {
      if (el.closest('[translate="no"], [lang="en"]') !== null) continue;
      for (const attr of ['aria-label', 'placeholder', 'title']) words.push(...((el.getAttribute(attr) ?? '').match(/[A-Za-z][A-Za-z'’-]+/g) ?? []));
    }
    expect(words).toEqual([]);
    expect((screen.getByLabelText('الوقت') as HTMLInputElement).placeholder).toBe('ساعة:دقيقة');
    cleanup();
    await renderScreen({ locale: 'en' });
    expect((screen.getByLabelText('Time') as HTMLInputElement).placeholder).toBe('HH:MM');
  });

  it('draws the states in Arabic', async () => {
    for (const state of ['empty', 'error'] as const) {
      const { container } = await renderScreen({ locale: 'ar', state });
      expect(dataText(container)).not.toMatch(/[A-Za-z]{3}/);
      cleanup();
    }
  });
});
