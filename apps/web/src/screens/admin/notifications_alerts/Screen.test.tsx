// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment jsdom
import { DesignSystemProvider } from '@opendispatch/ui';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { inLocale } from '@/components/opendispatch/test-utils';
import { getModule, type InstallMode, type Role } from '@/lib/access';
import { buildContext, fixtureTenantId } from '@/lib/data/go-test-reset';
import type { RequestContext } from '@/lib/data/guard';
import { listNotificationRules } from '@/lib/data/notifications';
import { listUsers } from '@/lib/data/users';
import type { ScreenProps, SearchParams } from '@/screens/types';
import * as actions from './actions';
import { NotificationsAlertsScreen } from './Screen';
import { fixtureUsers, resetGoTestState } from '@/lib/data/go-test-reset';

// The screen as the module route renders it: the async Server Component is called with the props ModuleRoute builds, and the
// element it returns is rendered in each language. The data layer is real (fixtures, a temp demo store); the router, the actions
// and next-intl's server translator are stood in for. Every call an action gets is checked to carry only what a person chose.
const env = vi.hoisted(() => ({ locale: 'en' as 'en' | 'ar', query: '', router: { push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }, saved: vi.fn(), navigate: vi.fn() }));

vi.mock('next-intl/server', async () => {
  const { createTranslator } = await import('next-intl');
  const { loadMessages } = await import('@/i18n/messages');
  return { getTranslations: async (namespace?: string) => createTranslator({ locale: env.locale, messages: loadMessages(env.locale, 'admin.notifications_alerts'), ...(namespace === undefined ? {} : { namespace }) }) };
});
vi.mock('@/i18n/navigation', () => ({ usePathname: () => '/admin/notifications-alerts', useRouter: () => env.router }));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams(env.query) }));
vi.mock('./actions', () => ({ saveRule: vi.fn(), toggleRule: vi.fn(), sendTestAlert: vi.fn(), markAlertsRead: vi.fn(), markAllRead: vi.fn(), saveQuietHours: vi.fn() }));
vi.mock('@/lib/export/download', async (original) => ({ ...(await original<typeof import('@/lib/export/download')>()), saveCsv: env.saved }));

