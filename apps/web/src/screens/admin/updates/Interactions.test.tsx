// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment jsdom
import { DesignSystemProvider } from '@opendispatch/ui';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { inLocale } from '@/components/opendispatch/test-utils';
import { getModule, moduleAccess, type InstallMode, type Role } from '@/lib/access';
import { buildContext, fixtureTenantId } from '@/lib/data/go-test-reset';
import type { RequestContext } from '@/lib/data/guard';
import { fixtureUsers, resetGoTestState, syncGoClock } from '@/lib/data/go-test-reset';
import { applyUpdate, approveUpdate, confirmUpdateBackup, getUpdateChangeWindows, requestUpdateRecovery, runUpdatePreflight, scheduleUpdate, startUpdateDownload, updateUpdateConnection, updateUpdateChangeWindows } from '@/lib/data/updates';
import type { ScreenProps, SearchParams } from '@/screens/types';
import * as actions from './actions';
import { UpdatesScreen } from './Screen';

// What the buttons of the Updates screen send to the server actions, and what the screen does with the answer. The actions are
// stood in for (each returns what the real one returns); the data layer behind the screen is real. Every call is checked to carry
// only what a person typed or picked: a version, a note, a window, a second approver: never a role, a user or an install mode.

const env = vi.hoisted(() => ({ locale: 'en' as 'en' | 'ar', query: '', router: { push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }, navigate: vi.fn() }));

vi.mock('next-intl/server', async () => {
  const { createTranslator } = await import('next-intl');
  const { loadMessages } = await import('@/i18n/messages');
  return { getTranslations: async (namespace?: string) => createTranslator({ locale: env.locale, messages: loadMessages(env.locale, 'admin.updates'), ...(namespace === undefined ? {} : { namespace }) }) };
});
vi.mock('@/i18n/navigation', () => ({ usePathname: () => '/admin/updates', useRouter: () => env.router }));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams(env.query) }));
vi.mock('./actions', () => ({
  checkNow: vi.fn(), downloadRelease: vi.fn(), runPreflight: vi.fn(), confirmBackup: vi.fn(), scheduleRelease: vi.fn(), cancelSchedule: vi.fn(), approveRelease: vi.fn(), rejectRelease: vi.fn(), applyRelease: vi.fn(),
  skipRelease: vi.fn(), emergencyOverride: vi.fn(), recoverUpdate: vi.fn(), saveSettings: vi.fn(), changeMode: vi.fn(), saveProxy: vi.fn(), testConnection: vi.fn(), uploadUpdateFile: vi.fn(), saveRecurring: vi.fn(),
  addBlackout: vi.fn(), removeBlackout: vi.fn(), setSecondApprover: vi.fn(),
}));

const T0 = '2026-09-13T10:00:00+03:00';

beforeEach(async () => {
  await resetGoTestState();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(T0));
  await syncGoClock();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  for (const mock of Object.values(actions)) if (vi.isMockFunction(mock)) mock.mockReset();
  for (const mock of [env.router.replace, env.router.push, env.router.refresh, env.navigate]) mock.mockReset();
});

function ctxOf(role: Role, installMode: InstallMode = 'private'): RequestContext {
  const tenant = fixtureTenantId();
  const built = buildContext({ role, installMode, zoneIds: [] }, fixtureUsers(), tenant);
  if (built === null) throw new Error(`no context for ${role}`);
  return built;
}
const at = async (seconds: number) => {
  vi.setSystemTime(new Date(Date.parse(T0) + seconds * 1000));
  await syncGoClock();
};
const admin = () => ctxOf('administrator');
const approver = () => ctxOf('change_approver');
async function toReady(version: string) {
  await startUpdateDownload(admin(), version);
  await at(7);
  await runUpdatePreflight(admin(), version);
  await confirmUpdateBackup(admin(), version, {});
}
async function toApproved(version: string) {
  await toReady(version);
  await scheduleUpdate(admin(), version, {});
  await approveUpdate(approver(), version, {});
}

