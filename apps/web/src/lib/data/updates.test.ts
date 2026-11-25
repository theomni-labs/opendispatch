// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { InstallMode } from '@/lib/access';
import type { Notification } from '@/lib/types';
import { listAuditEvents } from './audit';
import { deterministicUuid } from './context';
import { ConflictError, ForbiddenError, InvalidInputError, NotFoundError, UnauthenticatedError } from './errors';
import type { RequestContext } from './guard';
import {
  applyUpdate,
  approveUpdate,
  cancelScheduledUpdate,
  checkForUpdatesNow,
  confirmUpdateBackup,
  getNextUpdateWindow,
  getOfflineUpdateUpload,
  getUpdateChangePolicy,
  getUpdateChangeWindows,
  getUpdateConnection,
  getUpdateDownloadState,
  getUpdatePreflight,
  getUpdateRecovery,
  getUpdateRelease,
  getUpdateRun,
  getUpdateSettings,
  getUpdateStatus,
  getUpdatesSummary,
  listUpdateHistory,
  listUpdateReleases,
  patchUpdateChangePolicy,
  patchUpdateChangeWindows,
  patchUpdateConnection,
  rejectUpdate,
  requestUpdateEmergencyOverride,
  requestUpdateRecovery,
  runUpdatePreflight,
  scheduleUpdate,
  skipUpdate,
  startUpdateDownload,
  testUpdateConnection,
  updateUpdateChangePolicy,
  updateUpdateChangeWindows,
  updateUpdateConnection,
  updateUpdateSettings,
  uploadOfflineUpdate,
} from './updates';
import { listNotificationLog } from './notifications';
import { auditCount, ctxFor, resetGoTestState, dataSnapshot, expectJunkIdsForbiddenLive, expectJunkIdsInvalidLive, expectValid, patchGoUpdatesState, putSettingForTest, syncGoClock, withTempDemoState } from './test-support';

const DOWNLOAD_PACE_SETTING = 'updates.stub_download_pace';
const DOWNLOAD_MS = 4000;
const VERIFY_MS = 2000;
const RESTORE_IN_PROGRESS_AFTER_MS = 3000;
const RESTORE_COMPLETED_AFTER_MS = 7000;

withTempDemoState();

const admin = (): RequestContext => ctxFor('administrator');
const approver = (): RequestContext => ctxFor('change_approver');

// A download takes a few seconds in the scripted agent (the `demo` pace: downloading, then verifying, then the result). The tests
// below that predate the phases drive whole flows in milliseconds, so they run at the `instant` pace, which is the old behaviour
// (the call that starts a download also ends it). The tests of the phases switch the pace back.
async function setPace(pace: 'demo' | 'instant'): Promise<void> {
  await putSettingForTest(admin(), DOWNLOAD_PACE_SETTING, pace);
}
beforeEach(async () => {
  await resetGoTestState();
  await setPace('instant');
});

async function notificationsNow(): Promise<Notification[]> {
  return [...(await listNotificationLog(ctxFor('administrator'), { limit: 200 })).items];
}

function firstApproverId(): string {
  return approver().userId;
}

/** Download, confirm the backup (which re-runs pre-flight), schedule, approve: the release is ready to apply. */
async function driveToApproved(version: string): Promise<void> {
  await startUpdateDownload(admin(), version);
  await confirmUpdateBackup(admin(), version, {});
  await scheduleUpdate(admin(), version, {});
  await approveUpdate(approver(), version, { note: 'Approved.' });
}

async function audits(action: string, outcome?: 'success' | 'denied') {
  return (await listAuditEvents(ctxFor('viewer_auditor'), { action, ...(outcome === undefined ? {} : { outcome }), limit: 200 })).items;
}

describe('overview: current state', () => {
  it('reports the installed version, releases and the next window, all matching the contract', async () => {
    const ctx = admin();
    const status = await getUpdateStatus(ctx);
    expectValid('UpdateStatus', status);
    expect(status).toMatchObject({ current_version: '1.1.0', previous_version: '1.0.0', channel: 'stable', connection_mode: 'connected', state: 'idle', in_maintenance: false, notify_only: false });
    expect(status.next_window_start).toBe('2026-09-14T03:00:00+03:00');
    const list = await listUpdateReleases(ctx);
    expectValid('UpdateReleaseList', list);
    expect(list.items.map((r) => r.version)).toEqual(['1.3.1', '1.3.0', '1.2.1', '1.2.0', '1.1.0', '1.0.0']);
    const detail = await getUpdateRelease(ctx, '1.3.0');
    expectValid('UpdateReleaseDetail', detail);
    expect(detail.manifest).toMatchObject({ needs_downtime: true, live_assignment_fallback: true });
    expectValid('UpdateDownloadState', await getUpdateDownloadState(ctx, '1.2.0'));
    expect((await getUpdateDownloadState(ctx, '1.2.0')).state).toBe('not_started');
    expect((await getUpdatePreflight(ctx, '1.2.0')).state).toBe('not_run');
    await expect(getUpdateRelease(ctx, '9.9.9')).rejects.toThrow(NotFoundError);
    await expect(getUpdateRelease(ctx, 'latest')).rejects.toThrow(InvalidInputError);
  });

  it('pages the release list and filters history by time', async () => {
    const ctx = admin();
    const first = await listUpdateReleases(ctx, { limit: 2 });
    expect(first.items).toHaveLength(2);
    expect(first.page.has_more).toBe(true);
    const second = await listUpdateReleases(ctx, { limit: 2, cursor: first.page.next_cursor as string });
    expect(second.items.map((r) => r.version)).toEqual(['1.2.1', '1.2.0']);
    const history = await listUpdateHistory(ctx, { from: '2026-08-01T00:00:00+03:00', to: '2026-09-01T00:00:00+03:00' });
    expectValid('UpdateHistoryList', history);
    expect(history.items.map((h) => h.version)).toEqual(['1.1.0']);
    expect((await listUpdateHistory(ctx)).items.map((h) => h.version)).toEqual(['1.1.0', '1.0.0']);
  });

  it('lets a Change Approver read but not change anything', async () => {
    const ctx = approver();
    expect((await getUpdateStatus(ctx)).current_version).toBe('1.1.0');
    await expect(checkForUpdatesNow(ctx)).rejects.toThrow(ForbiddenError);
    await expect(scheduleUpdate(ctx, '1.2.0', {})).rejects.toThrow(ForbiddenError);
    await expect(applyUpdate(ctx, '1.2.0')).rejects.toThrow(ForbiddenError);
    expect(await audits('update.apply', 'denied')).toHaveLength(1);
  });
});

describe('run 1: success, health checks pass', () => {
  it('goes through download, pre-flight, backup confirmation, schedule, approval and apply', async () => {
    const a = admin();
    // check now
    const checked = await checkForUpdatesNow(a);
    expectValid('UpdateStatus', checked);
    expect(checked.last_check_result).toBe('update_found');
    // download and verify
    const download = await startUpdateDownload(a, '1.2.0');
    expectValid('UpdateDownloadState', download);
    expect(download).toMatchObject({ state: 'verified', verification: { verified: true, signature_valid: true, digests_match: true, key_revoked: false, older_than_installed: false } });
    expect((await getUpdateRelease(a, '1.2.0')).summary.state).toBe('verified');
    await expect(startUpdateDownload(a, '1.2.0')).rejects.toThrow(ConflictError);
    // pre-flight: the backup needs confirming
    const pre = await runUpdatePreflight(a, '1.2.0');
    expectValid('UpdatePreflightResult', pre);
    expect(pre.state).toBe('failed');
    expect(pre.checks.map((c) => c.id)).toEqual(['disk_and_registry_space', 'database_reachable', 'recent_backup', 'upgrade_path_allowed', 'system_healthy', 'migration_rehearsal']);
    expect(pre.checks.find((c) => c.id === 'recent_backup')?.status).toBe('needs_confirmation');
    expect((await getUpdateRelease(a, '1.2.0')).summary.state).toBe('verified');
    await expect(scheduleUpdate(a, '1.2.0', {})).rejects.toThrow(ConflictError);
    const confirmed = await confirmUpdateBackup(a, '1.2.0', { note: 'Backup taken at 02:00.' });
    expect(confirmed.state).toBe('passed');
    expect(confirmed.checks.every((c) => c.status === 'passed')).toBe(true);
    expect(await getUpdateStatus(a)).toMatchObject({ state: 'ready', ready_release_version: '1.2.0' });
    // schedule into the next open window: awaiting approval by default
    const scheduled = await scheduleUpdate(a, '1.2.0', {});
    expectValid('UpdateScheduledUpdate', scheduled);
    expect(scheduled).toMatchObject({ version: '1.2.0', window_start: '2026-09-14T03:00:00+03:00', window_end: '2026-09-14T05:00:00+03:00', state: 'awaiting_approval', second_approver_required: false });
    expect(scheduled.requested_by.user_id).toBe(a.userId);
    await expect(applyUpdate(a, '1.2.0')).rejects.toThrow(ConflictError);
    // approval by the Change Approver
    const approved = await approveUpdate(approver(), '1.2.0', { note: 'Go.' });
    expectValid('UpdateScheduledUpdate', approved);
    expect(approved.state).toBe('approved');
    expect(approved.approvals).toHaveLength(1);
    expect(approved.approvals[0]).toMatchObject({ decision: 'approved', note: 'Go.' });
    // apply
    const run = await applyUpdate(a, '1.2.0');
    expectValid('UpdateApplyRun', run);
    expect(run).toMatchObject({ version: '1.2.0', kind: 'update', state: 'succeeded', health_check_passed: true, maintenance_on: false, live_assignment_fallback: false });
    expect(run.steps.every((s) => s.state === 'succeeded' || s.state === 'skipped')).toBe(true);
    expect(run.steps.find((s) => s.name === 'smoke_tests')?.state).toBe('succeeded');
    expect(await getUpdateRun(a, run.run_id)).toEqual(run);
    // state and history
    expect(await getUpdateStatus(a)).toMatchObject({ current_version: '1.2.0', previous_version: '1.1.0', state: 'idle', ready_release_version: null });
    expect((await getUpdateRelease(a, '1.2.0')).summary.state).toBe('applied');
    expect((await getUpdateRelease(a, '1.2.0')).scheduled?.state).toBe('applied');
    const history = await listUpdateHistory(a);
    expect(history.items[0]).toMatchObject({ version: '1.2.0', from_version: '1.1.0', kind: 'update', result: 'succeeded', window_start: '2026-09-14T03:00:00+03:00' });
    expect(history.items[0]?.approved_by.map((p) => p.display_name)).toEqual(['Saad Al-Nabari']);
    expect((await getUpdatesSummary(a)).release_notes.map((n) => n.version)).toEqual(['1.2.0', '1.1.0', '1.0.0']);
    // audited, each step, all marked stub
    for (const action of ['update.check', 'update.download', 'update.preflight', 'update.backup_confirmed', 'update.schedule', 'update.approve', 'update.apply']) {
      const events = await audits(action, 'success');
      expect(events.length, action).toBeGreaterThan(0);
      expect(events[0]?.summary_en, action).toContain('stub');
    }
  });

  it('refuses steps out of order', async () => {
    const a = admin();
    await expect(runUpdatePreflight(a, '1.2.0')).rejects.toThrow(ConflictError);
    await expect(scheduleUpdate(a, '1.2.0', {})).rejects.toThrow(ConflictError);
    await expect(applyUpdate(a, '1.2.0')).rejects.toThrow(ConflictError);
    await expect(approveUpdate(approver(), '1.2.0', {})).rejects.toThrow(ConflictError);
  });
});

