// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment jsdom
import { DesignSystemProvider } from '@opendispatch/ui';
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hasLatinLetters, inLocale } from '@/components/opendispatch/test-utils';
import { getModule, type InstallMode, type Role } from '@/lib/access';
import { buildContext, fixtureTenantId } from '@/lib/data/go-test-reset';
import type { RequestContext } from '@/lib/data/guard';
import type { ScreenProps, SearchParams } from '@/screens/types';
import * as actions from './actions';
import { ApiWebhooksScreen } from './Screen';
import { fixtureUsers, resetGoTestState } from '@/lib/data/go-test-reset';

// The screen as the module route renders it: the async Server Component is called with the props ModuleRoute builds, and the element
// it returns is rendered in each language. The data layer is real (its seeds, a temp demo store); the router, the actions, next-intl's
// server translator, the clipboard and the download are stood in for. THE KEY: the create action's result carries a fake key
// (never a real one); the tests check where it shows and where it never does.
const env = vi.hoisted(() => ({ locale: 'en' as 'en' | 'ar', query: '', router: { push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }, navigate: vi.fn(), saved: vi.fn(), clipboard: vi.fn() }));

vi.mock('next-intl/server', async () => {
  const { createTranslator } = await import('next-intl');
  const { loadMessages } = await import('@/i18n/messages');
  return { getTranslations: async (namespace?: string) => createTranslator({ locale: env.locale, messages: loadMessages(env.locale, 'admin.api_webhooks'), ...(namespace === undefined ? {} : { namespace }) }) };
});
vi.mock('@/i18n/navigation', () => ({ usePathname: () => '/admin/api-webhooks', useRouter: () => env.router }));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams(env.query) }));
vi.mock('./actions', () => ({ createClient: vi.fn(), revokeClient: vi.fn(), rotateClient: vi.fn(), saveHook: vi.fn(), removeHook: vi.fn(), testHook: vi.fn(), retryDelivery: vi.fn(), saveLimits: vi.fn() }));
vi.mock('@/lib/export/download', async (original) => ({ ...(await original<typeof import('@/lib/export/download')>()), saveCsv: env.saved }));

const mocked = <K extends keyof typeof actions>(name: K) => actions[name] as unknown as ReturnType<typeof vi.fn>;
const FAKE_KEY = 'opendispatch_TEST-ONLY-NOT-A-REAL-KEY_0123456789abcdef';