beforeEach(async () => {
  await resetGoTestState();
  ruleList = (await listNotificationRules(ctxOf(), { limit: 50 })).items;
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
  const element = await NotificationsAlertsScreen({ def: getModule('admin.notifications_alerts'), ctx: ctxOf(), access: { access, reduced: false }, locale, homeHref: '/admin/notifications-alerts', state, searchParams: search });
  return inLocale(locale, <DesignSystemProvider navigate={env.navigate}>{element}</DesignSystemProvider>, { module: 'admin.notifications_alerts' });
}

const ok = <T,>(data: T) => ({ ok: true as const, data });
const root = (container: HTMLElement) => container.querySelector<HTMLElement>('[data-module]');
const disabled = (el: HTMLElement) => el.getAttribute('aria-disabled') === 'true' || (el as HTMLButtonElement).disabled === true;
const mockOf = <T extends (...args: never[]) => unknown>(fn: T) => vi.mocked(fn);
const FORBIDDEN = /"(role|customer|tenant|user|userId|installMode|install_mode|zoneScope|ctx)"/;
let ruleList: Awaited<ReturnType<typeof listNotificationRules>>['items'] = [];
const rules = () => ruleList;
const ruleOf = (event: string) => rules().find((r) => r.event_type === event) as ReturnType<typeof rules>[number];
const bodyRows = (name?: string) => {
  const table = screen.getByRole('table', name === undefined ? {} : { name });
  return within(table)
    .getAllByRole('row')
    .filter((r) => within(r).queryAllByRole('cell').length > 0);
};
const dataText = (container: HTMLElement) => {
  const copy = container.cloneNode(true) as HTMLElement;
  for (const node of copy.querySelectorAll('[translate="no"], [lang="en"]')) node.remove();
  return copy.textContent ?? '';
};

describe('Notifications and Alerts: the Rules tab, English, Administrator (edit)', () => {
  it('carries the four hooks the e2e specs read, the module title, the data source and no Demo tag', async () => {
    const { container } = await renderScreen();
    const page = root(container);
    expect([page?.getAttribute('data-module'), page?.getAttribute('data-state'), page?.getAttribute('data-access'), page?.getAttribute('data-reduced')]).toEqual(['admin.notifications_alerts', 'filled', 'edit', 'false']);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Notifications and Alerts');
    expect(container.querySelector('[data-badge="SYNTHETIC"]')).not.toBeNull();
    expect(container.querySelector('[data-stub="demo"]')).toBeNull();
    expect(screen.queryByText('View only')).toBeNull();
  });

  it('has two header actions (Send test alert, More), two tabs with their counts, and four figures with the quiet-hours one tagged', async () => {
    const { container } = await renderScreen();
    expect(disabled(screen.getByRole('button', { name: 'Send test alert' }))).toBe(false);
    expect(screen.getByRole('button', { name: 'More' })).toBeTruthy();
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['Rules16', 'Alert log14']);
    for (const label of ['Rules on', 'Unread', 'Critical', 'Quiet hours']) expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    // The figure and the card both show the window.
    expect(screen.getAllByText('23:00 to 05:00')).toHaveLength(2);
    expect(container.querySelectorAll('[data-stub="notApplied"]').length).toBeGreaterThanOrEqual(2);
  });

  it('lists the 16 rules with the event and its category, channels, recipients, severity and a switch that is on', async () => {
    await renderScreen();
    const table = screen.getByRole('table', { name: 'Notification rules' });
    expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Event', 'Channels', 'Recipients', 'Severity', 'On']);
    const rows = bodyRows('Notification rules');
    expect(rows).toHaveLength(16);
    const model = rows.find((r) => within(r).queryByText('Model paused') !== null) as HTMLElement;
    expect(within(model).getByText('Model')).toBeTruthy();
    expect(within(model).getByText('In app')).toBeTruthy();
    expect(within(model).getByText('Email')).toBeTruthy();
    expect(within(model).getByText('Administrator')).toBeTruthy();
    expect(within(model).getByText('Warning')).toBeTruthy();
    expect(within(model).getByRole('switch').getAttribute('aria-checked')).toBe('true');
    expect(within(model).getByRole('switch').getAttribute('aria-label')).toBe('Rule on: Model paused');
  });

  it('?severity= ?channel= and ?q= narrow the list on the server; a value that is not on the list is ignored', async () => {
    await renderScreen({ search: { severity: 'critical' } });
    expect(bodyRows('Notification rules')).toHaveLength(rules().filter((r) => r.severity === 'critical').length);
    cleanup();
    await renderScreen({ search: { channel: 'email' } });
    expect(bodyRows('Notification rules')).toHaveLength(rules().filter((r) => r.channels.includes('email')).length);
    cleanup();
    await renderScreen({ search: { q: 'model' } });
    expect(bodyRows('Notification rules')).toHaveLength(2);
    cleanup();
    await renderScreen({ search: { severity: 'urgent', channel: 'sms' } });
    expect(bodyRows('Notification rules')).toHaveLength(16);
    cleanup();
    await renderScreen({ search: { q: 'zzz-no-such-event' } });
    expect(screen.getByText('No matching results')).toBeTruthy();
  });

  it('a row opens the rule (the address gets ?rule=); an unknown rule shows a notice and no drawer', async () => {
    await renderScreen();
    fireEvent.click(bodyRows('Notification rules')[0] as HTMLElement);
    expect(env.navigate).toHaveBeenCalledWith(expect.stringMatching(/^\/admin\/notifications-alerts\?rule=[0-9a-f-]{36}$/));
    cleanup();
    await renderScreen({ search: { rule: '00000000-0000-4000-8000-000000000001' } });
    expect(screen.getByText('That rule could not be found.')).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
    cleanup();
    await renderScreen({ search: { rule: 'not-an-id' } });
    expect(screen.getByText('That rule could not be found.')).toBeTruthy();
  });

  it('the switch writes at once with the rule id and the state asked for, and nothing else', async () => {
    mockOf(actions.toggleRule).mockResolvedValue(ok({ ruleId: 'x', event: 'model_paused' as const, enabled: false }));
    await renderScreen();
    const rule = ruleOf('model_paused');
    fireEvent.click(within(bodyRows('Notification rules').find((r) => within(r).queryByText('Model paused') !== null) as HTMLElement).getByRole('switch'));
    await waitFor(() => expect(actions.toggleRule).toHaveBeenCalledWith({ ruleId: rule.id, enabled: false }));
    expect(JSON.stringify(mockOf(actions.toggleRule).mock.calls)).not.toMatch(FORBIDDEN);
  });

  it('a refused switch is a toast with its translated line', async () => {
    mockOf(actions.toggleRule).mockResolvedValue({ ok: false, code: 'forbidden', message: 'Not allowed.' });
    await renderScreen();
    fireEvent.click(within(bodyRows('Notification rules')[0] as HTMLElement).getByRole('switch'));
    expect(await screen.findByText('Your role cannot do that.')).toBeTruthy();
  });
});

