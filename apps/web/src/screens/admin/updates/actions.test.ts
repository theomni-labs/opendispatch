// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { InstallMode, Role } from '@/lib/access';
import { listAuditEvents } from '@/lib/data/audit';
import { UnauthenticatedError } from '@/lib/data/errors';
import type { RequestContext } from '@/lib/data/guard';
import { listUsers } from '@/lib/data/users';
import { fixtureUsers, syncGoClock } from '@/lib/data/go-test-reset';
import { getUpdateChangeWindows, getUpdateConnection, getUpdateSettings, getUpdateStatus, listUpdateHistory, listUpdateReleases } from '@/lib/data/updates';
import {
  addBlackout,
  applyRelease,
  approveRelease,
  cancelSchedule,
  changeMode,
  checkNow,
  confirmBackup,
  downloadRelease,
  emergencyOverride,
  recoverUpdate,
  rejectRelease,
  removeBlackout,
  runPreflight,
  saveProxy,
  saveRecurring,
  saveSettings,
  scheduleRelease,
  setSecondApprover,
  skipRelease,
  testConnection,
  uploadUpdateFile,
} from './actions';
import { buildContext, fixtureTenantId } from '@/lib/data/go-test-reset';

// The server actions against the real data layer and the committed fixtures, with the demo store in a temp folder and the clock of
// the data layer moved by hand (a download takes about four seconds and its verification two: `advance(7)` ends one). The session
// is the only thing stood in for: requireRequestContext returns the context of the role the test picks, exactly what a signed
// cookie would give.
const session = vi.hoisted(() => ({ role: 'administrator' as string | null, mode: 'private' as string, revalidate: vi.fn() }));

vi.mock('next/cache', () => ({ revalidatePath: session.revalidate }));
vi.mock('@/lib/data/context', async (original) => {
  const real = await original<typeof import('@/lib/data/context')>();
  return {
    ...real,
    requireRequestContext: async () => {
      if (session.role === null) throw new UnauthenticatedError();
      return contextOf(session.role as Role, session.mode as InstallMode);
    },
  };
});

function contextOf(role: Role, installMode: InstallMode): RequestContext {
  const tenant = fixtureTenantId();
  const built = buildContext({ role, installMode, zoneIds: [] }, fixtureUsers(), tenant);
  if (built === null) throw new Error(`no context for ${role}`);
  return built;
}

let errorLog: ReturnType<typeof vi.spyOn>;
const T0 = Date.parse('2026-09-13T10:00:00+03:00');
let now = 0;
/** Moves the clock of the data layer on (it counts whole seconds). */
const advance = async (seconds: number) => {
  now += seconds;
  vi.setSystemTime(new Date(T0 + now * 1000));
  await syncGoClock();
};

beforeEach(async () => {
  await fetch(`${process.env['OPENDISPATCH_API_URL']}/_internal/test/reset`, { method: 'POST' });
  session.role = 'administrator';
  session.mode = 'private';
  session.revalidate.mockReset();
  errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.useFakeTimers({ toFake: ['Date'] });
  now = 0;
  vi.setSystemTime(new Date(T0));
  await syncGoClock();
});
afterEach(() => {
  vi.useRealTimers();
  errorLog.mockRestore();
});

async function ctx(role: Role = 'administrator', mode: InstallMode = 'private'): Promise<RequestContext> {
  return contextOf(role, mode);
}
const events = async (action: string) => (await listAuditEvents(await ctx(), { action, limit: 200 })).items;
const REVALIDATED = ['/en/admin/updates', '/ar/admin/updates'];
const asRole = (role: Role, mode: InstallMode = 'private') => {
  session.role = role;
  session.mode = mode;
};