interface Options { locale?: 'en' | 'ar'; role?: Role; search?: SearchParams }
async function renderScreen({ locale = 'en', role = 'administrator', search = {} }: Options = {}) {
  env.locale = locale;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(search)) if (typeof value === 'string') params.set(key, value);
  env.query = params.toString();
  const props: ScreenProps = { def: getModule('admin.updates'), ctx: ctxOf(role), access: moduleAccess(role, 'admin.updates', 'private'), locale, homeHref: '/admin/updates', state: undefined, searchParams: search };
  const element = await UpdatesScreen(props);
  return inLocale(locale, <DesignSystemProvider navigate={env.navigate}>{element}</DesignSystemProvider>, { module: 'admin.updates' });
}

const ok = <T,>(data: T) => ({ ok: true as const, data });
const fail = (code: 'invalid' | 'conflict' | 'forbidden', message: string) => ({ ok: false as const, code, message });
const click = (name: string | RegExp) => fireEvent.click(screen.getByRole('button', { name }));
const mockOf = <T extends (...args: never[]) => unknown>(fn: T) => vi.mocked(fn);
const FORBIDDEN = /"(role|customer|tenant|user|userId|installMode|install_mode|zoneScope|ctx)"/;
const sent = (mock: ReturnType<typeof vi.fn>) => JSON.stringify(mock.mock.calls);