describe('run 2: the health check fails and the system rolls back by itself', () => {
  it('leaves the version unchanged, records the rollback and raises an alert', async () => {
    const a = admin();
    await driveToApproved('1.3.0');
    const run = await applyUpdate(a, '1.3.0');
    expectValid('UpdateApplyRun', run);
    expect(run).toMatchObject({ version: '1.3.0', kind: 'update', state: 'rolled_back', health_check_passed: false, maintenance_on: false, live_assignment_fallback: true });
    const byName = Object.fromEntries(run.steps.map((s) => [s.name, s.state]));
    expect(byName).toMatchObject({ helm_upgrade: 'succeeded', smoke_tests: 'failed', maintenance_off: 'succeeded', report: 'succeeded' });
    // the installed version did not change
    expect(await getUpdateStatus(a)).toMatchObject({ current_version: '1.1.0', previous_version: '1.0.0', state: 'idle', in_maintenance: false, live_assignment_fallback_active: false });
    expect((await getUpdateRelease(a, '1.3.0')).summary.state).toBe('available');
    expect((await getUpdateRelease(a, '1.3.0')).scheduled).toBeNull();
    // history
    const entry = (await listUpdateHistory(a)).items[0];
    expect(entry).toMatchObject({ version: '1.3.0', from_version: '1.1.0', kind: 'update', result: 'rolled_back' });
    expect(entry?.note).toContain('rolled back by itself');
    // an alert in the store: critical, update category, to the Administrator and the Change Approver
    const alerts = (await notificationsNow()).filter((n) => n.category === 'update' && n.title_en.includes('1.3.0'));
    expect(alerts.map((n) => n.recipient_role).sort()).toEqual(['administrator', 'change_approver']);
    for (const n of alerts) {
      expectValid('Notification', n);
      expect(n).toMatchObject({ severity: 'critical', link_path: '/admin/updates', is_read: false });
    }
    // audited
    expect((await audits('update.apply', 'success'))[0]?.detail).toMatchObject({ state: 'rolled_back', health_check_passed: false });
  });
});

describe('run 3: an offline file is uploaded and verified', () => {
  it('needs offline mode, verifies the file and lets the release go through the normal flow', async () => {
    const a = admin();
    await expect(uploadOfflineUpdate(a, { file: 'opendispatch-release-1.4.0.bundle' })).rejects.toThrow(ConflictError);
    const connection = await updateUpdateConnection(a, { mode: 'offline' });
    expectValid('UpdateConnectionSettings', connection);
    expect(connection).toMatchObject({ mode: 'offline', allowed_endpoints: [] });
    await expect(checkForUpdatesNow(a)).rejects.toThrow(ConflictError);
    await expect(startUpdateDownload(a, '1.2.0')).rejects.toThrow(ConflictError);
    expect(await getUpdateStatus(a)).toMatchObject({ connection_mode: 'offline', release_index_valid_until: null });

    const upload = await uploadOfflineUpdate(a, { file: 'opendispatch-release-1.4.0.bundle' });
    expectValid('UpdateOfflineUploadResult', upload);
    expect(upload).toMatchObject({ accepted: true, verification: { verified: true, signature_valid: true, digests_match: true, key_revoked: false, older_than_installed: false, index_expired: false } });
    expect(upload.release).toMatchObject({ version: '1.4.0', state: 'verified' });
    expect(await getOfflineUpdateUpload(a, upload.upload_id)).toEqual(upload);
    expect((await listUpdateReleases(a)).items[0]?.version).toBe('1.4.0');
    expect((await getUpdateDownloadState(a, '1.4.0')).state).toBe('verified');

    // pre-flight, schedule, approve, apply
    await confirmUpdateBackup(a, '1.4.0', {});
    await scheduleUpdate(a, '1.4.0', {});
    await approveUpdate(approver(), '1.4.0', {});
    const run = await applyUpdate(a, '1.4.0');
    expect(run).toMatchObject({ version: '1.4.0', state: 'succeeded', health_check_passed: true });
    expect((await getUpdateStatus(a)).current_version).toBe('1.4.0');
    expect((await audits('update.offline_upload', 'success'))[0]?.summary_en).toContain('accepted');
  });

  it('refuses a tampered file, a revoked key and a version that is not newer, and keeps no release', async () => {
    const a = admin();
    await updateUpdateConnection(a, { mode: 'offline' });
    const tampered = await uploadOfflineUpdate(a, { file: 'opendispatch-release-1.4.0-tampered.bundle' });
    expect(tampered).toMatchObject({ accepted: false, verification: { verified: false, signature_valid: false, digests_match: false } });
    expect(tampered.release).toBeUndefined();
    const revoked = await uploadOfflineUpdate(a, { file: 'opendispatch-release-1.4.0-revoked-key.bundle' });
    expect(revoked).toMatchObject({ accepted: false, verification: { verified: false, signature_valid: true, key_revoked: true } });
    const older = await uploadOfflineUpdate(a, { file: 'opendispatch-release-1.1.0.bundle' });
    expect(older).toMatchObject({ accepted: false, verification: { verified: false, older_than_installed: true } });
    const junk = await uploadOfflineUpdate(a, { file: 'not a release' });
    expect(junk.accepted).toBe(false);
    for (const result of [tampered, revoked, older, junk]) expectValid('UpdateOfflineUploadResult', result);
    expect((await listUpdateReleases(a)).items.map((r) => r.version)).not.toContain('1.4.0');
    await expect(getOfflineUpdateUpload(a, deterministicUuid('nope'))).rejects.toThrow(NotFoundError);
    expect((await notificationsNow()).filter((n) => n.title_en.includes('offline update file was discarded')).length).toBeGreaterThan(0);
    await expect(uploadOfflineUpdate(a, { file: '' })).rejects.toThrow(InvalidInputError);
  });
});

describe('recovery: migration failure, resume, restore, rollback', () => {
  it('stops in maintenance when a migration fails, then resumes', async () => {
    const a = admin();
    await driveToApproved('1.3.1');
    const failed = await applyUpdate(a, '1.3.1');
    expectValid('UpdateApplyRun', failed);
    expect(failed).toMatchObject({ state: 'needs_attention', maintenance_on: true, live_assignment_fallback: true, health_check_passed: null, offered_recovery: ['resume', 'restore'] });
    expect(failed.steps.find((s) => s.name === 'migrate_opendispatch')?.state).toBe('failed');
    expect(await getUpdateStatus(a)).toMatchObject({ state: 'needs_attention', current_version: '1.1.0', in_maintenance: true, live_assignment_fallback_active: true });
    // nothing else can be applied or pre-flighted clean until it is dealt with
    await startUpdateDownload(a, '1.2.0');
    expect((await runUpdatePreflight(a, '1.2.0')).checks.find((c) => c.id === 'system_healthy')?.status).toBe('failed');
    // restore request is recorded, the run still needs attention
    const restore = await requestUpdateRecovery(a, { action: 'restore', run_id: failed.run_id, note: 'Please restore.' });
    expectValid('UpdateRecoveryResult', restore);
    expect(restore).toMatchObject({ action: 'restore', state: 'requested', restore_request: { state: 'requested', backup_reference: 'backup-before-1.3.1' } });
    expect((await getUpdateRun(a, failed.run_id)).state).toBe('needs_attention');
    // resume
    const resumed = await requestUpdateRecovery(a, { action: 'resume' });
    expectValid('UpdateRecoveryResult', resumed);
    expect(resumed.state).toBe('started');
    expect(resumed.run).toMatchObject({ kind: 'resume', version: '1.3.1', state: 'succeeded', health_check_passed: true });
    expect((await getUpdateRun(a, failed.run_id)).state).toBe('failed');
    expect(await getUpdateStatus(a)).toMatchObject({ current_version: '1.3.1', previous_version: '1.1.0', in_maintenance: false, live_assignment_fallback_active: false });
    expect((await listUpdateHistory(a)).items.slice(0, 2).map((h) => `${h.kind}:${h.result}`)).toEqual(['resume:succeeded', 'update:failed']);
    // this release needs a restore to roll back, so a rollback is refused
    expect(await requestUpdateRecovery(a, { action: 'rollback' })).toEqual({ action: 'rollback', state: 'refused' });
  });

  it('rolls back to the recorded previous version', async () => {
    const a = admin();
    await driveToApproved('1.2.0');
    await applyUpdate(a, '1.2.0');
    const result = await requestUpdateRecovery(a, { action: 'rollback', note: 'Rolling back.' });
    expectValid('UpdateRecoveryResult', result);
    expect(result).toMatchObject({ action: 'rollback', state: 'started', run: { kind: 'rollback', version: '1.1.0', state: 'succeeded' } });
    expect(await getUpdateStatus(a)).toMatchObject({ current_version: '1.1.0', previous_version: null });
    expect((await getUpdateRelease(a, '1.2.0')).summary.state).toBe('available');
    expect((await listUpdateHistory(a)).items[0]).toMatchObject({ kind: 'rollback', version: '1.1.0', from_version: '1.2.0', result: 'succeeded' });
    // nothing recorded to go back to now
    expect((await requestUpdateRecovery(a, { action: 'rollback' })).state).toBe('refused');
  });

  it('refuses to resume or restore when nothing needs attention', async () => {
    const a = admin();
    expect(await requestUpdateRecovery(a, { action: 'resume' })).toEqual({ action: 'resume', state: 'refused' });
    expect(await requestUpdateRecovery(a, { action: 'restore' })).toEqual({ action: 'restore', state: 'refused' });
    await expect(requestUpdateRecovery(a, { action: 'explode' })).rejects.toThrow(InvalidInputError);
    await expect(requestUpdateRecovery(a, { action: 'resume', run_id: deterministicUuid('missing') })).rejects.toThrow(NotFoundError);
  });
});

describe('approvals', () => {
  it('lets only a Change Approver approve, never the Administrator, and audits the denial', async () => {
    const a = admin();
    await driveToApprovedUntilScheduled('1.2.0');
    await expect(approveUpdate(a, '1.2.0', {})).rejects.toThrow(ForbiddenError);
    await expect(rejectUpdate(a, '1.2.0', {})).rejects.toThrow(ForbiddenError);
    for (const role of ['planner', 'dispatcher', 'dispatch_supervisor', 'viewer_auditor', 'remote_team_lead'] as const) {
      await expect(approveUpdate(ctxFor(role), '1.2.0', {}), role).rejects.toThrow(ForbiddenError);
    }
    expect(await audits('update.approve', 'denied')).toHaveLength(6);
    expect(await audits('update.reject', 'denied')).toHaveLength(1);
    expect((await getUpdateRelease(a, '1.2.0')).scheduled?.state).toBe('awaiting_approval');
  });

  it('approves on scheduling when the policy lists nobody and needs no second approver', async () => {
    const a = admin();
    await updateUpdateChangePolicy(a, { approver_user_ids: [], second_approver_required: false, emergency_override_enabled: true, emergency_reason_min_length: 20 });
    await startUpdateDownload(a, '1.2.0');
    await confirmUpdateBackup(a, '1.2.0', {});
    expect((await scheduleUpdate(a, '1.2.0', {})).state).toBe('approved');
    expect((await applyUpdate(a, '1.2.0')).state).toBe('succeeded');
  });

  it('records a rejection and ends the release', async () => {
    const a = admin();
    await driveToApprovedUntilScheduled('1.2.0');
    const rejected = await rejectUpdate(approver(), '1.2.0', { note: 'Not this month.' });
    expectValid('UpdateScheduledUpdate', rejected);
    expect(rejected).toMatchObject({ state: 'rejected' });
    expect(rejected.approvals[0]).toMatchObject({ decision: 'rejected', note: 'Not this month.' });
    expect((await getUpdateRelease(a, '1.2.0')).summary.state).toBe('rejected');
    expect((await listUpdateHistory(a)).items[0]).toMatchObject({ version: '1.2.0', result: 'cancelled' });
    await expect(applyUpdate(a, '1.2.0')).rejects.toThrow(ConflictError);
  });
});

/** Download, confirm the backup and schedule, but leave the approval to the test. */
async function driveToApprovedUntilScheduled(version: string): Promise<void> {
  await startUpdateDownload(admin(), version);
  await confirmUpdateBackup(admin(), version, {});
  await scheduleUpdate(admin(), version, {});
}

