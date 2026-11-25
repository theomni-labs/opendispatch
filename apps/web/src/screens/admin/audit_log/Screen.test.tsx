// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment jsdom
import { DesignSystemProvider } from '@opendispatch/ui';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hasLatinLetters, inLocale } from '@/components/opendispatch/test-utils';
import { getModule, type InstallMode, type Role } from '@/lib/access';
import { fixtureUsers } from '@/lib/data/go-test-reset';
import { buildContext, fixtureTenantId } from '@/lib/data/go-test-reset';
import type { RequestContext } from '@/lib/data/guard';
import { createWebhook } from '@/lib/data/system';
import type { ScreenProps, SearchParams } from '@/screens/types';
import { AuditLogScreen } from './Screen';

// The screen as the module route renders it: the async Server Component is called with the props ModuleRoute builds, and the
// element it returns is rendered in each language. The data layer is real (fixtures, a temp demo store); the router, the
// export action, next-intl's server translator and the download are stood in for.
const env = vi.hoisted(() => ({ locale: 'en' as 'en' | 'ar', query: '', router: { push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }, exportAction: vi.fn(), download: vi.fn(), navigate: vi.fn() }));

vi.mock('next-intl/server', async () => {
  const { createTranslator } = await import('next-intl');
  const { loadMessages } = await import('@/i18n/messages');
  return { getTranslations: async (namespace?: string) => createTranslator({ locale: env.locale, messages: loadMessages(env.locale, 'admin.audit_log'), ...(namespace === undefined ? {} : { namespace }) }) };
});
vi.mock('@/i18n/navigation', () => ({ usePathname: () => '/admin/audit-log', useRouter: () => env.router }));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams(env.query) }));
vi.mock('./actions', () => ({ exportAuditLog: env.exportAction }));
vi.mock('@/lib/export/download', async (original) => ({ ...(await original<typeof import('@/lib/export/download')>()), downloadText: env.download }));

beforeEach(async () => {
  // Go audit events; no server is fine.
  const url = process.env['OPENDISPATCH_API_URL'];
  if (url) await fetch(`${url}/_internal/test/reset`, { method: 'POST' }).catch(() => undefined);
});
afterEach(() => {
  cleanup();
  for (const mock of [env.router.replace, env.router.push, env.router.refresh, env.exportAction, env.download, env.navigate]) mock.mockReset();
});

function ctxOf(role: Role, installMode: InstallMode = 'private'): RequestContext {
  const tenant = fixtureTenantId();
  const built = buildContext({ role, installMode, zoneIds: [] }, fixtureUsers(), tenant);
  if (built === null) throw new Error(`no context for ${role}`);
  return built;
}

interface Options {
  locale?: 'en' | 'ar';
  role?: Role;
  mode?: InstallMode;
  search?: SearchParams;
  state?: ScreenProps['state'];
}

async function renderScreen({ locale = 'en', role = 'administrator', mode = 'private', search = {}, state }: Options = {}) {
  env.locale = locale;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(search)) if (typeof value === 'string') params.set(key, value);
  env.query = params.toString();
  const element = await AuditLogScreen({ def: getModule('admin.audit_log'), ctx: ctxOf(role, mode), access: { access: 'view', reduced: false }, locale, homeHref: '/admin/audit-log', state, searchParams: search });
  return inLocale(locale, <DesignSystemProvider navigate={env.navigate}>{element}</DesignSystemProvider>, { module: 'admin.audit_log' });
}

const root = (container: HTMLElement) => container.querySelector<HTMLElement>('[data-module]');
const bodyRows = () => screen.getAllByRole('row').filter((row) => within(row).queryAllByRole('cell').length > 0);
const idOfFirstRow = async (search: SearchParams = {}) => {
  await renderScreen({ search });
  fireEvent.click(bodyRows()[0] as HTMLElement);
  const href = env.navigate.mock.calls[0]?.[0] as string;
  cleanup();
  env.navigate.mockReset();
  return new URL(href, 'http://x').searchParams.get('id') as string;
};