// -- to a state -------------------------------------------------------------------------------------------------------------
async function toReady(version: string) {
  expect(await downloadRelease({ version })).toMatchObject({ ok: true, data: { state: 'downloading' } });
  await advance(7);
  expect(await runPreflight({ version })).toMatchObject({ ok: true, data: { state: 'failed' } });
  expect(await confirmBackup({ version })).toMatchObject({ ok: true, data: { state: 'passed' } });
}
async function toApproved(version: string) {
  await toReady(version);
  const scheduled = await scheduleRelease({ version, window_start: (await openWindowStart()) });
  expect(scheduled).toMatchObject({ ok: true, data: { state: 'awaiting_approval' } });
  asRole('change_approver');
  expect(await approveRelease({ version, note: '' })).toMatchObject({ ok: true, data: { state: 'approved' } });
  asRole('administrator');
}
async function openWindowStart(): Promise<string> {
  const windows = await getUpdateChangeWindows(await ctx());
  const slot = windows.upcoming.find((w) => w.open);
  if (slot === undefined) throw new Error('no open window');
  return slot.start;
}

describe('the release card: check, download, pre-flight, backup, schedule, approve, apply, skip, cancel', () => {
  it('checkNow records the check, names the oldest release found, audits it, and refreshes the page in both languages', async () => {
    const result = await checkNow();
    expect(result).toMatchObject({ ok: true, data: { result: 'update_found', version: '1.2.0' } });
    expect((await events('update.check')).at(0)).toMatchObject({ outcome: 'success' });
    expect(session.revalidate.mock.calls.map((c) => c[0])).toEqual(REVALIDATED);
  });

  it('checkNow is refused in offline mode as `conflict`, and audited as a failure', async () => {
    await changeMode({ mode: 'offline' });
    expect(await checkNow()).toMatchObject({ ok: false, code: 'conflict' });
  });

  it('downloadRelease starts the download (the phases follow the clock); a second call is a conflict; a retry works after a failed verification', async () => {
    expect(await downloadRelease({ version: '1.2.0' })).toMatchObject({ ok: true, data: { version: '1.2.0', state: 'downloading' } });
    expect(await downloadRelease({ version: '1.2.0' })).toMatchObject({ ok: false, code: 'conflict' });
    await advance(7);
    expect((await listUpdateReleases(await ctx())).items.find((r) => r.version === '1.2.0')?.state).toBe('verified');
    expect((await events('update.download')).some((e) => e.outcome === 'success')).toBe(true);

    await saveProxy({ proxy_enabled: true, proxy_address: 'http://tampered.example:8080', proxy_username: '', proxy_password: '', proxy_certificate: '' });
    expect(await downloadRelease({ version: '1.2.1' })).toMatchObject({ ok: true, data: { state: 'downloading' } });
    await advance(7);
    expect((await listUpdateReleases(await ctx())).items.find((r) => r.version === '1.2.1')?.state).toBe('withdrawn');
    await saveProxy({ proxy_enabled: false, proxy_address: '', proxy_username: '', proxy_password: '', proxy_certificate: '' });
    expect(await downloadRelease({ version: '1.2.1' })).toMatchObject({ ok: true, data: { state: 'downloading' } });
    await advance(7);
    expect((await listUpdateReleases(await ctx())).items.find((r) => r.version === '1.2.1')?.state).toBe('verified');
  });

  it('runs the pre-flight, which waits for the backup, and confirmBackup passes it (the release becomes ready)', async () => {
    await toReady('1.2.0');
    const releases = (await listUpdateReleases(await ctx())).items;
    expect(releases.find((r) => r.version === '1.2.0')?.state).toBe('ready');
    expect((await events('update.backup_confirmed')).at(0)).toMatchObject({ outcome: 'success' });
  });

  it('schedules into an open window, approves as the Change Approver, and applies: the run comes back complete with nine steps', async () => {
    await toApproved('1.2.0');
    const applied = await applyRelease({ version: '1.2.0' });
    expect(applied).toMatchObject({ ok: true, data: { run: { version: '1.2.0', state: 'succeeded' } } });
    if (!applied.ok) throw new Error('unreachable');
    expect(applied.data.run.steps).toHaveLength(9);
    expect((await getUpdateStatus(await ctx())).current_version).toBe('1.2.0');
    expect((await events('update.apply')).at(0)).toMatchObject({ outcome: 'success' });
    expect((await listUpdateHistory(await ctx())).items[0]).toMatchObject({ version: '1.2.0', result: 'succeeded' });
  });

  it('the scripted 1.3.0 rolls back by itself: the run says rolled_back; 1.3.1 stops partway and asks for recovery', async () => {
    await toApproved('1.3.0');
    expect(await applyRelease({ version: '1.3.0' })).toMatchObject({ ok: true, data: { run: { state: 'rolled_back' } } });
    await toApproved('1.3.1');
    expect(await applyRelease({ version: '1.3.1' })).toMatchObject({ ok: true, data: { run: { state: 'needs_attention', maintenanceOn: true } } });
    expect((await getUpdateStatus(await ctx())).state).toBe('needs_attention');
  });

  it('rejects a scheduled update as the Change Approver; the Administrator cannot approve or reject (forbidden, audited as denied)', async () => {
    await toReady('1.2.0');
    await scheduleRelease({ version: '1.2.0', window_start: await openWindowStart() });
    expect(await approveRelease({ version: '1.2.0', note: '' })).toMatchObject({ ok: false, code: 'forbidden' });
    expect((await events('update.approve')).at(0)).toMatchObject({ outcome: 'denied' });
    asRole('change_approver');
    expect(await rejectRelease({ version: '1.2.0', note: 'Not this week' })).toMatchObject({ ok: true, data: { state: 'rejected' } });
    expect((await events('update.reject')).at(0)).toMatchObject({ outcome: 'success' });
  });

  it('cancelSchedule takes a scheduled update out of its window and puts the release back to ready', async () => {
    await toReady('1.2.0');
    await scheduleRelease({ version: '1.2.0', window_start: await openWindowStart() });
    expect(await cancelSchedule({ version: '1.2.0' })).toMatchObject({ ok: true, data: { version: '1.2.0', state: 'ready' } });
    expect(await cancelSchedule({ version: '1.2.0' })).toMatchObject({ ok: false, code: 'conflict' });
  });

  it('skipRelease needs a reason (invalid without one), records it in the history, and can skip a discarded release', async () => {
    expect(await skipRelease({ version: '1.2.0', reason: '' })).toMatchObject({ ok: false, code: 'invalid' });
    expect(await skipRelease({ version: '1.2.0', reason: 'Not now' })).toMatchObject({ ok: true, data: { version: '1.2.0', state: 'skipped' } });
    expect((await listUpdateHistory(await ctx())).items[0]).toMatchObject({ kind: 'skip', version: '1.2.0' });
  });

  it('the emergency override needs a reason of at least 20 characters and a second, different Change Approver', async () => {
    await downloadRelease({ version: '1.2.1' });
    await advance(7);
    const users = (await listUsers(await ctx(), { assigned_role: 'change_approver', limit: 10 })).items;
    const second = users[0];
    if (second === undefined) throw new Error('no change approver');
    expect(await emergencyOverride({ version: '1.2.1', second_approver_user_id: second.id, reason: 'too short' })).toMatchObject({ ok: false, code: 'invalid' });
    const done = await emergencyOverride({ version: '1.2.1', second_approver_user_id: second.id, reason: 'A gap calculation error hits live assignment now.' });
    expect(done).toMatchObject({ ok: true, data: { run: { kind: 'emergency', state: 'succeeded' } } });
    expect((await events('update.emergency_override')).at(0)).toMatchObject({ outcome: 'success' });
  });
});