describe('skip and settings', () => {
  it('skips a release with a reason and records it', async () => {
    const a = admin();
    await expect(skipUpdate(a, '1.2.0', {})).rejects.toThrow(InvalidInputError);
    await expect(skipUpdate(a, '1.2.0', { reason: '' })).rejects.toThrow(InvalidInputError);
    const detail = await skipUpdate(a, '1.2.0', { reason: 'Not needed this quarter.' });
    expectValid('UpdateReleaseDetail', detail);
    expect(detail.summary.state).toBe('skipped');
    expect((await listUpdateHistory(a)).items[0]).toMatchObject({ version: '1.2.0', kind: 'skip', result: 'skipped' });
    await expect(skipUpdate(a, '1.2.0', { reason: 'Again.' })).rejects.toThrow(ConflictError);
    await expect(startUpdateDownload(a, '1.2.0')).rejects.toThrow(ConflictError);
  });

  it('reads and replaces the update settings, and notify-only stops Apply', async () => {
    const a = admin();
    expect(await getUpdateSettings(a)).toEqual({ channel: 'stable', check_interval_hours: 6, auto_download: false, notify_only: false });
    const next = await updateUpdateSettings(a, { channel: 'hotfix', check_interval_hours: 12, auto_download: true, notify_only: true });
    expectValid('UpdateSettings', next);
    expect(await getUpdateSettings(approver())).toEqual(next);
    expect(await getUpdateStatus(a)).toMatchObject({ channel: 'hotfix', notify_only: true });
    await expect(updateUpdateSettings(a, { channel: 'beta', check_interval_hours: 12, auto_download: true, notify_only: true })).rejects.toThrow(InvalidInputError);
    await expect(updateUpdateSettings(a, { channel: 'stable', check_interval_hours: 0, auto_download: true, notify_only: true })).rejects.toThrow(InvalidInputError);
    await expect(updateUpdateSettings(a, { channel: 'stable', check_interval_hours: 6 })).rejects.toThrow(InvalidInputError);
    await driveToApproved('1.2.0');
    await expect(applyUpdate(a, '1.2.0')).rejects.toThrow(/Notify-only/);
    await updateUpdateSettings(a, { channel: 'stable', check_interval_hours: 6, auto_download: false, notify_only: false });
    expect((await applyUpdate(a, '1.2.0')).state).toBe('succeeded');
  });
});

describe('connection', () => {
  it('shows the firewall rule, keeps proxy secrets out of every result and the audit log, and tests the connection', async () => {
    const a = admin();
    const before = await getUpdateConnection(a);
    expectValid('UpdateConnectionSettings', before);
    expect(before).toMatchObject({ mode: 'connected', proxy: { enabled: false, has_password: false, has_ca_certificate: false }, last_contact_result: 'ok' });
    expect(before.allowed_endpoints[0]).toMatchObject({ port: 443 });
    const write = { mode: 'connected', proxy: { enabled: true, address: 'proxy.demo.example:3128', username: 'svc-opendispatch', password: 's3cret-pass-value', ca_certificate_pem: '-----BEGIN CERTIFICATE-----ZmFrZQ==-----END CERTIFICATE-----' } };
    const after = await updateUpdateConnection(a, write);
    expectValid('UpdateConnectionSettings', after);
    expect(after.proxy).toMatchObject({ enabled: true, address: 'proxy.demo.example:3128', username: 'svc-opendispatch', has_password: true, has_ca_certificate: true });
    const everything = JSON.stringify([after, await getUpdateConnection(approver()), await audits('update.connection_changed')]);
    expect(everything).not.toContain('s3cret-pass-value');
    expect(everything).not.toContain('BEGIN CERTIFICATE');
    // a later write without a password keeps the flag
    expect((await updateUpdateConnection(a, { mode: 'connected', proxy: { enabled: true, address: 'proxy.demo.example:3128' } })).proxy.has_password).toBe(true);
    // an empty password clears it
    expect((await updateUpdateConnection(a, { mode: 'connected', proxy: { enabled: true, address: 'p:1', password: '' } })).proxy.has_password).toBe(false);
    await expect(updateUpdateConnection(a, { mode: 'connected', proxy: { enabled: true } })).rejects.toThrow(InvalidInputError);
    await expect(updateUpdateConnection(a, { mode: 'satellite' })).rejects.toThrow(InvalidInputError);

    const ok = await testUpdateConnection(a);
    expectValid('UpdateConnectionTestResult', ok);
    expect(ok.ok).toBe(true);
    expect(ok.steps.map((s) => s.name)).toEqual(['proxy', 'dns', 'tcp', 'tls', 'release_index_signature']);
    expect((await getUpdateConnection(a)).last_contact_result).toBe('ok');

    await updateUpdateConnection(a, { mode: 'offline' });
    const offline = await testUpdateConnection(a);
    expectValid('UpdateConnectionTestResult', offline);
    expect(offline.ok).toBe(false);
    expect((await getUpdateConnection(a)).last_contact_result).toBe('failed');
  });
});

describe('change windows and blackouts', () => {
  it('has a Sunday to Thursday 03:00 to 05:00 window by default and 14 upcoming windows', async () => {
    const a = admin();
    const windows = await getUpdateChangeWindows(a);
    expectValid('UpdateChangeWindows', windows);
    expect(windows.recurring).toHaveLength(1);
    expect(windows.recurring[0]).toMatchObject({ days_of_week: [0, 1, 2, 3, 4], start_time: '03:00', end_time: '05:00' });
    expect(windows.blackouts).toEqual([]);
    expect(windows.upcoming).toHaveLength(14);
    expect(windows.upcoming.map((w) => w.start.slice(0, 10)).slice(0, 6)).toEqual(['2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17', '2026-09-20', '2026-09-21']);
    expect(windows.upcoming.every((w) => w.open && !w.blocked_by_blackout)).toBe(true);
    const next = await getNextUpdateWindow(approver());
    expectValid('UpdateUpcomingWindow', next);
    expect(next.start).toBe('2026-09-14T03:00:00+03:00');
  });

  it('turns a Hijri blackout into Gregorian dates, stores both and blocks the windows inside it', async () => {
    const a = admin();
    const written = await updateUpdateChangeWindows(a, {
      recurring: [{ label: 'Sunday to Thursday, 03:00 to 05:00', days_of_week: [4, 3, 2, 1, 0], start_time: '03:00', end_time: '05:00' }],
      blackouts: [{ label: 'Hijri blackout', entered_as: 'hijri', start_hijri: { year: 1448, month: 4, day: 3 }, end_hijri: { year: 1448, month: 4, day: 7 } }],
    });
    expectValid('UpdateChangeWindows', written);
    expect(written.blackouts[0]).toMatchObject({ entered_as: 'hijri', start_gregorian: '2026-09-14', end_gregorian: '2026-09-18', start_hijri: { year: 1448, month: 4, day: 3 }, end_hijri: { year: 1448, month: 4, day: 7 } });
    expect(written.recurring[0]?.days_of_week).toEqual([0, 1, 2, 3, 4]);
    const blocked = written.upcoming.filter((w) => w.blocked_by_blackout).map((w) => w.start.slice(0, 10));
    expect(blocked).toEqual(['2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17']);
    expect(written.upcoming.filter((w) => w.blocked_by_blackout).every((w) => !w.open)).toBe(true);
    expect((await getNextUpdateWindow(a)).start).toBe('2026-09-20T03:00:00+03:00');
    expect((await getUpdateStatus(a)).next_window_start).toBe('2026-09-20T03:00:00+03:00');
    // scheduling goes into the first window outside the blackout
    await driveToApprovedUntilScheduled('1.2.0');
    expect((await getUpdateRelease(a, '1.2.0')).scheduled?.window_start).toBe('2026-09-20T03:00:00+03:00');
  });

  it('keeps a Hijri form for a Gregorian blackout and rejects impossible input', async () => {
    const a = admin();
    const written = await updateUpdateChangeWindows(a, { recurring: [], blackouts: [{ label: 'Month end', entered_as: 'gregorian', start_gregorian: '2026-09-20', end_gregorian: '2026-09-22' }] });
    expect(written.blackouts[0]).toMatchObject({ entered_as: 'gregorian', start_hijri: { year: 1448, month: 4, day: 9 }, end_hijri: { year: 1448, month: 4, day: 11 } });
    await expect(updateUpdateChangeWindows(a, { recurring: [], blackouts: [{ label: 'x', entered_as: 'gregorian', start_gregorian: '2026-09-22', end_gregorian: '2026-09-20' }] })).rejects.toThrow(InvalidInputError);
    await expect(updateUpdateChangeWindows(a, { recurring: [], blackouts: [{ label: 'x', entered_as: 'hijri', start_hijri: { year: 1500, month: 1, day: 1 }, end_hijri: { year: 1500, month: 1, day: 2 } }] })).rejects.toThrow(InvalidInputError);
    await expect(updateUpdateChangeWindows(a, { recurring: [{ label: 'x', days_of_week: [7], start_time: '03:00', end_time: '05:00' }], blackouts: [] })).rejects.toThrow(InvalidInputError);
    await expect(updateUpdateChangeWindows(a, { recurring: [{ label: 'x', days_of_week: [1], start_time: '3am', end_time: '05:00' }], blackouts: [] })).rejects.toThrow(InvalidInputError);
    await expect(updateUpdateChangeWindows(a, { recurring: 'nope', blackouts: [] })).rejects.toThrow(InvalidInputError);
  });

  it('refuses to schedule when no window is open, and when the requested start is not a window', async () => {
    const a = admin();
    await updateUpdateChangeWindows(a, { recurring: [], blackouts: [] });
    await expect(getNextUpdateWindow(a)).rejects.toThrow(NotFoundError);
    expect((await getUpdateStatus(a)).next_window_start).toBeNull();
    await startUpdateDownload(a, '1.2.0');
    await confirmUpdateBackup(a, '1.2.0', {});
    await expect(scheduleUpdate(a, '1.2.0', {})).rejects.toThrow(ConflictError);
    await updateUpdateChangeWindows(a, { recurring: [{ label: 'Nights', days_of_week: [0, 1, 2, 3, 4], start_time: '22:00', end_time: '01:00' }], blackouts: [] });
    expect((await getUpdateChangeWindows(a)).upcoming[0]).toMatchObject({ start: '2026-09-14T22:00:00+03:00', end: '2026-09-15T01:00:00+03:00' });
    await expect(scheduleUpdate(a, '1.2.0', { window_start: '2026-09-14T03:00:00+03:00' })).rejects.toThrow(InvalidInputError);
    expect((await scheduleUpdate(a, '1.2.0', { window_start: '2026-09-15T22:00:00+03:00' })).window_start).toBe('2026-09-15T22:00:00+03:00');
  });

  it('keeps a window when one release is already scheduled', async () => {
    const a = admin();
    await driveToApprovedUntilScheduled('1.2.0');
    await startUpdateDownload(a, '1.3.0');
    await confirmUpdateBackup(a, '1.3.0', {});
    await expect(scheduleUpdate(a, '1.3.0', {})).rejects.toThrow(/already scheduled/);
  });
});

describe('change policy', () => {
  it('reads the default and validates a replacement', async () => {
    const a = admin();
    const policy = await getUpdateChangePolicy(approver());
    expectValid('UpdateChangePolicy', policy);
    expect(policy).toEqual({ approver_user_ids: [firstApproverId()], second_approver_required: false, emergency_override_enabled: true, emergency_reason_min_length: 20 });
    await expect(updateUpdateChangePolicy(a, { approver_user_ids: [a.userId], second_approver_required: false, emergency_override_enabled: true, emergency_reason_min_length: 20 })).rejects.toThrow(InvalidInputError);
    await expect(updateUpdateChangePolicy(a, { approver_user_ids: [firstApproverId()], second_approver_required: true, emergency_override_enabled: true, emergency_reason_min_length: 20 })).rejects.toThrow(/at least two/);
    await expect(updateUpdateChangePolicy(a, { approver_user_ids: [], second_approver_required: false, emergency_override_enabled: true, emergency_reason_min_length: 5 })).rejects.toThrow(InvalidInputError);
    await expect(updateUpdateChangePolicy(a, { approver_user_ids: ['nope'], second_approver_required: false, emergency_override_enabled: true, emergency_reason_min_length: 20 })).rejects.toThrow(InvalidInputError);
  });
});

