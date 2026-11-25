// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment jsdom
import { DesignSystemProvider } from '@opendispatch/ui';
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hasLatinLetters, inLocale } from '@/components/opendispatch/test-utils';
import { getModule, type InstallMode, type Role } from '@/lib/access';
import { buildContext, fixtureTenantId } from '@/lib/data/go-test-reset';
import type { RequestContext } from '@/lib/data/guard';
import { createIdentityProvider } from '@/lib/data/identity';
import type { ScreenProps, SearchParams } from '@/screens/types';
import { SignInIdentityScreen } from './Screen';
import { fixtureUsers, resetGoTestState } from '@/lib/data/go-test-reset';

// Live: skips, never fakes, if OPENDISPATCH_API_URL unset.
// loadIdentityView reads Zones/Cities.
// States are pure: see Screen.test.tsx.
const hasApi = process.env['OPENDISPATCH_API_URL'] !== undefined && process.env['OPENDISPATCH_API_URL'] !== '';
if (!hasApi) console.log('OPENDISPATCH_API_URL is not set: Screen.live.test.tsx is skipped, not faked.');

// The screen as the module route renders it: the async Server Component is called with the props ModuleRoute builds, and the
// element it returns is rendered in each language. The data layer is real (fixtures, a temp demo store); the router, the actions,
// next-intl's server translator and the download are stood in for.
const env = vi.hoisted(() => ({ locale: 'en' as 'en' | 'ar', query: '', router: { push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }, navigate: vi.fn(), download: vi.fn() }));

vi.mock('next-intl/server', async () => {
  const { createTranslator } = await import('next-intl');
  const { loadMessages } = await import('@/i18n/messages');
  return { getTranslations: async (namespace?: string) => createTranslator({ locale: env.locale, messages: loadMessages(env.locale, 'admin.sign_in_identity'), ...(namespace === undefined ? {} : { namespace }) }) };
});
vi.mock('@/i18n/navigation', () => ({ usePathname: () => '/admin/sign-in-identity', useRouter: () => env.router }));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams(env.query) }));
vi.mock('./actions', () => ({
  saveProvider: vi.fn(),
  saveAndTestProvider: vi.fn(),
  testProvider: vi.fn(),
  setProviderEnabled: vi.fn(),
  removeProvider: vi.fn(),
  saveRule: vi.fn(),
  setRuleEnabled: vi.fn(),
  removeRule: vi.fn(),
  previewRules: vi.fn(),
  saveSignInPolicy: vi.fn(),
  setEmergencySignIn: vi.fn(),
  requestChange: vi.fn(),
}));
vi.mock('@/lib/export/download', async (original) => ({ ...(await original<typeof import('@/lib/export/download')>()), downloadText: env.download }));