describe('Notifications and Alerts: the preview and the quiet-hours card', () => {
  it('shows the model example first with its rule\'s recipients and channels, and the name of the person looking', async () => {
    await renderScreen();
    expect(screen.getAllByRole('radio').map((r) => r.textContent)).toEqual(['Model paused', 'Feed outage', 'Emergency sign-in']);
    expect(screen.getByText('Forecast paused')).toBeTruthy();
    const user = (await listUsers(ctxOf(), { limit: 200 })).items.find((u) => u.assigned_role === 'administrator');
    expect(screen.getByText(user?.display_name as string).tagName).toBe('BDI');
    expect(screen.getByText(/paused the forecast: data check/)).toBeTruthy();
    const preview = document.querySelector('[data-preview="model"]')?.closest('div[class]')?.parentElement as HTMLElement;
    expect(within(preview).getByText('In app · Email')).toBeTruthy();
    expect(within(preview).getByText('Planner')).toBeTruthy();
  });

  it('what happens at night follows the window: the model alert (warning, e-mail) is held, a critical one is sent at once, and the row says "Not applied"', async () => {
    const { container } = await renderScreen();
    const night = () => screen.getByText('At night').closest('div') as HTMLElement;
    expect(within(night()).getByText('Email held until 05:00')).toBeTruthy();
    expect(within(night()).getByText('Not applied')).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: 'Feed outage' }));
    expect(screen.getByText('Agent feed is down')).toBeTruthy();
    expect(container.querySelector('[data-preview="feed"]')).not.toBeNull();
    expect(within(night()).getByText('Sent at once')).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: 'Emergency sign-in' }));
    expect(screen.getByText('Emergency administrator signed in')).toBeTruthy();
    expect(within(night()).getByText('Sent at once')).toBeTruthy();
  });

  it('the quiet-hours card shows the window in Riyadh time, what it applies to, that critical always sends, and Not applied; Edit opens ?quiet=1', async () => {
    await renderScreen();
    const heading = screen.getByRole('heading', { name: 'Quiet hours' });
    const card = heading.closest('section, div[class]')?.parentElement as HTMLElement;
    expect(within(card).getByText('23:00 to 05:00')).toBeTruthy();
    expect(within(card).getByText('Asia/Riyadh')).toBeTruthy();
    expect(within(card).getByText('Email only')).toBeTruthy();
    expect(within(card).getByText('Always sent')).toBeTruthy();
    expect(within(card).getByText('On')).toBeTruthy();
    expect(within(card).getByText('Not applied')).toBeTruthy();
    fireEvent.click(within(card).getByRole('button', { name: 'Edit' }));
    expect(env.router.push).toHaveBeenCalledWith(expect.stringContaining('quiet=1'));
  });
});