describe('emergency override', () => {
  const reason = 'Gap calculation error hides a two hour shortfall in Riyadh Central.';

  it('applies a hotfix outside a change window with two approvers and a reason, flagged in the audit log', async () => {
    const a = admin();
    await startUpdateDownload(a, '1.2.1');
    const run = await requestUpdateEmergencyOverride(a, { version: '1.2.1', second_approver_user_id: firstApproverId(), reason });
    expectValid('UpdateApplyRun', run);
    expect(run).toMatchObject({ kind: 'emergency', version: '1.2.1', state: 'succeeded', health_check_passed: true });
    expect((await getUpdateStatus(a)).current_version).toBe('1.2.1');
    expect((await getUpdateRelease(a, '1.2.0')).summary.state).toBe('superseded');
    const entry = (await listUpdateHistory(a)).items[0];
    expect(entry).toMatchObject({ kind: 'emergency_override', emergency: true, result: 'succeeded', window_start: null, version: '1.2.1' });
    expect(entry?.approved_by.map((p) => p.user_id)).toEqual([a.userId, firstApproverId()]);
    const event = (await audits('update.emergency_override', 'success'))[0];
    expect(event?.summary_en).toContain('EMERGENCY OVERRIDE');
    expect(event?.detail).toMatchObject({ emergency: true, second_approver_user_id: firstApproverId(), reason });
  });

  it('needs two different approvers, a long enough reason, a verified release and an enabled policy', async () => {
    const a = admin();
    await startUpdateDownload(a, '1.2.1');
    await expect(requestUpdateEmergencyOverride(a, { version: '1.2.1', second_approver_user_id: a.userId, reason })).rejects.toThrow(InvalidInputError);
    await expect(requestUpdateEmergencyOverride(a, { version: '1.2.1', second_approver_user_id: firstApproverId(), reason: 'too short' })).rejects.toThrow(InvalidInputError);
    await expect(requestUpdateEmergencyOverride(a, { version: '1.2.1', second_approver_user_id: ctxFor('planner').userId, reason })).rejects.toThrow(/Change Approver/);
    await expect(requestUpdateEmergencyOverride(a, { version: '1.2.0', second_approver_user_id: firstApproverId(), reason })).rejects.toThrow(ConflictError);
    await expect(requestUpdateEmergencyOverride(a, { version: '1.2.1', reason })).rejects.toThrow(InvalidInputError);
    await updateUpdateChangePolicy(a, { approver_user_ids: [firstApproverId()], second_approver_required: false, emergency_override_enabled: false, emergency_reason_min_length: 20 });
    await expect(requestUpdateEmergencyOverride(a, { version: '1.2.1', second_approver_user_id: firstApproverId(), reason })).rejects.toThrow(ForbiddenError);
    expect((await audits('update.emergency_override', 'denied')).length).toBeGreaterThan(0);
    expect((await getUpdateStatus(a)).current_version).toBe('1.1.0');
  });

  it('is not open to a Change Approver or a planner', async () => {
    for (const ctx of [approver(), ctxFor('planner')]) {
      await expect(requestUpdateEmergencyOverride(ctx, { version: '1.2.1', second_approver_user_id: firstApproverId(), reason })).rejects.toThrow(ForbiddenError);
    }
  });
});

describe('roles', () => {
  it('keeps every other role out of the Updates screen', async () => {
    for (const role of ['dispatch_supervisor', 'dispatcher', 'planner', 'remote_team_lead', 'viewer_auditor'] as const) {
      const ctx = ctxFor(role);
      await expect(getUpdatesSummary(ctx), role).rejects.toThrow(ForbiddenError);
      await expect(getUpdateStatus(ctx), role).rejects.toThrow(ForbiddenError);
      await expect(listUpdateReleases(ctx), role).rejects.toThrow(ForbiddenError);
      await expect(getUpdateRecovery(ctx), role).rejects.toThrow(ForbiddenError);
      await expect(checkForUpdatesNow(ctx), role).rejects.toThrow(ForbiddenError);
      await expect(startUpdateDownload(ctx, '1.2.0'), role).rejects.toThrow(ForbiddenError);
      await expect(uploadOfflineUpdate(ctx, { file: 'opendispatch-release-1.4.0.bundle' }), role).rejects.toThrow(ForbiddenError);
      await expect(updateUpdateConnection(ctx, { mode: 'offline' }), role).rejects.toThrow(ForbiddenError);
    }
    expect((await audits('update.check', 'denied')).length).toBe(5);
  });
});

describe('field-level PATCH writes', () => {
  it('changes one policy field at a time and keeps the rest; Go checks the merged policy', async () => {
    const a = admin();
    const p1 = await patchUpdateChangePolicy(a, { emergency_reason_min_length: 40 });
    expectValid('UpdateChangePolicy', p1);
    expect(p1).toEqual({ approver_user_ids: [firstApproverId()], second_approver_required: false, emergency_override_enabled: true, emergency_reason_min_length: 40 });
    const p2 = await patchUpdateChangePolicy(a, { emergency_override_enabled: false });
    expect(p2).toMatchObject({ emergency_override_enabled: false, emergency_reason_min_length: 40 });
    await expect(patchUpdateChangePolicy(a, { second_approver_required: true })).rejects.toThrow(/at least two/);
    await expect(patchUpdateChangePolicy(a, {})).rejects.toThrow(InvalidInputError);
    await expect(patchUpdateChangePolicy(a, { emergency_reason_min_length: 5 })).rejects.toThrow(InvalidInputError);
    expect(await getUpdateChangePolicy(a)).toMatchObject({ second_approver_required: false, emergency_override_enabled: false, emergency_reason_min_length: 40 });
    expect(await audits('update.policy_changed', 'success')).toHaveLength(2);
  });

  it('changes the mode or one proxy field without touching the rest, and keeps secrets out', async () => {
    const a = admin();
    const c1 = await patchUpdateConnection(a, { proxy: { address: ' proxy.demo.example:3128 ', password: 's3cret-pass-value' } });
    expectValid('UpdateConnectionSettings', c1);
    expect(c1).toMatchObject({ mode: 'connected', proxy: { enabled: false, address: 'proxy.demo.example:3128', has_password: true } });
    const c2 = await patchUpdateConnection(a, { proxy: { enabled: true } });
    expect(c2.proxy).toMatchObject({ enabled: true, address: 'proxy.demo.example:3128', has_password: true });
    const c3 = await patchUpdateConnection(a, { mode: 'offline' });
    expect(c3).toMatchObject({ mode: 'offline', proxy: { enabled: true, has_password: true } });
    await expect(patchUpdateConnection(a, { proxy: { address: '' } })).rejects.toThrow(/address is required/);
    await expect(patchUpdateConnection(a, { mode: 'satellite' })).rejects.toThrow(InvalidInputError);
    expect(JSON.stringify([c1, await audits('update.connection_changed')])).not.toContain('s3cret-pass-value');
    expect(await audits('update.connection_changed', 'success')).toHaveLength(3);
  });

  it('edits the recurring window by id with a label written in Go, and adds and removes blackouts', async () => {
    const a = admin();
    const id = (await getUpdateChangeWindows(a)).recurring[0]?.id ?? '';
    const w1 = await patchUpdateChangeWindows(a, { recurring_window: { id, days_of_week: [5, 6], start_time: '01:00' } });
    expectValid('UpdateChangeWindows', w1);
    expect(w1.recurring).toEqual([{ id, label: 'Friday, Saturday, 01:00 to 05:00', days_of_week: [5, 6], start_time: '01:00', end_time: '05:00' }]);
    const w2 = await patchUpdateChangeWindows(a, { add_blackouts: [{ label: 'Hijri blackout', entered_as: 'hijri', start_hijri: { year: 1448, month: 4, day: 3 }, end_hijri: { year: 1448, month: 4, day: 7 } }] });
    expect(w2.blackouts[0]).toMatchObject({ entered_as: 'hijri', start_gregorian: '2026-09-14', end_gregorian: '2026-09-18' });
    expect(w2.recurring[0]?.label).toBe('Friday, Saturday, 01:00 to 05:00');
    const w3 = await patchUpdateChangeWindows(a, { remove_blackout_ids: [w2.blackouts[0]?.id ?? ''] });
    expect(w3.blackouts).toEqual([]);
    await expect(patchUpdateChangeWindows(a, { recurring_window: { id: deterministicUuid('gone'), start_time: '02:00' } })).rejects.toThrow(NotFoundError);
    await expect(patchUpdateChangeWindows(a, { recurring_window: { id, days_of_week: [7] } })).rejects.toThrow(InvalidInputError);
    await expect(patchUpdateChangeWindows(a, { recurring: [] })).rejects.toThrow(InvalidInputError);
    expect(await audits('update.windows_changed', 'success')).toHaveLength(3);
  });

  it('keeps every change when administrators save different things at the same moment', async () => {
    const a = admin();
    const other = ctxFor('administrator');
    await Promise.all([
      patchUpdateChangePolicy(a, { emergency_reason_min_length: 60 }),
      patchUpdateChangePolicy(other, { emergency_override_enabled: false }),
      patchUpdateConnection(a, { proxy: { address: 'proxy.demo.example:3128' } }),
      patchUpdateConnection(other, { mode: 'offline' }),
      patchUpdateChangeWindows(a, { add_blackouts: [{ label: 'Month end', entered_as: 'gregorian', start_gregorian: '2026-09-28', end_gregorian: '2026-09-30' }] }),
      patchUpdateChangeWindows(other, { add_blackouts: [{ label: 'Eid', entered_as: 'gregorian', start_gregorian: '2027-03-09', end_gregorian: '2027-03-12' }] }),
    ]);
    expect(await getUpdateChangePolicy(a)).toMatchObject({ emergency_reason_min_length: 60, emergency_override_enabled: false });
    expect(await getUpdateConnection(a)).toMatchObject({ mode: 'offline', proxy: { address: 'proxy.demo.example:3128' } });
    expect((await getUpdateChangeWindows(a)).blackouts.map((b) => b.label).sort()).toEqual(['Eid', 'Month end']);
  });
});