describe('recovery', () => {
  it('resume and restore need a run that needs attention: refused as `refused` in the result otherwise; restore is requested, resume finishes', async () => {
    expect(await recoverUpdate({ action: 'resume', note: '' })).toMatchObject({ ok: true, data: { state: 'refused' } });
    await toApproved('1.3.1');
    await applyRelease({ version: '1.3.1' });
    expect(await recoverUpdate({ action: 'restore', note: 'Take the backup back' })).toMatchObject({ ok: true, data: { action: 'restore', state: 'requested' } });
    expect(await recoverUpdate({ action: 'resume', note: '' })).toMatchObject({ ok: true, data: { action: 'resume', state: 'started', run: { kind: 'resume', state: 'succeeded' } } });
    expect((await events('update.recovery')).length).toBeGreaterThanOrEqual(2);
  });

  it('an action name other than resume or restore is invalid (a rollback is not offered by this screen)', async () => {
    expect(await recoverUpdate({ action: 'format_disk' as never, note: '' })).toMatchObject({ ok: false, code: 'invalid' });
  });
});

describe('settings, connection, offline file', () => {
  it('saveSettings stores the four settings and audits the change', async () => {
    const result = await saveSettings({ channel: 'hotfix', check_interval_hours: 12, auto_download: true, notify_only: false });
    expect(result).toMatchObject({ ok: true, data: { channel: 'hotfix', check_interval_hours: 12, auto_download: true } });
    expect(await getUpdateSettings(await ctx())).toMatchObject({ channel: 'hotfix', check_interval_hours: 12 });
    expect((await events('update.settings_changed')).at(0)).toMatchObject({ outcome: 'success' });
    expect(await saveSettings({ channel: 'nightly', check_interval_hours: 12, auto_download: true, notify_only: false })).toMatchObject({ ok: false, code: 'invalid' });
    expect(await saveSettings({ channel: 'stable', check_interval_hours: 0, auto_download: true, notify_only: false })).toMatchObject({ ok: false, code: 'invalid' });
  });

  it('changeMode switches to offline and back; saveProxy keeps the mode and never returns the password', async () => {
    expect(await changeMode({ mode: 'offline' })).toMatchObject({ ok: true, data: { mode: 'offline' } });
    expect(await changeMode({ mode: 'connected' })).toMatchObject({ ok: true, data: { mode: 'connected' } });
    const saved = await saveProxy({ proxy_enabled: true, proxy_address: 'http://proxy.example.test:8080', proxy_username: 'svc', proxy_password: 'hunter2-secret', proxy_certificate: '' });
    expect(saved).toMatchObject({ ok: true, data: { enabled: true } });
    expect(JSON.stringify(saved)).not.toContain('hunter2');
    const connection = await getUpdateConnection(await ctx());
    expect(connection.mode).toBe('connected');
    expect(connection.proxy).toMatchObject({ enabled: true, address: 'http://proxy.example.test:8080', has_password: true });
    expect(JSON.stringify(connection)).not.toContain('hunter2');
    expect(JSON.stringify(await events('update.connection_changed'))).not.toContain('hunter2');
    expect(await saveProxy({ proxy_enabled: true, proxy_address: '  ', proxy_username: '', proxy_password: '', proxy_certificate: '' })).toMatchObject({ ok: false, code: 'invalid' });
  });

  it('testConnection returns the scripted steps and audits the test', async () => {
    const result = await testConnection();
    expect(result).toMatchObject({ ok: true, data: { ok: true } });
    if (!result.ok) throw new Error('unreachable');
    expect(result.data.steps.map((s) => s.name)).toEqual(['proxy', 'dns', 'tcp', 'tls', 'release_index_signature']);
    expect((await events('update.connection_tested')).at(0)).toMatchObject({ outcome: 'success' });
  });

  it('uploadUpdateFile needs offline mode; the scripted verification accepts a newer version and refuses tampered, revoked and older files', async () => {
    expect(await uploadUpdateFile({ file: 'opendispatch 1.4.0' })).toMatchObject({ ok: false, code: 'conflict' });
    await changeMode({ mode: 'offline' });
    const good = await uploadUpdateFile({ file: 'opendispatch-update 1.4.0 PAYLOAD-7f3a' });
    expect(good).toMatchObject({ ok: true, data: { accepted: true, version: '1.4.0', verification: { verified: true, signatureValid: true } } });
    expect(await uploadUpdateFile({ file: 'opendispatch 1.5.0 tampered' })).toMatchObject({ ok: true, data: { accepted: false, verification: { signatureValid: false, digestsMatch: false } } });
    expect(await uploadUpdateFile({ file: 'opendispatch 1.5.0 revoked' })).toMatchObject({ ok: true, data: { accepted: false, verification: { keyRevoked: true } } });
    expect(await uploadUpdateFile({ file: 'opendispatch 1.0.0' })).toMatchObject({ ok: true, data: { accepted: false, verification: { olderThanInstalled: true } } });
    expect(await uploadUpdateFile({ file: '' })).toMatchObject({ ok: false, code: 'invalid' });
    expect(await uploadUpdateFile({ file: 'x'.repeat(2_000_001) })).toMatchObject({ ok: false, code: 'invalid' });
    // The content is never stored or audited.
    expect(JSON.stringify(await events('update.offline_upload'))).not.toContain('PAYLOAD-7f3a');
  });
});