describe('Notifications and Alerts: the rule drawer (?rule=)', () => {
  const open = (event = 'model_paused') => renderScreen({ search: { rule: ruleOf(event).id } });

  it('shows the rule\'s channels and recipients ticked, the severity, the switch, the e-mail channel tagged Not applied, and Save', async () => {
    await open();
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Model paused')).toBeTruthy();
    expect(within(dialog).getByRole<HTMLInputElement>('checkbox', { name: 'In app' }).checked).toBe(true);
    expect(within(dialog).getByRole<HTMLInputElement>('checkbox', { name: 'Email' }).checked).toBe(true);
    expect(within(dialog).getByRole<HTMLInputElement>('checkbox', { name: 'Administrator' }).checked).toBe(true);
    expect(within(dialog).getByRole<HTMLInputElement>('checkbox', { name: 'Planner' }).checked).toBe(true);
    expect(within(dialog).getByRole<HTMLInputElement>('checkbox', { name: 'Dispatcher' }).checked).toBe(false);
    expect((within(dialog).getByRole('combobox') as HTMLSelectElement).value).toBe('warning');
    expect(within(dialog).getByRole('switch', { name: 'Rule on' }).getAttribute('aria-checked')).toBe('true');
    expect(within(dialog).getByText('Not applied')).toBeTruthy();
    expect(disabled(within(dialog).getByRole('button', { name: 'Save' }))).toBe(false);
  });

  it('with no channel ticked Save is disabled with "Choose at least one channel"; ticking one brings it back', async () => {
    await open('model_switched');
    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('checkbox', { name: 'In app' }));
    expect(within(dialog).getByText('Choose at least one channel')).toBeTruthy();
    expect(disabled(within(dialog).getByRole('button', { name: 'Save' }))).toBe(true);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(actions.saveRule).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('checkbox', { name: 'Email' }));
    expect(within(dialog).queryByText('Choose at least one channel')).toBeNull();
    expect(disabled(within(dialog).getByRole('button', { name: 'Save' }))).toBe(false);
  });

  it('Save sends the rule id, the ticked channels and recipients (in order), the severity and the switch, and nothing else; the toast names the event', async () => {
    mockOf(actions.saveRule).mockResolvedValue(ok({ ruleId: 'x', event: 'model_switched' as const, enabled: false }));
    await open('model_switched');
    const rule = ruleOf('model_switched');
    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('checkbox', { name: 'Email' }));
    fireEvent.click(within(dialog).getByRole('checkbox', { name: 'Dispatcher' }));
    fireEvent.click(within(dialog).getByRole('checkbox', { name: 'Administrator' }));
    fireEvent.change(within(dialog).getByRole('combobox'), { target: { value: 'critical' } });
    fireEvent.click(within(dialog).getByRole('switch', { name: 'Rule on' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(actions.saveRule).toHaveBeenCalledWith({ ruleId: rule.id, channels: ['in_app', 'email'], roles: expect.arrayContaining(['dispatcher']), severity: 'critical', enabled: false }));
    const sent = mockOf(actions.saveRule).mock.calls[0]?.[0] as unknown as { roles: string[] };
    expect(sent.roles).not.toContain('administrator');
    expect(JSON.stringify(mockOf(actions.saveRule).mock.calls)).not.toMatch(FORBIDDEN);
    expect(await screen.findByText('Rule saved')).toBeTruthy();
    expect(env.router.replace).toHaveBeenCalled();
  });

  it('a refusal stays in the drawer with its translated line and the English detail', async () => {
    mockOf(actions.saveRule).mockResolvedValue({ ok: false, code: 'invalid', message: 'Notification rule: channels needs at least 1 item.' });
    await open();
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Check the details and try again.')).toBeTruthy();
    expect(screen.getByText('Notification rule: channels needs at least 1 item.').getAttribute('lang')).toBe('en');
  });
});