describe('install modes', () => {
  const calls: readonly (readonly [string, (ctx: RequestContext) => unknown])[] = [
    ['getUpdateStatus', async (c) => await getUpdateStatus(c)],
    ['checkForUpdatesNow', async (c) => await checkForUpdatesNow(c)],
    ['listUpdateReleases', async (c) => await listUpdateReleases(c)],
    ['getUpdateRelease', async (c) => await getUpdateRelease(c, '1.2.0')],
    ['getUpdateDownloadState', async (c) => await getUpdateDownloadState(c, '1.2.0')],
    ['startUpdateDownload', async (c) => await startUpdateDownload(c, '1.2.0')],
    ['getUpdatePreflight', async (c) => await getUpdatePreflight(c, '1.2.0')],
    ['runUpdatePreflight', async (c) => await runUpdatePreflight(c, '1.2.0')],
    ['confirmUpdateBackup', async (c) => await confirmUpdateBackup(c, '1.2.0', {})],
    ['scheduleUpdate', async (c) => await scheduleUpdate(c, '1.2.0', {})],
    ['cancelScheduledUpdate', async (c) => await cancelScheduledUpdate(c, '1.2.0')],
    ['approveUpdate', async (c) => await approveUpdate(c, '1.2.0', {})],
    ['rejectUpdate', async (c) => await rejectUpdate(c, '1.2.0', {})],
    ['applyUpdate', async (c) => await applyUpdate(c, '1.2.0')],
    ['skipUpdate', async (c) => await skipUpdate(c, '1.2.0', { reason: 'No.' })],
    ['requestUpdateEmergencyOverride', async (c) => await requestUpdateEmergencyOverride(c, { version: '1.2.1', second_approver_user_id: firstApproverId(), reason: 'A reason that is long enough to pass.' })],
    ['getUpdateRun', async (c) => await getUpdateRun(c, deterministicUuid('run'))],
    ['requestUpdateRecovery', async (c) => await requestUpdateRecovery(c, { action: 'rollback' })],
    ['getUpdateRecovery', async (c) => await getUpdateRecovery(c)],
    ['listUpdateHistory', async (c) => await listUpdateHistory(c)],
    ['getUpdateSettings', async (c) => await getUpdateSettings(c)],
    ['updateUpdateSettings', async (c) => await updateUpdateSettings(c, { channel: 'stable', check_interval_hours: 6, auto_download: false, notify_only: false })],
    ['getUpdateConnection', async (c) => await getUpdateConnection(c)],
    ['updateUpdateConnection', async (c) => await updateUpdateConnection(c, { mode: 'offline' })],
    ['testUpdateConnection', async (c) => await testUpdateConnection(c)],
    ['uploadOfflineUpdate', async (c) => await uploadOfflineUpdate(c, { file: 'opendispatch-release-1.4.0.bundle' })],
    ['getOfflineUpdateUpload', async (c) => await getOfflineUpdateUpload(c, deterministicUuid('upload'))],
    ['getUpdateChangeWindows', async (c) => await getUpdateChangeWindows(c)],
    ['updateUpdateChangeWindows', async (c) => await updateUpdateChangeWindows(c, { recurring: [], blackouts: [] })],
    ['getNextUpdateWindow', async (c) => await getNextUpdateWindow(c)],
    ['getUpdateChangePolicy', async (c) => await getUpdateChangePolicy(c)],
    ['updateUpdateChangePolicy', async (c) => await updateUpdateChangePolicy(c, { approver_user_ids: [], second_approver_required: false, emergency_override_enabled: true, emergency_reason_min_length: 20 })],
    ['patchUpdateConnection', async (c) => await patchUpdateConnection(c, { mode: 'offline' })],
    ['patchUpdateChangeWindows', async (c) => await patchUpdateChangeWindows(c, { remove_blackout_ids: [] })],
    ['patchUpdateChangePolicy', async (c) => await patchUpdateChangePolicy(c, { second_approver_required: false })],
  ];

  it('covers the 35 operations besides the summary (the 30 of the agent stub, the cancel of a schedule (DG4), the read of a restore request and the three PATCH writes)', async () => {
    expect(calls).toHaveLength(35);
  });

  for (const mode of ['shared', 'dedicated'] as const satisfies readonly InstallMode[]) {
    it(`gives the Administrator only the version and release notes in a ${mode} install`, async () => {
      const ctx = ctxFor('administrator', { installMode: mode });
      const summary = await getUpdatesSummary(ctx);
      expectValid('UpdatesSummary', summary);
      expect(summary).toMatchObject({ install_mode: mode, current_version: '1.1.0', full_updates_available: false });
      expect(summary.release_notes.map((n) => n.version)).toEqual(['1.1.0', '1.0.0']);
      for (const [name, call] of calls) await expect(call(ctx), name).rejects.toThrow(ForbiddenError);
      // nothing changed, and every denial was audited
      expect((await getUpdatesSummary(ctx)).current_version).toBe('1.1.0');
      expect((await listAuditEvents(ctx, { outcome: 'denied', limit: 200 })).items.filter((e) => e.action.startsWith('update.')).length).toBeGreaterThanOrEqual(32);
    });
  }

  it('gives the Administrator the full screen in a private install and a Change Approver the summary too', async () => {
    expect(await getUpdatesSummary(admin())).toMatchObject({ install_mode: 'private', full_updates_available: true });
    expect((await getUpdatesSummary(approver())).full_updates_available).toBe(true);
    // Go refuses that session itself
    await expect(getUpdatesSummary(ctxFor('change_approver', { installMode: 'shared' }))).rejects.toThrow(UnauthenticatedError);
  });
});

describe('persistence and audit', () => {
  it('keeps a write across a fresh module instance and audits it', async () => {
    const a = admin();
    await startUpdateDownload(a, '1.2.0');
    await updateUpdateSettings(a, { channel: 'stable', check_interval_hours: 24, auto_download: true, notify_only: false });
    vi.resetModules();
    const fresh = await import('./updates');
    expect((await fresh.getUpdateRelease(a, '1.2.0')).summary.state).toBe('verified');
    expect(await fresh.getUpdateSettings(approver())).toMatchObject({ check_interval_hours: 24, auto_download: true });
    const events = await audits('update.settings_changed', 'success');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ entity_type: 'update_settings', actor_user_id: a.userId, outcome: 'success' });
    expect(events[0]?.summary_en).toContain('stub');
    expect(await audits('update.download', 'success')).toHaveLength(1);
  });

  it('starts every test from the fixture state', async () => {
    expect((await getUpdateStatus(admin())).current_version).toBe('1.1.0');
    expect((await getUpdateSettings(admin())).check_interval_hours).toBe(6);
  });
});

// ---------------------------------------------------------------------------------------------
// Review findings m2, m10 and M4
// ---------------------------------------------------------------------------------------------

/** Every write that takes a body (or an id), with a body the validator would refuse. */
const WRITERS: readonly (readonly [string, (ctx: RequestContext, body: unknown) => unknown])[] = [
  ['confirmUpdateBackup', async (c, b) => await confirmUpdateBackup(c, '1.2.0', b)],
  ['scheduleUpdate', async (c, b) => await scheduleUpdate(c, '1.2.0', b)],
  ['approveUpdate', async (c, b) => await approveUpdate(c, '1.2.0', b)],
  ['rejectUpdate', async (c, b) => await rejectUpdate(c, '1.2.0', b)],
  ['skipUpdate', async (c, b) => await skipUpdate(c, '1.2.0', b)],
  ['requestUpdateEmergencyOverride', async (c, b) => await requestUpdateEmergencyOverride(c, b)],
  ['requestUpdateRecovery', async (c, b) => await requestUpdateRecovery(c, b)],
  ['updateUpdateSettings', async (c, b) => await updateUpdateSettings(c, b)],
  ['updateUpdateConnection', async (c, b) => await updateUpdateConnection(c, b)],
  ['uploadOfflineUpdate', async (c, b) => await uploadOfflineUpdate(c, b)],
  ['updateUpdateChangeWindows', async (c, b) => await updateUpdateChangeWindows(c, b)],
  ['updateUpdateChangePolicy', async (c, b) => await updateUpdateChangePolicy(c, b)],
  ['patchUpdateConnection', async (c, b) => await patchUpdateConnection(c, b)],
  ['patchUpdateChangeWindows', async (c, b) => await patchUpdateChangeWindows(c, b)],
  ['patchUpdateChangePolicy', async (c, b) => await patchUpdateChangePolicy(c, b)],
];
const JUNK_BODIES: readonly unknown[] = [undefined, null, {}, 'x', 123, [], { role: 'administrator', reason: 5 }, { file: 5, version: {}, run_id: 'nope' }];

describe('authorize before validating (review m2)', () => {
  it('gives a role without edit `forbidden` and one denied event for any body, and changes nothing', async () => {
    for (const role of ['viewer_auditor', 'dispatcher', 'planner', 'remote_team_lead'] as const) {
      const ctx = ctxFor(role);
      for (const [name, call] of WRITERS) {
        for (const body of JUNK_BODIES) {
          const before = dataSnapshot();
          const audits = await auditCount();
          await expect(call(ctx, body), `${role} ${name}`).rejects.toThrow(ForbiddenError);
          expect(await auditCount(), `${role} ${name} audited`).toBe(audits + 1);
          expect(dataSnapshot()).toBe(before);
        }
      }
    }
    expect((await audits('update.skip', 'denied')).length).toBeGreaterThan(0);
    expect((await audits('update.offline_upload', 'denied')).length).toBeGreaterThan(0);
  });

  it('gives the Administrator `forbidden` in a shared or dedicated install for any body', async () => {
    for (const installMode of ['shared', 'dedicated'] as const) {
      const ctx = ctxFor('administrator', { installMode });
      for (const [name, call] of WRITERS) {
        for (const body of JUNK_BODIES) {
          const audits = await auditCount();
          await expect(call(ctx, body), `${installMode} ${name}`).rejects.toThrow(ForbiddenError);
          expect(await auditCount(), `${installMode} ${name} audited`).toBe(audits + 1);
        }
      }
    }
  });

  it('refuses approve and reject to a role that may not approve updates before it looks at the id or body', async () => {
    const a = admin();
    for (const [name, call] of WRITERS.filter(([n]) => n === 'approveUpdate' || n === 'rejectUpdate')) {
      for (const body of JUNK_BODIES) await expect(call(a, body), name).rejects.toThrow(/refused: role_cannot_approve_kind/);
      await expect(name === 'approveUpdate' ? approveUpdate(a, 'not a version', {}) : rejectUpdate(a, 'not a version', {})).rejects.toThrow(ForbiddenError);
    }
  });

  it('still tells an authorized Administrator what is wrong with the input', async () => {
    const a = admin();
    for (const [name, call] of WRITERS.filter(([n]) => n !== 'approveUpdate' && n !== 'rejectUpdate' && n !== 'requestUpdateRecovery')) {
      await expect(call(a, { role: 'administrator', unknown_field: 1 }), name).rejects.toThrow(InvalidInputError);
    }
    await expect(requestUpdateRecovery(a, { action: 'explode' })).rejects.toThrow(InvalidInputError);
    expect(await audits('update.skip', 'denied')).toHaveLength(0);
  });

  it('audits the version a denied emergency override named, without validating it', async () => {
    await expect(requestUpdateEmergencyOverride(ctxFor('viewer_auditor'), { version: '9.9.9', reason: 5 })).rejects.toThrow(ForbiddenError);
    expect((await audits('update.emergency_override', 'denied'))[0]).toMatchObject({ entity_id: '9.9.9', outcome: 'denied' });
  });
});

describe('crafted ids (review M4 and m10)', () => {
  it('refuses a run or upload id that is not a UUID, for reads, and changes nothing', async () => {
    await expectJunkIdsInvalidLive(async (id) => await getUpdateRun(admin(), id));
    await expectJunkIdsInvalidLive(async (id) => await getOfflineUpdateUpload(admin(), id));
    // a well formed id that names nothing is still not_found
    await expect(getUpdateRun(admin(), deterministicUuid('no-such-run'))).rejects.toThrow(NotFoundError);
    await expect(getOfflineUpdateUpload(admin(), deterministicUuid('no-such-upload'))).rejects.toThrow(NotFoundError);
  });

  it('refuses a release version that is not a version, for reads and writes, and never throws a TypeError', async () => {
    const a = admin();
    await expectJunkIdsInvalidLive(async (id) => await getUpdateRelease(a, id));
    await expectJunkIdsInvalidLive(async (id) => await getUpdateDownloadState(a, id));
    await expectJunkIdsInvalidLive(async (id) => await getUpdatePreflight(a, id));
    await expectJunkIdsInvalidLive(async (id) => await startUpdateDownload(a, id));
    await expectJunkIdsInvalidLive(async (id) => await runUpdatePreflight(a, id));
    await expectJunkIdsInvalidLive(async (id) => await confirmUpdateBackup(a, id, {}));
    await expectJunkIdsInvalidLive(async (id) => await scheduleUpdate(a, id, {}));
    await expectJunkIdsInvalidLive(async (id) => await cancelScheduledUpdate(a, id));
    await expectJunkIdsInvalidLive(async (id) => await applyUpdate(a, id));
    await expectJunkIdsInvalidLive(async (id) => await skipUpdate(a, id, { reason: 'x' }));
    await expect(getUpdateRelease(a, 123 as never)).rejects.toThrow(InvalidInputError);
    await expect(getUpdateRelease(a, {} as never)).rejects.toThrow(InvalidInputError);
    await expect(getUpdateRelease(a, null as never)).rejects.toThrow(InvalidInputError);
  });

  it('gives a role that may not write `forbidden`, audited, for any release id, without a TypeError', async () => {
    const v = ctxFor('viewer_auditor');
    await expectJunkIdsForbiddenLive(async (id) => await startUpdateDownload(v, id));
    await expectJunkIdsForbiddenLive(async (id) => await runUpdatePreflight(v, id));
    await expectJunkIdsForbiddenLive(async (id) => await confirmUpdateBackup(v, id, {}));
    await expectJunkIdsForbiddenLive(async (id) => await scheduleUpdate(v, id, {}));
    await expectJunkIdsForbiddenLive(async (id) => await cancelScheduledUpdate(v, id));
    await expectJunkIdsForbiddenLive(async (id) => await applyUpdate(v, id));
    await expectJunkIdsForbiddenLive(async (id) => await skipUpdate(v, id, {}));
    await expectJunkIdsForbiddenLive(async (id) => await approveUpdate(v, id, {}));
    await expectJunkIdsForbiddenLive(async (id) => await rejectUpdate(v, id, {}));
  });

  it('keeps ids of the update state UUID shaped', async () => {
    const a = admin();
    await startUpdateDownload(a, '1.2.0');
    await confirmUpdateBackup(a, '1.2.0', {});
    await scheduleUpdate(a, '1.2.0', {});
    await approveUpdate(approver(), '1.2.0', {});
    const run = await applyUpdate(a, '1.2.0');
    expect((await getUpdateRun(a, run.run_id)).run_id).toBe(run.run_id);
    await updateUpdateConnection(a, { mode: 'offline' });
    const upload = await uploadOfflineUpdate(a, { file: 'opendispatch-release-1.4.0.signed' });
    expect((await getOfflineUpdateUpload(a, upload.upload_id)).upload_id).toBe(upload.upload_id);
  });
});