describe('the release card sends only what a person chose', () => {
  it('Download sends the version of the card; a refusal stays inline with its translated line and the English detail', async () => {
    mockOf(actions.downloadRelease).mockResolvedValue(fail('conflict', 'Release 1.2.0 is downloading.'));
    await renderScreen();
    click('Download');
    await waitFor(() => expect(actions.downloadRelease).toHaveBeenCalledWith({ version: '1.2.0' }));
    expect(await screen.findByText('That is not possible in its current state.')).toBeTruthy();
    expect(screen.getByText('Release 1.2.0 is downloading.').getAttribute('lang')).toBe('en');
    expect(sent(actions.downloadRelease as never)).not.toMatch(FORBIDDEN);
  });

  it('Skip opens a dialog that needs a reason, then sends the version and the trimmed reason', async () => {
    mockOf(actions.skipRelease).mockResolvedValue(ok({ version: '1.2.0', state: 'skipped' }));
    await renderScreen();
    click('Skip');
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('button', { name: 'Skip' }).getAttribute('aria-disabled')).toBe('true');
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: '  Not this quarter  ' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Skip' }));
    await waitFor(() => expect(actions.skipRelease).toHaveBeenCalledWith({ version: '1.2.0', reason: 'Not this quarter' }));
  });

  it('a verified release: Run pre-flight checks sends the version; a pre-flight waiting for the backup shows Confirm backup, which sends it', async () => {
    await startUpdateDownload(admin(), '1.2.0');
    await at(7);
    mockOf(actions.runPreflight).mockResolvedValue(ok({ version: '1.2.0', state: 'failed' }));
    await renderScreen();
    click('Run pre-flight checks');
    await waitFor(() => expect(actions.runPreflight).toHaveBeenCalledWith({ version: '1.2.0' }));
    cleanup();
    await runUpdatePreflight(admin(), '1.2.0');
    mockOf(actions.confirmBackup).mockResolvedValue(ok({ version: '1.2.0', state: 'passed' }));
    await renderScreen();
    click('Confirm backup');
    await waitFor(() => expect(actions.confirmBackup).toHaveBeenCalledWith({ version: '1.2.0' }));
  });

  it('Schedule lists the open windows, names who must approve, and sends the version and the chosen window start', async () => {
    await toReady('1.2.0');
    mockOf(actions.scheduleRelease).mockResolvedValue(ok({ version: '1.2.0', state: 'awaiting_approval', windowStart: '2026-09-14T03:00:00+03:00', windowEnd: '2026-09-14T05:00:00+03:00' }));
    await renderScreen();
    click('Schedule');
    const dialog = screen.getByRole('dialog');
    const radios = within(dialog).getAllByRole('radio');
    expect(radios.length).toBe(5);
    expect(within(dialog).getByText(/Needs approval from Saad Al-Nabari/)).toBeTruthy();
    fireEvent.click(radios[1] as HTMLElement);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Schedule' }));
    await waitFor(() => expect(actions.scheduleRelease).toHaveBeenCalledTimes(1));
    const call = mockOf(actions.scheduleRelease).mock.calls[0]?.[0];
    expect(call?.version).toBe('1.2.0');
    expect(call?.window_start).toMatch(/^2026-09-\d\dT03:00:00\+03:00$/);
    expect(sent(actions.scheduleRelease as never)).not.toMatch(FORBIDDEN);
  });

  it('Apply now shows the pre-flight that passed, then the run the agent returned: nine steps and the result, with Done', async () => {
    await toApproved('1.2.0');
    const run = await applyUpdate(admin(), '1.2.0');
    // The screen was rendered before the apply in the real flow; here the run is what the action answers with.
    const steps = run.steps.map((s) => ({ name: s.name, state: s.state, message: s.message ?? null }));
    mockOf(actions.applyRelease).mockResolvedValue(ok({ run: { runId: run.run_id, version: '1.2.0', kind: 'update', state: 'succeeded', startedAt: run.started_at, finishedAt: run.finished_at ?? null, maintenanceOn: false, steps } }));
    // Render an approved release again: the data layer has already applied it, so build a second store for the approved view.
    await resetGoTestState();
    await at(0);
    await toApproved('1.2.0');
    await renderScreen();
    click('Apply now');
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Apply 1.2.0')).toBeTruthy();
    expect(within(dialog).getAllByText('Passed').length).toBe(6);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Apply now' }));
    await waitFor(() => expect(actions.applyRelease).toHaveBeenCalledWith({ version: '1.2.0' }));
    expect(await within(dialog).findByText('Update applied')).toBeTruthy();
    expect(within(dialog).getAllByRole('listitem')).toHaveLength(9);
    expect(within(dialog).getByRole('button', { name: 'Done' })).toBeTruthy();
  });

  it('Approve and Reject send the version and an empty note for the Change Approver; Cancel schedule sends the version for the Administrator', async () => {
    await toReady('1.2.0');
    await scheduleUpdate(admin(), '1.2.0', {});
    mockOf(actions.approveRelease).mockResolvedValue(ok({ version: '1.2.0', state: 'approved', windowStart: 'a', windowEnd: 'b' }));
    mockOf(actions.rejectRelease).mockResolvedValue(ok({ version: '1.2.0', state: 'rejected', windowStart: 'a', windowEnd: 'b' }));
    mockOf(actions.cancelSchedule).mockResolvedValue(ok({ version: '1.2.0', state: 'ready' }));
    await renderScreen({ role: 'change_approver' });
    click('Approve');
    await waitFor(() => expect(actions.approveRelease).toHaveBeenCalledWith({ version: '1.2.0', note: '' }));
    click('Reject');
    await waitFor(() => expect(actions.rejectRelease).toHaveBeenCalledWith({ version: '1.2.0', note: '' }));
    click('Cancel schedule');
    expect(actions.cancelSchedule).not.toHaveBeenCalled();
    cleanup();
    await renderScreen();
    click('Cancel schedule');
    await waitFor(() => expect(actions.cancelSchedule).toHaveBeenCalledWith({ version: '1.2.0' }));
  });

  it('a view-only click on a disabled control does nothing: no action is called', async () => {
    await renderScreen({ role: 'change_approver' });
    click('Download');
    click('Skip');
    click('Check now');
    expect(actions.downloadRelease).not.toHaveBeenCalled();
    expect(actions.checkNow).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('the header', () => {
  it('Check now calls checkNow and says what it found', async () => {
    mockOf(actions.checkNow).mockResolvedValue(ok({ result: 'update_found', version: '1.2.0' }));
    await renderScreen();
    click('Check now');
    await waitFor(() => expect(actions.checkNow).toHaveBeenCalledWith());
    expect(await screen.findByText('Update found: 1.2.0')).toBeTruthy();
  });

  it('More has Upload update file (goes to the Connection tab) and Emergency override (opens its dialog); a viewer sees both disabled with the reason', async () => {
    await renderScreen();
    click('More');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Upload update file' }));
    expect(env.router.push).toHaveBeenCalledWith(expect.stringContaining('tab=connection'));
    cleanup();
    await renderScreen({ role: 'change_approver' });
    click('More');
    expect(screen.getByRole('menuitem', { name: 'Upload update file' }).getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByRole('menuitem', { name: 'Emergency override' }).getAttribute('aria-disabled')).toBe('true');
    expect(screen.getAllByText('View only for this role').length).toBeGreaterThan(0);
  });

  it('the emergency override needs a downloaded hotfix, a second approver and 20 characters; then it sends the version, the approver and the reason', async () => {
    await startUpdateDownload(admin(), '1.2.1');
    await at(7);
    mockOf(actions.emergencyOverride).mockResolvedValue(ok({ run: { runId: 'r', version: '1.2.1', kind: 'emergency', state: 'succeeded', startedAt: T0, finishedAt: T0, maintenanceOn: false, steps: [] } }));
    await renderScreen();
    click('More');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Emergency override' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('1.2.1 (hotfix)')).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Apply now' }).getAttribute('aria-disabled')).toBe('true');
    fireEvent.change(within(dialog).getAllByRole('textbox').at(-1) as HTMLElement, { target: { value: 'A gap calculation error hits live assignment.' } });
    expect(within(dialog).getByRole('button', { name: 'Apply now' }).getAttribute('aria-disabled')).toBeNull();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Apply now' }));
    await waitFor(() => expect(actions.emergencyOverride).toHaveBeenCalledTimes(1));
    const call = mockOf(actions.emergencyOverride).mock.calls[0]?.[0];
    expect(call).toMatchObject({ version: '1.2.1', reason: 'A gap calculation error hits live assignment.' });
    expect(call?.second_approver_user_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(sent(actions.emergencyOverride as never)).not.toMatch(FORBIDDEN);
  });

  it('with no release verified yet the emergency dialog says so and cannot be confirmed', async () => {
    await renderScreen();
    click('More');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Emergency override' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Download and verify a release first')).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Apply now' }).getAttribute('aria-disabled')).toBe('true');
  });
});

