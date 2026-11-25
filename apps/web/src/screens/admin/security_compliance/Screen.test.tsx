// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment jsdom
import { DesignSystemProvider } from '@opendispatch/ui';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hasLatinLetters, inLocale } from '@/components/opendispatch/test-utils';
import { getModule, type InstallMode, type Role } from '@/lib/access';
import { buildContext, fixtureTenantId } from '@/lib/data/go-test-reset';
import type { RequestContext } from '@/lib/data/guard';
import type { ScreenProps, SearchParams } from '@/screens/types';
import * as actions from './actions';
import { SecurityComplianceScreen } from './Screen';
import { fixtureUsers, resetGoTestState } from '@/lib/data/go-test-reset';

// The screen as the module route renders it: the async Server Component is called with the props ModuleRoute builds, and the element
// it returns is rendered in each language. The data layer is real (its seeds, a temp demo store); the router, the actions, next-intl's
// server translator and the download are stood in for.
const env = vi.hoisted(() => ({ locale: 'en' as 'en' | 'ar', query: '', router: { push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }, navigate: vi.fn(), saved: vi.fn() }));

vi.mock('next-intl/server', async () => {
  const { createTranslator } = await import('next-intl');
  const { loadMessages } = await import('@/i18n/messages');
  return { getTranslations: async (namespace?: string) => createTranslator({ locale: env.locale, messages: loadMessages(env.locale, 'admin.security_compliance'), ...(namespace === undefined ? {} : { namespace }) }) };
});
vi.mock('@/i18n/navigation', () => ({ usePathname: () => '/admin/security-compliance', useRouter: () => env.router }));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams(env.query) }));
vi.mock('./actions', () => ({ saveSessionPolicy: vi.fn(), setMfaClaim: vi.fn(), saveEvidence: vi.fn(), saveSupportSetting: vi.fn(), grantSupport: vi.fn(), endSupport: vi.fn() }));
vi.mock('@/lib/export/download', async (original) => ({ ...(await original<typeof import('@/lib/export/download')>()), saveCsv: env.saved }));

const mocked = <K extends keyof typeof actions>(name: K) => actions[name] as unknown as ReturnType<typeof vi.fn>;