// ---------------------------------------------------------------------------------------------
// DG4: cancel a scheduled update (the update agent stub has no such operation: OpenDispatch contract only)
// ---------------------------------------------------------------------------------------------

describe('cancel a scheduled update (DG4)', () => {
  async function readyToSchedule(version = '1.2.0'): Promise<void> {
    await startUpdateDownload(admin(), version);
    await confirmUpdateBackup(admin(), version, {});
  }

  it('takes an update that awaits approval out of its window: the release is ready again, the history and the audit say so', async () => {
    const a = admin();
    await readyToSchedule();
    await scheduleUpdate(a, '1.2.0', {});
    expect((await getUpdateStatus(a)).state).toBe('scheduled');
    const detail = await cancelScheduledUpdate(a, '1.2.0');
    expectValid('UpdateReleaseDetail', detail);
    expect(detail.summary.state).toBe('ready');
    expect(detail.scheduled).toBeNull();
    expect(await getUpdateRelease(a, '1.2.0')).toEqual(detail);
    expect(await getUpdateStatus(a)).toMatchObject({ state: 'ready', ready_release_version: '1.2.0' });
    const entry = (await listUpdateHistory(a)).items[0]!;
    expect(entry).toMatchObject({ version: '1.2.0', kind: 'update', result: 'cancelled', window_start: '2026-09-14T03:00:00+03:00', approved_by: [] });
    expect(entry.note).toContain('cancelled');
    expect(entry.note).toContain('stub');
    const event = (await audits('update.schedule_cancelled', 'success'))[0]!;
    expect(event).toMatchObject({ entity_type: 'update_release', entity_id: '1.2.0', actor_user_id: a.userId });
    expect(event.summary_en).toContain('stub');
    expect(event.detail).toMatchObject({ version: '1.2.0', stub: true });
    // nothing can be applied, and it can be scheduled again
    await expect(applyUpdate(a, '1.2.0')).rejects.toThrow(ConflictError);
    expect(await scheduleUpdate(a, '1.2.0', {})).toMatchObject({ version: '1.2.0', state: 'awaiting_approval' });
  });

  it('also cancels an update that has been approved: the approval is dropped with it', async () => {
    const a = admin();
    await driveToApproved('1.2.0');
    expect((await getUpdateRelease(a, '1.2.0')).scheduled?.state).toBe('approved');
    await cancelScheduledUpdate(a, '1.2.0');
    expect((await getUpdateRelease(a, '1.2.0')).scheduled).toBeNull();
    await expect(applyUpdate(a, '1.2.0')).rejects.toThrow(ConflictError);
    // a second release can now be scheduled into the free slot
    await readyToSchedule('1.2.1');
    await scheduleUpdate(a, '1.2.1', {});
  });

  it('refuses a release that has no schedule, or whose schedule was decided or has run', async () => {
    const a = admin();
    await expect(cancelScheduledUpdate(a, '1.2.0')).rejects.toThrow(ConflictError); // available
    await readyToSchedule();
    await expect(cancelScheduledUpdate(a, '1.2.0')).rejects.toThrow(ConflictError); // ready, not scheduled
    await scheduleUpdate(a, '1.2.0', {});
    await rejectUpdate(approver(), '1.2.0', { note: 'No.' });
    await expect(cancelScheduledUpdate(a, '1.2.0')).rejects.toThrow(ConflictError); // rejected
    const applied = admin();
    await driveToApproved('1.2.1');
    await applyUpdate(applied, '1.2.1');
    await expect(cancelScheduledUpdate(applied, '1.2.1')).rejects.toThrow(ConflictError); // applied
    await expect(cancelScheduledUpdate(a, '9.9.9')).rejects.toThrow(NotFoundError);
    expect(await audits('update.schedule_cancelled', 'success')).toHaveLength(0);
  });

  it('is the Administrator in a private install only: a Change Approver may only view, and every other role or install mode is forbidden and audited', async () => {
    await readyToSchedule();
    await scheduleUpdate(admin(), '1.2.0', {});
    for (const ctx of [approver(), ctxFor('viewer_auditor'), ctxFor('planner'), ctxFor('dispatcher'), ctxFor('administrator', { installMode: 'shared' }), ctxFor('administrator', { installMode: 'dedicated' })]) {
      const before = dataSnapshot();
      const count = await auditCount();
      await expect(cancelScheduledUpdate(ctx, '1.2.0'), `${ctx.role} ${ctx.installMode}`).rejects.toThrow(ForbiddenError);
      expect(dataSnapshot()).toBe(before);
      expect(await auditCount()).toBe(count + 1);
    }
    expect(await audits('update.schedule_cancelled', 'denied')).toHaveLength(6);
    expect((await getUpdateRelease(admin(), '1.2.0')).scheduled).not.toBeNull();
    // the role is checked before the version: a junk version is still forbidden
    await expect(cancelScheduledUpdate(ctxFor('viewer_auditor'), 'not a version')).rejects.toThrow(ForbiddenError);
  });

  it('persists across a fresh module instance', async () => {
    await readyToSchedule();
    await scheduleUpdate(admin(), '1.2.0', {});
    await cancelScheduledUpdate(admin(), '1.2.0');
    vi.resetModules();
    const fresh = await import('./updates');
    expect((await fresh.getUpdateRelease(admin(), '1.2.0')).scheduled).toBeNull();
    expect((await fresh.getUpdateRelease(admin(), '1.2.0')).summary.state).toBe('ready');
  });
});

// ---------------------------------------------------------------------------------------------
// Follow-up for the Updates screen: timed downloads, a retry, the restore request (gaps 1 to 4)
// ---------------------------------------------------------------------------------------------

const T0 = '2026-09-13T10:00:00+03:00';

/** The clock of the data layer is Date.now(): only Date is faked, on a whole second (the layer counts whole seconds). */
async function useClock(): Promise<void> {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(T0));
  await syncGoClock();
}
async function at(seconds: number): Promise<void> {
  vi.setSystemTime(new Date(Date.parse(T0) + seconds * 1000));
  await syncGoClock();
}

const TAMPERED_PROXY = { mode: 'connected', proxy: { enabled: true, address: 'tampered-proxy.demo.example:3128' } };
const CLEAN_PROXY = { mode: 'connected', proxy: { enabled: true, address: 'proxy.demo.example:3128' } };