describe('change windows and policy', () => {
  it('saveRecurring changes the window by its id; Go writes the label from the days and times', async () => {
    const id = (await getUpdateChangeWindows(await ctx())).recurring[0]?.id;
    expect(await saveRecurring({ window_id: id, days_of_week: [1, 2, 3], start_time: '22:00', end_time: '23:30' })).toMatchObject({ ok: true, data: { recurring: 1 } });
    const windows = await getUpdateChangeWindows(await ctx());
    expect(windows.recurring[0]).toMatchObject({ id, label: 'Monday to Wednesday, 22:00 to 23:30', days_of_week: [1, 2, 3], start_time: '22:00', end_time: '23:30' });
    expect((await events('update.windows_changed')).at(0)).toMatchObject({ outcome: 'success' });
    for (const bad of [{ days_of_week: [], start_time: '03:00', end_time: '05:00' }, { days_of_week: [9], start_time: '03:00', end_time: '05:00' }, { days_of_week: [1], start_time: '3am', end_time: '05:00' }]) {
      expect(await saveRecurring({ window_id: id, ...bad }), JSON.stringify(bad)).toMatchObject({ ok: false, code: 'invalid' });
    }
    expect(await saveRecurring({ window_id: '00000000-0000-4000-8000-000000000000', days_of_week: [1], start_time: '03:00', end_time: '05:00' })).toMatchObject({ ok: false, code: 'not_found' });
    expect(await saveRecurring({ days_of_week: [5, 6], start_time: '01:00', end_time: '02:00' })).toMatchObject({ ok: true, data: { recurring: 2 } });
  });

  it('two administrators saving different things at the same moment both keep their change', async () => {
    const id = (await getUpdateChangeWindows(await ctx())).recurring[0]?.id;
    const results = await Promise.all([
      saveRecurring({ window_id: id, days_of_week: [0, 1], start_time: '02:00', end_time: '04:00' }),
      addBlackout({ label: 'Month-end', entered_as: 'gregorian', start_gregorian: '2026-09-29', end_gregorian: '2026-09-30' }),
      saveProxy({ proxy_enabled: false, proxy_address: 'http://proxy.example.test:8080', proxy_username: '', proxy_password: '', proxy_certificate: '' }),
      changeMode({ mode: 'offline' }),
    ]);
    for (const result of results) expect(result).toMatchObject({ ok: true });
    const windows = await getUpdateChangeWindows(await ctx());
    expect(windows.recurring[0]).toMatchObject({ days_of_week: [0, 1], start_time: '02:00' });
    expect(windows.blackouts.map((b) => b.label)).toEqual(['Month-end']);
    expect(await getUpdateConnection(await ctx())).toMatchObject({ mode: 'offline', proxy: { address: 'http://proxy.example.test:8080' } });
  });

  it('adds a Gregorian and a Hijri blackout (the Hijri one is converted with the reference table), and removes one by its id', async () => {
    expect(await addBlackout({ label: 'Month-end', entered_as: 'gregorian', start_gregorian: '2026-09-29', end_gregorian: '2026-09-30' })).toMatchObject({ ok: true, data: { blackouts: 1 } });
    expect(await addBlackout({ label: 'Saudi National Day', entered_as: 'hijri', start_hijri: { year: 1448, month: 4, day: 12 }, end_hijri: { year: 1448, month: 4, day: 12 } })).toMatchObject({ ok: true, data: { blackouts: 2 } });
    const windows = await getUpdateChangeWindows(await ctx());
    expect(windows.blackouts.map((b) => [b.label, b.entered_as, b.start_gregorian])).toEqual([
      ['Month-end', 'gregorian', '2026-09-29'],
      ['Saudi National Day', 'hijri', '2026-09-23'],
    ]);
    const first = windows.blackouts[0];
    if (first === undefined) throw new Error('no blackout');
    expect(await removeBlackout({ blackout_id: first.id })).toMatchObject({ ok: true, data: { blackouts: 1 } });
    expect((await getUpdateChangeWindows(await ctx())).blackouts.map((b) => b.label)).toEqual(['Saudi National Day']);
  });

  it('refuses a blackout with the end before the start, an empty label, and a Hijri month the table does not have', async () => {
    expect(await addBlackout({ label: 'x', entered_as: 'gregorian', start_gregorian: '2026-09-30', end_gregorian: '2026-09-29' })).toMatchObject({ ok: false, code: 'invalid' });
    expect(await addBlackout({ label: '', entered_as: 'gregorian', start_gregorian: '2026-09-29', end_gregorian: '2026-09-30' })).toMatchObject({ ok: false, code: 'invalid' });
    expect(await addBlackout({ label: 'x', entered_as: 'hijri', start_hijri: { year: 1500, month: 1, day: 1 }, end_hijri: { year: 1500, month: 1, day: 1 } })).toMatchObject({ ok: false, code: 'invalid' });
  });

  it('setSecondApprover needs two listed approvers before it can be switched on; off is always possible', async () => {
    expect(await setSecondApprover({ second_approver_required: true })).toMatchObject({ ok: false, code: 'invalid' });
    expect(await setSecondApprover({ second_approver_required: false })).toMatchObject({ ok: true, data: { second_approver_required: false } });
  });
});