describe('Audit Log: filled, English, Administrator', () => {
  it('carries the four hooks the e2e specs read, the module title, the data source, and the Append only badge', async () => {
    const { container } = await renderScreen();
    const page = root(container);
    expect([page?.getAttribute('data-module'), page?.getAttribute('data-state'), page?.getAttribute('data-access'), page?.getAttribute('data-reduced')]).toEqual(['admin.audit_log', 'filled', 'view', 'false']);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Audit Log');
    expect(container.querySelector('[data-badge="SYNTHETIC"]')).not.toBeNull();
    expect(screen.getByText('Append only')).toBeTruthy();
    expect(screen.getByText('View only for every role')).toBeTruthy();
  });

  it('has two header actions: Export (enabled for every role that can open the log) and More with Refresh', async () => {
    await renderScreen();
    expect(screen.getByRole('button', { name: 'Export' }).hasAttribute('aria-disabled')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual(['Refresh']);
  });

  it('shows four figures: events, the last 24 hours, sign-ins and denied', async () => {
    await renderScreen();
    // Each figure is a label and a value under one root: walk up from the label to the first ancestor that holds a number.
    const figure = (label: string) => {
      let node: HTMLElement | null = screen.getAllByText(label)[0] as HTMLElement;
      while (node !== null && !/\d$/.test(node.textContent ?? '')) node = node.parentElement;
      return node?.textContent;
    };
    expect(figure('Events')).toBe('Events23');
    expect(figure('Sign-ins')).toBe('Sign-ins9');
    expect(figure('Denied')).toBe('Denied1');
    expect(figure('Last 24 hours')).toMatch(/^Last 24 hours\d+$/);
  });

  it('lists ten events of 23 with the seven columns of the mockup, action codes as data, and pagination', async () => {
    const { container } = await renderScreen();
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Time', 'Actor', 'Action', 'Entity', 'Summary', 'Outcome', 'Source']);
    expect(bodyRows()).toHaveLength(10);
    expect(container.querySelectorAll('td [translate="no"]').length).toBeGreaterThanOrEqual(30);
    expect(screen.getByText('integration.health_changed')).toBeTruthy();
    expect(screen.getByRole('navigation', { name: 'Pagination' })).toBeTruthy();
    expect(screen.getByText(/1.*10.*23/)).toBeTruthy();
  });

  it('draws the cells: a person\'s name, System with its sub line, the outcome pill, the English summary marked as English', async () => {
    await renderScreen({ search: { q: 'Tariq' } });
    const tariq = bodyRows()[0] as HTMLElement;
    expect(within(tariq).getByText('Success')).toBeTruthy();
    expect(within(tariq).getByText('auth.sign_in')).toBeTruthy();
    expect(within(tariq).getByRole('img', { name: 'Tariq Al-Dubari' })).toBeTruthy();
    expect(within(tariq).getByText('Viewer / Auditor')).toBeTruthy();
    expect(within(tariq).getByText('Sign-in')).toBeTruthy();
    cleanup();
    const { container } = await renderScreen({ search: { outcome: 'denied' } });
    const denied = bodyRows()[0] as HTMLElement;
    expect(within(denied).getByText('Denied')).toBeTruthy();
    expect(within(denied).getByText('Unknown person')).toBeTruthy();
    expect(within(denied).getByText('No role matched')).toBeTruthy();
    const summary = denied.querySelector('[lang="en"]');
    expect(summary?.getAttribute('dir')).toBe('ltr');
    expect(summary?.textContent).toMatch(/^Sign-in refused/);
    expect(container.querySelector('tr[data-tone="danger"], tr[class*="danger"]')).not.toBeNull();
  });

  it('shows System and its sub line for a scheduled job', async () => {
    await renderScreen({ search: { cat: 'system' } });
    expect(screen.getAllByText('System').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Scheduled job').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Demo tooling').length).toBeGreaterThan(0);
  });

  it('opens an event through ?id= when its row is pressed (rowHref, a push: Back closes the drawer)', async () => {
    await renderScreen({ search: { cat: 'rules' } });
    fireEvent.click(bodyRows()[0] as HTMLElement);
    expect(env.navigate).toHaveBeenCalledTimes(1);
    expect(env.navigate.mock.calls[0]?.[0]).toMatch(/^\/admin\/audit-log\?cat=rules&id=[0-9a-f-]{36}$/);
  });
});