describe('a download takes time in the scripted agent: downloading, verifying, then verified or failed (gap 2)', () => {
  const total = 180_000_000 + 210_000_000 + 160_000_000 + 620_000_000;
  const IMAGES = ['web', 'api', 'worker', 'engines'] as const;

  beforeEach(async () => {
    await useClock();
    await setPace('demo');
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const discarded = async () => (await notificationsNow()).filter((n) => n.category === 'update' && n.title_en === 'Release 1.2.0 was discarded');

  it('documents its timings as constants of a few seconds', async () => {
    expect([DOWNLOAD_MS, VERIFY_MS, RESTORE_IN_PROGRESS_AFTER_MS, RESTORE_COMPLETED_AFTER_MS]).toEqual([4000, 2000, 3000, 7000]);
  });

  it('accepts a download as downloading, with nothing done and nothing verified yet, and says it is a stub', async () => {
    const a = admin();
    const started = await startUpdateDownload(a, '1.2.0');
    expectValid('UpdateDownloadState', started);
    expect(started).toMatchObject({ state: 'downloading', bytes_done: 0, bytes_total: total });
    expect(started.images).toEqual(IMAGES.map((name) => ({ name, state: 'pending' })));
    expect(started.verification).toBeUndefined();
    expect((await getUpdateRelease(a, '1.2.0')).summary.state).toBe('downloading');
    expect((await getUpdateStatus(a)).state).toBe('downloading');
    const event = (await audits('update.download', 'success'))[0]!;
    expect(event.summary_en).toContain('stub');
    expect(event.summary_en).toContain('started');
    expect(event.detail).toMatchObject({ version: '1.2.0', state: 'downloading', stub: true });
  });

  it('moves through the phases on the clock, with the boundaries exactly at the constants', async () => {
    const a = admin();
    await startUpdateDownload(a, '1.2.0');
    // [seconds after the start, agent state, download state, bytes done, state of each image]
    const timeline: readonly (readonly [number, string, string, number, readonly string[]])[] = [
      [0, 'downloading', 'downloading', 0, ['pending', 'pending', 'pending', 'pending']],
      [1, 'downloading', 'downloading', 292_500_000, ['pushed_to_registry', 'pending', 'pending', 'pending']],
      [2, 'downloading', 'downloading', 585_000_000, ['pushed_to_registry', 'pushed_to_registry', 'pulled', 'pending']],
      [3, 'downloading', 'downloading', 877_500_000, ['pushed_to_registry', 'pushed_to_registry', 'pushed_to_registry', 'pending']],
      [4, 'verifying', 'verifying', total, ['pushed_to_registry', 'pushed_to_registry', 'pushed_to_registry', 'pushed_to_registry']],
      [5, 'verifying', 'verifying', total, ['pushed_to_registry', 'pushed_to_registry', 'pushed_to_registry', 'pushed_to_registry']],
      [6, 'idle', 'verified', total, ['verified', 'verified', 'verified', 'verified']],
    ];
    for (const [seconds, agent, download, bytes, images] of timeline) {
      await at(seconds);
      const state = await getUpdateDownloadState(a, '1.2.0');
      expectValid('UpdateDownloadState', state);
      expect(state.state, `${seconds} s`).toBe(download);
      expect(state.bytes_done, `${seconds} s bytes`).toBe(bytes);
      expect(state.images.map((i) => i.state), `${seconds} s images`).toEqual(images);
      expect((await getUpdateStatus(a)).state, `${seconds} s agent`).toBe(agent);
      expect((await getUpdateRelease(a, '1.2.0')).summary.state, `${seconds} s release`).toBe(seconds < 6 ? 'downloading' : 'verified');
      expect((await getUpdateRelease(a, '1.2.0')).download, `${seconds} s detail`).toEqual(state);
    }
  });

  it('changes phase at the whole second of the constant, not a millisecond before (the clock counts whole seconds)', async () => {
    const a = admin();
    await startUpdateDownload(a, '1.2.0');
    await at(3.999);
    expect((await getUpdateDownloadState(a, '1.2.0')).state).toBe('downloading');
    await at(4);
    expect((await getUpdateDownloadState(a, '1.2.0')).state).toBe('verifying');
    await at(5.999);
    expect((await getUpdateDownloadState(a, '1.2.0')).state).toBe('verifying');
    await at(6);
    expect(await getUpdateDownloadState(a, '1.2.0')).toMatchObject({ state: 'verified', verification: { verified: true, signature_valid: true, digests_match: true } });
  });

  it('shows no verification result while it verifies, and the list of releases shows the release as downloading', async () => {
    const a = admin();
    await startUpdateDownload(a, '1.2.0');
    await at(4);
    expect((await getUpdateDownloadState(a, '1.2.0')).verification).toBeUndefined();
    expect((await listUpdateReleases(a)).items.find((r) => r.version === '1.2.0')?.state).toBe('downloading');
    expect((await getUpdateRelease(a, '1.2.0')).preflight).toBeNull();
  });

  it('does not let a release that is still downloading be checked, skipped, downloaded again or overridden', async () => {
    const a = admin();
    await startUpdateDownload(a, '1.2.1');
    await at(3);
    await expect(runUpdatePreflight(a, '1.2.1')).rejects.toThrow(/is downloading/);
    await expect(confirmUpdateBackup(a, '1.2.1', {})).rejects.toThrow(ConflictError);
    await expect(startUpdateDownload(a, '1.2.1')).rejects.toThrow(ConflictError);
    await expect(skipUpdate(a, '1.2.1', { reason: 'Too soon.' })).rejects.toThrow(ConflictError);
    await expect(scheduleUpdate(a, '1.2.1', {})).rejects.toThrow(ConflictError);
    await expect(requestUpdateEmergencyOverride(a, { version: '1.2.1', second_approver_user_id: firstApproverId(), reason: 'Gap calculation error hides a two hour shortfall.' })).rejects.toThrow(ConflictError);
    await at(6);
    expect((await runUpdatePreflight(a, '1.2.1')).checks.find((c) => c.id === 'recent_backup')?.status).toBe('needs_confirmation');
  });

  it('carries a whole update at the demo pace: download, wait, confirm the backup, schedule, approve, apply', async () => {
    const a = admin();
    await startUpdateDownload(a, '1.2.0');
    await at(6);
    expect((await confirmUpdateBackup(a, '1.2.0', {})).state).toBe('passed');
    expect((await scheduleUpdate(a, '1.2.0', {})).state).toBe('awaiting_approval');
    await approveUpdate(approver(), '1.2.0', {});
    expect(await applyUpdate(a, '1.2.0')).toMatchObject({ state: 'succeeded', version: '1.2.0' });
    expect(await getUpdateStatus(a)).toMatchObject({ current_version: '1.2.0', state: 'idle' });
  });

  it('applies the end of a download once, whoever reads first, and audits it as the system', async () => {
    const a = admin();
    await startUpdateDownload(a, '1.2.0');
    await at(5);
    expect(await audits('update.download_finished')).toHaveLength(0);
    await at(6);
    // the Change Approver sees it first: reading is enough
    expect((await getUpdateRelease(approver(), '1.2.0')).summary.state).toBe('verified');
    await getUpdateStatus(a);
    await getUpdateDownloadState(a, '1.2.0');
    await listUpdateReleases(approver());
    const events = await audits('update.download_finished', 'success');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ actor_type: 'system', actor_user_id: null, entity_type: 'update_release', entity_id: '1.2.0', outcome: 'success' });
    expect(events[0]?.summary_en).toContain('stub');
    expect(events[0]?.detail).toMatchObject({ version: '1.2.0', state: 'verified', stub: true });
  });

  it('keeps a download that is under way across a fresh module instance', async () => {
    await startUpdateDownload(admin(), '1.2.0');
    await at(2);
    vi.resetModules();
    const fresh = await import('./updates');
    expect(await fresh.getUpdateDownloadState(admin(), '1.2.0')).toMatchObject({ state: 'downloading', bytes_done: 585_000_000 });
    await at(6);
    expect((await fresh.getUpdateRelease(admin(), '1.2.0')).summary.state).toBe('verified');
  });

  it('leaves the offline upload as it was: verified at once, with no phases', async () => {
    const a = admin();
    await updateUpdateConnection(a, { mode: 'offline' });
    await uploadOfflineUpdate(a, { file: 'opendispatch-release-1.4.0.bundle' });
    expect((await getUpdateDownloadState(a, '1.4.0')).state).toBe('verified');
    expect((await getUpdateRelease(a, '1.4.0')).summary.state).toBe('verified');
  });

  it('reads any value but `instant` in the pace setting as the demo pace, and `instant` as the old synchronous download', async () => {
    const a = admin();
    await setPace('instant');
    expect(await startUpdateDownload(a, '1.2.0')).toMatchObject({ state: 'verified' });
    expect((await getUpdateRelease(a, '1.2.0')).summary.state).toBe('verified');
    await putSettingForTest(a, DOWNLOAD_PACE_SETTING, 'fast');
    expect(await startUpdateDownload(a, '1.2.1')).toMatchObject({ state: 'downloading' });
  });

  describe('verification fails (a proxy address that contains "tampered": the worker image digest does not match)', () => {
    it('ends in failed, discards the release, raises the alert once at the end and audits it', async () => {
      const a = admin();
      await updateUpdateConnection(a, TAMPERED_PROXY);
      await startUpdateDownload(a, '1.2.0');
      await at(5);
      expect(await discarded()).toHaveLength(0);
      expect((await getUpdateDownloadState(a, '1.2.0')).state).toBe('verifying');
      await at(6);
      const failed = await getUpdateDownloadState(a, '1.2.0');
      expectValid('UpdateDownloadState', failed);
      expect(failed).toMatchObject({ state: 'failed', verification: { verified: false, signature_valid: true, digests_match: false, key_revoked: false, older_than_installed: false, index_expired: false } });
      expect(failed.images.map((i) => i.state)).toEqual(['verified', 'verified', 'failed', 'verified']);
      expect(failed.error_message).toContain('worker');
      expect(failed.error_message).toContain('stub');
      expect((await getUpdateRelease(a, '1.2.0')).summary.state).toBe('withdrawn');
      expect((await getUpdateStatus(a)).state).toBe('idle');
      expect((await discarded()).map((n) => n.recipient_role).sort()).toEqual(['administrator', 'change_approver']);
      await getUpdateStatus(a);
      expect(await discarded()).toHaveLength(2);
      expect((await audits('update.download_finished', 'success'))[0]?.detail).toMatchObject({ version: '1.2.0', state: 'failed', stub: true });
    });

    it('names the first image when the release has no worker', async () => {
      const a = admin();
      await updateUpdateConnection(a, TAMPERED_PROXY);
      await startUpdateDownload(a, '1.2.1');
      await at(6);
      expect((await getUpdateDownloadState(a, '1.2.1')).images).toEqual([
        { name: 'web', state: 'failed' },
        { name: 'api', state: 'verified' },
      ]);
    });

    it('is the same result at the instant pace, in the call that starts the download', async () => {
      const a = admin();
      await setPace('instant');
      await updateUpdateConnection(a, TAMPERED_PROXY);
      expect(await startUpdateDownload(a, '1.2.0')).toMatchObject({ state: 'failed', verification: { digests_match: false } });
      expect(await discarded()).toHaveLength(2);
      expect(await audits('update.download_finished')).toHaveLength(0);
    });
  });

  describe('retry after a failed verification (gap 1: the same operation accepts a discarded release)', () => {
    it('accepts a release withdrawn by a failed verification, starts over, and ends verified once the cause is gone', async () => {
      const a = admin();
      await updateUpdateConnection(a, TAMPERED_PROXY);
      await startUpdateDownload(a, '1.2.0');
      await at(6);
      expect((await getUpdateRelease(a, '1.2.0')).summary.state).toBe('withdrawn');
      await updateUpdateConnection(a, CLEAN_PROXY);
      const again = await startUpdateDownload(a, '1.2.0');
      expectValid('UpdateDownloadState', again);
      expect(again).toMatchObject({ state: 'downloading', bytes_done: 0 });
      expect((await getUpdateRelease(a, '1.2.0')).summary.state).toBe('downloading');
      const event = (await audits('update.download', 'success'))[0]!;
      expect(event.summary_en).toContain('retried');
      expect(event.summary_en).toContain('stub');
      expect(event.detail).toMatchObject({ version: '1.2.0', retry: true, stub: true });
      expect(String(event.detail?.['previous_error'])).toContain('worker');
      await at(12);
      expect((await getUpdateDownloadState(a, '1.2.0')).state).toBe('verified');
      expect((await getUpdateRelease(a, '1.2.0')).summary.state).toBe('verified');
      expect((await confirmUpdateBackup(a, '1.2.0', {})).state).toBe('passed');
    });

    it('fails again while the cause is still there', async () => {
      const a = admin();
      await updateUpdateConnection(a, TAMPERED_PROXY);
      await startUpdateDownload(a, '1.2.0');
      await at(6);
      await startUpdateDownload(a, '1.2.0');
      await at(12);
      expect((await getUpdateDownloadState(a, '1.2.0')).state).toBe('failed');
      expect((await getUpdateRelease(a, '1.2.0')).summary.state).toBe('withdrawn');
    });

    it('accepts a retry at the instant pace, and after an expired release index once Check now has renewed it', async () => {
      const a = admin();
      await setPace('instant');
      await checkForUpdatesNow(a);
      await patchGoUpdatesState({ index_valid_until: '2026-09-01T00:00:00+03:00' });
      const expired = await startUpdateDownload(a, '1.2.0');
      expect(expired).toMatchObject({ state: 'failed', verification: { index_expired: true } });
      expect((await getUpdateRelease(a, '1.2.0')).summary.state).toBe('withdrawn');
      await checkForUpdatesNow(a);
      expect(await startUpdateDownload(a, '1.2.0')).toMatchObject({ state: 'verified' });
      expect((await audits('update.download', 'success'))[0]?.summary_en).toContain('retry');
    });

    it('refuses a release that is not newer than the installed one: trying again cannot help', async () => {
      const a = admin();
      await setPace('instant');
      await driveToApproved('1.3.1');
      await applyUpdate(a, '1.3.1');
      await requestUpdateRecovery(a, { action: 'resume' });
      expect((await getUpdateStatus(a)).current_version).toBe('1.3.1');
      expect(await startUpdateDownload(a, '1.2.0')).toMatchObject({ state: 'failed', verification: { older_than_installed: true } });
      expect((await getUpdateRelease(a, '1.2.0')).summary.state).toBe('withdrawn');
      await expect(startUpdateDownload(a, '1.2.0')).rejects.toThrow(/not newer than the installed 1\.3\.1/);
    });

    it('lets the Administrator skip a discarded release instead (the mockup offers Try again and Skip side by side); then it cannot be tried again', async () => {
      const a = admin();
      await setPace('instant');
      await updateUpdateConnection(a, TAMPERED_PROXY);
      await startUpdateDownload(a, '1.2.0');
      expect((await getUpdateRelease(a, '1.2.0')).summary.state).toBe('withdrawn');
      const detail = await skipUpdate(a, '1.2.0', { reason: 'The proxy garbles it; wait for the next release.' });
      expect(detail.summary.state).toBe('skipped');
      expect((await listUpdateHistory(a)).items[0]).toMatchObject({ version: '1.2.0', kind: 'skip', result: 'skipped' });
      await expect(startUpdateDownload(a, '1.2.0')).rejects.toThrow(ConflictError);
      // a withdrawn release with no failed download behind it is still not skippable
      await patchGoUpdatesState({ release_states: { '1.2.1': 'withdrawn' } });
      await expect(skipUpdate(a, '1.2.1', { reason: 'x' })).rejects.toThrow(ConflictError);
    });

    it('refuses a release the agent withdrew for another reason, one that is not withdrawn, and one that is under way', async () => {
      const a = admin();
      await setPace('instant');
      expect((await startUpdateDownload(a, '1.2.0')).state).toBe('verified');
      await expect(startUpdateDownload(a, '1.2.0')).rejects.toThrow(ConflictError); // verified
      await patchGoUpdatesState({ release_states: { '1.2.1': 'withdrawn' } }); // no failed download behind it: the agent withdrew it
      await expect(startUpdateDownload(a, '1.2.1')).rejects.toThrow(/only an available release/);
      const count = await auditCount();
      expect(await audits('update.download', 'denied')).toHaveLength(0);
      expect(await auditCount()).toBe(count);
    });

    it('is allowed to the Administrator in a private install only, and audited when denied', async () => {
      const a = admin();
      await updateUpdateConnection(a, TAMPERED_PROXY);
      await startUpdateDownload(a, '1.2.0');
      await at(6);
      for (const ctx of [approver(), ctxFor('viewer_auditor'), ctxFor('planner'), ctxFor('administrator', { installMode: 'shared' }), ctxFor('administrator', { installMode: 'dedicated' })]) {
        const before = dataSnapshot();
        const count = await auditCount();
        await expect(startUpdateDownload(ctx, '1.2.0'), `${ctx.role} ${ctx.installMode}`).rejects.toThrow(ForbiddenError);
        expect(dataSnapshot()).toBe(before);
        expect(await auditCount()).toBe(count + 1);
      }
      expect(await audits('update.download', 'denied')).toHaveLength(5);
      expect((await getUpdateRelease(a, '1.2.0')).summary.state).toBe('withdrawn');
    });
  });
});