describe('recovery dialogs', () => {
  async function toNeedsAttention() {
    await toApproved('1.3.1');
    await applyUpdate(admin(), '1.3.1');
  }

  it('Resume confirms with a short summary, then sends the action and no note', async () => {
    await toNeedsAttention();
    mockOf(actions.recoverUpdate).mockResolvedValue(ok({ action: 'resume', state: 'started', run: null }));
    await renderScreen();
    click('Resume');
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Resume update 1.3.1?')).toBeTruthy();
    expect(within(dialog).getByText('Off when it finishes')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Resume' }));
    await waitFor(() => expect(actions.recoverUpdate).toHaveBeenCalledWith({ action: 'resume', note: '' }));
  });

  it('Restore is a danger dialog that names the backup and needs a reason, then sends the action and the reason', async () => {
    await toNeedsAttention();
    mockOf(actions.recoverUpdate).mockResolvedValue(ok({ action: 'restore', state: 'requested', run: null }));
    await renderScreen();
    click('Restore');
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Restore the backup from before 1.3.1?')).toBeTruthy();
    expect(within(dialog).getByText('backup-before-1.3.1')).toBeTruthy();
    expect(within(dialog).getByText('Your database team')).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Request restore' }).getAttribute('aria-disabled')).toBe('true');
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'The migration cannot be fixed today' } });
    expect(within(dialog).getByText('35 / 500')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Request restore' }));
    await waitFor(() => expect(actions.recoverUpdate).toHaveBeenCalledWith({ action: 'restore', note: 'The migration cannot be fixed today' }));
  });

  it('a restore request in progress locks Resume and Restore with the reason', async () => {
    await toNeedsAttention();
    await requestUpdateRecovery(admin(), { action: 'restore', note: 'x' });
    await at(11);
    await renderScreen();
    click('Resume');
    click('Restore');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(actions.recoverUpdate).not.toHaveBeenCalled();
  });
});