describe('Audit Log: search and filters from the address (validated on the server)', () => {
  it('honours ?q= and ?outcome= (the sign-in e2e spec reads the log this way)', async () => {
    await renderScreen({ search: { q: 'auth.emergency' } });
    expect(bodyRows()).toHaveLength(1);
    expect(screen.getByText('auth.emergency_sign_in')).toBeTruthy();
    expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('auth.emergency');
    cleanup();
    await renderScreen({ search: { outcome: 'denied' } });
    expect(bodyRows()).toHaveLength(1);
    expect(screen.getByText('Outcome: Denied')).toBeTruthy();
  });

  it('filters by category and period and shows them as chips with Clear all', async () => {
    await renderScreen({ search: { cat: 'rules', period: '7d' } });
    expect(screen.getByText('Category: Rules')).toBeTruthy();
    expect(screen.getByText('Period: Last 7 days')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Clear all' }).length).toBeGreaterThan(0);
  });

  it('ignores a value that is not on its allow-list: no filter, no chip, the whole log is listed', async () => {
    await renderScreen({ search: { outcome: 'root', cat: 'everything', period: 'forever', page: '-3', q: '\u0000' } });
    expect(bodyRows()).toHaveLength(10);
    expect(screen.queryByText(/Outcome: /)).toBeNull();
    expect(screen.queryByText(/Category: /)).toBeNull();
  });

  it('shows "No match" with Clear all when nothing matches, and the figures stay', async () => {
    await renderScreen({ search: { q: 'zzz-nothing' } });
    expect(screen.getByText('No match')).toBeTruthy();
    expect(screen.queryByRole('navigation', { name: 'Pagination' })).toBeNull();
    fireEvent.click(screen.getAllByRole('button', { name: 'Clear all' }).at(-1) as HTMLElement);
    expect(env.router.replace).toHaveBeenCalledWith('/admin/audit-log', { scroll: false });
  });

  it('pages through ?page=', async () => {
    await renderScreen({ search: { page: '3' } });
    expect(bodyRows()).toHaveLength(3);
    fireEvent.click(screen.getByRole('button', { name: 'Previous page' }));
    expect(env.router.replace).toHaveBeenCalledWith('/admin/audit-log?page=2', { scroll: false });
  });
});

describe('Audit Log: the event drawer from the address', () => {
  it('opens on first paint for ?id=, read only: the record, its English summary, the actor, and Copy JSON', async () => {
    const id = await idOfFirstRow({ cat: 'rules' });
    await renderScreen({ search: { cat: 'rules', id } });
    const drawer = screen.getByRole('dialog', { name: 'rule.approved' });
    expect(within(drawer).getByText('Fahad Al-Musari')).toBeTruthy();
    expect(within(drawer).getByText('Actor type')).toBeTruthy();
    expect(within(drawer).getByText('Correlation id')).toBeTruthy();
    expect(within(drawer).getByRole('button', { name: 'Copy JSON' })).toBeTruthy();
    expect(within(drawer).getAllByRole('button', { name: 'Close' }).length).toBe(2);
    const json = drawer.querySelector('pre');
    expect(JSON.parse(json?.textContent ?? '{}')).toMatchObject({ id, action: 'rule.approved', data_source: 'SYNTHETIC' });
    expect(json?.getAttribute('translate')).toBe('no');
    // append only: no edit control of any kind in the drawer
    expect(within(drawer).queryByRole('button', { name: /Edit|Save|Delete|Disable/ })).toBeNull();
  });

  it('shows an inline notice and no drawer for an id that is malformed or names no event', async () => {
    await renderScreen({ search: { id: 'nonsense' } });
    expect(screen.getByRole('alert').textContent).toContain('That event could not be found.');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(bodyRows()).toHaveLength(10);
    cleanup();
    await renderScreen({ search: { id: '00000000-0000-4000-8000-00000000dead' } });
    expect(screen.getByRole('alert').textContent).toContain('That event could not be found.');
  });
});

describe('Audit Log: Export and Refresh', () => {
  it('exports the events in the current filter through the action, saves the file and says so', async () => {
    env.exportAction.mockResolvedValue({ ok: true, data: { filename: 'audit-log-2026-09-20.csv', mime: 'text/csv;charset=utf-8', text: 'a,b' } });
    await renderScreen({ search: { q: 'rule', outcome: 'success', cat: 'rules', period: '7d' } });
    fireEvent.click(screen.getByRole('button', { name: 'Export' }));
    await waitFor(() => expect(env.download).toHaveBeenCalledTimes(1));
    expect(env.exportAction).toHaveBeenCalledWith({ q: 'rule', outcome: 'success', category: 'rules', period: '7d' });
    expect(env.download).toHaveBeenCalledWith({ filename: 'audit-log-2026-09-20.csv', mime: 'text/csv;charset=utf-8', text: 'a,b' });
    expect(await screen.findByText('Export started')).toBeTruthy();
  });

  it('says so when the export fails, and saves nothing', async () => {
    env.exportAction.mockResolvedValue({ ok: false, code: 'forbidden', message: 'planner may not view admin.audit_log in a private install.' });
    await renderScreen();
    fireEvent.click(screen.getByRole('button', { name: 'Export' }));
    expect(await screen.findByText('Your role cannot do that.')).toBeTruthy();
    expect(env.download).not.toHaveBeenCalled();
  });

  it('refreshes the log from the More menu', async () => {
    await renderScreen();
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Refresh' }));
    expect(env.router.refresh).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('Log refreshed')).toBeTruthy();
  });
});

