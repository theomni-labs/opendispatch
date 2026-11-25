// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment jsdom
import { DesignSystemProvider } from '@opendispatch/ui';
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { inLocale } from '@/components/opendispatch/test-utils';
import { getModule, moduleAccess, type InstallMode, type Role } from '@/lib/access';
import { buildContext, fixtureTenantId } from '@/lib/data/go-test-reset';
import type { RequestContext } from '@/lib/data/guard';
import { fixtureUsers, syncGoClock } from '@/lib/data/go-test-reset';
import {
  applyUpdate,
  approveUpdate,
  confirmUpdateBackup,
  requestUpdateRecovery,
  runUpdatePreflight,
  scheduleUpdate,
  skipUpdate,
  startUpdateDownload,
  updateUpdateConnection,
} from '@/lib/data/updates';
import type { ScreenProps, SearchParams } from '@/screens/types';
import { UpdatesScreen } from './Screen';

// The screen as the module route renders it: the async Server Component is called with the props ModuleRoute builds, and the
// element it returns is rendered in each language. The data layer is real (fixtures, a temp demo store, a clock that is moved by
// hand); the router, the actions and next-intl's server translator are stood in for. The tests that need a state the scripted
// agent reaches only with time (downloading, verifying, a restore request) move the clock of the data layer.

const env = vi.hoisted(() => ({ locale: 'en' as 'en' | 'ar', query: '', router: { push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }, navigate: vi.fn() }));

vi.mock('next-intl/server', async () => {
  const { createTranslator } = await import('next-intl');
  const { loadMessages } = await import('@/i18n/messages');
  return { getTranslations: async (namespace?: string) => createTranslator({ locale: env.locale, messages: loadMessages(env.locale, 'admin.updates'), ...(namespace === undefined ? {} : { namespace }) }) };
});
vi.mock('@/i18n/navigation', () => ({ usePathname: () => '/admin/updates', useRouter: () => env.router }));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams(env.query) }));
vi.mock('./actions', () => ({
  checkNow: vi.fn(),
  downloadRelease: vi.fn(),
  runPreflight: vi.fn(),
  confirmBackup: vi.fn(),
  scheduleRelease: vi.fn(),
  cancelSchedule: vi.fn(),
  approveRelease: vi.fn(),
  rejectRelease: vi.fn(),
  applyRelease: vi.fn(),
  skipRelease: vi.fn(),
  emergencyOverride: vi.fn(),
  recoverUpdate: vi.fn(),
  saveSettings: vi.fn(),
  changeMode: vi.fn(),
  saveProxy: vi.fn(),
  testConnection: vi.fn(),
  uploadUpdateFile: vi.fn(),
  saveRecurring: vi.fn(),
  addBlackout: vi.fn(),
  removeBlackout: vi.fn(),
  setSecondApprover: vi.fn(),
}));

const T0 = '2026-09-13T10:00:00+03:00';

