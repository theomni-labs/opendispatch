// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment jsdom
import { DesignSystemProvider } from '@opendispatch/ui';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { inLocale } from '@/components/opendispatch/test-utils';
import { getModule, type InstallMode, type Role } from '@/lib/access';
import { buildContext, fixtureTenantId } from '@/lib/data/go-test-reset';
import type { RequestContext } from '@/lib/data/guard';
import type { ScreenProps, SearchParams } from '@/screens/types';
import * as actions from './actions';
import { SystemHealthScreen } from './Screen';
import { fixtureUsers, resetGoTestState } from '@/lib/data/go-test-reset';

// The screen as the module route renders it: the async Server Component is called with the props ModuleRoute builds, and the element
// it returns is rendered in each language. The data layer is real (its seeds, a temp demo store); the router, the actions and
// next-intl's server translator are stood in for, and so is the browser's download.
const env = vi.hoisted(() => ({ locale: 'en' as 'en' | 'ar', query: '', router: { push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }, navigate: vi.fn() }));

vi.mock('next-intl/server', async () => {
  const { createTranslator } = await import('next-intl');
  const { loadMessages } = await import('@/i18n/messages');
  return { getTranslations: async (namespace?: string) => createTranslator({ locale: env.locale, messages: loadMessages(env.locale, 'admin.system_health'), ...(namespace === undefined ? {} : { namespace }) }) };
});
vi.mock('@/i18n/navigation', () => ({ usePathname: () => '/admin/system-health', useRouter: () => env.router }));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams(env.query) }));
vi.mock('./actions', () => ({ confirmBackupDone: vi.fn(), createDiagnostics: vi.fn() }));

const mocked = <K extends keyof typeof actions>(name: K) => actions[name] as unknown as ReturnType<typeof vi.fn>;

let clicked: { download: string; href: string }[];
beforeEach(async () => {
  await resetGoTestState();
  clicked = [];
  (URL as unknown as { createObjectURL: () => string }).createObjectURL = () => 'blob:opendispatch-test';
  (URL as unknown as { revokeObjectURL: () => void }).revokeObjectURL = () => undefined;
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function click(this: HTMLAnchorElement) {
    clicked.push({ download: this.download, href: this.href });
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  for (const mock of [env.router.replace, env.router.push, env.router.refresh, env.navigate]) mock.mockReset();
  for (const name of Object.keys(actions) as (keyof typeof actions)[]) mocked(name).mockReset();
});

function ctxOf(role: Role, installMode: InstallMode = 'private'): RequestContext {
  const tenant = fixtureTenantId();
  const built = buildContext({ role, installMode, zoneIds: [] }, fixtureUsers(), tenant);
  if (built === null) throw new Error(`no context for ${role}`);
  return built;
}

interface Options {
  locale?: 'en' | 'ar';
  access?: 'edit' | 'view';
  mode?: InstallMode;
  search?: SearchParams;
  state?: ScreenProps['state'];
}

async function renderScreen({ locale = 'en', access = 'edit', mode = 'private', search = {}, state }: Options = {}) {
  env.locale = locale;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(search)) if (typeof value === 'string') params.set(key, value);
  env.query = params.toString();
  const element = await SystemHealthScreen({ def: getModule('admin.system_health'), ctx: ctxOf('administrator', mode), access: { access, reduced: false }, locale, homeHref: '/', state, searchParams: search });
  return inLocale(locale, <DesignSystemProvider navigate={env.navigate}>{element}</DesignSystemProvider>, { module: 'admin.system_health' });
}

const root = (container: HTMLElement) => container.querySelector<HTMLElement>('[data-module]');
const bodyRows = () => screen.getAllByRole('row').filter((row) => within(row).queryAllByRole('cell').length > 0);
const isDisabled = (element: HTMLElement) => element.getAttribute('aria-disabled') === 'true' || element.hasAttribute('disabled');
const figure = (label: string) => {
  let node: HTMLElement | null = screen.getAllByText(label)[0] as HTMLElement;
  while (node !== null && !/(\d|Degraded|Healthy|Down|Illustrative)$/.test(node.textContent ?? '')) node = node.parentElement;
  return node?.textContent ?? '';
};