describe('Notifications and Alerts: the quiet-hours drawer (?quiet=1)', () => {
  it('shows the stored window, what it applies to, the switch, Riyadh time with the Not applied tag, and a critical switch that is fixed on', async () => {
    await renderScreen({ search: { quiet: '1' } });
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('switch', { name: 'Quiet hours on' }).getAttribute('aria-checked')).toBe('true');
    expect((within(dialog).getByLabelText('From') as HTMLInputElement).value).toBe('23:00');
    expect((within(dialog).getByLabelText('To') as HTMLInputElement).value).toBe('05:00');
    expect(within(dialog).getByRole<HTMLInputElement>('radio', { name: 'Email only' }).checked).toBe(true);
    expect(within(dialog).getByText('Riyadh time')).toBeTruthy();
    expect(within(dialog).getByText('Not applied')).toBeTruthy();
    const critical = within(dialog).getByRole('switch', { name: 'Critical alerts always send' });
    expect(critical.getAttribute('aria-checked')).toBe('true');
    expect(disabled(critical)).toBe(true);
    expect(within(dialog).getByText('Critical alerts are never held')).toBeTruthy();
  });

  it('Save sends the switch, the two times and the scope, and nothing else', async () => {
    mockOf(actions.saveQuietHours).mockResolvedValue(ok({ enabled: true, start: '22:00', end: '06:30', appliesTo: 'email_and_in_app' as const }));
    await renderScreen({ search: { quiet: '1' } });
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('From'), { target: { value: '22:00' } });
    fireEvent.change(within(dialog).getByLabelText('To'), { target: { value: '06:30' } });
    fireEvent.click(within(dialog).getByRole('radio', { name: 'In app and email' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(actions.saveQuietHours).toHaveBeenCalledWith({ enabled: true, start: '22:00', end: '06:30', appliesTo: 'email_and_in_app' }));
    expect(JSON.stringify(mockOf(actions.saveQuietHours).mock.calls)).not.toMatch(FORBIDDEN);
    expect(await screen.findByText('Quiet hours saved')).toBeTruthy();
  });

  it('a window whose start equals its end, or with a time cleared, cannot be saved: Save is disabled with the reason', async () => {
    await renderScreen({ search: { quiet: '1' } });
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('To'), { target: { value: '23:00' } });
    expect(within(dialog).getByText('The start and the end must differ')).toBeTruthy();
    expect(disabled(within(dialog).getByRole('button', { name: 'Save' }))).toBe(true);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(actions.saveQuietHours).not.toHaveBeenCalled();
    fireEvent.change(within(dialog).getByLabelText('To'), { target: { value: '' } });
    expect(disabled(within(dialog).getByRole('button', { name: 'Save' }))).toBe(true);
  });
});