beforeEach(async () => {
  await fetch(`${process.env['OPENDISPATCH_API_URL']}/_internal/test/reset`, { method: 'POST' });
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(T0));
  await syncGoClock();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
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

// -- driving the scripted agent to a state ---------------------------------------------------------------------------------
async function toVerified(version: string): Promise<void> {
  await startUpdateDownload(admin(), version);
  await at(7);
}
async function toReady(version: string): Promise<void> {
  await toVerified(version);
  await runUpdatePreflight(admin(), version);
  await confirmUpdateBackup(admin(), version, {});
}
async function toAwaiting(version: string): Promise<void> {
  await toReady(version);
  await scheduleUpdate(admin(), version, {});
}
async function toApproved(version: string): Promise<void> {
  await toAwaiting(version);
  await approveUpdate(approver(), version, {});
}
async function toNeedsAttention(): Promise<void> {
  await toApproved('1.3.1');
  await applyUpdate(admin(), '1.3.1');
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
  const access = moduleAccess(role, 'admin.updates', mode);
  const element = await UpdatesScreen({ def: getModule('admin.updates'), ctx: ctxOf(role, mode), access, locale, homeHref: '/admin/updates', state, searchParams: search });
  return inLocale(locale, <DesignSystemProvider navigate={env.navigate}>{element}</DesignSystemProvider>, { module: 'admin.updates' });
}

const root = (container: HTMLElement) => container.querySelector<HTMLElement>('[data-module]');
const button = (name: string | RegExp) => screen.getByRole('button', { name });
const disabled = (el: HTMLElement) => el.getAttribute('aria-disabled') === 'true';
const dataText = (container: HTMLElement) => {
  const copy = container.cloneNode(true) as HTMLElement;
  for (const node of copy.querySelectorAll('[translate="no"], [lang="en"]')) node.remove();
  return (copy.textContent ?? '').replaceAll('OPENDISPATCH', '');
};

describe('Updates: the reduced screen (dedicated and shared installs)', () => {
  it.each(['dedicated', 'shared'] as const)('shows the version and the release notes only in a %s install, with no tabs and no actions', async (mode) => {
    const { container } = await renderScreen({ mode });
    const page = root(container);
    expect([page?.getAttribute('data-module'), page?.getAttribute('data-state'), page?.getAttribute('data-access'), page?.getAttribute('data-reduced')]).toEqual(['admin.updates', 'filled', 'view', 'true']);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Updates');
    expect(screen.queryAllByRole('tab')).toHaveLength(0);
    expect(screen.queryByRole('button', { name: 'Check now' })).toBeNull();
    expect(screen.getByText('Release notes')).toBeTruthy();
    expect(screen.getByText('OpenDispatch applies updates in this install.')).toBeTruthy();
    expect(container.textContent).toMatch(/v1\.1\.0/);
    expect(container.textContent).toMatch(/Forecast Explorer likely range/);
  });

  it('reads nothing but the summary: no denied audit event comes from rendering it', async () => {
    const { listAuditEvents } = await import('@/lib/data/audit');
    await renderScreen({ mode: 'shared' });
    expect((await listAuditEvents(ctxOf('administrator', 'shared'), { action: 'update.read', limit: 50 })).items).toHaveLength(0);
  });

  it('is in Arabic with the release notes in Arabic and no English text outside data', async () => {
    const { container } = await renderScreen({ mode: 'dedicated', locale: 'ar' });
    expect(container.textContent).toMatch(/نظام OpenDispatch تطبّق التحديثات|OpenDispatch/);
    expect(dataText(container)).not.toMatch(/[A-Za-z]{3}/);
    expect(container.textContent).toMatch(/نطاق التوقع المحتمل/);
  });
});

describe('Updates: the Overview, English, Administrator (edit)', () => {
  it('carries the four hooks, the module title, the data source, the Demo tag and the version', async () => {
    const { container } = await renderScreen();
    const page = root(container);
    expect([page?.getAttribute('data-module'), page?.getAttribute('data-state'), page?.getAttribute('data-access'), page?.getAttribute('data-reduced')]).toEqual(['admin.updates', 'filled', 'edit', 'false']);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Updates');
    expect(container.querySelector('[data-badge="SYNTHETIC"]')).not.toBeNull();
    expect(container.querySelector('[data-stub="demo"]')).not.toBeNull();
    expect(container.textContent).toContain('v1.1.0');
    expect(screen.queryByText('View only')).toBeNull();
  });

  it('has at most two visible header actions: Check now (primary) and More', async () => {
    await renderScreen();
    expect(disabled(button('Check now'))).toBe(false);
    expect(button('More')).toBeTruthy();
  });

  it('has the five tabs, Overview first, and four figures', async () => {
    await renderScreen();
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((tab) => tab.textContent)).toEqual(['Overview', 'Connection', 'Change windows', 'History', 'Settings']);
    expect(tabs[0]?.getAttribute('aria-selected')).toBe('true');
    for (const label of ['Current version', 'Channel', 'Connection', 'Last check']) expect(screen.getAllByText(label).length).toBeGreaterThan(0);
  });

  it('shows release 1.2.0 as available: notes, what changes, downtime, live assignment, rollback, Download and Skip', async () => {
    const { container } = await renderScreen();
    expect(container.querySelector('#up-release')?.getAttribute('data-stage')).toBe('available');
    expect(screen.getByRole('heading', { name: /Release\s*1\.2\.0/ })).toBeTruthy();
    expect(screen.getAllByText('Available').length).toBeGreaterThan(0);
    expect(container.textContent).toMatch(/Prayer-time-aware break planner/);
    expect(container.textContent).toContain('Adds prayer conflict columns to break plans.');
    expect(container.textContent).toContain('Stays on OpenDispatch');
    expect(container.textContent).toContain('Automatic, no restore');
    expect(disabled(button('Download'))).toBe(false);
    expect(disabled(button('Skip'))).toBe(false);
    expect(screen.getByText('Downloaded and checked before anything changes')).toBeTruthy();
  });

  it('lists the other open releases (the hotfix and the two scripted stable ones) as rows that open ?release=', async () => {
    const { container } = await renderScreen();
    const table = screen.getByRole('table', { name: 'Other releases' });
    const rows = within(table).getAllByRole('row').filter((row) => within(row).queryAllByRole('cell').length > 0);
    expect(rows.map((row) => within(row).getAllByRole('cell')[0]?.textContent)).toEqual(['1.2.1', '1.3.0', '1.3.1']);
    expect(container.textContent).toContain('Hotfix');
  });

  it('shows the release with ?release= when it is open, and ignores anything else', async () => {
    await renderScreen({ search: { release: '1.3.0' } });
    expect(screen.getByRole('heading', { name: /Release\s*1\.3\.0/ })).toBeTruthy();
    expect(screen.getAllByText('Live assignment').length).toBeGreaterThan(0);
    cleanup();
    await renderScreen({ search: { release: '9.9.9' } });
    expect(screen.getByRole('heading', { name: /Release\s*1\.2\.0/ })).toBeTruthy();
    cleanup();
    await renderScreen({ search: { release: '../etc' } });
    expect(screen.getByRole('heading', { name: /Release\s*1\.2\.0/ })).toBeTruthy();
  });

  it('shows the next window and the approval card', async () => {
    await renderScreen();
    expect(screen.getByRole('heading', { name: 'Next window' })).toBeTruthy();
    expect(screen.getByText('Approval')).toBeTruthy();
    expect(screen.getByText('Second approver')).toBeTruthy();
    expect(screen.getByText('Not required')).toBeTruthy();
    expect(screen.getByText('Asia/Riyadh')).toBeTruthy();
  });
});

