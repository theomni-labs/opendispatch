// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { InstallMode, Role } from '@/lib/access';
import { listAuditEvents } from '@/lib/data/audit';
import { buildContext, fixtureTenantId } from '@/lib/data/go-test-reset';
import type { RequestContext } from '@/lib/data/guard';
import { fixtureUsers, syncGoClock } from '@/lib/data/go-test-reset';
import { applyUpdate, approveUpdate, confirmUpdateBackup, requestUpdateRecovery, runUpdatePreflight, scheduleUpdate, startUpdateDownload } from '@/lib/data/updates';
import { compareVersions, decisionGate, isWaitingForBackup, loadUpdatesView, openReleases, pickFocus, stageOf } from './view';
import type { FullUpdatesView } from './types';

// The view against the real data layer and the committed fixtures, with the demo store in a temp folder and the clock of the data
// layer moved by hand (a download and a restore request take seconds in the scripted agent).
function ctxOf(role: Role, installMode: InstallMode = 'private'): RequestContext {
  const tenant = fixtureTenantId();
  const built = buildContext({ role, installMode, zoneIds: [] }, fixtureUsers(), tenant);
  if (built === null) throw new Error(`no context for ${role}`);
  return built;
}
const admin = () => ctxOf('administrator');
const approver = () => ctxOf('change_approver');
const T0 = '2026-09-13T10:00:00+03:00';
const at = async (seconds: number) => {
  vi.setSystemTime(new Date(Date.parse(T0) + seconds * 1000));
  await syncGoClock();
};

beforeEach(async () => {
  await fetch(`${process.env['OPENDISPATCH_API_URL']}/_internal/test/reset`, { method: 'POST' });
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(T0));
  await syncGoClock();
});
afterEach(() => {
  vi.useRealTimers();
});

const full = async (mode: 'en' | 'ar' = 'en', release?: string): Promise<FullUpdatesView> => {
  const view = await loadUpdatesView(admin(), { reduced: false, locale: mode, query: { release } });
  if (view.kind !== 'full') throw new Error('expected the full view');
  return view;
};

describe('versions and the release the card shows', () => {
  it('compares versions as numbers, not as text', () => {
    expect(compareVersions('1.10.0', '1.9.0')).toBeGreaterThan(0);
    expect(compareVersions('1.2.0', '1.2.0')).toBe(0);
    expect(compareVersions('1.2.1', '1.3.0')).toBeLessThan(0);
  });

  const listed = [
    { version: '1.3.0', channel: 'stable' as const, state: 'available', published_at: 'x' },
    { version: '1.2.0', channel: 'stable' as const, state: 'available', published_at: 'x' },
    { version: '1.1.0', channel: 'stable' as const, state: 'applied', published_at: 'x' },
    { version: '1.2.1', channel: 'hotfix' as const, state: 'verified', published_at: 'x' },
    { version: '1.0.5', channel: 'stable' as const, state: 'available', published_at: 'x' },
    { version: '1.4.0', channel: 'stable' as const, state: 'skipped', published_at: 'x' },
  ];

  it('an open release is available, downloading, verified, ready, scheduled or discarded, and newer than what runs; oldest first', () => {
    expect(openReleases(listed, '1.1.0').map((r) => r.version)).toEqual(['1.2.0', '1.2.1', '1.3.0']);
  });

  it('the card shows ?release= when it is open, else the release furthest along, the oldest among equals', () => {
    const open = openReleases(listed, '1.1.0');
    expect(pickFocus(open, '1.3.0')?.version).toBe('1.3.0');
    expect(pickFocus(open, '9.9.9')?.version).toBe('1.2.1');
    expect(pickFocus(open, undefined)?.version).toBe('1.2.1');
    expect(pickFocus(open.filter((r) => r.state === 'available'), undefined)?.version).toBe('1.2.0');
    expect(pickFocus([], undefined)).toBeUndefined();
  });

  it('maps the agent state to the stage of the card', () => {
    expect(stageOf('available', null, null)).toBe('available');
    expect(stageOf('downloading', { state: 'downloading' }, null)).toBe('downloading');
    expect(stageOf('downloading', { state: 'verifying' }, null)).toBe('verifying');
    expect(stageOf('verified', null, null)).toBe('verified');
    expect(stageOf('ready', null, null)).toBe('ready');
    expect(stageOf('scheduled', null, { state: 'awaiting_approval' })).toBe('awaiting');
    expect(stageOf('scheduled', null, { state: 'approved' })).toBe('approved');
    expect(stageOf('withdrawn', { state: 'failed' }, null)).toBe('verify_failed');
    expect(stageOf('applied', null, null)).toBeNull();
    expect(stageOf('rejected', null, null)).toBeNull();
  });

  it('a pre-flight that failed with a check waiting for the backup and none failed is waiting, not failed', () => {
    const check = (id: string, status: string) => ({ id: id as never, status: status as never, message: null });
    expect(isWaitingForBackup({ state: 'failed', estimateSeconds: null, checks: [check('a', 'passed'), check('recent_backup', 'needs_confirmation')] })).toBe(true);
    expect(isWaitingForBackup({ state: 'failed', estimateSeconds: null, checks: [check('a', 'failed'), check('recent_backup', 'needs_confirmation')] })).toBe(false);
    expect(isWaitingForBackup({ state: 'passed', estimateSeconds: null, checks: [check('a', 'passed')] })).toBe(false);
    expect(isWaitingForBackup(null)).toBe(false);
  });
});