describe('the Connection tab', () => {
  it('switching to Offline sends the mode; Save on the proxy sends what was typed and nothing else', async () => {
    mockOf(actions.changeMode).mockResolvedValue(ok({ mode: 'offline' as const }));
    mockOf(actions.saveProxy).mockResolvedValue(ok({ enabled: true }));
    await renderScreen({ search: { tab: 'connection' } });
    fireEvent.click(screen.getByRole('radio', { name: 'Offline' }));
    await waitFor(() => expect(actions.changeMode).toHaveBeenCalledWith({ mode: 'offline' }));
    cleanup();
    await renderScreen({ search: { tab: 'connection' } });
    const address = screen.getByLabelText('Address') as HTMLInputElement;
    expect(address.disabled).toBe(true);
    fireEvent.click(screen.getByRole('switch', { name: 'Use a proxy' }));
    fireEvent.change(address, { target: { value: 'http://proxy.example.test:8080' } });
    fireEvent.change(screen.getByLabelText(/Username/), { target: { value: 'svc' } });
    fireEvent.change(screen.getByLabelText(/Password/), { target: { value: 'not-a-real-password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(actions.saveProxy).toHaveBeenCalledWith({ proxy_enabled: true, proxy_address: 'http://proxy.example.test:8080', proxy_username: 'svc', proxy_password: 'not-a-real-password', proxy_certificate: '' }));
  });

  it('an enabled proxy with no address cannot be saved and says why', async () => {
    await updateUpdateConnection(admin(), { mode: 'connected', proxy: { enabled: true, address: 'http://p.example:1', username: null } });
    await renderScreen({ search: { tab: 'connection' } });
    fireEvent.change(screen.getByLabelText('Address'), { target: { value: '' } });
    expect(screen.getAllByText('Enter the proxy address').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(actions.saveProxy).not.toHaveBeenCalled();
  });

  it('Test connection shows the five scripted steps and a Demo tag', async () => {
    mockOf(actions.testConnection).mockResolvedValue(ok({ ok: true, checkedAt: T0, steps: (['proxy', 'dns', 'tcp', 'tls', 'release_index_signature'] as const).map((name) => ({ name, ok: true, message: name === 'proxy' ? 'No proxy in use.' : null })) }));
    await renderScreen({ search: { tab: 'connection' } });
    click('Test connection');
    expect(await screen.findByText('Release index signature is valid')).toBeTruthy();
    expect(screen.getByText('No proxy in use')).toBeTruthy();
    expect(screen.getAllByText('OK').length).toBeGreaterThanOrEqual(5);
  });

  describe('offline: the update file', () => {
    beforeEach(async () => {
      await updateUpdateConnection(admin(), { mode: 'offline' });
    });
    const fileOf = (name: string, text: string) => Object.assign(new File([text], name), { text: async () => text });
    const drop = (container: HTMLElement, file: File) => fireEvent.change(container.querySelector('input[type="file"]') as HTMLInputElement, { target: { files: [file] } });

    it('reads the file in the browser and sends its text; an accepted file shows its checks, Verified, and Use this file', async () => {
      mockOf(actions.uploadUpdateFile).mockResolvedValue(ok({ accepted: true, version: '1.4.0', verification: { verified: true, signatureValid: true, digestsMatch: true, keyRevoked: false, olderThanInstalled: false, indexExpired: false, keyId: 'opendispatch-release-key-2026-01', message: 'ok' } }));
      const { container } = await renderScreen({ search: { tab: 'connection' } });
      drop(container, fileOf('opendispatch-1.4.0.update', 'opendispatch 1.4.0'));
      await waitFor(() => expect(actions.uploadUpdateFile).toHaveBeenCalledWith({ file: 'opendispatch 1.4.0' }));
      expect(await screen.findByText('Verified')).toBeTruthy();
      expect(screen.getByText('Not enforced offline')).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: 'Use this file' }));
      expect(env.router.push).toHaveBeenCalledWith(expect.stringContaining('release=1.4.0'));
    });

    it('a refused file shows the failed checks, the discarded alert with the English detail, and no Use this file', async () => {
      mockOf(actions.uploadUpdateFile).mockResolvedValue(ok({ accepted: false, version: null, verification: { verified: false, signatureValid: false, digestsMatch: false, keyRevoked: false, olderThanInstalled: false, indexExpired: false, keyId: null, message: 'The signature or an image digest does not match. The file was discarded.' } }));
      const { container } = await renderScreen({ search: { tab: 'connection' } });
      drop(container, fileOf('opendispatch-1.4.0-tampered.update', 'opendispatch 1.4.0 tampered'));
      expect(await screen.findByText('File discarded')).toBeTruthy();
      expect(screen.getByText('Refused')).toBeTruthy();
      expect(screen.getAllByText('Failed').length).toBe(2);
      expect(screen.queryByRole('button', { name: 'Use this file' })).toBeNull();
    });

    it('a file of another type (.zip) is rejected by the drop area with its own message, and nothing is sent', async () => {
      const { container } = await renderScreen({ search: { tab: 'connection' } });
      drop(container, fileOf('opendispatch-1.4.0.zip', 'x'));
      expect(await screen.findByRole('alert')).toBeTruthy();
      expect(container.textContent).toContain('opendispatch-1.4.0.zip');
      expect(actions.uploadUpdateFile).not.toHaveBeenCalled();
    });

    it('a file over the limit is rejected before it is read, with the honest limit in the message', async () => {
      const big = Object.assign(new File(['x'], 'opendispatch-9.9.9.update'), { text: async () => 'x' });
      Object.defineProperty(big, 'size', { value: 3_000_000 });
      const { container } = await renderScreen({ search: { tab: 'connection' } });
      drop(container, big);
      expect((await screen.findByRole('alert')).textContent).toMatch(/1\.9 MB/);
      expect(actions.uploadUpdateFile).not.toHaveBeenCalled();
    });

    it('a viewer cannot use the drop area: it is disabled with the reason', async () => {
      const { container } = await renderScreen({ role: 'change_approver', search: { tab: 'connection' } });
      expect((container.querySelector('input[type="file"]') as HTMLInputElement).matches(':disabled')).toBe(true);
      expect(screen.getAllByText('View only for this role').length).toBeGreaterThan(0);
    });
  });
});

describe('the Change windows tab', () => {
  it('Edit and Add blackout open their drawers through the address (a push, so Back closes them)', async () => {
    await renderScreen({ search: { tab: 'windows' } });
    click('Edit');
    expect(env.router.push).toHaveBeenLastCalledWith(expect.stringContaining('window=edit'));
    click('Add blackout');
    expect(env.router.push).toHaveBeenLastCalledWith(expect.stringContaining('blackout=new'));
  });

  it('the window drawer saves the days and the times, and refuses no day', async () => {
    mockOf(actions.saveRecurring).mockResolvedValue(ok({ recurring: 1, blackouts: 0 }));
    await renderScreen({ search: { tab: 'windows', window: 'edit' } });
    const dialog = screen.getByRole('dialog');
    const boxes = within(dialog).getAllByRole('checkbox');
    fireEvent.click(boxes[5] as HTMLElement);
    fireEvent.change(within(dialog).getByLabelText('From'), { target: { value: '22:00' } });
    fireEvent.change(within(dialog).getByLabelText('To'), { target: { value: '23:30' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    const windowId = (await getUpdateChangeWindows(admin())).recurring[0]?.id;
    await waitFor(() => expect(actions.saveRecurring).toHaveBeenCalledWith({ window_id: windowId, days_of_week: [0, 1, 2, 3, 4, 5], start_time: '22:00', end_time: '23:30' }));
    for (const box of boxes.filter((b) => (b as HTMLInputElement).checked)) fireEvent.click(box);
    expect(within(dialog).getByText('Choose at least one day')).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Save' }).getAttribute('aria-disabled')).toBe('true');
  });

  it('the blackout drawer sends Gregorian dates, or Hijri ones picked from the three Selects; it needs a label and ordered dates', async () => {
    mockOf(actions.addBlackout).mockResolvedValue(ok({ recurring: 1, blackouts: 1 }));
    await renderScreen({ search: { tab: 'windows', blackout: 'new' } });
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('button', { name: 'Save' }).getAttribute('aria-disabled')).toBe('true');
    expect(within(dialog).getByText('Write a label')).toBeTruthy();
    fireEvent.change(within(dialog).getByLabelText(/Label/), { target: { value: 'Month-end' } });
    fireEvent.change(within(dialog).getByLabelText('From'), { target: { value: '2026-09-29' } });
    fireEvent.change(within(dialog).getByLabelText('To'), { target: { value: '2026-09-28' } });
    expect(within(dialog).getByText('The end is before the start')).toBeTruthy();
    fireEvent.change(within(dialog).getByLabelText('To'), { target: { value: '2026-09-30' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(actions.addBlackout).toHaveBeenCalledWith({ label: 'Month-end', entered_as: 'gregorian', start_gregorian: '2026-09-29', end_gregorian: '2026-09-30' }));
    mockOf(actions.addBlackout).mockClear();
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Hijri' }));
    for (const legend of ['From', 'To']) {
      fireEvent.change(within(dialog).getByLabelText(`${legend}: Year`), { target: { value: '1448' } });
      fireEvent.change(within(dialog).getByLabelText(`${legend}: Month`), { target: { value: '4' } });
      fireEvent.change(within(dialog).getByLabelText(`${legend}: Day`), { target: { value: '12' } });
    }
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(actions.addBlackout).toHaveBeenCalledWith({ label: 'Month-end', entered_as: 'hijri', start_hijri: { year: 1448, month: 4, day: 12 }, end_hijri: { year: 1448, month: 4, day: 12 } }));
  });

  it('a blackout is removed by its id; the second approver switch sends only the answer', async () => {
    await updateUpdateChangeWindows(admin(), { recurring: [{ label: 'x', days_of_week: [0], start_time: '03:00', end_time: '05:00' }], blackouts: [{ label: 'Month-end', entered_as: 'gregorian', start_gregorian: '2026-09-29', end_gregorian: '2026-09-30' }] });
    mockOf(actions.removeBlackout).mockResolvedValue(ok({ recurring: 1, blackouts: 0 }));
    mockOf(actions.setSecondApprover).mockResolvedValue(fail('invalid', 'A second approver is required, so at least two approvers must be listed.'));
    await renderScreen({ search: { tab: 'windows' } });
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(actions.removeBlackout).toHaveBeenCalledTimes(1));
    expect(mockOf(actions.removeBlackout).mock.calls[0]?.[0]?.blackout_id).toMatch(/^[0-9a-f-]{36}$/);
    fireEvent.click(screen.getByRole('switch', { name: 'Second approver required' }));
    await waitFor(() => expect(actions.setSecondApprover).toHaveBeenCalledWith({ second_approver_required: true }));
    expect(await screen.findByText('A second approver is required, so at least two approvers must be listed.')).toBeTruthy();
  });
});

describe('the Settings tab', () => {
  it('Save sends the four settings as chosen', async () => {
    mockOf(actions.saveSettings).mockResolvedValue(ok({ channel: 'hotfix', check_interval_hours: 12, auto_download: true, notify_only: false }));
    await renderScreen({ search: { tab: 'settings' } });
    fireEvent.click(screen.getByRole('radio', { name: 'Hotfix' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Check interval' }), { target: { value: '12' } });
    fireEvent.click(screen.getByRole('switch', { name: 'Download automatically' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(actions.saveSettings).toHaveBeenCalledWith({ channel: 'hotfix', check_interval_hours: 12, auto_download: true, notify_only: false }));
  });
});