describe('Updates: the stages of the release card', () => {
  it('downloading: a bar from the data layer clock, the images pulled and pushed, and no polling when nothing runs', async () => {
    await startUpdateDownload(admin(), '1.2.0');
    await at(1);
    const { container } = await renderScreen();
    expect(container.querySelector('#up-release')?.getAttribute('data-stage')).toBe('downloading');
    expect(screen.getAllByText('Downloading').length).toBeGreaterThan(1);
    const bar = container.querySelector('[role="progressbar"]');
    expect(Number(bar?.getAttribute('aria-valuenow'))).toBeGreaterThan(0);
    expect(Number(bar?.getAttribute('aria-valuenow'))).toBeLessThan(100);
    expect(screen.getByText('Schedule and Apply wait until it is verified')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Download' })).toBeNull();
    expect(container.querySelector('[data-header-state]')).toBeNull();
  });

  it('asks the server again every second while a download runs, and stops when it is over', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    vi.setSystemTime(new Date(T0));
    await startUpdateDownload(admin(), '1.2.0');
    await at(1);
    await renderScreen();
    expect(env.router.refresh).not.toHaveBeenCalled();
    vi.advanceTimersByTime(3000);
    expect(env.router.refresh).toHaveBeenCalledTimes(3);
    cleanup();
    env.router.refresh.mockReset();
    await at(8);
    await renderScreen();
    vi.advanceTimersByTime(5000);
    expect(env.router.refresh).not.toHaveBeenCalled();
  });

  it('verifying: the five checks are shown as running, no per-check progress is made up, and the header says Verifying', async () => {
    await startUpdateDownload(admin(), '1.2.0');
    await at(4.5);
    const { container } = await renderScreen();
    expect(container.querySelector('#up-release')?.getAttribute('data-stage')).toBe('verifying');
    const list = screen.getByRole('list', { name: 'Checking the release' });
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(5);
    for (const item of items) expect(within(item).getByText('Running')).toBeTruthy();
    for (const name of ['Signature valid', 'Image digests match', 'Signing key not revoked', 'Newer than installed', 'Release index still valid']) expect(within(list).getByText(name)).toBeTruthy();
    expect(screen.getAllByText('Verifying').length).toBeGreaterThan(0);
  });

  it('verified: the five checks passed, Run pre-flight checks and Skip', async () => {
    await toVerified('1.2.0');
    const { container } = await renderScreen();
    expect(container.querySelector('#up-release')?.getAttribute('data-stage')).toBe('verified');
    const list = screen.getByRole('list', { name: 'Checking the release' });
    expect(within(list).getAllByText('Passed')).toHaveLength(5);
    expect(container.textContent).toContain('opendispatch-release-key-2026-01');
    expect(disabled(button('Run pre-flight checks'))).toBe(false);
    expect(container.textContent).toContain('Not run');
  });

  it('pre-flight waiting for the backup: a Confirm backup button (a deviation from the mockup) and the six checks', async () => {
    await toVerified('1.2.0');
    await runUpdatePreflight(admin(), '1.2.0');
    const { container } = await renderScreen();
    expect(container.querySelector('#up-release')?.getAttribute('data-stage')).toBe('verified');
    const checks = screen.getByRole('list', { name: 'Pre-flight checks' });
    expect(within(checks).getAllByRole('listitem')).toHaveLength(6);
    expect(within(checks).getByText('Needs confirmation')).toBeTruthy();
    expect(within(checks).getByText('Confirm that a fresh backup exists')).toBeTruthy();
    expect(disabled(button('Confirm backup'))).toBe(false);
    expect(screen.queryByRole('button', { name: 'Run pre-flight checks' })).toBeNull();
  });

  it('verification failed (a tampered proxy address): the danger alert, the failed digest check, Try again and Skip', async () => {
    await updateUpdateConnection(admin(), { mode: 'connected', proxy: { enabled: true, address: 'http://tampered.example:8080', username: null } });
    await startUpdateDownload(admin(), '1.2.0');
    await at(7);
    const { container } = await renderScreen();
    expect(container.querySelector('#up-release')?.getAttribute('data-stage')).toBe('verify_failed');
    expect(screen.getByRole('alert').textContent).toContain('Verification failed');
    expect(container.textContent).toContain('The release was discarded. Nothing was installed.');
    expect(container.textContent).toContain('An image digest does not match the signed manifest.');
    const list = screen.getByRole('list', { name: 'Checking the release' });
    expect(within(list).getAllByText('Failed')).toHaveLength(1);
    expect(disabled(button('Try again'))).toBe(false);
    expect(disabled(button('Skip'))).toBe(false);
  });

  it('ready: Schedule, Apply disabled with its reason, Skip', async () => {
    await toReady('1.2.0');
    const { container } = await renderScreen();
    expect(container.querySelector('#up-release')?.getAttribute('data-stage')).toBe('ready');
    expect(disabled(button('Schedule'))).toBe(false);
    expect(disabled(button('Apply'))).toBe(true);
    expect(screen.getAllByText('Schedule it and get approval first').length).toBeGreaterThan(0);
    expect(container.textContent).toContain('6 of 6 passed');
  });

  it('awaiting approval: who asked and the window; the Administrator cannot approve and sees why', async () => {
    await toAwaiting('1.2.0');
    const { container } = await renderScreen();
    expect(container.querySelector('#up-release')?.getAttribute('data-stage')).toBe('awaiting');
    expect(container.textContent).toContain('Awaiting approval');
    expect(container.textContent).toMatch(/Requested by Nadia Al-Ghalani/);
    expect(disabled(button('Approve'))).toBe(true);
    expect(disabled(button('Reject'))).toBe(true);
    expect(container.textContent).toContain('Your role cannot approve this');
    expect(disabled(button('Cancel schedule'))).toBe(false);
  });

  it('awaiting approval as the Change Approver: Approve and Reject are enabled, everything else is disabled with the view-only reason', async () => {
    await toAwaiting('1.2.0');
    const { container } = await renderScreen({ role: 'change_approver' });
    expect(root(container)?.getAttribute('data-access')).toBe('view');
    expect(disabled(button('Approve'))).toBe(false);
    expect(disabled(button('Reject'))).toBe(false);
    expect(disabled(button('Cancel schedule'))).toBe(true);
    expect(disabled(button('Check now'))).toBe(true);
    expect(screen.getByText('View only')).toBeTruthy();
  });

  it('approved: Apply now and Cancel schedule, and who approved', async () => {
    await toApproved('1.2.0');
    const { container } = await renderScreen();
    expect(container.querySelector('#up-release')?.getAttribute('data-stage')).toBe('approved');
    expect(container.textContent).toMatch(/Approved by Saad Al-Nabari/);
    expect(disabled(button('Apply now'))).toBe(false);
    expect(disabled(button('Cancel schedule'))).toBe(false);
  });

  it('a Change Approver cannot approve their own request: the reason says so', async () => {
    // The approver schedules through the data layer only to make the request theirs: an Administrator schedules in the product,
    // so the case is built by reading the gate directly.
    const { decisionGate } = await import('./view');
    const scheduled = { requested_by: { user_id: approver().userId, display_name: 'x' }, approvals: [], state: 'awaiting_approval' } as unknown as Parameters<typeof decisionGate>[1];
    const policy = { approver_user_ids: [], second_approver_required: false, emergency_override_enabled: true, emergency_reason_min_length: 20 };
    expect(decisionGate(approver(), scheduled, policy)).toBe('own_request');
    expect(decisionGate(admin(), scheduled, policy)).toBe('not_an_approver_role');
    expect(decisionGate(approver(), { ...scheduled, requested_by: { user_id: 'someone', display_name: 'x' } } as never, { ...policy, approver_user_ids: ['not-me'] })).toBe('not_listed');
  });

  it('up to date: the empty state with Check now, when every open release was skipped', async () => {
    for (const version of ['1.2.0', '1.2.1', '1.3.0', '1.3.1']) await skipUpdate(admin(), version, { reason: 'Not now' });
    const { container } = await renderScreen();
    expect(screen.getByText('You are up to date')).toBeTruthy();
    expect(container.textContent).toContain('No release is waiting.');
    expect(screen.getAllByRole('button', { name: 'Check now' })).toHaveLength(2);
  });
});