describe('who may decide a scheduled update', () => {
  const policy = { approver_user_ids: [] as string[], second_approver_required: false, emergency_override_enabled: true, emergency_reason_min_length: 20 };
  const scheduled = (requester: string, approvals: { approver: { user_id: string } }[] = []) => ({ state: 'awaiting_approval', requested_by: { user_id: requester, display_name: 'x' }, approvals }) as never;

  it('only an approver role, never the requester, only a listed approver, and only once', () => {
    const me = approver();
    expect(decisionGate(me, null, policy)).toBe('nothing_to_decide');
    expect(decisionGate(me, { state: 'approved' } as never, policy)).toBe('nothing_to_decide');
    expect(decisionGate(admin(), scheduled('someone'), policy)).toBe('not_an_approver_role');
    expect(decisionGate(me, scheduled(me.userId), policy)).toBe('own_request');
    expect(decisionGate(me, scheduled('someone'), { ...policy, approver_user_ids: ['not-me'] })).toBe('not_listed');
    expect(decisionGate(me, scheduled('someone', [{ approver: { user_id: me.userId } }]), policy)).toBe('already_decided');
    expect(decisionGate(me, scheduled('someone'), { ...policy, approver_user_ids: [me.userId] })).toBe('allowed');
  });
});

describe('the view', () => {
  it('the full view of a fresh install: connected, 1.1.0, release 1.2.0 available with three others, the seeded windows and history', async () => {
    const view = await full();
    expect(view.status).toMatchObject({ currentVersion: '1.1.0', channel: 'stable', connectionMode: 'connected', agentState: 'idle', inMaintenance: false, fallbackActive: false });
    expect(view.overview.mode).toBe('release');
    expect(view.overview.release).toMatchObject({ version: '1.2.0', stage: 'available', channel: 'stable', needsDowntime: false });
    expect(view.overview.others.map((o) => o.version)).toEqual(['1.2.1', '1.3.0', '1.3.1']);
    expect(view.overview.polling).toBe(false);
    expect(view.overview.recovery).toBeNull();
    expect(view.overview.nextWindow?.open).toBe(true);
    expect(view.windows.recurring[0]).toMatchObject({ days: [0, 1, 2, 3, 4], start: '03:00', end: '05:00' });
    expect(view.windows.upcoming).toHaveLength(14);
    expect(view.windows.months.length).toBeGreaterThan(10);
    expect(view.history.map((h) => h.version)).toEqual(['1.1.0', '1.0.0']);
    expect(view.overview.approvers.map((a) => a.name)).toEqual(['Saad Al-Nabari']);
  });

  it('gives the release notes in the reader\'s language', async () => {
    expect((await full('en')).overview.release?.notes).toMatch(/^Prayer-time-aware/);
    expect((await full('ar')).overview.release?.notes).toMatch(/مخطط استراحات/);
  });

  it('polls only while a download phase or a restore request is under way', async () => {
    await startUpdateDownload(admin(), '1.2.0');
    await at(1);
    expect((await full()).overview).toMatchObject({ polling: true, release: { stage: 'downloading' } });
    await at(4.5);
    expect((await full()).overview).toMatchObject({ polling: true, release: { stage: 'verifying' } });
    await at(7);
    expect((await full()).overview).toMatchObject({ polling: false, release: { stage: 'verified' } });
  });

  it('while the release verifies the view carries no verification result, so no per-check progress can be drawn', async () => {
    await startUpdateDownload(admin(), '1.2.0');
    await at(5);
    expect((await full()).overview.release?.download?.verification).toBeNull();
  });

  it('a release that waits for the backup after the pre-flight says so; confirming makes it ready', async () => {
    await startUpdateDownload(admin(), '1.2.0');
    await at(7);
    await runUpdatePreflight(admin(), '1.2.0');
    expect((await full()).overview.release).toMatchObject({ stage: 'verified', waitingForBackup: true });
    await confirmUpdateBackup(admin(), '1.2.0', {});
    expect((await full()).overview.release).toMatchObject({ stage: 'ready', waitingForBackup: false });
  });

  it('recovery: needs attention names the failed migration and the failed release; a restore request follows the clock and the view keeps its run', async () => {
    for (const step of [async () => await startUpdateDownload(admin(), '1.3.1'), () => at(7), async () => await runUpdatePreflight(admin(), '1.3.1'), async () => await confirmUpdateBackup(admin(), '1.3.1', {}), async () => await scheduleUpdate(admin(), '1.3.1', {}), async () => await approveUpdate(approver(), '1.3.1', {}), async () => await applyUpdate(admin(), '1.3.1')]) await step();
    let view = await full();
    expect(view.overview).toMatchObject({ mode: 'needs_attention', release: null, recovery: { version: '1.3.1', failedMigration: '20260911_backfill_zone_codes', restore: null, backupReference: 'backup-before-1.3.1' } });
    expect(view.status).toMatchObject({ agentState: 'needs_attention', inMaintenance: true, fallbackActive: true });
    await requestUpdateRecovery(admin(), { action: 'restore', note: 'n' });
    view = await full();
    expect(view.overview).toMatchObject({ mode: 'restore_requested', polling: true, recovery: { restore: { state: 'requested' }, note: 'n' } });
    expect(view.overview.recovery?.run?.state).toBe('needs_attention');
    await at(11);
    expect((await full()).overview.mode).toBe('restore_in_progress');
    await at(16);
    view = await full();
    expect(view.overview).toMatchObject({ mode: 'restored', polling: false, recovery: { restore: { state: 'completed' } } });
    expect(view.overview.release?.version).toBe('1.2.0');
  });

  it('the newest history entry becomes the last result: rolled back, and resumed', async () => {
    for (const step of [async () => await startUpdateDownload(admin(), '1.3.0'), () => at(7), async () => await runUpdatePreflight(admin(), '1.3.0'), async () => await confirmUpdateBackup(admin(), '1.3.0', {}), async () => await scheduleUpdate(admin(), '1.3.0', {}), async () => await approveUpdate(approver(), '1.3.0', {}), async () => await applyUpdate(admin(), '1.3.0')]) await step();
    expect((await full()).overview.lastResult).toMatchObject({ kind: 'rolled_back', version: '1.3.0', from: '1.1.0' });
  });

  it('the reduced view reads only the summary: it works in a dedicated install, and leaves no denied event behind', async () => {
    const view = await loadUpdatesView(ctxOf('administrator', 'dedicated'), { reduced: true, locale: 'en' });
    expect(view).toMatchObject({ kind: 'reduced', installMode: 'dedicated', currentVersion: '1.1.0' });
    if (view.kind !== 'reduced') throw new Error('unreachable');
    expect(view.notes.map((n) => n.version)).toEqual(['1.1.0', '1.0.0']);
    expect((await listAuditEvents(admin(), { action: 'update.read', limit: 20 })).items).toHaveLength(0);
    // Even when the access model says "full", a non-private install never reaches the full reads.
    expect((await loadUpdatesView(ctxOf('administrator', 'shared'), { reduced: false, locale: 'en' })).kind).toBe('reduced');
    expect((await listAuditEvents(admin(), { action: 'update.read', limit: 20 })).items).toHaveLength(0);
  });

  it('the emergency choices list the verified releases (a hotfix first), the active Change Approvers, and the minimum reason length', async () => {
    expect((await full()).emergency.releases).toEqual([]);
    await startUpdateDownload(admin(), '1.2.1');
    await startUpdateDownload(admin(), '1.2.0');
    await at(7);
    const choices = (await full()).emergency;
    expect(choices.releases.map((r) => r.version)).toEqual(['1.2.1', '1.2.0']);
    expect(choices.secondApprovers.map((a) => a.name)).toContain('Saad Al-Nabari');
    expect(choices).toMatchObject({ minLength: 20, enabled: true });
    expect(choices.firstApprover).not.toBe('');
  });
});