beforeEach(async () => {
  await resetGoTestState();
});
afterEach(() => {
  cleanup();
  for (const mock of [env.router.replace, env.router.push, env.router.refresh, env.navigate, env.download]) mock.mockReset();
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
  const element = await SignInIdentityScreen({ def: getModule('admin.sign_in_identity'), ctx: ctxOf('administrator', mode), access: { access, reduced: false }, locale, homeHref: '/admin/sign-in-identity', state, searchParams: search });
  return inLocale(locale, <DesignSystemProvider navigate={env.navigate}>{element}</DesignSystemProvider>, { module: 'admin.sign_in_identity' });
}

/** A provider of the Okta preset in the store, for the drawer and the wizard. */
async function addOkta(mode: InstallMode = 'private', enabled = true) {
  return await createIdentityProvider(ctxOf('administrator', mode), { preset_id: 'okta', display_name: 'Customer Okta', is_enabled: enabled, email_domains: ['acme.example'], config: { okta_domain: 'example.okta.com', client_id: 'opendispatch-test' }, client_secret: 'example-not-a-secret-value' });
}

const root = (container: HTMLElement) => container.querySelector<HTMLElement>('[data-module]');
const bodyRows = () => screen.getAllByRole('row').filter((row) => within(row).queryAllByRole('cell').length > 0);
const alertWith = (text: string) => screen.getAllByRole('alert').find((alert) => alert.textContent?.includes(text));
const isDisabled = (element: HTMLElement) => element.getAttribute('aria-disabled') === 'true' || element.hasAttribute('disabled');

describe.skipIf(!hasApi)('Sign-in and Identity Screen (live, real api and Postgres)', () => {
  describe('the Providers tab, Administrator (edit)', () => {
    it('carries the four hooks the e2e specs read, the module title and the data source of the records', async () => {
      const { container } = await renderScreen();
      const page = root(container);
      expect([page?.getAttribute('data-module'), page?.getAttribute('data-state'), page?.getAttribute('data-access'), page?.getAttribute('data-reduced')]).toEqual(['admin.sign_in_identity', 'filled', 'edit', 'false']);
      expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Sign-in and Identity Providers');
      expect(container.querySelector('[data-badge="SYNTHETIC"]')).not.toBeNull();
      expect(screen.queryByText('View only')).toBeNull();
      expect(screen.queryByText('Our staff set up providers in the shared tier.')).toBeNull();
    });

    it('has two header actions (Add provider and More with Export settings) and four tabs with counts', async () => {
      await renderScreen();
      expect(screen.getByRole('button', { name: 'Add provider' }).hasAttribute('aria-disabled')).toBe(false);
      fireEvent.click(screen.getByRole('button', { name: 'More' }));
      expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual(['Export settings']);
      expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['Providers1', 'Group rules11', 'Sign-in policy', 'Emergency admin']);
    });

    it('exports the settings as a JSON file that has no secret in it, and says so', async () => {
      await renderScreen();
      fireEvent.click(screen.getByRole('button', { name: 'More' }));
      fireEvent.click(screen.getByRole('menuitem', { name: 'Export settings' }));
      expect(env.download).toHaveBeenCalledTimes(1);
      const file = env.download.mock.calls[0]?.[0] as { filename: string; mime: string; text: string };
      expect([file.filename, file.mime]).toEqual(['sign-in-identity-settings.json', 'application/json']);
      expect(Object.keys(JSON.parse(file.text) as object)).toEqual(['providers', 'group_rules', 'sign_in_policy']);
      expect(await screen.findByText('Settings exported')).toBeTruthy();
    });

    it('lists the providers with the seven columns of the mockup, the mock provider labelled Demo, protocol, status and Keycloak sync', async () => {
      await addOkta();
      await renderScreen();
      expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Provider', 'Preset', 'Protocol', 'Email domains', 'Status', 'Keycloak', 'Last test']);
      expect(alertWith('Keycloak not connected')).toBeTruthy();
      expect(bodyRows()).toHaveLength(2);
      const mock = bodyRows().find((row) => row.textContent?.includes('Mock provider')) as HTMLElement;
      expect(within(mock).getByText('Demo')).toBeTruthy();
      expect(within(mock).getByText('Generic OIDC')).toBeTruthy();
      expect(within(mock).getByText('OIDC')).toBeTruthy();
      expect(within(mock).getByText('Enabled')).toBeTruthy();
      expect(within(mock).getByText('Not tested')).toBeTruthy();
      const okta = bodyRows().find((row) => row.textContent?.includes('Customer Okta')) as HTMLElement;
      expect(within(okta).getByText('acme.example')).toBeTruthy();
      expect(within(okta).getByText('Stored only')).toBeTruthy();
      expect(okta.querySelectorAll('[translate="no"]').length).toBeGreaterThanOrEqual(3);
    });

    it('opens a provider through ?provider= when its row is pressed (a push: Back closes the drawer)', async () => {
      await renderScreen();
      fireEvent.click(bodyRows()[0] as HTMLElement);
      expect(env.navigate).toHaveBeenCalledWith('/admin/sign-in-identity?provider=mock-provider');
    });

    it('shows the provider drawer on first paint: settings, claims, the Test connection stub tag, Edit and Enable or Disable', async () => {
      const okta = await addOkta();
      await renderScreen({ search: { provider: okta.id } });
      const drawer = screen.getByRole('dialog', { name: 'Customer Okta' });
      expect(drawer.textContent).toContain('Okta');
      for (const label of ['Protocol', 'Email domains', 'Email claim', 'Name claim', 'Groups claim', 'Signed assertions']) expect(within(drawer).getByText(label)).toBeTruthy();
      expect(within(drawer).getByRole('button', { name: 'Test connection' })).toBeTruthy();
      expect(drawer.querySelector('[data-stub="demo"]')).not.toBeNull();
      expect(within(drawer).getByRole('button', { name: 'Edit' }).hasAttribute('aria-disabled')).toBe(false);
      expect(within(drawer).getByRole('button', { name: 'Disable' })).toBeTruthy();
    });

    it('shows the mock provider read only: Edit and Disable are disabled with "The demo provider cannot be changed"', async () => {
      await renderScreen({ search: { provider: 'mock-provider' } });
      const drawer = screen.getByRole('dialog', { name: 'Mock provider (demo only)' });
      expect(isDisabled(within(drawer).getByRole('button', { name: 'Edit' }))).toBe(true);
      expect(isDisabled(within(drawer).getByRole('button', { name: 'Disable' }))).toBe(true);
      expect(within(drawer).getByRole('button', { name: 'Test connection' }).hasAttribute('aria-disabled')).toBe(false);
      expect(within(drawer).getAllByText('Demo').length).toBe(2);
    });

    it('shows an inline notice and no drawer for a provider, a rule or a wizard target that does not exist', async () => {
      await renderScreen({ search: { provider: 'nobody-3fa89d67' } });
      expect(alertWith('That provider could not be found.')).toBeTruthy();
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(bodyRows()).toHaveLength(1);
      cleanup();
      await renderScreen({ search: { rule: '00000000-0000-4000-8000-00000000dead' } });
      expect(alertWith('That group rule could not be found.')).toBeTruthy();
      cleanup();
      await renderScreen({ search: { wizard: 'mock-provider' } });
      expect(screen.getAllByRole('alert').length).toBe(2);
      expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('ignores a value that is not on its allow-list: the Providers tab shows', async () => {
      await renderScreen({ search: { tab: 'evil', provider: '../etc', rule: 'x', wizard: '$(x)' } });
      expect(screen.getAllByRole('tab')[0]?.getAttribute('aria-selected')).toBe('true');
      expect(bodyRows()).toHaveLength(1);
    });
  });

  describe('the wizard from the address', () => {
    it('opens on ?wizard=1 at step 1 with the nine presets and the four steps; Next is disabled until a preset is chosen', async () => {
      await renderScreen({ search: { wizard: '1' } });
      const dialog = screen.getByRole('dialog', { name: 'Add provider' });
      expect(within(dialog).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['1Preset', '2Settings', '3Token fields', '4Test']);
      expect(dialog.querySelectorAll('[data-preset]')).toHaveLength(9);
      expect(within(dialog).getByRole('button', { name: 'Next' }).getAttribute('aria-disabled')).toBe('true');
      expect(within(dialog).getByText('Choose a preset')).toBeTruthy();
      fireEvent.click(dialog.querySelector('[data-preset="okta"]') as HTMLElement);
      expect(within(dialog).getByRole('button', { name: 'Next' }).hasAttribute('aria-disabled')).toBe(false);
    });

    it('opens on ?wizard=<id> at step 2 for a provider it can change, with its settings filled in and no secret shown', async () => {
      const okta = await addOkta();
      await renderScreen({ search: { wizard: okta.id } });
      const dialog = screen.getByRole('dialog', { name: 'Edit provider' });
      expect((within(dialog).getByLabelText(/Display name/) as HTMLInputElement).value).toBe('Customer Okta');
      expect((within(dialog).getByLabelText(/Okta domain/) as HTMLInputElement).value).toBe('example.okta.com');
      const secret = within(dialog).getByLabelText(/Client secret/) as HTMLInputElement;
      expect([secret.type, secret.value]).toEqual(['password', '']);
      expect(within(dialog).getByText('Leave empty to keep the secret already given')).toBeTruthy();
    });

    it('does not open for a view-only Administrator', async () => {
      await renderScreen({ access: 'view', mode: 'shared', search: { wizard: '1' } });
      expect(screen.queryByRole('dialog', { name: 'Add provider' })).toBeNull();
    });
  });

  describe('the Group rules tab', () => {
    it('shows the rules lowest number first with the mockup\'s five columns, the match type under the group, roles, zones and On switches', async () => {
      await renderScreen({ search: { tab: 'rules' } });
      expect(screen.getAllByRole('tab')[1]?.getAttribute('aria-selected')).toBe('true');
      expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['#', 'Group', 'Role', 'Zone', 'On']);
      expect(bodyRows()).toHaveLength(11);
      const first = bodyRows()[0] as HTMLElement;
      expect(within(first).getByText('opendispatch-administrators')).toBeTruthy();
      expect(within(first).getByText('Exact')).toBeTruthy();
      expect(within(first).getByText('Administrator')).toBeTruthy();
      expect(within(first).getByText('Whole install')).toBeTruthy();
      expect(within(first).getByRole('switch', { name: 'On' }).getAttribute('aria-checked')).toBe('true');
      const supervisor = bodyRows()[1] as HTMLElement;
      expect(within(supervisor).getByText('Object ID')).toBeTruthy();
      expect(within(supervisor).getByText('RD-C')).toBeTruthy();
      expect(within(supervisor).getByText('+2')).toBeTruthy();
      expect(within(bodyRows()[10] as HTMLElement).getByRole('switch', { name: 'On' }).getAttribute('aria-checked')).toBe('false');
      expect(screen.getByText('Lowest number wins')).toBeTruthy();
    });

    it('shows the preview: the group in the token, the sample buttons, and the role, zones and matched rule of the first group', async () => {
      await renderScreen({ search: { tab: 'rules' } });
      expect((screen.getByLabelText('Groups in the token') as HTMLTextAreaElement).value).toBe('opendispatch-dispatch-riyadh-core');
      expect(screen.getByRole('button', { name: 'unknown-group' })).toBeTruthy();
      const result = document.querySelector('[aria-live="polite"]') as HTMLElement;
      expect(within(result).getByText('Dispatcher')).toBeTruthy();
      expect(within(result).getByText('RD-C')).toBeTruthy();
      expect(within(result).getByText('Matched 1')).toBeTruthy();
      expect(within(result).getByText('#4')).toBeTruthy();
      expect(bodyRows()[3]?.className).toMatch(/success|tone/i);
    });

    it('opens the rule editor on ?rule=<id> with the rule\'s group, match type, role, zones and priority; and on ?rule=new empty', async () => {
      await renderScreen({ search: { tab: 'rules' } });
      fireEvent.click(bodyRows()[3] as HTMLElement);
      const href = env.navigate.mock.calls[0]?.[0] as string;
      const id = new URL(href, 'http://x').searchParams.get('rule') as string;
      cleanup();
      await renderScreen({ search: { tab: 'rules', rule: id } });
      const drawer = screen.getByRole('dialog', { name: 'Edit rule' });
      expect((within(drawer).getByLabelText(/Group/) as HTMLInputElement).value).toBe('opendispatch-dispatch-riyadh-core');
      expect(within(drawer).getByRole('radio', { name: 'Exact' }).getAttribute('aria-checked')).toBe('true');
      expect((within(drawer).getByLabelText('Role') as HTMLSelectElement).value).toBe('dispatcher');
      expect((within(drawer).getByLabelText('Priority') as HTMLInputElement).value).toBe('4');
      expect(within(drawer).getByRole('button', { name: 'Delete' })).toBeTruthy();
      cleanup();
      await renderScreen({ search: { tab: 'rules', rule: 'new' } });
      const fresh = screen.getByRole('dialog', { name: 'Add rule' });
      expect((within(fresh).getByLabelText(/Group/) as HTMLInputElement).value).toBe('');
      expect((within(fresh).getByLabelText('Priority') as HTMLInputElement).value).toBe('12');
      expect(within(fresh).queryByRole('button', { name: 'Delete' })).toBeNull();
      expect(within(fresh).getByText('Enter a group')).toBeTruthy();
    });
  });

  describe('the Sign-in policy tab', () => {
    it('shows the force SSO switch with the domains, the MFA switch, the session length and the sticky footer with nothing to save', async () => {
      await renderScreen({ search: { tab: 'policy' } });
      expect(screen.getByRole('switch', { name: /Force SSO/ }).getAttribute('aria-checked')).toBe('true');
      expect(screen.getByText('demo.example')).toBeTruthy();
      expect(screen.getByRole('switch', { name: /Require MFA claim/ }).getAttribute('aria-checked')).toBe('false');
      expect((screen.getByLabelText('Session length') as HTMLSelectElement).value).toBe('480');
      expect([...(screen.getByLabelText('Session length') as HTMLSelectElement).options].map((o) => o.textContent)).toEqual(['4 hours', '8 hours', '12 hours']);
      const footer = screen.getByRole('group', { name: 'Form actions' });
      expect(within(footer).getByText('No changes to save')).toBeTruthy();
      expect(within(footer).getByRole('button', { name: 'Save' }).getAttribute('aria-disabled')).toBe('true');
    });

    it('becomes dirty when a control changes: Unsaved changes, and Save is available; Discard puts it back', async () => {
      await renderScreen({ search: { tab: 'policy' } });
      fireEvent.click(screen.getByRole('switch', { name: /Require MFA claim/ }));
      const footer = screen.getByRole('group', { name: 'Form actions' });
      expect(within(footer).getByText('Unsaved changes')).toBeTruthy();
      expect(within(footer).getByRole('button', { name: 'Save' }).hasAttribute('aria-disabled')).toBe(false);
      fireEvent.click(within(footer).getByRole('button', { name: 'Discard' }));
      expect(screen.getByRole('switch', { name: /Require MFA claim/ }).getAttribute('aria-checked')).toBe('false');
      expect(within(footer).getByText('No changes to save')).toBeTruthy();
    });
  });

  describe('the Emergency admin tab', () => {
    it('shows the account, what every use does, the switch and its recent use', async () => {
      await renderScreen({ search: { tab: 'emergency' } });
      expect(screen.getByRole('heading', { name: 'Emergency administrator' })).toBeTruthy();
      expect(screen.getByText('Active')).toBeTruthy();
      expect(screen.getByText('emergency.admin@demo.example')).toBeTruthy();
      expect(screen.getByText('Local: email and password')).toBeTruthy();
      expect(screen.getByText('Authenticator app')).toBeTruthy();
      for (const line of ['MFA enforced by OpenDispatch', 'Raises an alert', 'Written to the Audit Log']) expect(screen.getByText(line)).toBeTruthy();
      expect(screen.getByRole('switch', { name: 'Emergency sign-in enabled' }).getAttribute('aria-checked')).toBe('true');
      expect(screen.getByRole('heading', { name: 'Recent use' })).toBeTruthy();
      expect(screen.getByText('auth.emergency_sign_in')).toBeTruthy();
      expect(screen.getByRole('link', { name: /Open Audit Log/ }).getAttribute('href')).toBe('/admin/audit-log?q=auth.emergency');
    });
  });

  describe('in a shared install (the Administrator has view): every write control is disabled with the reason', () => {
    const reason = 'Managed by our staff in the shared tier';

    it('says View only and shows the Read only banner with Request a change (enabled: it is the way to ask)', async () => {
      const { container } = await renderScreen({ access: 'view', mode: 'shared' });
      expect(root(container)?.getAttribute('data-access')).toBe('view');
      expect(screen.getByText('View only')).toBeTruthy();
      expect(screen.getByText('Our staff set up providers in the shared tier.')).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Request a change' }).hasAttribute('aria-disabled')).toBe(false);
      expect(isDisabled(screen.getByRole('button', { name: 'Add provider' }))).toBe(true);
      fireEvent.click(screen.getByRole('button', { name: 'Add provider' }));
      expect(env.router.push).not.toHaveBeenCalled();
      expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('opens the request dialog: the confirm button needs a note, and the dialog says what to write', async () => {
      await renderScreen({ access: 'view', mode: 'shared' });
      fireEvent.click(screen.getByRole('button', { name: 'Request a change' }));
      const dialog = screen.getByRole('dialog', { name: 'Request a change' });
      expect(within(dialog).getByLabelText(/What should change/)).toBeTruthy();
      expect(within(dialog).getByRole('button', { name: 'Send request' }).getAttribute('aria-disabled')).toBe('true');
    });

    it('keeps the provider drawer readable with Edit, Disable and Test connection disabled', async () => {
      await renderScreen({ access: 'view', mode: 'shared', search: { provider: 'mock-provider' } });
      const drawer = screen.getByRole('dialog', { name: 'Mock provider (demo only)' });
      for (const name of ['Edit', 'Disable', 'Test connection']) expect(isDisabled(within(drawer).getByRole('button', { name })), name).toBe(true);
    });

    it('shows the rules, the switches and Add rule disabled, with the preview still working', async () => {
      await renderScreen({ access: 'view', mode: 'shared', search: { tab: 'rules' } });
      expect(isDisabled(screen.getByRole('button', { name: 'Add rule' }))).toBe(true);
      const switches = screen.getAllByRole('switch', { name: 'On' });
      expect(switches).toHaveLength(11);
      expect(switches.every((sw) => sw.hasAttribute('disabled'))).toBe(true);
      expect(screen.getByLabelText('Groups in the token').hasAttribute('disabled')).toBe(false);
      expect(within(screen.getByText('Preview').closest('div') as HTMLElement).getByText('Preview')).toBeTruthy();
    });

    it('shows the policy controls disabled with the reason in the footer, and the emergency switch disabled', async () => {
      await renderScreen({ access: 'view', mode: 'shared', search: { tab: 'policy' } });
      expect(screen.getByRole('switch', { name: /Force SSO/ }).hasAttribute('disabled')).toBe(true);
      expect(screen.getByRole('switch', { name: /Require MFA claim/ }).hasAttribute('disabled')).toBe(true);
      expect((screen.getByLabelText('Session length') as HTMLSelectElement).disabled).toBe(true);
      const footer = screen.getByRole('group', { name: 'Form actions' });
      expect(within(footer).getByText(reason)).toBeTruthy();
      expect(isDisabled(within(footer).getByRole('button', { name: 'Save' }))).toBe(true);
      cleanup();
      await renderScreen({ access: 'view', mode: 'shared', search: { tab: 'emergency' } });
      expect(screen.getByRole('switch', { name: 'Emergency sign-in enabled' }).hasAttribute('disabled')).toBe(true);
    });

    it('shows the Change Approver rule as not live in a shared install', async () => {
      await renderScreen({ access: 'view', mode: 'shared', search: { tab: 'rules' } });
      expect(screen.getByText('Private installs only')).toBeTruthy();
    });
  });

  describe('in Arabic', () => {
    // Names, codes, group names, e-mail addresses and the server's English detail are data (translate="no" / lang="en").
    const untranslated = (container: HTMLElement) => {
      const clone = container.cloneNode(true) as HTMLElement;
      for (const node of clone.querySelectorAll('[translate="no"], [lang="en"]')) node.remove();
      const attributes = [...clone.querySelectorAll('[aria-label], [title], [placeholder]')].flatMap((el) => [el.getAttribute('aria-label') ?? '', el.getAttribute('title') ?? '', el.getAttribute('placeholder') ?? '']);
      // Product and protocol names stay in Latin letters inside Arabic text.
      // City and zone names come from the data: the zone picker names its checkboxes with them in an attribute outside translate="no" (reported).
      const names = /\b(OpenDispatch|Okta|ADFS|Entra ID|Google Workspace|Cloud Identity|Keycloak|OIDC|SAML|SSO|MFA|JSON|ID|Riyadh|Jeddah|Dammam|Central|North|South|East|West)\b/g;
      // Disposable test records: no fixed prefix, so
      // this strips any 2-4 Title-Case word run (real
      // untranslated chrome never looks like a name).
      const disposable = /\b[A-Z][a-z]+(?: [A-Z][a-z]+){1,3}\b/g;
      return `${clone.textContent ?? ''} ${attributes.join(' ')}`.replace(disposable, ' ').replace(names, ' ');
    };

    it('draws every tab in Arabic with no English left over outside the data', async () => {
      await addOkta();
      for (const tab of ['providers', 'rules', 'policy', 'emergency']) {
        const { container } = await renderScreen({ locale: 'ar', search: { tab } });
        expect(untranslated(container).match(/[A-Za-z]{2,}/g), tab).toBeNull();
        cleanup();
      }
      await renderScreen({ locale: 'ar' });
      expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('تسجيل الدخول ومزوّدو الهوية');
      expect(screen.getByRole('button', { name: 'إضافة مزوّد' })).toBeTruthy();
      expect(screen.getAllByRole('tab')).toHaveLength(4);
    });

    it('draws the provider drawer, the wizard and the rule editor in Arabic with no English left over', async () => {
      const okta = await addOkta();
      await renderScreen({ locale: 'ar', search: { provider: okta.id } });
      expect(untranslated(screen.getByRole('dialog')).match(/[A-Za-z]{2,}/g), 'provider').toBeNull();
      cleanup();
      await renderScreen({ locale: 'ar', search: { wizard: '1' } });
      expect(untranslated(screen.getByRole('dialog')).match(/[A-Za-z]{2,}/g), 'wizard').toBeNull();
      cleanup();
      await renderScreen({ locale: 'ar', search: { wizard: okta.id } });
      expect(untranslated(screen.getByRole('dialog')).match(/[A-Za-z]{2,}/g), 'edit').toBeNull();
      cleanup();
      await renderScreen({ locale: 'ar', search: { tab: 'rules', rule: 'new' } });
      expect(untranslated(screen.getByRole('dialog')).match(/[A-Za-z]{2,}/g)?.join(',') ?? '', 'rule').toBe('');
    });

    it('draws the read only banner and the states in Arabic', async () => {
      const shared = await renderScreen({ locale: 'ar', access: 'view', mode: 'shared' });
      expect(hasLatinLetters(untranslated(shared.container), [])).toBe(false);
      expect(screen.getByText('للقراءة فقط')).toBeTruthy();
      cleanup();
      await renderScreen({ locale: 'ar', state: 'error' });
      expect(screen.getByText('تعذّر تحميل المزوّدين.')).toBeTruthy();
    });
  });
});