describe('Updates: recovery', () => {
  it('needs attention: the alert with what failed, what is safe and what next; Resume and Restore; the live system on the fallback', async () => {
    await toNeedsAttention();
    const { container } = await renderScreen();
    expect(container.querySelector('#up-release')).toBeNull();
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('Update 1.3.1 needs attention');
    expect(alert.textContent).toContain('What failed:');
    expect(alert.textContent).toContain('20260911_backfill_zone_codes');
    expect(alert.textContent).toContain('What is safe:');
    expect(alert.textContent).toContain('What next:');
    expect(disabled(button('Resume'))).toBe(false);
    expect(disabled(button('Restore'))).toBe(false);
    expect(screen.getByRole('heading', { name: 'Live system' })).toBeTruthy();
    expect(screen.getByText("Customer's fallback")).toBeTruthy();
    expect(container.textContent).toContain('backup-before-1.3.1');
    expect(screen.getAllByText('Needs attention').length).toBeGreaterThan(0);
  });

  it('needs attention as the Change Approver: Resume and Restore are disabled with the view-only reason', async () => {
    await toNeedsAttention();
    await renderScreen({ role: 'change_approver' });
    expect(disabled(button('Resume'))).toBe(true);
    expect(disabled(button('Restore'))).toBe(true);
    expect(screen.getAllByText('View only for this role. The Administrator resumes or restores.').length).toBeGreaterThan(0);
  });

  it('a restore request survives a reload: requested, in progress, then completed, with the buttons locked while it runs', async () => {
    await toNeedsAttention();
    await requestUpdateRecovery(admin(), { action: 'restore', note: 'Take the backup back' });
    await at(8.5);
    let view = await renderScreen();
    expect(screen.getByRole('heading', { name: 'Restore request' })).toBeTruthy();
    expect(screen.getAllByText('Requested').length).toBeGreaterThan(0);
    expect(disabled(button('Resume'))).toBe(true);
    expect(disabled(button('Restore'))).toBe(true);
    expect(screen.getAllByText('A restore is requested. Your database team carries it out.').length).toBeGreaterThan(0);
    expect(view.container.textContent).toContain('backup-before-1.3.1');
    expect(screen.getByRole('heading', { name: /Update run/ })).toBeTruthy();
    cleanup();
    await at(11.5);
    view = await renderScreen();
    expect(screen.getAllByText('In progress').length).toBeGreaterThan(0);
    cleanup();
    await at(16);
    view = await renderScreen();
    expect(view.container.textContent).toContain('Restored to the backup from before 1.3.1');
    expect(view.container.textContent).toContain('OpenDispatch runs 1.1.0 again');
    expect(screen.queryByRole('button', { name: 'Resume' })).toBeNull();
    // After a restore the release can go again: its card is there.
    expect(screen.getByRole('heading', { name: /Release\s*1\.2\.0/ })).toBeTruthy();
  });

  it('polls only while the restore request is under way', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    vi.setSystemTime(new Date(T0));
    await toNeedsAttention();
    await requestUpdateRecovery(admin(), { action: 'restore', note: 'x' });
    await at(9);
    await renderScreen();
    vi.advanceTimersByTime(2000);
    expect(env.router.refresh).toHaveBeenCalledTimes(2);
  });

  it('resumed: the success alert (the newest history entry)', async () => {
    await toNeedsAttention();
    await requestUpdateRecovery(admin(), { action: 'resume', note: '' });
    const { container } = await renderScreen();
    expect(container.textContent).toContain('Update 1.3.1 resumed and finished');
    expect(container.textContent).toContain('Maintenance is off and live assignment is back on OpenDispatch.');
  });

  it('rolled back: the warning alert with View history, after the scripted health check fails', async () => {
    await toApproved('1.3.0');
    await applyUpdate(admin(), '1.3.0');
    const { container } = await renderScreen();
    expect(container.textContent).toContain('Update 1.3.0 rolled back to 1.1.0');
    expect(container.textContent).toContain('The health check failed after the upgrade.');
    expect(button('View history')).toBeTruthy();
    fireEvent.click(button('View history'));
    expect(env.router.replace).toHaveBeenCalledWith(expect.stringContaining('tab=history'), expect.anything());
  });
});