beforeEach(async () => {
  await resetGoTestState();
  Object.defineProperty(navigator, 'clipboard', { value: { writeText: env.clipboard.mockResolvedValue(undefined) }, configurable: true });
});
afterEach(() => {
  cleanup();
  for (const mock of [env.router.replace, env.router.push, env.router.refresh, env.navigate, env.saved, env.clipboard]) mock.mockReset();
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
  const element = await ApiWebhooksScreen({ def: getModule('admin.api_webhooks'), ctx: ctxOf('administrator', mode), access: { access, reduced: false }, locale, homeHref: '/', state, searchParams: search });
  return inLocale(locale, <DesignSystemProvider navigate={env.navigate}>{element}</DesignSystemProvider>, { module: 'admin.api_webhooks' });
}

const root = (container: HTMLElement) => container.querySelector<HTMLElement>('[data-module]');
const bodyRows = () => screen.getAllByRole('row').filter((row) => within(row).queryAllByRole('cell').length > 0);
const isDisabled = (element: HTMLElement) => element.getAttribute('aria-disabled') === 'true' || element.hasAttribute('disabled');
const dialog = () => screen.getByRole('dialog');
const rowOf = (text: string) => bodyRows().find((row) => row.textContent?.includes(text)) as HTMLElement;

describe('API and Webhooks: the API clients tab, Administrator (edit)', () => {
  it('carries the four hooks the e2e specs read, the module title and the data source', async () => {
    const { container } = await renderScreen();
    const page = root(container);
    expect([page?.getAttribute('data-module'), page?.getAttribute('data-state'), page?.getAttribute('data-access'), page?.getAttribute('data-reduced')]).toEqual(['admin.api_webhooks', 'filled', 'edit', 'false']);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('API and Webhooks');
    expect(container.querySelector('[data-badge="SYNTHETIC"]')).not.toBeNull();
    expect(screen.queryByText('View only')).toBeNull();
  });

  it('has two header actions (Create client and More with Add webhook and Export delivery log), four tabs and three figures', async () => {
    await renderScreen();
    expect(screen.getByRole('button', { name: 'Create client' }).hasAttribute('aria-disabled')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual(['Add webhook', 'Export delivery log']);
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['API clients', 'Webhooks', 'Delivery log', 'Rate limits']);
    const figure = (label: string) => {
      let node: HTMLElement | null = screen.getAllByText(label)[0] as HTMLElement;
      while (node !== null && !/\d$/.test(node.textContent ?? '')) node = node.parentElement;
      return node?.textContent;
    };
    expect([figure('Active clients'), figure('Failed deliveries')]).toEqual(['Active clients2', 'Failed deliveries1']);
    const figures = screen.getAllByText('Webhooks').map((label) => {
      let node: HTMLElement | null = label;
      while (node !== null && !/\d$/.test(node.textContent ?? '')) node = node.parentElement;
      return node?.textContent;
    });
    expect(figures).toContain('Webhooks1');
  });

  it('lists the clients with the six columns of the mockup: scopes as tags, only the last four characters of the key, last use, status, Revoke', async () => {
    await renderScreen();
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Client', 'Scopes', 'Key', 'Last used', 'Status', 'Actions']);
    expect(bodyRows()).toHaveLength(3);
    const reporting = rowOf('Reporting export');
    expect(within(reporting).getByText('read')).toBeTruthy();
    expect(within(reporting).getByText('····x7q2')).toBeTruthy();
    expect(within(reporting).getByText('Active')).toBeTruthy();
    expect(within(reporting).getByText(/Created 20 Aug 2026/)).toBeTruthy();
    expect(within(reporting).getByText('12 Sept 2026')).toBeTruthy();
    expect(within(reporting).getByRole('button', { name: 'Revoke key' })).toBeTruthy();
    const old = rowOf('Old export client');
    expect(within(old).getByText('Revoked')).toBeTruthy();
    expect(within(old).queryByRole('button', { name: 'Revoke key' })).toBeNull();
    expect(within(old).queryByRole('button', { name: 'Rotate key' })).toBeNull();
    expect(within(old).getByText('read')).toBeTruthy();
    expect(within(old).getByText('write')).toBeTruthy();
    expect(old.querySelectorAll('[translate="no"]').length).toBeGreaterThanOrEqual(3);
  });

  it('does not open a drawer for a client row (the mockup has none)', async () => {
    await renderScreen();
    fireEvent.click(bodyRows()[0] as HTMLElement);
    expect(env.navigate).not.toHaveBeenCalled();
  });

  it('opens the create drawer on ?client=new: a name, the three scopes with their descriptions, and the reason Create is unavailable', async () => {
    await renderScreen({ search: { client: 'new' } });
    const drawer = dialog();
    expect(within(drawer).getByLabelText(/Name/)).toBeTruthy();
    for (const scope of ['read', 'write', 'feeds']) expect(within(drawer).getByRole('checkbox', { name: new RegExp(scope) })).toBeTruthy();
    expect(within(drawer).getByText('Read plans, rosters and reports')).toBeTruthy();
    expect(within(drawer).getByText('Enter a name')).toBeTruthy();
    expect(within(drawer).getByRole('button', { name: 'Create' }).getAttribute('aria-disabled')).toBe('true');
  });

  it('ignores a value that is not on its allow-list: the API clients tab shows, no drawer opens', async () => {
    await renderScreen({ search: { tab: 'evil', client: 'x', hook: '../x', status: 'gone', page: '-2' } });
    expect(screen.getAllByRole('tab')[0]?.getAttribute('aria-selected')).toBe('true');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(bodyRows()).toHaveLength(3);
  });
});

describe('API and Webhooks: the create client flow and the key dialog', () => {
  async function fillAndCreate() {
    mocked('createClient').mockResolvedValue({ ok: true, data: { id: 'c1', name: 'Planning tool', secret: FAKE_KEY } });
    await renderScreen({ search: { client: 'new' } });
    fireEvent.change(within(dialog()).getByLabelText(/Name/), { target: { value: ' Planning tool ' } });
    expect(within(dialog()).getByText('Choose at least one scope')).toBeTruthy();
    fireEvent.click(within(dialog()).getByRole('checkbox', { name: /read/ }));
    fireEvent.click(within(dialog()).getByRole('checkbox', { name: /feeds/ }));
    expect(within(dialog()).getByRole('button', { name: 'Create' }).hasAttribute('aria-disabled')).toBe(false);
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(mocked('createClient')).toHaveBeenCalledTimes(1));
  }

  it('sends only what the person typed: the trimmed name and the scopes', async () => {
    await fillAndCreate();
    expect(mocked('createClient')).toHaveBeenCalledWith({ name: 'Planning tool', scopes: ['read', 'feeds'] });
  });

  it('shows the key once, in a read-only box, with the warning, and closes the drawer through the address, never putting the key there', async () => {
    await fillAndCreate();
    const key = await screen.findByDisplayValue(FAKE_KEY);
    expect((key as HTMLInputElement).readOnly).toBe(true);
    expect(key.getAttribute('dir')).toBe('ltr');
    expect(screen.getByRole('dialog', { name: 'Copy the key now' })).toBeTruthy();
    expect(screen.getByText('It is shown once. OpenDispatch keeps only the last 4 characters.')).toBeTruthy();
    expect(env.router.replace).toHaveBeenCalledWith('/admin/api-webhooks', { scroll: false });
    // the key is in no address, no toast and no other text of the page
    for (const call of [...env.router.replace.mock.calls, ...env.router.push.mock.calls, ...env.navigate.mock.calls]) expect(JSON.stringify(call)).not.toContain(FAKE_KEY);
    expect(document.body.textContent).not.toContain(FAKE_KEY);
    expect(document.querySelector('[role="status"], [role="alert"]')?.textContent ?? '').not.toContain(FAKE_KEY);
  });

  it('cannot be closed until the person says they copied the key: Done is disabled with the reason, Escape and the X only remind', async () => {
    await fillAndCreate();
    const modal = await screen.findByRole('dialog', { name: 'Copy the key now' });
    const done = within(modal).getByRole('button', { name: 'Done' });
    expect(done.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(done);
    expect(screen.queryByRole('dialog', { name: 'Copy the key now' })).not.toBeNull();
    fireEvent.keyDown(modal, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Copy the key now' })).not.toBeNull();
    expect(within(screen.getByRole('dialog', { name: 'Copy the key now' })).getAllByText('Copy the key first').length).toBeGreaterThan(0);
  });

  it('copies the key to the clipboard, and after the acknowledgement Done closes the dialog and forgets the key', async () => {
    await fillAndCreate();
    const modal = await screen.findByRole('dialog', { name: 'Copy the key now' });
    fireEvent.click(within(modal).getByRole('button', { name: 'Copy' }));
    await waitFor(() => expect(env.clipboard).toHaveBeenCalledWith(FAKE_KEY));
    fireEvent.click(within(modal).getByRole('checkbox', { name: 'I have copied the key' }));
    const done = within(modal).getByRole('button', { name: 'Done' });
    expect(done.hasAttribute('aria-disabled')).toBe(false);
    fireEvent.click(done);
    expect(screen.queryByRole('dialog', { name: 'Copy the key now' })).toBeNull();
    expect(document.body.textContent).not.toContain(FAKE_KEY);
    expect(screen.queryByDisplayValue(FAKE_KEY)).toBeNull();
  });

  it('shows the data layer\'s refusal in the drawer and no key dialog', async () => {
    mocked('createClient').mockResolvedValue({ ok: false, code: 'invalid', message: 'API client: name must be at most 120 characters.' });
    await renderScreen({ search: { client: 'new' } });
    fireEvent.change(within(dialog()).getByLabelText(/Name/), { target: { value: 'x' } });
    fireEvent.click(within(dialog()).getByRole('checkbox', { name: /read/ }));
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Create' }));
    const alert = await within(dialog()).findByRole('alert');
    expect(alert.querySelector('[lang="en"]')?.textContent).toBe('API client: name must be at most 120 characters.');
    expect(screen.queryByRole('dialog', { name: 'Copy the key now' })).toBeNull();
  });
});

describe('API and Webhooks: revoking a client', () => {
  it('asks first, names the client, and revokes only after Revoke is pressed', async () => {
    mocked('revokeClient').mockResolvedValue({ ok: true, data: { id: 'c1', name: 'Reporting export (read only)' } });
    await renderScreen();
    fireEvent.click(within(rowOf('Reporting export')).getByRole('button', { name: 'Revoke key' }));
    expect(mocked('revokeClient')).not.toHaveBeenCalled();
    const confirm = screen.getByRole('dialog', { name: 'Revoke this key?' });
    expect(within(confirm).getByText(/stop working at once/)).toBeTruthy();
    expect(within(confirm).getByText('Reporting export (read only)')).toBeTruthy();
    fireEvent.click(within(confirm).getByRole('button', { name: 'Revoke' }));
    await waitFor(() => expect(mocked('revokeClient')).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('Key revoked')).toBeTruthy();
  });
});

describe('API and Webhooks: rotating a key', () => {
  it('rotates at once and shows the new key in the dialog that must be acknowledged', async () => {
    mocked('rotateClient').mockResolvedValue({ ok: true, data: { id: 'c1', name: 'Reporting export (read only)', secret: FAKE_KEY } });
    await renderScreen();
    fireEvent.click(within(rowOf('Reporting export')).getByRole('button', { name: 'Rotate key' }));
    await waitFor(() => expect(mocked('rotateClient')).toHaveBeenCalledTimes(1));
    const keyDialog = await screen.findByRole('dialog', { name: 'New key: copy it now' });
    expect((within(keyDialog).getByDisplayValue(FAKE_KEY) as HTMLInputElement).readOnly).toBe(true);
    expect(within(keyDialog).getByText('Reporting export (read only)')).toBeTruthy();
    expect(isDisabled(within(keyDialog).getByRole('button', { name: 'Done' }))).toBe(true);
    fireEvent.click(within(keyDialog).getByRole('checkbox', { name: 'I have copied the key' }));
    fireEvent.click(within(keyDialog).getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'New key: copy it now' })).toBeNull());
    expect(screen.queryByDisplayValue(FAKE_KEY)).toBeNull();
  });
});