describe('Audit Log: the roles that can open it', () => {
  it.each([
    ['administrator', 'private'],
    ['viewer_auditor', 'private'],
    ['change_approver', 'private'],
    ['administrator', 'shared'],
    ['viewer_auditor', 'dedicated'],
  ] as const)('%s in a %s install sees the same read only page: View only, Export enabled, names of the actors', async (role, mode) => {
    const { container } = await renderScreen({ role, mode });
    expect(root(container)?.getAttribute('data-access')).toBe('view');
    expect(screen.getByText('View only')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Export' }).hasAttribute('aria-disabled')).toBe(false);
    expect(bodyRows()).toHaveLength(10);
    cleanup();
    await renderScreen({ role, mode, search: { cat: 'rules' } });
    expect(screen.getAllByText('Fahad Al-Musari').length).toBeGreaterThan(0);
  });
});

describe('Audit Log: the states', () => {
  it('empty: the module\'s own text', async () => {
    const { container } = await renderScreen({ state: 'empty' });
    expect(root(container)?.getAttribute('data-state')).toBe('empty');
    expect(screen.getByText('No events yet')).toBeTruthy();
    expect(screen.getByText('Every write and sign-in appears here.')).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.getByRole('button', { name: 'Export' }).getAttribute('aria-disabled') ?? screen.getByRole('button', { name: 'Export' }).hasAttribute('disabled')).toBeTruthy();
  });

  it('loading: skeletons in a card, announced once, the header kept', async () => {
    const { container } = await renderScreen({ state: 'loading' });
    expect(root(container)?.getAttribute('data-state')).toBe('loading');
    expect(container.querySelector('[data-skeleton="list"]')).not.toBeNull();
    expect(screen.getAllByText('Loading')).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Audit Log');
  });

  it('error: "The events could not load." as an alert with Try again', async () => {
    const { container } = await renderScreen({ state: 'error' });
    expect(root(container)?.getAttribute('data-state')).toBe('error');
    expect(screen.getByRole('alert').textContent).toContain('The events could not load.');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });

  it('a review state reads no data', async () => {
    await renderScreen({ state: 'empty' });
    expect(screen.queryByText('integration.health_changed')).toBeNull();
  });
});

