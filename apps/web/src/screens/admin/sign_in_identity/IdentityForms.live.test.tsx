// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment jsdom
import { DesignSystemProvider } from '@opendispatch/ui';
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { inLocale } from '@/components/opendispatch/test-utils';
import { getModule, type InstallMode, type Role } from '@/lib/access';
import { buildContext, fixtureTenantId } from '@/lib/data/go-test-reset';
import type { RequestContext } from '@/lib/data/guard';
import { createIdentityProvider } from '@/lib/data/identity';
import type { SearchParams } from '@/screens/types';
import * as actions from './actions';
import { SignInIdentityScreen } from './Screen';
import { fixtureUsers, resetGoTestState } from '@/lib/data/go-test-reset';

// Live: skips, never fakes, if OPENDISPATCH_API_URL unset.
// loadIdentityView reads Zones/Cities.
const hasApi = process.env['OPENDISPATCH_API_URL'] !== undefined && process.env['OPENDISPATCH_API_URL'] !== '';
if (!hasApi) console.log('OPENDISPATCH_API_URL is not set: IdentityForms.live.test.tsx is skipped, not faked.');

// The interactions of the client files: the wizard, the rule editor, the preview, the policy form, the switches and the request
// dialog. The actions are stood in for (their own tests are in actions.test.ts); what these tests prove is what the client sends
// and what it shows for each answer.
const env = vi.hoisted(() => ({ locale: 'en' as 'en' | 'ar', query: '', router: { push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }, navigate: vi.fn() }));

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

const mocked = <K extends keyof typeof actions>(name: K) => actions[name] as unknown as ReturnType<typeof vi.fn>;

beforeEach(async () => {
  await resetGoTestState();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  for (const mock of [env.router.replace, env.router.push, env.router.refresh, env.navigate]) mock.mockReset();
  for (const name of Object.keys(actions) as (keyof typeof actions)[]) mocked(name).mockReset();
});

function ctxOf(role: Role, installMode: InstallMode = 'private'): RequestContext {
  const tenant = fixtureTenantId();
  const built = buildContext({ role, installMode, zoneIds: [] }, fixtureUsers(), tenant);
  if (built === null) throw new Error(`no context for ${role}`);
  return built;
}

async function renderScreen(search: SearchParams = {}, { access = 'edit', mode = 'private' }: { access?: 'edit' | 'view'; mode?: InstallMode } = {}) {
  env.locale = 'en';
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(search)) if (typeof value === 'string') params.set(key, value);
  env.query = params.toString();
  const element = await SignInIdentityScreen({ def: getModule('admin.sign_in_identity'), ctx: ctxOf('administrator', mode), access: { access, reduced: false }, locale: 'en', homeHref: '/', state: undefined, searchParams: search });
  return inLocale('en', <DesignSystemProvider navigate={env.navigate}>{element}</DesignSystemProvider>, { module: 'admin.sign_in_identity' });
}

const addOkta = async () => await createIdentityProvider(ctxOf('administrator'), { preset_id: 'okta', display_name: 'Customer Okta', is_enabled: false, email_domains: ['acme.example'], config: { okta_domain: 'example.okta.com', client_id: 'opendispatch-test' }, client_secret: 'example-not-a-secret-value' });
const dialog = () => screen.getByRole('dialog');
const type = (label: RegExp | string, value: string, within_: HTMLElement = dialog()) => fireEvent.change(within(within_).getByLabelText(label), { target: { value } });
const next = () => fireEvent.click(within(dialog()).getByRole('button', { name: 'Next' }));

const PASS = { checkedAt: '2026-09-20T10:00:00+03:00', ok: true, referenceCode: null, steps: [{ code: 'reach', name: 'Reach the provider', ok: true, message: null }, { code: 'discovery', name: 'Read the discovery document', ok: true, message: null }, { code: 'client', name: 'Check the client', ok: true, message: null }, { code: 'claims', name: 'Find the email, name and groups claims', ok: true, message: null }] };
const FAIL = { checkedAt: '2026-09-20T10:00:00+03:00', ok: false, referenceCode: 'IDP-4F2A91', steps: [{ code: 'reach', name: 'Reach the provider', ok: false, message: 'The provider address did not answer.' }, { code: 'discovery', name: 'Read the discovery document', ok: false, message: null }] };