describe('API and Webhooks: the Webhooks tab', () => {
  it('lists the webhook with its address, events, last delivery and status, and a Send test button; Add webhook and the Demo tag are in the card header', async () => {
    await renderScreen({ search: { tab: 'hooks' } });
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Webhook', 'Events', 'Last delivery', 'Status', 'Actions']);
    const row = bodyRows()[0] as HTMLElement;
    expect(within(row).getByText('Roster approved to the planning tool')).toBeTruthy();
    expect(within(row).getByText('https://hooks.example.com/opendispatch/roster')).toBeTruthy();
    expect(within(row).getByText('roster.approved')).toBeTruthy();
    expect(within(row).getByText('Delivered')).toBeTruthy();
    expect(within(row).getByText('On')).toBeTruthy();
    expect(within(row).getByRole('button', { name: 'Send test' })).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Add webhook' }).length).toBeGreaterThan(0);
    expect(document.querySelector('[data-stub="demo"]')).not.toBeNull();
  });

  it('opens a webhook through ?hook= when its row is pressed, but not when Send test is', async () => {
    await renderScreen({ search: { tab: 'hooks' } });
    fireEvent.click(within(bodyRows()[0] as HTMLElement).getByRole('button', { name: 'Send test' }));
    expect(env.navigate).not.toHaveBeenCalled();
    fireEvent.click(bodyRows()[0] as HTMLElement);
    expect(env.navigate.mock.calls[0]?.[0]).toMatch(/^\/admin\/api-webhooks\?tab=hooks&hook=[0-9a-f-]{36}$/);
  });

  it('says "(stub: nothing was sent)" in the toast for a test delivery, and warns when it failed', async () => {
    mocked('testHook').mockResolvedValueOnce({ ok: true, data: { name: 'Roster approved to the planning tool', delivered: true, httpStatus: 200 } }).mockResolvedValueOnce({ ok: true, data: { name: 'x', delivered: false, httpStatus: 500 } });
    await renderScreen({ search: { tab: 'hooks' } });
    fireEvent.click(within(bodyRows()[0] as HTMLElement).getByRole('button', { name: 'Send test' }));
    expect(await screen.findByText('Test delivered')).toBeTruthy();
    expect(screen.getByText(/HTTP 200 · \(stub: nothing was sent\)/)).toBeTruthy();
    fireEvent.click(within(bodyRows()[0] as HTMLElement).getByRole('button', { name: 'Send test' }));
    expect(await screen.findByText('Test delivery failed')).toBeTruthy();
    expect(screen.getAllByText(/HTTP 500 · \(stub: nothing was sent\)/).length).toBeGreaterThan(0);
  });

  it('shows the webhook drawer for ?hook=<id> with its settings, and the add drawer for ?hook=new with what is missing', async () => {
    await renderScreen({ search: { tab: 'hooks' } });
    fireEvent.click(bodyRows()[0] as HTMLElement);
    const id = new URL(env.navigate.mock.calls[0]?.[0] as string, 'http://x').searchParams.get('hook') as string;
    cleanup();
    await renderScreen({ search: { tab: 'hooks', hook: id } });
    const drawer = screen.getByRole('dialog', { name: 'Edit webhook' });
    expect((within(drawer).getByLabelText(/Name/) as HTMLInputElement).value).toBe('Roster approved to the planning tool');
    expect((within(drawer).getByLabelText(/Address/) as HTMLInputElement).value).toBe('https://hooks.example.com/opendispatch/roster');
    expect(within(drawer).getAllByRole('checkbox').filter((box) => (box as HTMLInputElement).checked)).toHaveLength(1);
    expect(within(drawer).getAllByRole('checkbox')).toHaveLength(7);
    expect(within(drawer).getByRole('switch', { name: 'Webhook on' }).getAttribute('aria-checked')).toBe('true');
    expect(within(drawer).getByRole('button', { name: 'Delete' })).toBeTruthy();
    cleanup();
    await renderScreen({ search: { tab: 'hooks', hook: 'new' } });
    const fresh = screen.getByRole('dialog', { name: 'Add webhook' });
    expect(within(fresh).getByText('Enter a name')).toBeTruthy();
    expect(within(fresh).queryByRole('button', { name: 'Delete' })).toBeNull();
    expect(within(fresh).getByText('Must start with https://')).toBeTruthy();
    expect(within(fresh).getByRole('button', { name: 'Save' }).getAttribute('aria-disabled')).toBe('true');
  });

  it('asks for a name, then a https address, then an event, before Save is available, and sends the trimmed fields', async () => {
    mocked('saveHook').mockResolvedValue({ ok: true, data: { id: 'h2', name: 'Rules' } });
    await renderScreen({ search: { tab: 'hooks', hook: 'new' } });
    const save = () => within(dialog()).getByRole('button', { name: 'Save' });
    fireEvent.change(within(dialog()).getByLabelText(/Name/), { target: { value: ' Rules ' } });
    expect(within(dialog()).getByText('Enter a valid https address')).toBeTruthy();
    fireEvent.change(within(dialog()).getByLabelText(/Address/), { target: { value: 'http://hooks.example.com/x' } });
    expect(within(dialog()).getByText('Enter a valid https address')).toBeTruthy();
    fireEvent.change(within(dialog()).getByLabelText(/Address/), { target: { value: ' https://hooks.example.com/rules ' } });
    expect(within(dialog()).getByText('Choose at least one event')).toBeTruthy();
    expect(save().getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(within(dialog()).getByRole('checkbox', { name: 'rule.approved' }));
    expect(save().hasAttribute('aria-disabled')).toBe(false);
    fireEvent.click(save());
    await waitFor(() => expect(mocked('saveHook')).toHaveBeenCalledWith({ name: 'Rules', target_url: 'https://hooks.example.com/rules', event_types: ['rule.approved'], is_enabled: true }));
    expect(await screen.findByText('Webhook added')).toBeTruthy();
    expect(env.router.replace).toHaveBeenCalledWith('/admin/api-webhooks?tab=hooks', { scroll: false });
  });

  it('accepts plain http for localhost, and deletes a webhook only after a confirmation', async () => {
    mocked('removeHook').mockResolvedValue({ ok: true, data: { removed: true } });
    await renderScreen({ search: { tab: 'hooks' } });
    fireEvent.click(bodyRows()[0] as HTMLElement);
    const id = new URL(env.navigate.mock.calls[0]?.[0] as string, 'http://x').searchParams.get('hook') as string;
    cleanup();
    await renderScreen({ search: { tab: 'hooks', hook: id } });
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Delete' }));
    expect(mocked('removeHook')).not.toHaveBeenCalled();
    const confirm = screen.getByRole('dialog', { name: 'Delete this webhook?' });
    fireEvent.click(within(confirm).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(mocked('removeHook')).toHaveBeenCalledWith({ hookId: id }));
    expect(await screen.findByText('Webhook deleted')).toBeTruthy();
  });

  it('shows an inline notice and no drawer for a webhook that does not exist', async () => {
    await renderScreen({ search: { tab: 'hooks', hook: '00000000-0000-4000-8000-00000000dead' } });
    expect(screen.getByRole('alert').textContent).toContain('That webhook could not be found.');
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('API and Webhooks: the Delivery log tab', () => {
  it('lists the three deliveries with the six columns, the failed one in the danger tone with its HTTP status and a Retry button', async () => {
    const { container } = await renderScreen({ search: { tab: 'log' } });
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Time', 'Webhook', 'Event', 'Status', 'Attempts', 'Actions']);
    expect(bodyRows()).toHaveLength(3);
    const failed = rowOf('Failed');
    expect(within(failed).getByText('HTTP 503')).toBeTruthy();
    expect(within(failed).getByText('3')).toBeTruthy();
    expect(within(failed).getByRole('button', { name: 'Retry' })).toBeTruthy();
    expect(container.querySelectorAll('button[aria-label], button').length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: 'Retry' })).toHaveLength(1);
  });

  it('filters by ?status= and ?q= (validated on the server) and shows the filter as a chip', async () => {
    await renderScreen({ search: { tab: 'log', status: 'succeeded' } });
    expect(bodyRows()).toHaveLength(2);
    expect(screen.getByText('Status: Delivered')).toBeTruthy();
    cleanup();
    await renderScreen({ search: { tab: 'log', q: 'zzz' } });
    expect(screen.getByText('No matching deliveries')).toBeTruthy();
  });

  it('retries a failed delivery, and says "(stub: nothing was sent)"', async () => {
    mocked('retryDelivery').mockResolvedValue({ ok: true, data: { delivered: true, httpStatus: 200, attempts: 4 } });
    await renderScreen({ search: { tab: 'log' } });
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(mocked('retryDelivery')).toHaveBeenCalledTimes(1));
    expect(mocked('retryDelivery').mock.calls[0]?.[0]).toEqual({ deliveryId: expect.stringMatching(/^[0-9a-f-]{36}$/) });
    expect(await screen.findByText('Delivery retried')).toBeTruthy();
    expect(screen.getByText(/HTTP 200 · \(stub: nothing was sent\)/)).toBeTruthy();
  });

  it('exports the whole delivery log from the More menu, in the reader\'s language, and says so', async () => {
    await renderScreen({ search: { tab: 'log', status: 'failed' } });
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Export delivery log' }));
    const [filename, table] = env.saved.mock.calls[0] as [string, { header: string[]; rows: string[][] }];
    expect(filename).toBe('webhook-deliveries.csv');
    expect(table.header).toEqual(['Time', 'Webhook', 'Event', 'Status', 'HTTP', 'Attempts']);
    expect(table.rows).toHaveLength(3);
    expect(table.rows.map((row) => row[3])).toEqual(['Delivered', 'Delivered', 'Failed']);
    expect(await screen.findByText('Delivery log exported')).toBeTruthy();
  });
});

describe('API and Webhooks: the Rate limits tab (stored, not enforced)', () => {
  it('shows the three scopes with their figures, labelled Illustrative and Not applied, beside the retry policy', async () => {
    await renderScreen({ search: { tab: 'limits' } });
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Scope', 'Requests per minute', 'Burst', 'Clients']);
    expect((screen.getByLabelText('read') as HTMLInputElement).value).toBe('120');
    expect((screen.getByLabelText('write') as HTMLInputElement).value).toBe('30');
    expect((screen.getByLabelText('feeds') as HTMLInputElement).value).toBe('600');
    expect(screen.getAllByText('Illustrative').length).toBe(2);
    expect(document.querySelectorAll('[data-stub="notApplied"]').length).toBe(2);
    expect(screen.getByText('Delivery retries')).toBeTruthy();
    expect(screen.getByText('1, 5, 15')).toBeTruthy();
    const save = screen.getByRole('button', { name: 'Save' });
    expect(save.getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByText('No changes to save')).toBeTruthy();
  });

  it('saves the changed figures, keeps the burst as it is, and says so', async () => {
    mocked('saveLimits').mockResolvedValue({ ok: true, data: { limits: [] } });
    await renderScreen({ search: { tab: 'limits' } });
    fireEvent.change(screen.getByLabelText('read'), { target: { value: '200' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(mocked('saveLimits')).toHaveBeenCalledWith({ limits: [{ scope: 'read', requests_per_minute: 200, burst: 20 }, { scope: 'write', requests_per_minute: 30, burst: 5 }, { scope: 'feeds', requests_per_minute: 600, burst: 100 }] }));
    expect(await screen.findByText('Rate limits saved')).toBeTruthy();
  });

  it('refuses a figure that is not a whole number from 1 to 100,000 before asking the server', async () => {
    await renderScreen({ search: { tab: 'limits' } });
    for (const bad of ['0', '', '1.5', '100001', '-3']) {
      fireEvent.change(screen.getByLabelText('read'), { target: { value: bad } });
      expect(screen.getByRole('button', { name: 'Save' }).getAttribute('aria-disabled'), bad).toBe('true');
    }
    expect(screen.getByText('Enter whole numbers from 1 to 100,000')).toBeTruthy();
    expect(mocked('saveLimits')).not.toHaveBeenCalled();
  });
});

describe('API and Webhooks: a role without edit access (view only)', () => {
  it('says View only and shows every writing control disabled with the reason', async () => {
    const { container } = await renderScreen({ access: 'view' });
    expect(root(container)?.getAttribute('data-access')).toBe('view');
    expect(screen.getByText('View only')).toBeTruthy();
    expect(isDisabled(screen.getByRole('button', { name: 'Create client' }))).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Create client' }));
    expect(env.router.push).not.toHaveBeenCalled();
    expect(isDisabled(within(rowOf('Reporting export')).getByRole('button', { name: 'Revoke key' }))).toBe(true);
    expect(isDisabled(within(rowOf('Reporting export')).getByRole('button', { name: 'Rotate key' }))).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    expect(isDisabled(screen.getByRole('menuitem', { name: 'Add webhook' }))).toBe(true);
    expect(isDisabled(screen.getByRole('menuitem', { name: 'Export delivery log' }))).toBe(false);
  });

  it('does not open the create drawer from ?client=new, keeps the webhook drawer readable with everything disabled, and disables Send test, Retry and the limits', async () => {
    await renderScreen({ access: 'view', search: { client: 'new' } });
    expect(screen.queryByRole('dialog')).toBeNull();
    cleanup();
    await renderScreen({ access: 'view', search: { tab: 'log' } });
    expect(isDisabled(screen.getByRole('button', { name: 'Retry' }))).toBe(true);
    cleanup();
    await renderScreen({ access: 'view', search: { tab: 'limits' } });
    expect((screen.getByLabelText('read') as HTMLInputElement).disabled).toBe(true);
    expect(isDisabled(screen.getByRole('button', { name: 'Save' }))).toBe(true);
    cleanup();
    await renderScreen({ access: 'view', search: { tab: 'hooks', hook: 'new' } });
    const drawer = dialog();
    expect((within(drawer).getByLabelText(/Name/) as HTMLInputElement).disabled).toBe(true);
    expect(isDisabled(within(drawer).getByRole('button', { name: 'Save' }))).toBe(true);
    cleanup();
    await renderScreen({ access: 'view', search: { tab: 'hooks' } });
    expect(isDisabled(within(bodyRows()[0] as HTMLElement).getByRole('button', { name: 'Send test' }))).toBe(true);
  });
});

describe('API and Webhooks: the states', () => {
  it('empty: the module\'s own text and Create client', async () => {
    const { container } = await renderScreen({ state: 'empty' });
    expect(root(container)?.getAttribute('data-state')).toBe('empty');
    expect(screen.getByText('No API clients yet')).toBeTruthy();
    expect(screen.getByText('Create a client to connect a system.')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Create client' }).length).toBeGreaterThan(0);
    expect(screen.queryByRole('tab')).toBeNull();
  });

  it('empty for a view-only role: the action is disabled with its reason next to it', async () => {
    await renderScreen({ state: 'empty', access: 'view' });
    expect(screen.getAllByRole('button', { name: 'Create client' }).every(isDisabled)).toBe(true);
    expect(screen.getAllByText('View only for this role').length).toBeGreaterThan(0);
  });

  it('loading: skeletons, announced once, the header kept', async () => {
    const { container } = await renderScreen({ state: 'loading' });
    expect(root(container)?.getAttribute('data-state')).toBe('loading');
    expect(screen.getAllByText('Loading')).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('API and Webhooks');
  });

  it('error: "The clients could not load." as an alert with Try again', async () => {
    const { container } = await renderScreen({ state: 'error' });
    expect(root(container)?.getAttribute('data-state')).toBe('error');
    expect(screen.getByRole('alert').textContent).toContain('The clients could not load.');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });
});

describe('API and Webhooks in Arabic', () => {
  // Client and webhook names, scopes, event codes, addresses and the server's English detail are data (translate="no" / lang="en").
  const untranslated = (container: HTMLElement) => {
    const clone = container.cloneNode(true) as HTMLElement;
    for (const node of clone.querySelectorAll('[translate="no"], [lang="en"]')) node.remove();
    const attributes = [...clone.querySelectorAll('[aria-label], [title], [placeholder]')].flatMap((el) => [el.getAttribute('aria-label') ?? '', el.getAttribute('title') ?? '', el.getAttribute('placeholder') ?? '']);
    return `${clone.textContent ?? ''} ${attributes.join(' ')}`.replace(/\b(OpenDispatch|HTTP|API|https)\b/g, ' ');
  };

  it('draws every tab in Arabic with no English left over outside the data', async () => {
    for (const tab of ['clients', 'hooks', 'log', 'limits']) {
      const { container } = await renderScreen({ locale: 'ar', search: { tab } });
      expect(hasLatinLetters(untranslated(container), []), tab).toBe(false);
      cleanup();
    }
    await renderScreen({ locale: 'ar' });
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('واجهة البرمجة وخطّافات الويب');
    expect(screen.getAllByRole('tab')).toHaveLength(4);
    expect(/[٠-٩]/.test(document.body.textContent ?? '')).toBe(false);
  });

  it('draws the create drawer, the key dialog, the webhook drawer and the revoke confirmation in Arabic with no English left over', async () => {
    mocked('createClient').mockResolvedValue({ ok: true, data: { id: 'c1', name: 'Planning tool', secret: FAKE_KEY } });
    await renderScreen({ locale: 'ar', search: { client: 'new' } });
    expect(untranslated(dialog()).match(/[A-Za-z]{2,}/g)?.join(',') ?? '', 'create').toBe('');
    fireEvent.change(within(dialog()).getByLabelText(/الاسم/), { target: { value: 'x' } });
    fireEvent.click(within(dialog()).getAllByRole('checkbox')[0] as HTMLElement);
    await act(async () => {
      fireEvent.click(within(dialog()).getByRole('button', { name: 'إنشاء' }));
    });
    const modal = await screen.findByRole('dialog', { name: /انسخ المفتاح/ });
    expect(untranslated(modal).match(/[A-Za-z]{2,}/g)?.join(',') ?? '', 'key').toBe('');
    cleanup();
    await renderScreen({ locale: 'ar', search: { tab: 'hooks', hook: 'new' } });
    expect(untranslated(dialog()).match(/[A-Za-z]{2,}/g)?.join(',') ?? '', 'hook').toBe('');
    cleanup();
    await renderScreen({ locale: 'ar' });
    fireEvent.click(within(rowOf('Reporting export')).getByRole('button', { name: 'إلغاء المفتاح' }));
    expect(untranslated(dialog()).match(/[A-Za-z]{2,}/g)?.join(',') ?? '', 'revoke').toBe('');
    cleanup();
    mocked('rotateClient').mockResolvedValue({ ok: true, data: { id: 'c1', name: 'Reporting export', secret: FAKE_KEY } });
    await renderScreen({ locale: 'ar' });
    fireEvent.click(within(rowOf('Reporting export')).getByRole('button', { name: 'تدوير المفتاح' }));
    const rotated = await screen.findByRole('dialog', { name: /مفتاح جديد/ });
    expect(untranslated(rotated).match(/[A-Za-z]{2,}/g)?.join(',') ?? '', 'rotate').toBe('');
  });

  it('draws the states in Arabic, and the stub note in the toast', async () => {
    await renderScreen({ locale: 'ar', state: 'error' });
    expect(screen.getByText('تعذّر تحميل العملاء.')).toBeTruthy();
    cleanup();
    mocked('testHook').mockResolvedValue({ ok: true, data: { name: 'x', delivered: true, httpStatus: 200 } });
    await renderScreen({ locale: 'ar', search: { tab: 'hooks' } });
    fireEvent.click(within(bodyRows()[0] as HTMLElement).getAllByRole('button')[0] as HTMLElement);
    expect(await screen.findByText(/\(محاكاة: لم يُرسل شيء\)/)).toBeTruthy();
  });
});