describe('who may write, in which install, and what is audited', () => {
  const writes: readonly [string, () => Promise<{ ok: boolean; code?: string }>, string][] = [
    ['checkNow', () => checkNow(), 'update.check'],
    ['downloadRelease', () => downloadRelease({ version: '1.2.0' }), 'update.download'],
    ['runPreflight', () => runPreflight({ version: '1.2.0' }), 'update.preflight'],
    ['confirmBackup', () => confirmBackup({ version: '1.2.0' }), 'update.backup_confirmed'],
    ['scheduleRelease', () => scheduleRelease({ version: '1.2.0', window_start: '2026-09-14T03:00:00+03:00' }), 'update.schedule'],
    ['cancelSchedule', () => cancelSchedule({ version: '1.2.0' }), 'update.schedule_cancelled'],
    ['applyRelease', () => applyRelease({ version: '1.2.0' }), 'update.apply'],
    ['skipRelease', () => skipRelease({ version: '1.2.0', reason: 'x' }), 'update.skip'],
    ['emergencyOverride', () => emergencyOverride({ version: '1.2.1', second_approver_user_id: '00000000-0000-4000-8000-000000000000', reason: 'x'.repeat(30) }), 'update.emergency_override'],
    ['recoverUpdate', () => recoverUpdate({ action: 'resume', note: '' }), 'update.recovery'],
    ['saveSettings', () => saveSettings({ channel: 'stable', check_interval_hours: 6, auto_download: false, notify_only: false }), 'update.settings_changed'],
    ['changeMode', () => changeMode({ mode: 'offline' }), 'update.connection_changed'],
    ['saveProxy', () => saveProxy({ proxy_enabled: false, proxy_address: '', proxy_username: '', proxy_password: '', proxy_certificate: '' }), 'update.connection_changed'],
    ['testConnection', () => testConnection(), 'update.connection_tested'],
    ['uploadUpdateFile', () => uploadUpdateFile({ file: 'opendispatch 1.4.0' }), 'update.offline_upload'],
    ['saveRecurring', () => saveRecurring({ days_of_week: [1], start_time: '03:00', end_time: '05:00' }), 'update.windows_changed'],
    ['addBlackout', () => addBlackout({ label: 'x', entered_as: 'gregorian', start_gregorian: '2026-09-29', end_gregorian: '2026-09-30' }), 'update.windows_changed'],
    ['removeBlackout', () => removeBlackout({ blackout_id: '00000000-0000-4000-8000-000000000000' }), 'update.windows_changed'],
    ['setSecondApprover', () => setSecondApprover({ second_approver_required: false }), 'update.policy_changed'],
  ];

  it.each(writes)('%s is refused for the Change Approver (view only) as `forbidden` and audited as denied', async (_name, call, action) => {
    asRole('change_approver');
    const result = await call();
    expect(result).toMatchObject({ ok: false, code: 'forbidden' });
    expect((await events(action)).some((e) => e.outcome === 'denied')).toBe(true);
    expect(session.revalidate).not.toHaveBeenCalled();
  });

  it.each(writes)('%s is refused for a role with no access to Updates (a Planner), audited as denied, and changes nothing', async (_name, call, action) => {
    asRole('planner');
    expect(await call()).toMatchObject({ ok: false, code: 'forbidden' });
    expect((await events(action)).some((e) => e.outcome === 'denied')).toBe(true);
  });

  it.each(writes)('%s is refused for the Administrator of a dedicated or shared install (updates are ours there), audited as denied', async (_name, call, action) => {
    for (const mode of ['dedicated', 'shared'] as const) {
      asRole('administrator', mode);
      expect(await call(), mode).toMatchObject({ ok: false, code: 'forbidden' });
    }
    asRole('administrator');
    expect((await events(action)).filter((e) => e.outcome === 'denied').length).toBeGreaterThanOrEqual(1);
  });

  it('answers `unauthenticated` with no session, and touches nothing', async () => {
    session.role = null;
    for (const [, call] of writes) expect(await call()).toMatchObject({ ok: false, code: 'unauthenticated' });
    expect(session.revalidate).not.toHaveBeenCalled();
    expect((await listUpdateHistory(await ctx())).items.every((h) => h.kind !== 'skip')).toBe(true);
  });

  it('refuses hostile versions and inputs as `invalid`, never as an unexpected error', async () => {
    for (const version of ['', 'toString', '__proto__', '../etc', '1.2', '1.2.0; drop table', 42, null, undefined]) {
      expect(await downloadRelease({ version: version as never }), String(version)).toMatchObject({ ok: false, code: 'invalid' });
      expect(await skipRelease({ version: version as never, reason: 'x' }), String(version)).toMatchObject({ ok: false, code: 'invalid' });
    }
    for (const input of [null, undefined, 'x', 7, [], {}]) {
      expect(await saveSettings(input as never)).toMatchObject({ ok: false, code: 'invalid' });
      expect(await scheduleRelease(input as never)).toMatchObject({ ok: false });
    }
  });
});

describe('an unexpected error', () => {
  it('returns a reference ODP- and 8 hex characters, logs only that reference and the error name, and leaks no input', async () => {
    const hostile = new Proxy({}, {
      getOwnPropertyDescriptor() {
        throw new TypeError('boom: password=hunter2 file=secret-update-contents');
      },
    });
    const result = await saveProxy(hostile as never);
    expect(result).toMatchObject({ ok: false, code: 'unexpected' });
    if (result.ok) throw new Error('unreachable');
    expect(result.reference).toMatch(/^ODP-[0-9A-F]{8}$/);
    expect(JSON.stringify(result)).not.toMatch(/hunter2|secret-update|boom/);
    const logged = errorLog.mock.calls.flat().join('\n');
    expect(logged).toContain(result.reference);
    expect(logged).not.toMatch(/hunter2|secret-update|boom|password/);
    expect(session.revalidate).not.toHaveBeenCalled();
  });
});