describe('pre-flight: waiting for the backup is not a failure of a check (gap 4)', () => {
  it('reports a failed result while the backup awaits confirmation, but with no failed check; a real failure has one', async () => {
    const a = admin();
    await startUpdateDownload(a, '1.2.0');
    const waiting = await runUpdatePreflight(a, '1.2.0');
    expect(waiting.state).toBe('failed');
    expect(waiting.checks.filter((c) => c.status === 'failed')).toEqual([]);
    expect(waiting.checks.filter((c) => c.status === 'needs_confirmation').map((c) => c.id)).toEqual(['recent_backup']);
    // a run that needs attention is a real failure of the check "system is healthy"
    await driveToApproved('1.3.1');
    await applyUpdate(a, '1.3.1');
    const real = await runUpdatePreflight(a, '1.2.0');
    expect(real.state).toBe('failed');
    expect(real.checks.filter((c) => c.status === 'failed').map((c) => c.id)).toEqual(['system_healthy']);
    // confirming the backup does not turn a real failure into a pass
    const confirmed = await confirmUpdateBackup(a, '1.2.0', { note: 'Taken.' });
    expect(confirmed.checks.find((c) => c.id === 'recent_backup')?.status).toBe('passed');
    expect(confirmed.state).toBe('failed');
    expect((await getUpdateRelease(a, '1.2.0')).summary.state).toBe('verified');
  });

  it('refuses to confirm a backup for a release that has not been downloaded and verified', async () => {
    const a = admin();
    await expect(confirmUpdateBackup(a, '1.2.0', {})).rejects.toThrow(ConflictError);
    expect(await audits('update.backup_confirmed', 'success')).toHaveLength(0);
  });
});

describe('the restore request: read it again, watch it move, see its effects once (gap 3)', () => {
  beforeEach(async () => {
    await useClock();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /** 1.3.1 fails partway (scripted) and needs attention. */
  async function needsAttention(): Promise<string> {
    await driveToApproved('1.3.1');
    return (await applyUpdate(admin(), '1.3.1')).run_id;
  }
  const NONE = { restore_request: null, run_id: null, version: null, note: null, completed_at: null };

  it('has no request until one is made, for a role that may view Updates', async () => {
    expect(await getUpdateRecovery(admin())).toEqual(NONE);
    expect(await getUpdateRecovery(approver())).toEqual(NONE);
    expectValid('UpdateRecoveryStatus', await getUpdateRecovery(admin()));
    await needsAttention();
    expect(await getUpdateRecovery(admin())).toEqual(NONE);
    const before = dataSnapshot();
    await getUpdateRecovery(approver());
    expect(dataSnapshot()).toBe(before);
  });

  it('shows the request as requested, with the run, the release, the note and who asked, and keeps it across a reload', async () => {
    const a = admin();
    const runId = await needsAttention();
    const result = await requestUpdateRecovery(a, { action: 'restore', run_id: runId, note: 'Please restore the backup.' });
    const recovery = await getUpdateRecovery(approver());
    expectValid('UpdateRecoveryStatus', recovery);
    expect(recovery).toMatchObject({ run_id: runId, version: '1.3.1', note: 'Please restore the backup.', completed_at: null });
    expect(recovery.restore_request).toMatchObject({ state: 'requested', backup_reference: 'backup-before-1.3.1', requested_at: T0 });
    expect(recovery.restore_request).toEqual(result.restore_request);
    expect(recovery.restore_request?.requested_by.user_id).toBe(a.userId);
    expect(await getUpdateStatus(a)).toMatchObject({ state: 'needs_attention', in_maintenance: true, live_assignment_fallback_active: true });
    vi.resetModules();
    const fresh = await import('./updates');
    expect(await fresh.getUpdateRecovery(a)).toEqual(recovery);
  });

  it('has no note when none was given', async () => {
    await needsAttention();
    await requestUpdateRecovery(admin(), { action: 'restore' });
    expect(await getUpdateRecovery(admin())).toMatchObject({ note: null });
  });

  it('moves from requested to in progress to completed on the clock, exactly at the constants', async () => {
    const a = admin();
    await needsAttention();
    await requestUpdateRecovery(a, { action: 'restore' });
    const timeline: readonly (readonly [number, string])[] = [
      [0, 'requested'],
      [2.999, 'requested'],
      [RESTORE_IN_PROGRESS_AFTER_MS / 1000, 'in_progress'],
      [6, 'in_progress'],
      [6.999, 'in_progress'],
      [RESTORE_COMPLETED_AFTER_MS / 1000, 'completed'],
      [60, 'completed'],
    ];
    for (const [seconds, phase] of timeline) {
      await at(seconds);
      const recovery = await getUpdateRecovery(a);
      expectValid('UpdateRecoveryStatus', recovery);
      expect(recovery.restore_request?.state, `${seconds} s`).toBe(phase);
      expect((await getUpdateStatus(a)).state, `${seconds} s agent`).toBe(phase === 'completed' ? 'idle' : 'needs_attention');
    }
    expect((await getUpdateRecovery(a)).completed_at).toBe('2026-09-13T10:00:07+03:00');
  });

  it('on completion turns maintenance off, gives live assignment back to OpenDispatch, clears the attention and lets the release go again', async () => {
    const a = admin();
    const runId = await needsAttention();
    await requestUpdateRecovery(a, { action: 'restore', run_id: runId });
    await at(6);
    expect(await getUpdateStatus(a)).toMatchObject({ state: 'needs_attention', in_maintenance: true, live_assignment_fallback_active: true });
    expect(await getUpdateRun(a, runId)).toMatchObject({ state: 'needs_attention', maintenance_on: true });
    await at(7);
    expect(await getUpdateStatus(a)).toMatchObject({ state: 'idle', current_version: '1.1.0', in_maintenance: false, live_assignment_fallback_active: false });
    const run = await getUpdateRun(a, runId);
    expectValid('UpdateApplyRun', run);
    expect(run).toMatchObject({ state: 'failed', maintenance_on: false, finished_at: '2026-09-13T10:00:07+03:00' });
    expect(run.offered_recovery).toBeUndefined();
    expect(await getUpdateRelease(a, '1.3.1')).toMatchObject({ summary: { state: 'available' }, download: null, preflight: null, scheduled: null });
    // nothing waits for the recovery any more: the pre-flight passes the health check and an update can be applied again
    await startUpdateDownload(a, '1.2.0');
    expect((await runUpdatePreflight(a, '1.2.0')).checks.find((c) => c.id === 'system_healthy')?.status).toBe('passed');
    expect(await requestUpdateRecovery(a, { action: 'restore' })).toEqual({ action: 'restore', state: 'refused' });
    expect(await requestUpdateRecovery(a, { action: 'resume' })).toEqual({ action: 'resume', state: 'refused' });
  });

  it('records the completion once, as an event of the system with no user, whoever reads first, and marks it a stub', async () => {
    const a = admin();
    await needsAttention();
    await requestUpdateRecovery(a, { action: 'restore' });
    await at(6.999);
    expect(await audits('update.restore_completed')).toHaveLength(0);
    await at(7);
    await getUpdateStatus(approver());
    await getUpdateRecovery(a);
    await getUpdateRecovery(a);
    await listUpdateHistory(a);
    const events = await audits('update.restore_completed', 'success');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ actor_type: 'system', actor_user_id: null, entity_type: 'update_run', outcome: 'success' });
    expect(events[0]?.summary_en).toContain('stub');
    expect(events[0]?.detail).toMatchObject({ version: '1.3.1', stub: true });
    expect(await audits('update.recovery', 'success')).toHaveLength(1);
  });

  it('is applied by a write that comes first: Check now already sees the restored system', async () => {
    const a = admin();
    await needsAttention();
    await requestUpdateRecovery(a, { action: 'restore' });
    await at(8);
    expect(await checkForUpdatesNow(a)).toMatchObject({ state: 'idle', in_maintenance: false });
    expect(await audits('update.restore_completed')).toHaveLength(1);
  });

  it('lets a resume overtake a restore that is not done: the request is dropped and its effects never happen', async () => {
    const a = admin();
    await needsAttention();
    await requestUpdateRecovery(a, { action: 'restore', note: 'Maybe.' });
    await at(4);
    expect((await getUpdateRecovery(a)).restore_request?.state).toBe('in_progress');
    expect(await requestUpdateRecovery(a, { action: 'resume' })).toMatchObject({ action: 'resume', state: 'started' });
    expect(await getUpdateRecovery(a)).toEqual(NONE);
    await at(60);
    expect(await getUpdateRecovery(a)).toEqual(NONE);
    expect(await audits('update.restore_completed')).toHaveLength(0);
    expect(await getUpdateStatus(a)).toMatchObject({ current_version: '1.3.1', state: 'idle', in_maintenance: false });
    expect((await listUpdateHistory(a)).items.map((h) => `${h.kind}:${h.result}`)).toEqual(['resume:succeeded', 'update:failed', 'update:succeeded', 'update:succeeded']);
  });

  it('refuses a second restore while one is requested or in progress, and audits the refusal as a stub', async () => {
    const a = admin();
    await needsAttention();
    await requestUpdateRecovery(a, { action: 'restore' });
    const first = (await getUpdateRecovery(a)).restore_request!;
    expect(await requestUpdateRecovery(a, { action: 'restore' })).toEqual({ action: 'restore', state: 'refused' });
    await at(4);
    expect(await requestUpdateRecovery(a, { action: 'restore' })).toEqual({ action: 'restore', state: 'refused' });
    expect((await getUpdateRecovery(a)).restore_request?.id).toBe(first.id);
    const refusals = (await audits('update.recovery', 'success')).filter((e) => e.summary_en.includes('refused'));
    expect(refusals).toHaveLength(2);
    expect(refusals[0]?.summary_en).toContain('already');
    expect(refusals[0]?.summary_en).toContain('stub');
  });

  it('keeps the completed request until the next run starts, then shows the next request', async () => {
    const a = admin();
    const first = await needsAttention();
    await requestUpdateRecovery(a, { action: 'restore' });
    await at(7);
    const done = await getUpdateRecovery(a);
    expect(done.restore_request?.state).toBe('completed');
    await at(600);
    expect((await getUpdateRecovery(a)).restore_request?.state).toBe('completed');
    // the same release fails again (scripted): a new run needs attention, and the old request is history
    const second = await needsAttention();
    expect(second).not.toBe(first);
    expect(await getUpdateRecovery(a)).toEqual(NONE);
    await requestUpdateRecovery(a, { action: 'restore', run_id: second });
    const next = await getUpdateRecovery(a);
    expect(next.run_id).toBe(second);
    expect(next.restore_request?.id).not.toBe(done.restore_request?.id);
    expect(next.restore_request?.state).toBe('requested');
  });

  it('gives a role that may not view Updates, and an install that is not private, `forbidden`, audited for the install mode', async () => {
    for (const role of ['dispatch_supervisor', 'dispatcher', 'planner', 'remote_team_lead', 'viewer_auditor'] as const) await expect(getUpdateRecovery(ctxFor(role)), role).rejects.toThrow(ForbiddenError);
    for (const installMode of ['shared', 'dedicated'] as const) {
      const count = await auditCount();
      await expect(getUpdateRecovery(ctxFor('administrator', { installMode })), installMode).rejects.toThrow(ForbiddenError);
      expect(await auditCount()).toBe(count + 1);
    }
    expect((await audits('update.read', 'denied')).length).toBeGreaterThanOrEqual(2);
  });
});