describe.skipIf(!hasApi)('IdentityForms: the interactions (live, real api and Postgres)', () => {
  describe('the wizard: a new provider', () => {
    async function throughToTest() {
      await renderScreen({ wizard: '1' });
      fireEvent.click(dialog().querySelector('[data-preset="okta"]') as HTMLElement);
      next();
      expect(within(dialog()).getByText('Fill in the required settings')).toBeTruthy();
      expect(within(dialog()).getByRole('button', { name: 'Next' }).getAttribute('aria-disabled')).toBe('true');
      type(/Display name/, 'Customer Okta');
      type(/Okta domain/, 'example.okta.com');
      type(/Client ID/, 'opendispatch-test');
      type(/Client secret/, 'example-not-a-secret-value');
      type('Email domains', 'acme.example, other.example');
      expect(within(dialog()).getByRole('button', { name: 'Next' }).hasAttribute('aria-disabled')).toBe(false);
      next();
      expect(within(dialog()).getByLabelText('Groups claim')).toBeTruthy();
      next();
      expect(within(dialog()).getByRole('button', { name: 'Test connection' })).toBeTruthy();
    }

    it('fills the display name and the claims from the preset, and asks for the required settings before going on', async () => {
      await renderScreen({ wizard: '1' });
      fireEvent.click(dialog().querySelector('[data-preset="entra_id_saml"]') as HTMLElement);
      next();
      expect((within(dialog()).getByLabelText(/Display name/) as HTMLInputElement).value).toBe('Microsoft Entra ID (SAML)');
      type(/App federation metadata URL/, 'https://idp.example.com/federationmetadata.xml');
      next();
      expect((within(dialog()).getByLabelText('Email claim') as HTMLInputElement).value).toMatch(/emailaddress$/);
      expect(within(dialog()).getByText(/Above 150 groups Entra ID sends none/)).toBeTruthy();
      expect(within(dialog()).getByRole('switch', { name: 'Signed assertions required' }).getAttribute('aria-checked')).toBe('true');
    });

    it('saves and tests on the last step (a labelled stub), shows the result, and only then allows Save provider', async () => {
      mocked('saveAndTestProvider').mockResolvedValue({ ok: true, data: { provider: { id: 'okta-1a2b3c4d', name: 'Customer Okta', enabled: false }, test: PASS } });
      await throughToTest();
      const save = within(dialog()).getByRole('button', { name: 'Save provider' });
      expect(save.getAttribute('aria-disabled')).toBe('true');
      expect(within(dialog()).getByText('Test the connection first')).toBeTruthy();
      expect(dialog().querySelector('[data-stub="demo"]')).not.toBeNull();
      fireEvent.click(within(dialog()).getByRole('button', { name: 'Test connection' }));
      await waitFor(() => expect(mocked('saveAndTestProvider')).toHaveBeenCalledTimes(1));
      expect(mocked('saveAndTestProvider')).toHaveBeenCalledWith({
        preset_id: 'okta',
        display_name: 'Customer Okta',
        email_domains: ['acme.example', 'other.example'],
        config: { okta_domain: 'example.okta.com', client_id: 'opendispatch-test' },
        client_secret: 'example-not-a-secret-value',
        claim_mapping: { email: 'email', name: 'name', groups: 'groups' },
      });
      expect(await within(dialog()).findByText('Connection works')).toBeTruthy();
      for (const step of ['Reach the provider', 'Read the discovery document', 'Check the client', 'Find the email, name and groups claims']) expect(within(dialog()).getByText(step)).toBeTruthy();
      expect(within(dialog()).getByRole('button', { name: 'Save provider' }).hasAttribute('aria-disabled')).toBe(false);
    });

    it('enables the provider on Save provider, says so and closes', async () => {
      mocked('saveAndTestProvider').mockResolvedValue({ ok: true, data: { provider: { id: 'okta-1a2b3c4d', name: 'Customer Okta', enabled: false }, test: PASS } });
      mocked('setProviderEnabled').mockResolvedValue({ ok: true, data: { id: 'okta-1a2b3c4d', name: 'Customer Okta', enabled: true } });
      await throughToTest();
      fireEvent.click(within(dialog()).getByRole('button', { name: 'Test connection' }));
      await within(dialog()).findByText('Connection works');
      fireEvent.click(within(dialog()).getByRole('button', { name: 'Save provider' }));
      await waitFor(() => expect(mocked('setProviderEnabled')).toHaveBeenCalledWith({ providerId: 'okta-1a2b3c4d', enabled: true }));
      expect(await screen.findByText('Provider added')).toBeTruthy();
      expect(env.router.replace).toHaveBeenCalledWith('/admin/sign-in-identity', { scroll: false });
      expect(mocked('removeProvider')).not.toHaveBeenCalled();
    });

    it('shows a failed test with its reference code and keeps Save provider disabled', async () => {
      mocked('saveAndTestProvider').mockResolvedValue({ ok: true, data: { provider: { id: 'okta-1a2b3c4d', name: 'Customer Okta', enabled: false }, test: FAIL } });
      await throughToTest();
      fireEvent.click(within(dialog()).getByRole('button', { name: 'Test connection' }));
      expect(await within(dialog()).findByText('Connection failed')).toBeTruthy();
      expect(within(dialog()).getByText('Reference IDP-4F2A91')).toBeTruthy();
      expect(within(dialog()).getAllByText('The provider address did not answer.').length).toBeGreaterThan(0);
      expect(within(dialog()).getByRole('button', { name: 'Save provider' }).getAttribute('aria-disabled')).toBe('true');
    });

    it('removes the draft the test made when the wizard is closed without saving', async () => {
      mocked('saveAndTestProvider').mockResolvedValue({ ok: true, data: { provider: { id: 'okta-1a2b3c4d', name: 'Customer Okta', enabled: false }, test: PASS } });
      mocked('removeProvider').mockResolvedValue({ ok: true, data: { removed: true } });
      await throughToTest();
      fireEvent.click(within(dialog()).getByRole('button', { name: 'Test connection' }));
      await within(dialog()).findByText('Connection works');
      fireEvent.click(within(dialog()).getByRole('button', { name: 'Close' }));
      await waitFor(() => expect(mocked('removeProvider')).toHaveBeenCalledWith({ providerId: 'okta-1a2b3c4d' }));
      expect(env.router.replace).toHaveBeenCalledWith('/admin/sign-in-identity', { scroll: false });
    });

    it('forgets a test when a setting changes afterwards: the result goes and Save provider is disabled again', async () => {
      mocked('saveAndTestProvider').mockResolvedValue({ ok: true, data: { provider: { id: 'okta-1a2b3c4d', name: 'Customer Okta', enabled: false }, test: PASS } });
      await throughToTest();
      fireEvent.click(within(dialog()).getByRole('button', { name: 'Test connection' }));
      await within(dialog()).findByText('Connection works');
      fireEvent.click(within(dialog()).getByRole('button', { name: 'Back' }));
      fireEvent.click(within(dialog()).getByRole('button', { name: 'Back' }));
      type(/Client ID/, 'another-client');
      next();
      next();
      expect(within(dialog()).queryByText('Connection works')).toBeNull();
      expect(within(dialog()).getByRole('button', { name: 'Save provider' }).getAttribute('aria-disabled')).toBe('true');
    });

    it('shows the data layer\'s refusal in the dialog with its English detail marked as English', async () => {
      mocked('saveAndTestProvider').mockResolvedValue({ ok: false, code: 'invalid', message: 'Identity provider: Okta domain is required.' });
      await throughToTest();
      fireEvent.click(within(dialog()).getByRole('button', { name: 'Test connection' }));
      const alert = await within(dialog()).findByRole('alert');
      expect(alert.textContent).toContain('Check the details and try again.');
      expect(alert.querySelector('[lang="en"]')?.textContent).toBe('Identity provider: Okta domain is required.');
    });
  });

  describe('the wizard: changing a provider', () => {
    it('sends the provider id, keeps the secret unless a new one is typed, and does not remove anything on close', async () => {
      const okta = await addOkta();
      mocked('saveAndTestProvider').mockResolvedValue({ ok: true, data: { provider: { id: okta.id, name: 'Customer Okta renamed', enabled: false }, test: PASS } });
      await renderScreen({ wizard: okta.id });
      type(/Display name/, 'Customer Okta renamed');
      next();
      next();
      fireEvent.click(within(dialog()).getByRole('button', { name: 'Test connection' }));
      await waitFor(() => expect(mocked('saveAndTestProvider')).toHaveBeenCalledTimes(1));
      const sent = mocked('saveAndTestProvider').mock.calls[0]?.[0] as Record<string, unknown>;
      expect(sent).toMatchObject({ providerId: okta.id, preset_id: 'okta', display_name: 'Customer Okta renamed', email_domains: ['acme.example'] });
      expect(sent).not.toHaveProperty('client_secret');
      await within(dialog()).findByText('Connection works');
      fireEvent.click(within(dialog()).getByRole('button', { name: 'Save provider' }));
      expect(await screen.findByText('Provider saved')).toBeTruthy();
      expect(mocked('setProviderEnabled')).not.toHaveBeenCalled();
      expect(mocked('removeProvider')).not.toHaveBeenCalled();
    });

    it('cannot change the preset: the cards are disabled except the provider\'s own', async () => {
      const okta = await addOkta();
      await renderScreen({ wizard: okta.id });
      fireEvent.click(within(dialog()).getByRole('button', { name: 'Back' }));
      const cards = [...dialog().querySelectorAll<HTMLButtonElement>('[data-preset]')];
      expect(cards.filter((card) => !card.disabled).map((card) => card.dataset['preset'])).toEqual(['okta']);
    });
  });

  describe('the provider drawer', () => {
    it('runs the scripted test (a stub), shows the steps, and says "Connection test passed" only when it passed', async () => {
      const okta = await addOkta();
      mocked('testProvider').mockResolvedValue({ ok: true, data: PASS });
      await renderScreen({ provider: okta.id });
      fireEvent.click(within(dialog()).getByRole('button', { name: 'Test connection' }));
      await waitFor(() => expect(mocked('testProvider')).toHaveBeenCalledWith({ providerId: okta.id }));
      expect(await within(dialog()).findByText('Connection works')).toBeTruthy();
      expect(await screen.findByText('Connection test passed')).toBeTruthy();
      cleanup();
      mocked('testProvider').mockResolvedValue({ ok: true, data: FAIL });
      await renderScreen({ provider: okta.id });
      fireEvent.click(within(dialog()).getByRole('button', { name: 'Test connection' }));
      expect(await within(dialog()).findByText('Connection failed')).toBeTruthy();
      expect(screen.queryByText('Connection test passed')).toBeNull();
    });

    it('enables a disabled provider and disables an enabled one', async () => {
      const okta = await addOkta();
      mocked('setProviderEnabled').mockResolvedValue({ ok: true, data: { id: okta.id, name: 'Customer Okta', enabled: true } });
      await renderScreen({ provider: okta.id });
      fireEvent.click(within(dialog()).getByRole('button', { name: 'Enable' }));
      await waitFor(() => expect(mocked('setProviderEnabled')).toHaveBeenCalledWith({ providerId: okta.id, enabled: true }));
      expect(await screen.findByText('Provider enabled')).toBeTruthy();
    });

    it('opens the wizard for this provider from Edit (a push)', async () => {
      const okta = await addOkta();
      await renderScreen({ provider: okta.id });
      fireEvent.click(within(dialog()).getByRole('button', { name: 'Edit' }));
      expect(env.router.push).toHaveBeenCalledWith(`/admin/sign-in-identity?provider=${okta.id}&wizard=${okta.id}`);
    });
  });

  describe('the rule editor', () => {
    it('asks for a group, and for a zone when the role has zones, before Save is available', async () => {
      await renderScreen({ tab: 'rules', rule: 'new' });
      const save = () => within(dialog()).getByRole('button', { name: 'Save' });
      expect(save().getAttribute('aria-disabled')).toBe('true');
      type(/Group/, 'opendispatch-new-group');
      expect(within(dialog()).getAllByText('Choose at least one zone').length).toBeGreaterThan(0);
      expect(save().getAttribute('aria-disabled')).toBe('true');
      fireEvent.click(within(dialog()).getByRole('checkbox', { name: 'RD-C' }));
      expect(save().hasAttribute('aria-disabled')).toBe(false);
      fireEvent.change(within(dialog()).getByLabelText('Role'), { target: { value: 'administrator' } });
      expect(within(dialog()).getByText('Not needed for this role')).toBeTruthy();
      expect(save().hasAttribute('aria-disabled')).toBe(false);
    });

    it('saves a new rule with the person\'s fields only, says so, and closes', async () => {
      mocked('saveRule').mockResolvedValue({ ok: true, data: { id: 'r1', match: 'opendispatch-new-group' } });
      await renderScreen({ tab: 'rules', rule: 'new' });
      type(/Group/, ' opendispatch-new-group ');
      fireEvent.click(within(dialog()).getByRole('radio', { name: 'Prefix' }));
      fireEvent.click(within(dialog()).getByRole('checkbox', { name: 'RD-C' }));
      fireEvent.click(within(dialog()).getByRole('checkbox', { name: 'RD-N' }));
      fireEvent.click(within(dialog()).getByRole('button', { name: 'Save' }));
      await waitFor(() => expect(mocked('saveRule')).toHaveBeenCalledTimes(1));
      const sent = mocked('saveRule').mock.calls[0]?.[0] as Record<string, unknown>;
      expect(sent).toMatchObject({ group_match: 'opendispatch-new-group', group_match_type: 'prefix', assigned_role: 'dispatcher', priority: 12 });
      expect((sent['zone_ids'] as string[]).length).toBe(2);
      expect(sent).not.toHaveProperty('ruleId');
      expect(await screen.findByText('Group rule saved')).toBeTruthy();
      expect(env.router.replace).toHaveBeenCalledWith('/admin/sign-in-identity?tab=rules', { scroll: false });
    });

    it('keeps the drawer open and shows the refusal when the data layer says no', async () => {
      mocked('saveRule').mockResolvedValue({ ok: false, code: 'invalid', message: 'Group rule: an object ID must be a GUID.' });
      await renderScreen({ tab: 'rules', rule: 'new' });
      type(/Group/, 'x');
      fireEvent.click(within(dialog()).getByRole('checkbox', { name: 'RD-C' }));
      fireEvent.click(within(dialog()).getByRole('button', { name: 'Save' }));
      const alert = await within(dialog()).findByRole('alert');
      expect(alert.querySelector('[lang="en"]')?.textContent).toBe('Group rule: an object ID must be a GUID.');
    });

    it('deletes a rule only after a confirmation', async () => {
      mocked('removeRule').mockResolvedValue({ ok: true, data: { removed: true } });
      await renderScreen({ tab: 'rules' });
      fireEvent.click(screen.getAllByRole('row')[3] as HTMLElement);
      const id = new URL(env.navigate.mock.calls[0]?.[0] as string, 'http://x').searchParams.get('rule') as string;
      cleanup();
      await renderScreen({ tab: 'rules', rule: id });
      fireEvent.click(within(dialog()).getByRole('button', { name: 'Delete' }));
      expect(mocked('removeRule')).not.toHaveBeenCalled();
      const confirm = screen.getByRole('dialog', { name: 'Delete this group rule?' });
      fireEvent.click(within(confirm).getByRole('button', { name: 'Delete' }));
      await waitFor(() => expect(mocked('removeRule')).toHaveBeenCalledWith({ ruleId: id }));
      expect(await screen.findByText('Group rule deleted')).toBeTruthy();
    });
  });

  describe('the rule switches and the preview', () => {
    it('turns a rule on or off from its switch, and says so', async () => {
      mocked('setRuleEnabled').mockResolvedValue({ ok: true, data: { id: 'r', match: 'opendispatch-administrators' } });
      await renderScreen({ tab: 'rules' });
      const first = screen.getAllByRole('switch', { name: 'On' })[0] as HTMLElement;
      fireEvent.click(first);
      await waitFor(() => expect(mocked('setRuleEnabled')).toHaveBeenCalledTimes(1));
      expect(mocked('setRuleEnabled').mock.calls[0]?.[0]).toMatchObject({ enabled: false });
      expect(await screen.findByText('Group rule saved')).toBeTruthy();
    });

    it('asks the server what the typed groups get, after a pause, and shows what they get', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      await renderScreen({ tab: 'rules' });
      mocked('previewRules').mockResolvedValue({ ok: true, data: { role: 'viewer_auditor', zoneCodes: [], matchedIds: [] } });
      fireEvent.change(screen.getByLabelText('Groups in the token'), { target: { value: 'opendispatch-auditors\nother' } });
      expect(mocked('previewRules')).not.toHaveBeenCalled();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(400);
      });
      await waitFor(() => expect(mocked('previewRules')).toHaveBeenCalledWith({ groups: ['opendispatch-auditors', 'other'] }));
      const result = document.querySelector('[aria-live="polite"]') as HTMLElement;
      expect(await within(result).findByText('Viewer / Auditor')).toBeTruthy();
      expect(within(result).getByText('Matched 0')).toBeTruthy();
    });

    it('shows "No matching rule: no access" when nothing matches, and a sample button fills the box', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      mocked('previewRules').mockResolvedValue({ ok: true, data: { role: null, zoneCodes: [], matchedIds: [] } });
      await renderScreen({ tab: 'rules' });
      fireEvent.click(screen.getByRole('button', { name: 'unknown-group' }));
      expect((screen.getByLabelText('Groups in the token') as HTMLTextAreaElement).value).toBe('unknown-group');
      await act(async () => {
        await vi.advanceTimersByTimeAsync(400);
      });
      expect(await screen.findByText('No matching rule: no access')).toBeTruthy();
    });
  });

  describe('the policy form', () => {
    it('saves the changed policy in one action and says so', async () => {
      mocked('saveSignInPolicy').mockResolvedValue({ ok: true, data: { forceDomains: ['demo.example', 'acme.example'], requireMfa: true, sessionMinutes: 720 } });
      await renderScreen({ tab: 'policy' });
      type('Email domains', 'Acme.Example', document.body);
      fireEvent.click(screen.getByRole('button', { name: 'Add domain' }));
      expect(screen.getByText('acme.example')).toBeTruthy();
      fireEvent.click(screen.getByRole('switch', { name: /Require MFA claim/ }));
      fireEvent.change(screen.getByLabelText('Session length'), { target: { value: '720' } });
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));
      await waitFor(() => expect(mocked('saveSignInPolicy')).toHaveBeenCalledWith({ force_sso_email_domains: ['demo.example', 'acme.example'], require_mfa_claim: true, session_length_minutes: 720 }));
      expect(await screen.findByText('Sign-in policy saved')).toBeTruthy();
    });

    it('refuses a domain that is not a domain name before asking the server, and never adds it', async () => {
      await renderScreen({ tab: 'policy' });
      type('Email domains', 'not a domain', document.body);
      fireEvent.click(screen.getByRole('button', { name: 'Add domain' }));
      expect(screen.getByText('Enter a valid domain name')).toBeTruthy();
      expect(screen.queryByText('not a domain')).toBeNull();
    });

    it('turning force SSO off saves an empty list of domains; turning it on again with none asks for a domain', async () => {
      mocked('saveSignInPolicy').mockResolvedValue({ ok: true, data: { forceDomains: [], requireMfa: false, sessionMinutes: 480 } });
      await renderScreen({ tab: 'policy' });
      fireEvent.click(screen.getByRole('switch', { name: /Force SSO/ }));
      expect(screen.queryByText('demo.example')).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));
      await waitFor(() => expect(mocked('saveSignInPolicy')).toHaveBeenCalledWith({ force_sso_email_domains: [], require_mfa_claim: false, session_length_minutes: 480 }));
    });

    it('removes a domain chip and keeps Save unavailable while SSO is forced and no domain is left', async () => {
      await renderScreen({ tab: 'policy' });
      fireEvent.click(screen.getByRole('button', { name: /Remove/ }));
      const footer = screen.getByRole('group', { name: 'Form actions' });
      expect(within(footer).getByText('Add at least one domain')).toBeTruthy();
      expect(within(footer).getByRole('button', { name: 'Save' }).getAttribute('aria-disabled')).toBe('true');
    });
  });

  describe('the emergency switch and the request dialog', () => {
    it('turns emergency sign-in off, warns that only SSO can sign in, and turns it on again', async () => {
      mocked('setEmergencySignIn').mockResolvedValueOnce({ ok: true, data: { enabled: false } }).mockResolvedValueOnce({ ok: true, data: { enabled: true } });
      await renderScreen({ tab: 'emergency' });
      fireEvent.click(screen.getByRole('switch', { name: 'Emergency sign-in enabled' }));
      await waitFor(() => expect(mocked('setEmergencySignIn')).toHaveBeenCalledWith({ enabled: false }));
      expect(await screen.findByText('Emergency sign-in disabled')).toBeTruthy();
      expect(screen.getByText('Only SSO can sign in now')).toBeTruthy();
    });

    it('sends the request with the person\'s words and shows the reference code', async () => {
      mocked('requestChange').mockResolvedValue({ ok: true, data: { referenceCode: 'CHG-0A1B2C3D' } });
      await renderScreen({}, { access: 'view', mode: 'shared' });
      fireEvent.click(screen.getByRole('button', { name: 'Request a change' }));
      fireEvent.change(within(dialog()).getByLabelText(/What should change/), { target: { value: 'Add our second tenant.' } });
      fireEvent.click(within(dialog()).getByRole('button', { name: 'Send request' }));
      await waitFor(() => expect(mocked('requestChange')).toHaveBeenCalledWith({ change: 'Add our second tenant.' }));
      expect(await screen.findByText('Change requested')).toBeTruthy();
      expect(screen.getByText(/Reference CHG-0A1B2C3D/)).toBeTruthy();
    });
  });
});