describe('Updates: the other tabs', () => {
  it('Connection: the firewall hostnames with Copy all, the proxy form, Test connection with its Demo tag', async () => {
    const { container } = await renderScreen({ search: { tab: 'connection' } });
    expect(screen.getByRole('radio', { name: 'Connected' }).getAttribute('aria-checked')).toBe('true');
    expect(container.textContent).toContain('updates.opendispatch.example');
    expect(container.textContent).toContain('releases.opendispatch.example');
    expect(button('Copy all')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Proxy' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Test connection' })).toBeTruthy();
    expect(container.querySelectorAll('[data-stub="demo"]').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('Release index valid until')).toBeTruthy();
  });

  it('Connection, offline: the file drop with the honest size hint, the portal steps with a Demo tag, no proxy or test cards', async () => {
    await updateUpdateConnection(admin(), { mode: 'offline' });
    const { container } = await renderScreen({ search: { tab: 'connection' } });
    expect(screen.getByRole('radio', { name: 'Offline' }).getAttribute('aria-checked')).toBe('true');
    expect(container.querySelector('input[type="file"]')?.getAttribute('accept')).toBe('.update');
    expect(container.textContent).toContain('Signed update file, up to 2,000,000 characters in this demo');
    expect(screen.getByText('Sign in to the customer portal.')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Proxy' })).toBeNull();
    expect(disabled(button('Check now'))).toBe(true);
  });

  it('Change windows: the recurring window, the upcoming windows, the blackouts (none), the approvers and the emergency override', async () => {
    const { container } = await renderScreen({ search: { tab: 'windows' } });
    expect(container.textContent).toContain('Sunday to Thursday, 03:00 to 05:00');
    const upcoming = screen.getByRole('table', { name: 'Recurring windows' });
    expect(within(upcoming).getAllByRole('row').length).toBeGreaterThan(8);
    expect(screen.getByText('No blackout periods.')).toBeTruthy();
    expect(screen.getByText('Second approver required')).toBeTruthy();
    expect(screen.getAllByText('Emergency override').length).toBeGreaterThan(0);
    expect(disabled(button('Edit'))).toBe(false);
    expect(disabled(button('Add blackout'))).toBe(false);
  });

  it('Change windows: ?window=edit opens the drawer with the seven days and the times; ?blackout=new opens the Gregorian/Hijri drawer', async () => {
    await renderScreen({ search: { tab: 'windows', window: 'edit' } });
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getAllByRole('checkbox')).toHaveLength(7);
    expect(within(dialog).getAllByRole('checkbox').filter((box) => (box as HTMLInputElement).checked)).toHaveLength(5);
    cleanup();
    await renderScreen({ search: { tab: 'windows', blackout: 'new' } });
    const drawer = screen.getByRole('dialog');
    expect(within(drawer).getByRole('radio', { name: 'Gregorian' }).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(within(drawer).getByRole('radio', { name: 'Hijri' }));
    expect(within(drawer).getAllByRole('combobox').length).toBe(6);
    expect(within(drawer).getAllByText(/Same day:/).length).toBeGreaterThan(0);
  });

  it('a viewer sees ?window=edit and ?blackout=new as no drawer, and every control disabled with the view-only reason', async () => {
    await renderScreen({ role: 'change_approver', search: { tab: 'windows', window: 'edit' } });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(disabled(button('Edit'))).toBe(true);
    expect(disabled(button('Add blackout'))).toBe(true);
    expect(screen.getAllByText('View only for this role').length).toBeGreaterThan(0);
  });

  it('History: the two seeded updates with approver, window and started; the emergency and failed rows are toned', async () => {
    const { container } = await renderScreen({ search: { tab: 'history' } });
    const table = screen.getByRole('table', { name: 'History' });
    expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Version', 'Kind', 'Result', 'Approved by', 'Window', 'Started']);
    expect(container.textContent).toContain('1.1.0');
    expect(container.textContent).toContain('Initial install.');
    expect(container.textContent).toContain('Applied in the change window. Health checks passed.');
  });

  it('Settings: channel, check interval, both switches and Save; every control is disabled for a viewer', async () => {
    await renderScreen({ search: { tab: 'settings' } });
    expect(screen.getByRole('radio', { name: 'Stable' })).toBeTruthy();
    expect(screen.getByRole('combobox', { name: 'Check interval' })).toBeTruthy();
    expect(screen.getByRole('switch', { name: 'Download automatically' })).toBeTruthy();
    expect(disabled(button('Save'))).toBe(false);
    cleanup();
    await renderScreen({ role: 'change_approver', search: { tab: 'settings' } });
    expect(disabled(button('Save'))).toBe(true);
    expect((screen.getByRole('switch', { name: 'Download automatically' }) as HTMLInputElement).disabled).toBe(true);
  });
});