describe('System Health: the frame and the Overview, Administrator (edit)', () => {
  it('carries the four hooks the e2e specs read, the module title, the data source and the version badge with its tooltip name', async () => {
    const { container } = await renderScreen();
    const page = root(container);
    expect([page?.getAttribute('data-module'), page?.getAttribute('data-state'), page?.getAttribute('data-access'), page?.getAttribute('data-reduced')]).toEqual(['admin.system_health', 'filled', 'edit', 'false']);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('System Health');
    expect(container.querySelector('[data-badge="SYNTHETIC"]')).not.toBeNull();
    expect(container.querySelector('[data-version]')?.textContent).toBe('v1.1.0');
    expect(screen.queryByText('View only')).toBeNull();
  });

  it('has two header actions (Download diagnostics and More with Refresh and Confirm backup), three tabs with the job count and four figures', async () => {
    await renderScreen();
    expect(screen.getByRole('button', { name: 'Download diagnostics' }).hasAttribute('aria-disabled')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual(['Refresh', 'Confirm backup']);
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['Overview', 'Job runs11', 'Storage and backups']);
    expect(figure('Overall')).toBe('OverallDegraded');
    expect(figure('Services up')).toContain('7');
    expect(figure('Services up')).toContain('/ 8');
    expect(figure('Failed jobs')).toBe('Failed jobs1');
    expect(figure('Storage used')).toContain('2.9');
    expect(figure('Storage used')).toContain('GB / 100 GB');
    expect(figure('Storage used')).toContain('Illustrative');
  });

  it('shows the eight services with their status and the mockup\'s detail lines, and the as-of time', async () => {
    const { container } = await renderScreen();
    const cards = [...container.querySelectorAll<HTMLElement>('[data-service]')];
    expect(cards.map((card) => card.getAttribute('data-service'))).toEqual(['web', 'api', 'worker', 'engines', 'database', 'keycloak', 'object_storage', 'update_agent']);
    const card = (name: string) => cards.find((c) => c.getAttribute('data-service') === name) as HTMLElement;
    expect(within(card('web')).getByText('Web app')).toBeTruthy();
    expect(within(card('web')).getByText('v1.1.0')).toBeTruthy();
    expect(within(card('api')).getByText('OK')).toBeTruthy();
    expect(within(card('api')).getByText('Responding')).toBeTruthy();
    expect(within(card('keycloak')).getByText('Unknown')).toBeTruthy();
    expect(within(card('keycloak')).getByText('Demo sign-in')).toBeTruthy();
    expect(within(card('update_agent')).getByText('v0.4.0')).toBeTruthy();
    expect(screen.getAllByText('As of')[0]).toBeTruthy();
  });

  it('shows the update agent as run by OpenDispatch in a dedicated or shared install, with no agent version', async () => {
    const { container } = await renderScreen({ mode: 'shared' });
    const agent = container.querySelector('[data-service="update_agent"]') as HTMLElement;
    expect(within(agent).getByText('Unknown')).toBeTruthy();
    expect(within(agent).getByText('Run by OpenDispatch')).toBeTruthy();
    expect(within(agent).queryByText('v0.4.0')).toBeNull();
  });

  it('lists the five feeds with the mockup\'s four columns, the degraded one in the warning tone with its English error', async () => {
    await renderScreen();
    const feeds = within(screen.getAllByRole('table')[0] as HTMLElement);
    const feedRows = feeds.getAllByRole('row').filter((row) => within(row).queryAllByRole('cell').length > 0);
    expect(feeds.getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Feed', 'Direction', 'Health', 'Last success']);
    expect(feedRows).toHaveLength(5);
    const agent = feedRows.find((row) => row.textContent?.includes('Agent status')) as HTMLElement;
    expect(within(agent).getByText('Degraded')).toBeTruthy();
    expect(within(agent).getByText('Inbound')).toBeTruthy();
    expect(agent.querySelector('[lang="en"]')?.textContent).toMatch(/Position updates delayed/);
    expect(within(feedRows.find((row) => row.textContent?.includes('Assignment channel')) as HTMLElement).getByText('Outbound')).toBeTruthy();
    expect(within(feedRows.find((row) => row.textContent?.includes('Weather')) as HTMLElement).getByText('Off')).toBeTruthy();
    expect(screen.getByRole('link', { name: /Data sources/ }).getAttribute('href')).toBe('/admin/data-sources');
  });

  it('shows the Engines card under the feeds with the four engines in fixture mode, and the engines tile OK', async () => {
    const { container } = await renderScreen();
    const engines = within(container.querySelector('[data-engines]') as HTMLElement);
    expect(engines.getByRole('heading', { name: 'Engines' })).toBeTruthy();
    expect(engines.getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Engine', 'Status', 'Model version', 'Calls', 'Answered from fixture', 'Last failure']);
    const rows = engines.getAllByRole('row').filter((row) => within(row).queryAllByRole('cell').length > 0);
    expect(rows.map((row) => within(row).getAllByRole('cell')[0]?.textContent)).toEqual(['Forecaster', 'Optimizer', 'Simulator', 'Assignment']);
    expect(engines.getAllByText('Fixture')).toHaveLength(4);
    expect(within(container.querySelector('[data-service="engines"]') as HTMLElement).getByText('OK')).toBeTruthy();
  });

  it('opens an engine\'s drawer from ?engine= and ignores a name that is not an engine', async () => {
    await renderScreen({ search: { engine: 'optimizer' } });
    expect(within(screen.getByRole('dialog')).getByText('Model version')).toBeTruthy();
    cleanup();
    await renderScreen({ search: { engine: 'nope' } });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('keeps the Engines card off the Job runs and Storage tabs', async () => {
    const { container } = await renderScreen({ search: { tab: 'jobs' } });
    expect(container.querySelector('[data-engines]')).toBeNull();
  });

  it('shows the Version card (channel, install mode, the update agent) with Open Updates, and the Diagnostics card with Preview', async () => {
    await renderScreen();
    expect(screen.getByRole('heading', { name: 'Version' })).toBeTruthy();
    expect(screen.getByText('Stable')).toBeTruthy();
    expect(screen.getByText('Private')).toBeTruthy();
    // the service card and the Version card both name it
    expect(screen.getAllByText('Update agent')).toHaveLength(2);
    expect(screen.getByRole('link', { name: /Open Updates/ }).getAttribute('href')).toBe('/admin/updates');
    expect(screen.getByRole('heading', { name: 'Diagnostics file' })).toBeTruthy();
    for (const line of ['Settings, health, job runs', 'Case and personal data removed', 'Nothing is sent automatically']) expect(screen.getByText(line)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Preview' })).toBeTruthy();
  });

  it('shows the Version card as the summary outside a private install: no update agent row', async () => {
    await renderScreen({ mode: 'dedicated' });
    expect(screen.getByText('Dedicated')).toBeTruthy();
    expect(screen.getAllByText('Update agent')).toHaveLength(1);
  });

  it('ignores a value that is not on its allow-list: the Overview shows', async () => {
    await renderScreen({ search: { tab: 'evil', status: 'gone', kind: 'x', diag: 'maybe', page: '-1' } });
    expect(screen.getAllByRole('tab')[0]?.getAttribute('aria-selected')).toBe('true');
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('System Health: the Job runs tab', () => {
  it('lists the eleven runs with the five columns of the mockup, times, durations, translated messages and the failed run in the danger tone', async () => {
    await renderScreen({ search: { tab: 'jobs' } });
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Job', 'Kind', 'Started', 'Duration', 'Status']);
    expect(bodyRows()).toHaveLength(11);
    const first = bodyRows()[0] as HTMLElement;
    expect(within(first).getByText('rollup-refresh')).toBeTruthy();
    expect(within(first).getByText('Rollup')).toBeTruthy();
    expect(within(first).getByText('18 s')).toBeTruthy();
    expect(within(first).getByText('Succeeded')).toBeTruthy();
    const forecast = bodyRows().find((row) => row.textContent?.includes('nightly-forecast')) as HTMLElement;
    expect(within(forecast).getByText('4:00')).toBeTruthy();
    const failed = bodyRows().at(-1) as HTMLElement;
    expect(within(failed).getByText('Failed')).toBeTruthy();
    expect(within(failed).getByText('The file header is missing required columns.')).toBeTruthy();
    expect(within(failed).getByText('0.9 s')).toBeTruthy();
    expect(within(bodyRows().find((row) => row.textContent?.includes('Validated with 3 errors')) as HTMLElement).getByText('Validated with 3 errors and 1 warning.')).toBeTruthy();
  });

  it('filters through the address: ?q=, ?status= and ?kind=, shown as chips, with "No matching jobs" and Clear all', async () => {
    await renderScreen({ search: { tab: 'jobs', status: 'succeeded', kind: 'rollup' } });
    expect(bodyRows()).toHaveLength(3);
    expect(screen.getByText('Status: Succeeded')).toBeTruthy();
    expect(screen.getByText('Kind: Rollup')).toBeTruthy();
    cleanup();
    await renderScreen({ search: { tab: 'jobs', q: 'zzz' } });
    expect(screen.getByText('No matching jobs')).toBeTruthy();
    expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('zzz');
  });
});

describe('System Health: the Storage and backups tab', () => {
  it('shows the storage as Illustrative: the progress, the four areas with their sizes, largest first', async () => {
    await renderScreen({ search: { tab: 'storage' } });
    expect(screen.getByRole('heading', { name: 'Storage' })).toBeTruthy();
    expect(screen.getAllByText('Illustrative').length).toBeGreaterThan(0);
    expect(screen.getByRole('progressbar').getAttribute('aria-valuetext')).toBe('\u20662.9 GB / 100 GB\u2069'); // isolated for Arabic
    const legend = screen.getAllByRole('listitem').filter((li) => /GB$/.test(li.textContent ?? ''));
    expect(legend.map((li) => li.textContent)).toEqual(['Other1.2 GB', 'Backups0.9 GB', 'Import files0.6 GB', 'Exports0.2 GB']);
  });

  it('shows the backups: overdue, the customer\'s own, who confirmed it and when, the source and the restore drill', async () => {
    await renderScreen({ search: { tab: 'storage' } });
    expect(screen.getByText('Overdue')).toBeTruthy();
    expect(screen.getByText('Your own backups. Confirm before updates.')).toBeTruthy();
    expect(screen.getByText('Nadia Al-Ghalani')).toBeTruthy();
    expect(screen.getByText('Customer reported')).toBeTruthy();
    expect(screen.getByText(/30 Aug 2026/)).toBeTruthy();
    expect(screen.getByText('30 Sept 2026')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Confirm backup' })).toBeTruthy();
  });

  it('says OpenDispatch runs the export in a shared install', async () => {
    await renderScreen({ mode: 'shared', search: { tab: 'storage' } });
    expect(screen.getByText('OpenDispatch runs a nightly export for you.')).toBeTruthy();
    expect(screen.queryByText('Your own backups. Confirm before updates.')).toBeNull();
  });

  it('confirms the backup from the card or the More menu through the action, and says so', async () => {
    mocked('confirmBackupDone').mockResolvedValue({ ok: true, data: { confirmedAt: '2026-09-20T10:00:00+03:00' } });
    await renderScreen({ search: { tab: 'storage' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm backup' }));
    await waitFor(() => expect(mocked('confirmBackupDone')).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('Backup confirmed')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Confirm backup' }));
    await waitFor(() => expect(mocked('confirmBackupDone')).toHaveBeenCalledTimes(2));
  });

  it('shows the data layer\'s refusal in the card', async () => {
    mocked('confirmBackupDone').mockResolvedValue({ ok: false, code: 'forbidden', message: 'planner may not edit admin.system_health in a private install.' });
    await renderScreen({ search: { tab: 'storage' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm backup' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Your role cannot do that.');
    expect(alert.querySelector('[lang="en"]')?.textContent).toContain('planner may not edit');
  });
});

describe('System Health: the diagnostics drawer and Refresh', () => {
  it('opens from the header and from Preview through ?diag=1 (a push)', async () => {
    await renderScreen();
    fireEvent.click(screen.getByRole('button', { name: 'Download diagnostics' }));
    expect(env.router.push).toHaveBeenCalledWith('/admin/system-health?diag=1');
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
    expect(env.router.push).toHaveBeenCalledTimes(2);
  });

  it('shows what the file holds before anything is created: the reassurance, the Demo tag and the four files with their previews', async () => {
    await renderScreen({ search: { diag: '1' } });
    const drawer = screen.getByRole('dialog', { name: 'Diagnostics file' });
    expect(within(drawer).getByText('What the file contains')).toBeTruthy();
    expect(within(drawer).getAllByText('Case and personal data removed').length).toBeGreaterThan(0);
    expect(within(drawer).getByText('Nothing is sent automatically')).toBeTruthy();
    expect(drawer.querySelector('[data-stub="demo"]')).not.toBeNull();
    for (const name of ['settings.json', 'health.json', 'jobs.json', 'README.txt']) expect(within(drawer).getByText(name)).toBeTruthy();
    for (const key of ['clock_start', 'planning_level', 'fallback_timeout_seconds', 'install_mode', 'time_zone']) expect(within(drawer).getByText(key)).toBeTruthy();
    expect(within(drawer).getByText('Asia/Riyadh')).toBeTruthy();
    expect(within(drawer).getByText('Status of 8 services and 5 feeds')).toBeTruthy();
    expect(within(drawer).getByText('The 11 latest job runs, without case data')).toBeTruthy();
  });

  it('creates the file through the action, saves it with the name the server gave, says so and closes', async () => {
    mocked('createDiagnostics').mockResolvedValue({ ok: true, data: { fileName: 'opendispatch-diagnostics-2026-09-20.zip', contentType: 'application/zip', contentBase64: Buffer.from('PK\u0003\u0004test').toString('base64'), sizeBytes: 8 } });
    await renderScreen({ search: { diag: '1' } });
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Create and download' }));
    await waitFor(() => expect(mocked('createDiagnostics')).toHaveBeenCalledTimes(1));
    expect(mocked('createDiagnostics')).toHaveBeenCalledWith();
    await waitFor(() => expect(clicked).toEqual([{ download: 'opendispatch-diagnostics-2026-09-20.zip', href: 'blob:opendispatch-test' }]));
    expect(await screen.findByText('Diagnostics file created')).toBeTruthy();
    expect(env.router.replace).toHaveBeenCalledWith('/admin/system-health', { scroll: false });
  });

  it('keeps the drawer open and saves nothing when the action fails', async () => {
    mocked('createDiagnostics').mockResolvedValue({ ok: false, code: 'unexpected', message: 'Something went wrong.', reference: 'ODP-0A1B2C3D' });
    await renderScreen({ search: { diag: '1' } });
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Create and download' }));
    const alert = await within(screen.getByRole('dialog')).findByRole('alert');
    expect(alert.textContent).toContain('ODP-0A1B2C3D');
    expect(clicked).toEqual([]);
  });

  it('refreshes from the More menu and says so', async () => {
    await renderScreen();
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Refresh' }));
    expect(env.router.refresh).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('Status refreshed')).toBeTruthy();
  });
});

describe('System Health: a role without edit access (view only)', () => {
  it('says View only and shows every writing control disabled with the reason; Refresh stays open', async () => {
    const { container } = await renderScreen({ access: 'view' });
    expect(root(container)?.getAttribute('data-access')).toBe('view');
    expect(screen.getByText('View only')).toBeTruthy();
    expect(isDisabled(screen.getByRole('button', { name: 'Download diagnostics' }))).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Download diagnostics' }));
    expect(env.router.push).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    expect(isDisabled(screen.getByRole('menuitem', { name: 'Confirm backup' }))).toBe(true);
    expect(isDisabled(screen.getByRole('menuitem', { name: 'Refresh' }))).toBe(false);
    expect(isDisabled(screen.getByRole('button', { name: 'Preview' }))).toBe(true);
  });

  it('does not open the drawer from ?diag=1, and disables Confirm backup on the storage tab', async () => {
    await renderScreen({ access: 'view', search: { diag: '1' } });
    expect(screen.queryByRole('dialog')).toBeNull();
    cleanup();
    await renderScreen({ access: 'view', search: { tab: 'storage' } });
    expect(isDisabled(screen.getByRole('button', { name: 'Confirm backup' }))).toBe(true);
  });
});

describe('System Health: the states', () => {
  it('empty: the module\'s own text and Refresh', async () => {
    const { container } = await renderScreen({ state: 'empty' });
    expect(root(container)?.getAttribute('data-state')).toBe('empty');
    expect(screen.getByText('No health data yet')).toBeTruthy();
    expect(screen.getByText('Checks appear after the first run.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(env.router.refresh).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('tab')).toBeNull();
  });

  it('loading: skeletons, announced once, the header kept', async () => {
    const { container } = await renderScreen({ state: 'loading' });
    expect(root(container)?.getAttribute('data-state')).toBe('loading');
    expect(screen.getAllByText('Loading')).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('System Health');
  });

  it('error: "The health checks could not load." as an alert with Try again', async () => {
    const { container } = await renderScreen({ state: 'error' });
    expect(root(container)?.getAttribute('data-state')).toBe('error');
    expect(screen.getByRole('alert').textContent).toContain('The health checks could not load.');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });
});

describe('System Health in Arabic', () => {
  // Job names, feed error texts, file names, settings keys and the server's English detail are data (translate="no" / lang="en").
  const untranslated = (container: HTMLElement) => {
    const clone = container.cloneNode(true) as HTMLElement;
    for (const node of clone.querySelectorAll('[translate="no"], [lang="en"]')) node.remove();
    const attributes = [...clone.querySelectorAll('[aria-label], [title], [placeholder]')].flatMap((el) => [el.getAttribute('aria-label') ?? '', el.getAttribute('title') ?? '', el.getAttribute('placeholder') ?? '']);
    return `${clone.textContent ?? ''} ${attributes.join(' ')}`.replace(/\b(OpenDispatch|GB)\b/g, ' ');
  };
  const leftovers = (container: HTMLElement) => untranslated(container).match(/[A-Za-z]{2,}/g)?.join(',') ?? '';

  it('draws every tab in Arabic with no English left over outside the data, in Western digits', async () => {
    for (const tab of ['overview', 'jobs', 'storage']) {
      const { container } = await renderScreen({ locale: 'ar', search: { tab } });
      expect(leftovers(container), tab).toBe('');
      expect(/[٠-٩]/.test(container.textContent ?? ''), tab).toBe(false);
      cleanup();
    }
    await renderScreen({ locale: 'ar' });
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('سلامة النظام');
    expect(screen.getAllByRole('tab')).toHaveLength(3);
  });

  it('draws the diagnostics drawer and the states in Arabic', async () => {
    await renderScreen({ locale: 'ar', search: { diag: '1' } });
    expect(leftovers(screen.getByRole('dialog'))).toBe('');
    cleanup();
    await renderScreen({ locale: 'ar', state: 'error' });
    expect(screen.getByText('تعذّر تحميل فحوصات السلامة.')).toBeTruthy();
    cleanup();
    await renderScreen({ locale: 'ar', mode: 'shared', search: { tab: 'storage' } });
    expect(leftovers(document.body)).toBe('');
  });
});