describe('Notifications and Alerts: the Alert log tab', () => {
  it('lists the 14 alerts newest first with time, title and body, category, severity and to whom; unread ones are marked; the caller\'s own are "Yours"', async () => {
    await renderScreen({ search: { tab: 'log' } });
    const table = screen.getByRole('table', { name: 'Alert log' });
    expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(expect.arrayContaining(['Time', 'Alert', 'Category', 'Severity', 'To']));
    const rows = bodyRows('Alert log');
    expect(rows).toHaveLength(14);
    expect(rows[0]?.textContent).toContain('Agent feed is degraded');
    expect(within(rows[0] as HTMLElement).getByText('Position updates are delayed for 4 agents.')).toBeTruthy();
    expect(within(rows[0] as HTMLElement).getByText('Unread')).toBeTruthy();
    expect(within(rows[0] as HTMLElement).getByText('Yours')).toBeTruthy();
    const read = rows.find((r) => r.textContent?.includes('Fallback was active for 12 minutes')) as HTMLElement;
    expect(within(read).queryByText('Unread')).toBeNull();
    expect(within(read).queryByText('Yours')).toBeNull();
  });

  it('?severity= ?category= ?read= and ?q= narrow the list on the server; an unknown value is ignored', async () => {
    await renderScreen({ search: { tab: 'log', severity: 'critical' } });
    expect(bodyRows('Alert log')).toHaveLength(2);
    cleanup();
    await renderScreen({ search: { tab: 'log', category: 'roster' } });
    expect(bodyRows('Alert log')).toHaveLength(2);
    cleanup();
    await renderScreen({ search: { tab: 'log', read: 'read' } });
    expect(bodyRows('Alert log').every((r) => within(r).queryByText('Unread') === null)).toBe(true);
    cleanup();
    await renderScreen({ search: { tab: 'log', q: 'backup' } });
    expect(bodyRows('Alert log')).toHaveLength(1);
    cleanup();
    await renderScreen({ search: { tab: 'log', severity: 'urgent', category: 'nope', read: 'maybe' } });
    expect(bodyRows('Alert log')).toHaveLength(14);
    cleanup();
    await renderScreen({ search: { tab: 'log', q: 'zzz-nothing' } });
    expect(screen.getByText('No matching results')).toBeTruthy();
  });

  it('the checkbox of a row is named by the alert, and a selection shows the bulk bar with Mark read', async () => {
    await renderScreen({ search: { tab: 'log' } });
    fireEvent.click(screen.getByRole('checkbox', { name: /Backup overdue/ }));
    expect(screen.getByText(/1\s+selected/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Mark read' })).toBeTruthy();
  });

  it('Mark read sends only the selected alerts that are the caller\'s own and unread, and says how many were marked', async () => {
    mockOf(actions.markAlertsRead).mockResolvedValue(ok({ marked: 1, skipped: 0 }));
    await renderScreen({ search: { tab: 'log' } });
    fireEvent.click(screen.getByRole('checkbox', { name: /Backup overdue/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Roster waiting for approval/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Mark read' }));
    const view = bodyRows('Alert log');
    expect(view).toHaveLength(14);
    await waitFor(() => expect(actions.markAlertsRead).toHaveBeenCalledTimes(1));
    const sent = mockOf(actions.markAlertsRead).mock.calls[0]?.[0] as unknown as { ids: string[] };
    expect(Object.keys(mockOf(actions.markAlertsRead).mock.calls[0]?.[0] as object)).toEqual(['ids']);
    expect(sent.ids).toHaveLength(1);
    expect(JSON.stringify(mockOf(actions.markAlertsRead).mock.calls)).not.toMatch(FORBIDDEN);
    expect(await screen.findByText('1 alert marked read')).toBeTruthy();
  });

  it('a selection with nothing the caller can mark says so and calls no action', async () => {
    await renderScreen({ search: { tab: 'log' } });
    fireEvent.click(screen.getByRole('checkbox', { name: /Roster waiting for approval/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Mark read' }));
    expect(await screen.findByText(/Nothing to mark/)).toBeTruthy();
    expect(actions.markAlertsRead).not.toHaveBeenCalled();
  });
});

describe('Notifications and Alerts: the header', () => {
  it('Send test alert sends the first rule that is on (by id) and the toast names the rule', async () => {
    mockOf(actions.sendTestAlert).mockResolvedValue(ok({ ruleId: 'x', event: 'model_paused' as const, notificationId: 'n' }));
    await renderScreen();
    fireEvent.click(screen.getByRole('button', { name: 'Send test alert' }));
    await waitFor(() => expect(actions.sendTestAlert).toHaveBeenCalledWith({ ruleId: rules().find((r) => r.is_enabled)?.id }));
    expect(JSON.stringify(mockOf(actions.sendTestAlert).mock.calls)).not.toMatch(FORBIDDEN);
    expect(await screen.findByText('Test alert sent')).toBeTruthy();
    expect(screen.getByText('For Model paused. It appears at the bell in the top bar.')).toBeTruthy();
  });

  it('More has Quiet hours (opens the drawer), Mark all read, and Export log (a CSV of what is on screen)', async () => {
    mockOf(actions.markAllRead).mockResolvedValue(ok({ marked: 3, skipped: 0 }));
    await renderScreen({ search: { tab: 'log', severity: 'critical' } });
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Quiet hours' }));
    expect(env.router.push).toHaveBeenCalledWith(expect.stringContaining('quiet=1'));
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Mark all read' }));
    await waitFor(() => expect(actions.markAllRead).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('All your alerts are marked read')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Export log' }));
    const [file, table] = env.saved.mock.calls[0] as [string, { header: string[]; rows: string[][] }];
    expect(file).toBe('alert-log.csv');
    expect(table.header).toEqual(['Time', 'Alert', 'Category', 'Severity', 'To', 'Status']);
    expect(table.rows).toHaveLength(2);
    expect(table.rows.every((r) => r[3] === 'Critical')).toBe(true);
  });
});

describe('Notifications and Alerts: a view-only role', () => {
  it('sees every control disabled with the reason, and no action is called', async () => {
    await renderScreen({ access: 'view' });
    expect(screen.getByText('View only')).toBeTruthy();
    expect(disabled(screen.getByRole('button', { name: 'Send test alert' }))).toBe(true);
    expect(disabled(screen.getByRole('button', { name: 'Edit' }))).toBe(true);
    for (const toggle of screen.getAllByRole('switch')) expect(disabled(toggle)).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Send test alert' }));
    fireEvent.click(within(bodyRows('Notification rules')[0] as HTMLElement).getByRole('switch'));
    expect(actions.sendTestAlert).not.toHaveBeenCalled();
    expect(actions.toggleRule).not.toHaveBeenCalled();
    cleanup();
    await renderScreen({ access: 'view', search: { rule: ruleOf('model_paused').id } });
    expect(disabled(within(screen.getByRole('dialog')).getByRole('button', { name: 'Save' }))).toBe(true);
    expect(within(screen.getByRole('dialog')).getAllByText('View only for this role').length).toBeGreaterThan(0);
    cleanup();
    await renderScreen({ access: 'view', search: { quiet: '1' } });
    expect(disabled(within(screen.getByRole('dialog')).getByRole('button', { name: 'Save' }))).toBe(true);
    cleanup();
    await renderScreen({ access: 'view', search: { tab: 'log' } });
    fireEvent.click(screen.getByRole('checkbox', { name: /Backup overdue/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Mark read' }));
    expect(actions.markAlertsRead).not.toHaveBeenCalled();
  });
});

describe('Notifications and Alerts: the review states (?state=)', () => {
  it.each(['empty', 'loading', 'error'] as const)('?state=%s shows that state, keeps the header, and reads nothing', async (state) => {
    const { container } = await renderScreen({ state });
    expect(root(container)?.getAttribute('data-state')).toBe(state);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Notifications and Alerts');
    if (state === 'empty') {
      expect(screen.getByText('No alerts yet')).toBeTruthy();
      expect(screen.getByText('Alerts appear when a rule fires.')).toBeTruthy();
      expect(screen.getAllByRole('button', { name: 'Send test alert' }).length).toBeGreaterThan(1);
    }
    if (state === 'error') {
      expect(screen.getByRole('alert').textContent).toContain('The alerts could not load.');
      expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
    }
    if (state === 'loading') expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
  });
});

describe('Notifications and Alerts: Arabic', () => {
  it('draws both tabs in Arabic with no English left outside data, Western digits, and the preview in Arabic', async () => {
    for (const tab of ['rules', 'log']) {
      const { container } = await renderScreen({ locale: 'ar', search: { tab } });
      expect(dataText(container), tab).not.toMatch(/[A-Za-z]{3}/);
      expect(container.textContent, tab).not.toMatch(/[٠-٩]/);
      cleanup();
    }
  });

  it('draws the drawers and the states in Arabic', async () => {
    for (const search of [{ rule: ruleOf('model_paused').id }, { quiet: '1' }]) {
      const { container } = await renderScreen({ locale: 'ar', search });
      expect(dataText(document.body), JSON.stringify(search)).not.toMatch(/[A-Za-z]{3}/);
      expect(container.textContent).not.toMatch(/[٠-٩]/);
      cleanup();
    }
    for (const state of ['empty', 'error'] as const) {
      const { container } = await renderScreen({ locale: 'ar', state });
      expect(dataText(container)).not.toMatch(/[A-Za-z]{3}/);
      cleanup();
    }
  });

  it('marks the English data in the log (titles and bodies) as English so a screen reader switches voice', async () => {
    const { container } = await renderScreen({ locale: 'ar', search: { tab: 'log' } });
    const english = container.querySelectorAll('[lang="en"]');
    expect(english.length).toBeGreaterThanOrEqual(14);
  });
});