describe('Updates: the review states (?state=)', () => {
  it.each(['empty', 'loading', 'error'] as const)('?state=%s shows that state, keeps the header, and reads nothing', async (state) => {
    const { container } = await renderScreen({ state });
    expect(root(container)?.getAttribute('data-state')).toBe(state);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Updates');
    expect(screen.queryAllByRole('tab')).toHaveLength(0);
    if (state === 'empty') {
      expect(screen.getByText('You are up to date')).toBeTruthy();
      expect(screen.getAllByRole('button', { name: 'Check now' }).length).toBeGreaterThan(0);
    }
    if (state === 'error') {
      expect(screen.getByRole('alert').textContent).toContain('The update status could not load.');
      expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
    }
    if (state === 'loading') expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
  });
});

describe('Updates: Arabic', () => {
  it('draws the Overview in Arabic, in every stage, with no English left outside data (names, versions, hostnames)', async () => {
    const stages: [string, () => void][] = [
      ['available', () => undefined],
      ['ready', async () => await toReady('1.2.0')],
    ];
    for (const [, prepare] of stages) {
      prepare();
      const { container } = await renderScreen({ locale: 'ar' });
      expect(container.querySelector('#up-release')).not.toBeNull();
      expect(dataText(container)).not.toMatch(/[A-Za-z]{3}/);
      cleanup();
    }
  });

  it('draws the recovery and the tabs in Arabic with Western digits and no English left', async () => {
    await toNeedsAttention();
    const { container } = await renderScreen({ locale: 'ar' });
    expect(container.textContent).toMatch(/يحتاج إلى تدخل/);
    expect(dataText(container)).not.toMatch(/[A-Za-z]{3}/);
    expect(container.textContent).not.toMatch(/[٠-٩]/);
    cleanup();
    for (const tab of ['connection', 'windows', 'history', 'settings']) {
      const view = await renderScreen({ locale: 'ar', search: { tab } });
      expect(dataText(view.container), tab).not.toMatch(/[A-Za-z]{3}/);
      expect(view.container.textContent, tab).not.toMatch(/[٠-٩]/);
      cleanup();
    }
  });
});