beforeEach(async () => {
  await resetGoTestState();
});
afterEach(() => {
  cleanup();
  for (const mock of [env.router.replace, env.router.push, env.router.refresh, env.navigate, env.saved]) mock.mockReset();
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
  const element = await SecurityComplianceScreen({ def: getModule('admin.security_compliance'), ctx: ctxOf('administrator', mode), access: { access, reduced: false }, locale, homeHref: '/', state, searchParams: search });
  return inLocale(locale, <DesignSystemProvider navigate={env.navigate}>{element}</DesignSystemProvider>, { module: 'admin.security_compliance' });
}

const root = (container: HTMLElement) => container.querySelector<HTMLElement>('[data-module]');
const bodyRows = () => screen.getAllByRole('row').filter((row) => within(row).queryAllByRole('cell').length > 0);
const isDisabled = (element: HTMLElement) => element.getAttribute('aria-disabled') === 'true' || element.hasAttribute('disabled');
const dialog = () => screen.getByRole('dialog');
const idOfRow = async (ref: string) => {
  await renderScreen({ search: { tab: 'controls', q: ref } });
  fireEvent.click(bodyRows()[0] as HTMLElement);
  const id = new URL(env.navigate.mock.calls[0]?.[0] as string, 'http://x').searchParams.get('control') as string;
  cleanup();
  env.navigate.mockReset();
  return id;
};
const file = (name: string, bytes: number, type = 'application/octet-stream') => new File([new Uint8Array(bytes)], name, { type });

describe('Security and Compliance: the frame, Administrator (edit)', () => {
  it('carries the four hooks the e2e specs read, the module title, the data source and the fixed "Saudi Arabia" residency badge', async () => {
    const { container } = await renderScreen();
    const page = root(container);
    expect([page?.getAttribute('data-module'), page?.getAttribute('data-state'), page?.getAttribute('data-access'), page?.getAttribute('data-reduced')]).toEqual(['admin.security_compliance', 'filled', 'edit', 'false']);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Security and Compliance');
    expect(container.querySelector('[data-badge="SYNTHETIC"]')).not.toBeNull();
    expect(container.querySelector('[data-residency]')?.textContent).toBe('Saudi Arabia');
    expect(screen.queryByText('View only')).toBeNull();
  });

  it('has two header actions (Upload evidence and More with Export controls report), three tabs with the control count, and four figures', async () => {
    await renderScreen();
    expect(screen.getByRole('button', { name: 'Upload evidence' }).hasAttribute('aria-disabled')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual(['Export controls report']);
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['Sessions', 'Controls11', 'Support access']);
    const figure = (label: string) => {
      let node: HTMLElement | null = screen.getAllByText(label)[0] as HTMLElement;
      while (node !== null && !/(\d|Off|On)$/.test(node.textContent ?? '')) node = node.parentElement;
      return node?.textContent;
    };
    expect(figure('Evidenced')).toContain('5');
    expect(figure('Evidenced')).toContain('/ 11');
    expect(figure('In progress')).toBe('In progress3');
    expect(figure('Not started')).toBe('Not started2');
    const support = screen.getAllByText('Support access').map((label) => {
      let node: HTMLElement | null = label;
      while (node !== null && !/(\d|Off|On)$/.test(node.textContent ?? '')) node = node.parentElement;
      return node?.textContent;
    });
    expect(support).toContain('Support accessOff');
  });

  it('exports the whole controls report from the More menu, in the reader\'s language, whatever the filters', async () => {
    await renderScreen({ search: { tab: 'controls', framework: 'PDPL' } });
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Export controls report' }));
    const [filename, table] = env.saved.mock.calls[0] as [string, { header: string[]; rows: string[][] }];
    expect(filename).toBe('controls-report.csv');
    expect(table.header).toEqual(['Control', 'Framework', 'Status', 'Evidence', 'Reviewed']);
    expect(table.rows).toHaveLength(11);
    expect(table.rows[0]).toEqual(['NCA-AC-01 Access is limited by role and zone', 'NCA', 'Evidenced', 'Role matrix reviewed with the Administrator.', expect.stringMatching(/2026/)]);
    expect(await screen.findByText('Controls report exported')).toBeTruthy();
  });

  it('ignores a value that is not on its allow-list: the Sessions tab shows and nothing is filtered or opened', async () => {
    await renderScreen({ search: { tab: 'evil', framework: 'GDPR', status: 'gone', control: '../x', grant: 'maybe', page: '-2' } });
    expect(screen.getAllByRole('tab')[0]?.getAttribute('aria-selected')).toBe('true');
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('Security and Compliance: the Sessions tab', () => {
  it('shows the three session fields with their units, the MFA switch, the data residency and Save with Reset', async () => {
    await renderScreen();
    expect((screen.getByLabelText('Session length') as HTMLInputElement).value).toBe('480');
    expect((screen.getByLabelText('Idle timeout') as HTMLInputElement).value).toBe('30');
    expect((screen.getByLabelText('Sessions per person') as HTMLInputElement).value).toBe('3');
    expect(screen.getAllByText('min').length).toBe(2);
    expect(screen.getByRole('switch', { name: /Require MFA claim/ }).getAttribute('aria-checked')).toBe('false');
    expect(screen.getByText('Where data lives')).toBeTruthy();
    expect(screen.getByText('Update check only')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Save' }).getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByRole('button', { name: 'Reset' })).toBeTruthy();
    expect(screen.getByText('No changes to save')).toBeTruthy();
  });

  it('saves the changed policy in one action and says so; Reset puts the fields back', async () => {
    mocked('saveSessionPolicy').mockResolvedValue({ ok: true, data: { lengthMinutes: 240, idleMinutes: 20, perPerson: 2 } });
    await renderScreen();
    fireEvent.change(screen.getByLabelText('Session length'), { target: { value: '240' } });
    fireEvent.change(screen.getByLabelText('Idle timeout'), { target: { value: '20' } });
    fireEvent.change(screen.getByLabelText('Sessions per person'), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(mocked('saveSessionPolicy')).toHaveBeenCalledWith({ session_length_minutes: 240, idle_timeout_minutes: 20, max_concurrent_sessions: 2 }));
    expect(await screen.findByText('Session policy saved')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Session length'), { target: { value: '60' } });
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
    expect((screen.getByLabelText('Session length') as HTMLInputElement).value).toBe('480');
  });

  it('shows "Idle timeout is longer than the session" and keeps Save unavailable; and refuses numbers out of range', async () => {
    await renderScreen();
    fireEvent.change(screen.getByLabelText('Idle timeout'), { target: { value: '500' } });
    expect(screen.getAllByText('Idle timeout is longer than the session').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Save' }).getAttribute('aria-disabled')).toBe('true');
    fireEvent.change(screen.getByLabelText('Idle timeout'), { target: { value: '30' } });
    for (const bad of ['4', '1441', '', '1.5']) {
      fireEvent.change(screen.getByLabelText('Session length'), { target: { value: bad } });
      expect(screen.getByRole('button', { name: 'Save' }).getAttribute('aria-disabled'), bad).toBe('true');
    }
    expect(mocked('saveSessionPolicy')).not.toHaveBeenCalled();
  });

  it('switches the MFA claim at once through its own action, and says so', async () => {
    mocked('setMfaClaim').mockResolvedValue({ ok: true, data: { required: true } });
    await renderScreen();
    fireEvent.click(screen.getByRole('switch', { name: /Require MFA claim/ }));
    await waitFor(() => expect(mocked('setMfaClaim')).toHaveBeenCalledWith({ required: true }));
    expect(await screen.findByText('MFA claim is now required')).toBeTruthy();
  });

  it('disables the MFA switch with the Identity module\'s reason in a shared install, where the Sign-in policy is read only', async () => {
    await renderScreen({ mode: 'shared' });
    const mfa = screen.getByRole('switch', { name: /Require MFA claim/ });
    expect(mfa.hasAttribute('disabled')).toBe(true);
    fireEvent.click(mfa);
    expect(mocked('setMfaClaim')).not.toHaveBeenCalled();
    // the session fields stay editable: the Security module is editable there
    expect((screen.getByLabelText('Session length') as HTMLInputElement).disabled).toBe(false);
  });
});

describe('Security and Compliance: the Controls tab', () => {
  it('lists the eleven controls with the six columns of the mockup, framework tags, status pills, notes and review dates', async () => {
    await renderScreen({ search: { tab: 'controls' } });
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Control', 'Framework', 'Status', 'Evidence', 'Reviewed', 'Actions']);
    expect(bodyRows()).toHaveLength(11);
    const first = bodyRows()[0] as HTMLElement;
    expect(within(first).getByText('Access is limited by role and zone')).toBeTruthy();
    expect(within(first).getByText('NCA-AC-01')).toBeTruthy();
    expect(within(first).getByText('NCA')).toBeTruthy();
    expect(within(first).getByText('Evidenced')).toBeTruthy();
    expect(within(first).getByText('Role matrix reviewed with the Administrator.')).toBeTruthy();
    expect(within(first).getByRole('button', { name: 'Upload evidence' })).toBeTruthy();
    const ir = bodyRows().find((row) => row.textContent?.includes('NCA-IR-01')) as HTMLElement;
    expect(within(ir).getByText('Not started')).toBeTruthy();
    expect(within(ir).getByText('None')).toBeTruthy();
    expect(within(bodyRows().at(-1) as HTMLElement).getByText('Other')).toBeTruthy();
  });

  it('filters through the address: ?q=, ?framework= and ?status=, shown as chips, and says "No matching controls" with Clear all', async () => {
    await renderScreen({ search: { tab: 'controls', framework: 'PDPL', status: 'in_progress' } });
    expect(bodyRows()).toHaveLength(1);
    expect(screen.getByText('Framework: PDPL')).toBeTruthy();
    expect(screen.getByText('Status: In progress')).toBeTruthy();
    cleanup();
    await renderScreen({ search: { tab: 'controls', q: 'zzz' } });
    expect(screen.getByText('No matching controls')).toBeTruthy();
    expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('zzz');
  });

  it('opens the evidence drawer through ?control= when a row is pressed (a push), also from the header and from the row\'s own button', async () => {
    await renderScreen({ search: { tab: 'controls' } });
    fireEvent.click(bodyRows()[0] as HTMLElement);
    expect(env.navigate.mock.calls[0]?.[0]).toMatch(/^\/admin\/security-compliance\?tab=controls&control=[0-9a-f-]{36}$/);
    fireEvent.click(within(bodyRows()[1] as HTMLElement).getByRole('button', { name: 'Upload evidence' }));
    expect(env.router.push).toHaveBeenLastCalledWith(expect.stringMatching(/control=[0-9a-f-]{36}/));
    fireEvent.click(screen.getAllByRole('button', { name: 'Upload evidence' })[0] as HTMLElement);
    expect(env.router.push).toHaveBeenCalledTimes(2);
  });
});

describe('Security and Compliance: the evidence drawer', () => {
  it('opens on first paint for ?control=: the control chosen, its status and note, the file drop with its limits, and the Demo tag', async () => {
    const id = await idOfRow('NCA-CR-01');
    await renderScreen({ search: { tab: 'controls', control: id } });
    const drawer = dialog();
    expect(drawer.getAttribute('aria-label') ?? drawer.textContent).toContain('Upload evidence');
    expect(drawer.textContent).toContain('NCA-CR-01');
    expect((within(drawer).getByLabelText('Control') as HTMLSelectElement).value).toBe(id);
    expect([...(within(drawer).getByLabelText('Control') as HTMLSelectElement).options]).toHaveLength(11);
    expect((within(drawer).getByLabelText('Status') as HTMLSelectElement).value).toBe('in_progress');
    expect((within(drawer).getByLabelText('Evidence') as HTMLTextAreaElement).value).toBe('Waiting for the customer cluster settings.');
    expect(within(drawer).getByText('PDF, DOCX or PNG, up to 10 MB')).toBeTruthy();
    expect(drawer.querySelector('[data-stub="demo"]')).not.toBeNull();
    expect(drawer.querySelector('input[type="file"]')?.getAttribute('accept')).toBe('.pdf,.docx,.png');
  });

  it('changes control through the address when the Control select changes (a replace)', async () => {
    const id = await idOfRow('NCA-CR-01');
    await renderScreen({ search: { tab: 'controls', control: id } });
    const other = ([...(within(dialog()).getByLabelText('Control') as HTMLSelectElement).options].find((o) => o.value !== id) as HTMLOptionElement).value;
    fireEvent.change(within(dialog()).getByLabelText('Control'), { target: { value: other } });
    expect(env.router.replace).toHaveBeenCalledWith(`/admin/security-compliance?tab=controls&control=${other}`, { scroll: false });
  });

  it('saves the status and the note only, says so, and closes', async () => {
    const id = await idOfRow('NCA-IR-01');
    mocked('saveEvidence').mockResolvedValue({ ok: true, data: { ref: 'NCA-IR-01', status: 'evidenced' } });
    await renderScreen({ search: { tab: 'controls', control: id } });
    fireEvent.change(within(dialog()).getByLabelText('Status'), { target: { value: 'evidenced' } });
    fireEvent.change(within(dialog()).getByLabelText('Evidence'), { target: { value: '  Contact recorded.  ' } });
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(mocked('saveEvidence')).toHaveBeenCalledWith({ controlId: id, status: 'evidenced', evidence_note: 'Contact recorded.' }));
    expect(await screen.findByText('Evidence saved')).toBeTruthy();
    expect(env.router.replace).toHaveBeenCalledWith('/admin/security-compliance?tab=controls', { scroll: false });
  });

  it('takes a PDF, DOCX or PNG within 10 MB into the list and says the file is not stored, and sends no file to the action', async () => {
    const id = await idOfRow('NCA-IR-01');
    mocked('saveEvidence').mockResolvedValue({ ok: true, data: { ref: 'NCA-IR-01', status: 'evidenced' } });
    await renderScreen({ search: { tab: 'controls', control: id } });
    const input = dialog().querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file('role-matrix-review.pdf', 2048, 'application/pdf')] } });
    expect(await within(dialog()).findByText('role-matrix-review.pdf')).toBeTruthy();
    expect(within(dialog()).getByText('Files are not stored in this demo: only the status and the note are saved.')).toBeTruthy();
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(mocked('saveEvidence')).toHaveBeenCalledTimes(1));
    expect(Object.keys(mocked('saveEvidence').mock.calls[0]?.[0] as object).sort()).toEqual(['controlId', 'evidence_note', 'status']);
  });

  it('rejects a wrong file type out loud, in the drop area, and does not take it', async () => {
    const id = await idOfRow('NCA-IR-01');
    await renderScreen({ search: { tab: 'controls', control: id } });
    fireEvent.change(dialog().querySelector('input[type="file"]') as HTMLInputElement, { target: { files: [file('evidence-scan.zip', 100, 'application/zip')] } });
    const alert = await within(dialog()).findByRole('alert');
    expect(alert.textContent).toContain('evidence-scan.zip is not an accepted file type.');
    expect(within(dialog()).queryByText('Files are not stored in this demo: only the status and the note are saved.')).toBeNull();
  });

  it('rejects a file over 10 MB out loud, naming the limit', async () => {
    const id = await idOfRow('NCA-IR-01');
    await renderScreen({ search: { tab: 'controls', control: id } });
    fireEvent.change(dialog().querySelector('input[type="file"]') as HTMLInputElement, { target: { files: [file('nca-controls-2026-full.pdf', 10 * 1024 * 1024 + 1, 'application/pdf')] } });
    const alert = await within(dialog()).findByRole('alert');
    expect(alert.textContent).toContain('nca-controls-2026-full.pdf is larger than 10 MB.');
  });

  it('keeps the drawer open and shows the data layer\'s refusal with its English detail marked as English', async () => {
    const id = await idOfRow('NCA-IR-01');
    mocked('saveEvidence').mockResolvedValue({ ok: false, code: 'invalid', message: 'Control evidence: evidence_note must have at most 1000 characters.' });
    await renderScreen({ search: { tab: 'controls', control: id } });
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Save' }));
    const alert = await within(dialog()).findByRole('alert');
    expect(alert.querySelector('[lang="en"]')?.textContent).toContain('evidence_note');
  });

  it('asks for a shorter note before asking the server', async () => {
    const id = await idOfRow('NCA-IR-01');
    await renderScreen({ search: { tab: 'controls', control: id } });
    fireEvent.change(within(dialog()).getByLabelText('Evidence'), { target: { value: 'x'.repeat(1001) } });
    expect(within(dialog()).getByRole('button', { name: 'Save' }).getAttribute('aria-disabled')).toBe('true');
    expect(within(dialog()).getAllByText('The note is too long (at most 1,000 characters)').length).toBeGreaterThan(0);
  });

  it('shows an inline notice and no drawer for a control that does not exist', async () => {
    await renderScreen({ search: { tab: 'controls', control: '00000000-0000-4000-8000-00000000dead' } });
    expect(screen.getByRole('alert').textContent).toContain('That control could not be found.');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(bodyRows()).toHaveLength(11);
  });
});

describe('Security and Compliance: the Support access tab', () => {
  it('shows the access log with the seeded grant, and the setting: off by default, the longest grant and Grant access unavailable with the reason', async () => {
    await renderScreen({ search: { tab: 'support' } });
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Started', 'Duration', 'Granted by', 'Status', 'Actions']);
    expect(bodyRows()).toHaveLength(1);
    const row = bodyRows()[0] as HTMLElement;
    expect(within(row).getByText('20 Aug 2026')).toBeTruthy();
    expect(within(row).getByText('10:00 - 12:00')).toBeTruthy();
    expect(within(row).getByText('Nadia Al-Ghalani')).toBeTruthy();
    expect(within(row).getByText('Ended')).toBeTruthy();
    expect(within(row).queryByRole('button', { name: 'End now' })).toBeNull();
    expect(screen.getByRole('switch', { name: /Allow support access/ }).getAttribute('aria-checked')).toBe('false');
    expect(screen.getByText('Off by default.')).toBeTruthy();
    expect((screen.getByLabelText('Longest grant') as HTMLInputElement).value).toBe('8');
    expect(isDisabled(screen.getByRole('button', { name: 'Grant access' }))).toBe(true);
  });

  it('switches support access on at once and warns; the longest grant saves through its own Save when changed', async () => {
    mocked('saveSupportSetting').mockResolvedValueOnce({ ok: true, data: { enabled: true, maxHours: 8 } }).mockResolvedValueOnce({ ok: true, data: { enabled: false, maxHours: 12 } });
    await renderScreen({ search: { tab: 'support' } });
    fireEvent.click(screen.getByRole('switch', { name: /Allow support access/ }));
    await waitFor(() => expect(mocked('saveSupportSetting')).toHaveBeenCalledWith({ enabled: true, max_duration_hours: 8 }));
    expect(await screen.findByText('Support access switched on')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
    fireEvent.change(screen.getByLabelText('Longest grant'), { target: { value: '12' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(mocked('saveSupportSetting')).toHaveBeenLastCalledWith({ enabled: false, max_duration_hours: 12 }));
    expect(await screen.findByText('Longest grant saved')).toBeTruthy();
  });

  it('refuses a longest grant that is not whole hours from 1 to 72 before asking the server', async () => {
    await renderScreen({ search: { tab: 'support' } });
    for (const bad of ['0', '73', '', '1.5']) {
      fireEvent.change(screen.getByLabelText('Longest grant'), { target: { value: bad } });
      const save = screen.queryByRole('button', { name: 'Save' });
      if (save !== null) expect(save.getAttribute('aria-disabled'), bad).toBe('true');
    }
    expect(mocked('saveSupportSetting')).not.toHaveBeenCalled();
  });
});

describe('Security and Compliance: grant and end support access', () => {
  // The setting is on in the store: the action is stood in for, so it is set through the data layer directly.
  async function withSupportOn() {
    const { updateSupportAccessSetting } = await import('@/lib/data/system');
    await updateSupportAccessSetting(ctxOf('administrator'), { enabled: true, max_duration_hours: 8 });
  }

  it('opens Grant access from the button (a push) and shows the dialog on ?grant=1: a duration up to the longest grant, a reason, and what is missing', async () => {
    await withSupportOn();
    await renderScreen({ search: { tab: 'support' } });
    const grant = screen.getByRole('button', { name: 'Grant access' });
    expect(isDisabled(grant)).toBe(false);
    fireEvent.click(grant);
    expect(env.router.push).toHaveBeenCalledWith('/admin/security-compliance?tab=support&grant=1');
    cleanup();
    await renderScreen({ search: { tab: 'support', grant: '1' } });
    const modal = screen.getByRole('dialog', { name: 'Grant access' });
    expect(within(modal).getByText('Time limited. Ends by itself.')).toBeTruthy();
    expect((within(modal).getByLabelText(/Duration/) as HTMLInputElement).value).toBe('2');
    expect((within(modal).getByLabelText(/Duration/) as HTMLInputElement).max).toBe('8');
    expect(within(modal).getAllByText('Write a reason').length).toBeGreaterThan(0);
    expect(within(modal).getByRole('button', { name: 'Grant access' }).getAttribute('aria-disabled')).toBe('true');
  });

  it('does not open the dialog while support access is off', async () => {
    await renderScreen({ search: { tab: 'support', grant: '1' } });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('grants with the hours and the reason the person wrote, says so with a warning, and closes', async () => {
    await withSupportOn();
    mocked('grantSupport').mockResolvedValue({ ok: true, data: { hours: 3 } });
    await renderScreen({ search: { tab: 'support', grant: '1' } });
    const modal = screen.getByRole('dialog', { name: 'Grant access' });
    fireEvent.change(within(modal).getByLabelText(/Duration/), { target: { value: '3' } });
    fireEvent.change(within(modal).getByLabelText(/Reason/), { target: { value: '  Investigating a feed.  ' } });
    fireEvent.click(within(modal).getByRole('button', { name: 'Grant access' }));
    await waitFor(() => expect(mocked('grantSupport')).toHaveBeenCalledWith({ hours: 3, reason: 'Investigating a feed.' }));
    expect(await screen.findByText('Support access granted for 3 h')).toBeTruthy();
    expect(env.router.replace).toHaveBeenCalledWith('/admin/security-compliance?tab=support', { scroll: false });
  });

  it('asks for hours from 1 to the longest grant before asking the server', async () => {
    await withSupportOn();
    await renderScreen({ search: { tab: 'support', grant: '1' } });
    const modal = screen.getByRole('dialog', { name: 'Grant access' });
    fireEvent.change(within(modal).getByLabelText(/Reason/), { target: { value: 'x' } });
    fireEvent.change(within(modal).getByLabelText(/Duration/), { target: { value: '9' } });
    expect(within(modal).getAllByText('Choose from 1 to 8 hours').length).toBeGreaterThan(0);
    expect(within(modal).getByRole('button', { name: 'Grant access' }).getAttribute('aria-disabled')).toBe('true');
  });

  it('shows an open grant in the warning tone with End now, disables Grant access with the reason, and ends it on request', async () => {
    await withSupportOn();
    const { grantSupportAccess } = await import('@/lib/data/system');
    await grantSupportAccess(ctxOf('administrator'), { hours: 2, reason: 'Investigating.' });
    mocked('endSupport').mockResolvedValue({ ok: true, data: { ended: true } });
    await renderScreen({ search: { tab: 'support' } });
    const active = bodyRows().find((row) => row.textContent?.includes('Active')) as HTMLElement;
    expect(active).toBeTruthy();
    expect(isDisabled(screen.getByRole('button', { name: 'Grant access' }))).toBe(true);
    fireEvent.click(within(active).getByRole('button', { name: 'End now' }));
    await waitFor(() => expect(mocked('endSupport')).toHaveBeenCalledWith({ grantId: expect.stringMatching(/^[0-9a-f-]{36}$/) }));
    expect(await screen.findByText('Support access ended')).toBeTruthy();
  });
});

describe('Security and Compliance: a role without edit access (view only)', () => {
  it('says View only and shows every writing control disabled with the reason', async () => {
    const { container } = await renderScreen({ access: 'view' });
    expect(root(container)?.getAttribute('data-access')).toBe('view');
    expect(screen.getByText('View only')).toBeTruthy();
    expect(isDisabled(screen.getByRole('button', { name: 'Upload evidence' }))).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Upload evidence' }));
    expect(env.router.push).not.toHaveBeenCalled();
    for (const field of ['Session length', 'Idle timeout', 'Sessions per person']) expect((screen.getByLabelText(field) as HTMLInputElement).disabled, field).toBe(true);
    expect(screen.getByRole('switch', { name: /Require MFA claim/ }).hasAttribute('disabled')).toBe(true);
    expect(isDisabled(screen.getByRole('button', { name: 'Save' }))).toBe(true);
    expect(screen.getAllByText('View only for this role').length).toBeGreaterThan(0);
  });

  it('keeps the evidence drawer readable with Save disabled, and the support tab with every control disabled', async () => {
    const id = await idOfRow('NCA-CR-01');
    await renderScreen({ access: 'view', search: { tab: 'controls', control: id } });
    expect((within(dialog()).getByLabelText('Status') as HTMLSelectElement).disabled).toBe(true);
    expect(isDisabled(within(dialog()).getByRole('button', { name: 'Save' }))).toBe(true);
    cleanup();
    await renderScreen({ access: 'view', search: { tab: 'support' } });
    expect(screen.getByRole('switch', { name: /Allow support access/ }).hasAttribute('disabled')).toBe(true);
    expect((screen.getByLabelText('Longest grant') as HTMLInputElement).disabled).toBe(true);
    expect(isDisabled(screen.getByRole('button', { name: 'Grant access' }))).toBe(true);
  });
});

describe('Security and Compliance: the states', () => {
  it('empty: the module\'s own text and Load control list (a refresh, since the list is always present in demo mode)', async () => {
    const { container } = await renderScreen({ state: 'empty' });
    expect(root(container)?.getAttribute('data-state')).toBe('empty');
    expect(screen.getByText('No controls yet')).toBeTruthy();
    expect(screen.getByText('Add NCA and PDPL controls to track evidence.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Load control list' }));
    expect(env.router.refresh).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('Control list loaded')).toBeTruthy();
    expect(screen.queryByRole('tab')).toBeNull();
  });

  it('empty for a view-only role: the action is disabled with its reason next to it', async () => {
    await renderScreen({ state: 'empty', access: 'view' });
    expect(isDisabled(screen.getByRole('button', { name: 'Load control list' }))).toBe(true);
    expect(screen.getAllByText('View only for this role').length).toBeGreaterThan(0);
  });

  it('loading: skeletons, announced once, the header kept', async () => {
    const { container } = await renderScreen({ state: 'loading' });
    expect(root(container)?.getAttribute('data-state')).toBe('loading');
    expect(screen.getAllByText('Loading')).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Security and Compliance');
  });

  it('error: "The controls could not load." as an alert with Try again', async () => {
    const { container } = await renderScreen({ state: 'error' });
    expect(root(container)?.getAttribute('data-state')).toBe('error');
    expect(screen.getByRole('alert').textContent).toContain('The controls could not load.');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });
});

describe('Security and Compliance in Arabic', () => {
  // Names, control references, the data layer's English notes and the server's English detail are data (translate="no" / lang="en").
  const untranslated = (container: HTMLElement) => {
    const clone = container.cloneNode(true) as HTMLElement;
    for (const node of clone.querySelectorAll('[translate="no"], [lang="en"]')) node.remove();
    const attributes = [...clone.querySelectorAll('[aria-label], [title], [placeholder]')].flatMap((el) => [el.getAttribute('aria-label') ?? '', el.getAttribute('title') ?? '', el.getAttribute('placeholder') ?? '']);
    return `${clone.textContent ?? ''} ${attributes.join(' ')}`.replace(/\b(OpenDispatch|MFA|NCA|PDPL|PDF|DOCX|PNG|MB)\b/g, ' ');
  };
  const leftovers = (container: HTMLElement) => untranslated(container).match(/[A-Za-z]{2,}/g)?.join(',') ?? '';

  it('draws every tab in Arabic with no English left over outside the data, in Western digits', async () => {
    for (const tab of ['sessions', 'controls', 'support']) {
      const { container } = await renderScreen({ locale: 'ar', search: { tab } });
      expect(leftovers(container), tab).toBe('');
      expect(/[٠-٩]/.test(container.textContent ?? ''), tab).toBe(false);
      cleanup();
    }
    await renderScreen({ locale: 'ar' });
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('الأمن والامتثال');
    expect(screen.getAllByRole('tab')).toHaveLength(3);
  });

  it('translates the seeded control titles into Arabic and marks a control the map does not know as English', async () => {
    await renderScreen({ locale: 'ar', search: { tab: 'controls' } });
    expect(screen.getByText('يقتصر الوصول على الدور والمنطقة')).toBeTruthy();
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['الضابط', 'الإطار', 'الحالة', 'الدليل', 'تاريخ المراجعة', 'الإجراءات']);
  });

  it('draws the evidence drawer, the rejected-file messages and the grant dialog in Arabic with no English left over', async () => {
    const id = await idOfRow('NCA-IR-01');
    await renderScreen({ locale: 'ar', search: { tab: 'controls', control: id } });
    expect(leftovers(dialog())).toBe('');
    fireEvent.change(dialog().querySelector('input[type="file"]') as HTMLInputElement, { target: { files: [file('scan.zip', 100)] } });
    const alert = await within(dialog()).findByRole('alert');
    expect(hasLatinLetters(alert.textContent?.replace('scan.zip', '') ?? '', [])).toBe(false);
    cleanup();
    const { updateSupportAccessSetting } = await import('@/lib/data/system');
    await updateSupportAccessSetting(ctxOf('administrator'), { enabled: true, max_duration_hours: 8 });
    await renderScreen({ locale: 'ar', search: { tab: 'support', grant: '1' } });
    expect(leftovers(dialog())).toBe('');
  });

  it('draws the states in Arabic', async () => {
    await renderScreen({ locale: 'ar', state: 'error' });
    expect(screen.getByText('تعذّر تحميل الضوابط.')).toBeTruthy();
  });
});