describe('Audit Log in Arabic', () => {
  // Action codes, names, ids and the data layer's English summaries are data (translate="no" / lang="en"); the rest is Arabic.
  const untranslated = (container: HTMLElement) => {
    const clone = container.cloneNode(true) as HTMLElement;
    for (const node of clone.querySelectorAll('[translate="no"], [lang="en"]')) node.remove();
    const attributes = [...clone.querySelectorAll('[aria-label], [title], [placeholder]')].flatMap((el) => [el.getAttribute('aria-label') ?? '', el.getAttribute('title') ?? '', el.getAttribute('placeholder') ?? '']);
    return `${clone.textContent ?? ''} ${attributes.join(' ')}`;
  };

  it('draws the log in Arabic with no English left over outside the data', async () => {
    const { container } = await renderScreen({ locale: 'ar' });
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('سجل التدقيق');
    expect(hasLatinLetters(untranslated(container), [])).toBe(false);
    expect(screen.getByRole('button', { name: 'تصدير' })).toBeTruthy();
    expect(screen.getByText('للإضافة فقط')).toBeTruthy();
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['الوقت', 'المنفّذ', 'الإجراء', 'الكيان', 'الملخّص', 'النتيجة', 'المصدر']);
    expect(container.querySelector('[data-badge="SYNTHETIC"]')?.textContent).toBe('اصطناعية');
  });

  it('draws the drawer, a denied row, the filters and the states in Arabic', async () => {
    const id = await idOfFirstRow({ cat: 'rules' });
    await renderScreen({ locale: 'ar', search: { cat: 'rules', id } });
    // `JSON` is the format's name, written in Latin letters in Arabic too.
    expect(hasLatinLetters(untranslated(screen.getByRole('dialog')), ['JSON'])).toBe(false);
    cleanup();
    const denied = await renderScreen({ locale: 'ar', search: { outcome: 'denied' } });
    expect(hasLatinLetters(untranslated(denied.container), [])).toBe(false);
    expect(screen.getByText('شخص غير معروف')).toBeTruthy();
    cleanup();
    await renderScreen({ locale: 'ar', state: 'empty' });
    expect(screen.getByText('لا أحداث بعد')).toBeTruthy();
    cleanup();
    await renderScreen({ locale: 'ar', state: 'error' });
    expect(screen.getByText('تعذّر تحميل الأحداث.')).toBeTruthy();
  });

  it('fills the Arabic summary sentence from the event\'s values, with the role under the name', async () => {
    await createWebhook(ctxOf('administrator'), { name: 'Rules hook', target_url: 'https://hooks.example.com/r', event_types: ['rule.approved'] });
    await renderScreen({ locale: 'ar', search: { q: 'Rules hook' } });
    const row = bodyRows()[0] as HTMLElement;
    expect(within(row).getByText('تم إنشاء خطّاف الويب Rules hook.')).toBeTruthy();
    expect(within(row).getByText('مسؤول النظام')).toBeTruthy();
    cleanup();
    await renderScreen({ locale: 'en', search: { q: 'Rules hook' } });
    expect(within(bodyRows()[0] as HTMLElement).getByText('Webhook Rules hook created.')).toBeTruthy();
  });

  it('writes numbers in Western digits and the dates through the shared formatter', async () => {
    const { container } = await renderScreen({ locale: 'ar' });
    expect(/[٠-٩]/.test(container.textContent ?? '')).toBe(false);
    expect(container.textContent).toMatch(/12 سبتمبر 2026/);
  });
});
