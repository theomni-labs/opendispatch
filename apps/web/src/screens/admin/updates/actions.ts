'use server';
// SPDX-License-Identifier: AGPL-3.0-only

// The writes of the Updates screen: exactly the data functions of lib/data/updates.ts.
//
//   checkNow                checkForUpdatesNow                     downloadRelease   startUpdateDownload (also the retry)
//   runPreflight            runUpdatePreflight                     confirmBackup     confirmUpdateBackup
//   scheduleRelease         scheduleUpdate                         cancelSchedule    cancelScheduledUpdate
//   approveRelease          approveUpdate                          rejectRelease     rejectUpdate
//   applyRelease            applyUpdate                            skipRelease       skipUpdate
//   emergencyOverride       requestUpdateEmergencyOverride         recoverUpdate     requestUpdateRecovery (resume, restore)
//   saveSettings            updateUpdateSettings                   changeMode        patchUpdateConnection (the mode)
//   saveProxy               patchUpdateConnection (the proxy)      testConnection    testUpdateConnection
//   uploadUpdateFile        uploadOfflineUpdate                    saveRecurring     patchUpdateChangeWindows (one window)
//   addBlackout, removeBlackout                                    patchUpdateChangeWindows (add, remove)
//   setSecondApprover       patchUpdateChangePolicy
//
// THE UPDATE AGENT IS A SCRIPTED STUB: nothing checks a signature, pulls an image or runs a migration.
//
// Rule 2: no action takes a context, customer, user, role, zone scope or install mode from the browser. Each builds its own
// context with requireRequestContext() inside runAction, and the data function authorises, validates and audits. The release
// an action acts on is a `version`; the second approver of the emergency override is `second_approver_user_id` (what a
// person picked). A role that may not write gets `forbidden` and a `denied` audit event from the write's own guard. The
// PATCH writes send only what the person changed; Go merges it into the stored state and writes the window label.
// (tools/rules/context-rules.test.ts scans this file for those names.)

import { pickFields, pickText } from '@/lib/actions/pick';
import { runAction } from '@/lib/actions/run-action';
import type { ActionResult } from '@/lib/actions/types';
import {
  applyUpdate,
  approveUpdate,
  cancelScheduledUpdate,
  checkForUpdatesNow,
  confirmUpdateBackup,
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
  updateUpdateSettings,
  uploadOfflineUpdate,
} from '@/lib/data/updates';
import type { UpdateChangeWindows } from '@/lib/types';
import type {
  ApplyOutcome,
  BlackoutInput,
  BlackoutTarget,
  CheckOutcome,
  ConnectionTestView,
  ModeInput,
  DecisionInput,
  DownloadOutcome,
  EmergencyInput,
  PolicyInput,
  ProxyInput,
  PreflightOutcome,
  RecoveryInput,
  RecoveryOutcome,
  RecurringInput,
  ReleaseOutcome,
  ScheduleInput,
  ScheduleOutcome,
  SettingsInput,
  SkipInput,
  UploadInput,
  UploadOutcome,
  VersionInput,
} from './types';
import { compareVersions, runView } from './view';

const REVALIDATE = '/admin/updates';

const versionOf = (input: unknown): string => pickText(input, 'version') ?? '';

// ---------------------------------------------------------------------------------------------
// The release card
// ---------------------------------------------------------------------------------------------

/** Checks the release index now (connected mode). The toast names the oldest release still open when one was found. */
export async function checkNow(): Promise<ActionResult<CheckOutcome>> {
  return runAction(
    async (ctx) => {
      const status = await checkForUpdatesNow(ctx);
      const open = (await listUpdateReleases(ctx, { limit: 200 })).items.filter((r) => ['available', 'downloading', 'verified', 'ready', 'scheduled'].includes(r.state) && compareVersions(r.version, status.current_version) > 0);
      const oldest = [...open].sort((a, b) => compareVersions(a.version, b.version))[0];
      return { result: status.last_check_result ?? null, version: oldest?.version ?? null } satisfies CheckOutcome;
    },
    { revalidate: REVALIDATE },
  );
}

/** Starts the download of a release, or downloads one again after a failed verification. The phases move on with time. */
export async function downloadRelease(input: VersionInput): Promise<ActionResult<DownloadOutcome>> {
  return runAction(
    async (ctx) => {
      const version = versionOf(input);
      const download = await startUpdateDownload(ctx, version);
      return { version, state: download.state } satisfies DownloadOutcome;
    },
    { revalidate: REVALIDATE },
  );
}

export async function runPreflight(input: VersionInput): Promise<ActionResult<PreflightOutcome>> {
  return runAction(
    async (ctx) => {
      const version = versionOf(input);
      return { version, state: (await runUpdatePreflight(ctx, version)).state } satisfies PreflightOutcome;
    },
    { revalidate: REVALIDATE },
  );
}

/** Records that a fresh backup exists (the pre-flight waits for it) and runs the pre-flight again. */
export async function confirmBackup(input: VersionInput): Promise<ActionResult<PreflightOutcome>> {
  return runAction(
    async (ctx) => {
      const version = versionOf(input);
      return { version, state: (await confirmUpdateBackup(ctx, version, {})).state } satisfies PreflightOutcome;
    },
    { revalidate: REVALIDATE },
  );
}

export async function scheduleRelease(input: ScheduleInput): Promise<ActionResult<ScheduleOutcome>> {
  return runAction(
    async (ctx) => {
      const version = versionOf(input);
      const scheduled = await scheduleUpdate(ctx, version, pickFields(input, ['window_start']));
      return { version, state: scheduled.state, windowStart: scheduled.window_start, windowEnd: scheduled.window_end } satisfies ScheduleOutcome;
    },
    { revalidate: REVALIDATE },
  );
}

export async function cancelSchedule(input: VersionInput): Promise<ActionResult<ReleaseOutcome>> {
  return runAction(
    async (ctx) => {
      const detail = await cancelScheduledUpdate(ctx, versionOf(input));
      return { version: detail.summary.version, state: detail.summary.state } satisfies ReleaseOutcome;
    },
    { revalidate: REVALIDATE },
  );
}

const decisionBody = (input: unknown): Record<string, unknown> => {
  const note = (pickText(input, 'note') ?? '').trim();
  return note === '' ? {} : { note };
};

/** For the Change Approver: nobody approves their own request, and only a listed approver decides (the data layer checks). */
export async function approveRelease(input: DecisionInput): Promise<ActionResult<ScheduleOutcome>> {
  return runAction(
    async (ctx) => {
      const version = versionOf(input);
      const scheduled = await approveUpdate(ctx, version, decisionBody(input));
      return { version, state: scheduled.state, windowStart: scheduled.window_start, windowEnd: scheduled.window_end } satisfies ScheduleOutcome;
    },
    { revalidate: REVALIDATE },
  );
}

export async function rejectRelease(input: DecisionInput): Promise<ActionResult<ScheduleOutcome>> {
  return runAction(
    async (ctx) => {
      const version = versionOf(input);
      const scheduled = await rejectUpdate(ctx, version, decisionBody(input));
      return { version, state: scheduled.state, windowStart: scheduled.window_start, windowEnd: scheduled.window_end } satisfies ScheduleOutcome;
    },
    { revalidate: REVALIDATE },
  );
}

/** Applies an approved, scheduled release. The scripted agent finishes in this call: the run comes back complete. */
export async function applyRelease(input: VersionInput): Promise<ActionResult<ApplyOutcome>> {
  return runAction(async (ctx) => ({ run: runView(await applyUpdate(ctx, versionOf(input))) }) satisfies ApplyOutcome, { revalidate: REVALIDATE });
}

export async function skipRelease(input: SkipInput): Promise<ActionResult<ReleaseOutcome>> {
  return runAction(
    async (ctx) => {
      const detail = await skipUpdate(ctx, versionOf(input), pickFields(input, ['reason']));
      return { version: detail.summary.version, state: detail.summary.state } satisfies ReleaseOutcome;
    },
    { revalidate: REVALIDATE },
  );
}

/** A hotfix outside a change window: the Administrator is the first approver, a Change Approver the second, and a reason is written. */
export async function emergencyOverride(input: EmergencyInput): Promise<ActionResult<ApplyOutcome>> {
  return runAction(async (ctx) => ({ run: runView(await requestUpdateEmergencyOverride(ctx, pickFields(input, ['version', 'second_approver_user_id', 'reason']))) }) satisfies ApplyOutcome, { revalidate: REVALIDATE });
}

// ---------------------------------------------------------------------------------------------
// Recovery
// ---------------------------------------------------------------------------------------------

/**
 * Resume after the fixed release, or request a restore of the backup from before the update. The restore is carried out by the
 * customer's database team: the data layer answers `requested` and the phases move on with time. The run to recover is the one
 * that needs attention (the data layer finds it), so the browser names none.
 */
export async function recoverUpdate(input: RecoveryInput): Promise<ActionResult<RecoveryOutcome>> {
  return runAction(
    async (ctx) => {
      const action = pickText(input, 'action');
      const note = (pickText(input, 'note') ?? '').trim();
      const result = await requestUpdateRecovery(ctx, { action, run_id: null, ...(note === '' ? {} : { note }) });
      return { action: result.action === 'restore' ? 'restore' : 'resume', state: result.state, run: result.run === null || result.run === undefined ? null : runView(result.run) } satisfies RecoveryOutcome;
    },
    { revalidate: REVALIDATE },
  );
}

// ---------------------------------------------------------------------------------------------
// Settings, connection, offline file
// ---------------------------------------------------------------------------------------------

export async function saveSettings(input: SettingsInput): Promise<ActionResult<SettingsInput>> {
  return runAction(
    async (ctx) => {
      const saved = await updateUpdateSettings(ctx, pickFields(input, ['channel', 'check_interval_hours', 'auto_download', 'notify_only']));
      return { channel: saved.channel, check_interval_hours: saved.check_interval_hours, auto_download: saved.auto_download, notify_only: saved.notify_only } satisfies SettingsInput;
    },
    { revalidate: REVALIDATE },
  );
}

/** Connected or offline. The proxy keeps what it had. */
export async function changeMode(input: ModeInput): Promise<ActionResult<{ mode: 'connected' | 'offline' }>> {
  return runAction(
    async (ctx) => {
      const saved = await patchUpdateConnection(ctx, { mode: pickText(input, 'mode') });
      return { mode: saved.mode };
    },
    { revalidate: REVALIDATE },
  );
}

/**
 * The proxy of connected mode. The password and the certificate are never read back: only whether they are set. An empty
 * password or certificate field keeps the one stored, so it is not sent; a blank address or username clears it (Go).
 */
export async function saveProxy(input: ProxyInput): Promise<ActionResult<{ enabled: boolean }>> {
  return runAction(
    async (ctx) => {
      const password = pickText(input, 'proxy_password') ?? '';
      const certificate = pickText(input, 'proxy_certificate') ?? '';
      const proxy = {
        enabled: pickFields(input, ['proxy_enabled'])['proxy_enabled'] === true,
        address: pickText(input, 'proxy_address') ?? null,
        username: pickText(input, 'proxy_username') ?? null,
        ...(password === '' ? {} : { password }),
        ...(certificate === '' ? {} : { ca_certificate_pem: certificate }),
      };
      const saved = await patchUpdateConnection(ctx, { proxy });
      return { enabled: saved.proxy.enabled };
    },
    { revalidate: REVALIDATE },
  );
}

export async function testConnection(): Promise<ActionResult<ConnectionTestView>> {
  return runAction(
    async (ctx) => {
      const result = await testUpdateConnection(ctx);
      return { ok: result.ok, checkedAt: result.checked_at, steps: result.steps.map((step) => ({ name: step.name, ok: step.ok, message: step.message ?? null })) } satisfies ConnectionTestView;
    },
    { revalidate: REVALIDATE },
  );
}

/**
 * The offline update file, read in the browser and sent as text (at most 2,000,000 characters: the data layer's limit; the
 * real file is about 1.2 GB and the agent, not this screen, will take it). The scripted verification decides the result.
 */
export async function uploadUpdateFile(input: UploadInput): Promise<ActionResult<UploadOutcome>> {
  return runAction(
    async (ctx) => {
      const result = await uploadOfflineUpdate(ctx, pickFields(input, ['file']));
      const v = result.verification;
      return {
        accepted: result.accepted,
        version: result.release?.version ?? null,
        verification: { verified: v.verified, signatureValid: v.signature_valid, digestsMatch: v.digests_match, keyRevoked: v.key_revoked, olderThanInstalled: v.older_than_installed, indexExpired: v.index_expired, keyId: v.key_id ?? null, message: v.message ?? null },
      } satisfies UploadOutcome;
    },
    { revalidate: REVALIDATE },
  );
}

// ---------------------------------------------------------------------------------------------
// Change windows and policy
// ---------------------------------------------------------------------------------------------

type WindowsResult = { recurring: number; blackouts: number };

const windowsResult = (saved: UpdateChangeWindows): WindowsResult => ({ recurring: saved.recurring.length, blackouts: saved.blackouts.length });

/** Changes the recurring window the screen shows (`window_id`), or adds one when there is none. Go writes the label. */
export async function saveRecurring(input: RecurringInput): Promise<ActionResult<WindowsResult>> {
  return runAction(
    async (ctx) => {
      const id = pickText(input, 'window_id');
      const window = { ...(id === undefined ? {} : { id }), ...pickFields(input, ['days_of_week', 'start_time', 'end_time']) };
      return windowsResult(await patchUpdateChangeWindows(ctx, { recurring_window: window }));
    },
    { revalidate: REVALIDATE },
  );
}

const hijriOf = (value: unknown): Record<string, unknown> | undefined => (value === undefined ? undefined : pickFields(value, ['year', 'month', 'day']));

/** Adds a blackout period, entered in Gregorian or in Hijri dates. Go converts the Hijri ones with its reference table. */
export async function addBlackout(input: BlackoutInput): Promise<ActionResult<WindowsResult>> {
  return runAction(
    async (ctx) => {
      const fields = pickFields(input, ['label', 'entered_as', 'start_gregorian', 'end_gregorian', 'start_hijri', 'end_hijri']);
      const dates = fields['entered_as'] === 'hijri' ? { start_hijri: hijriOf(fields['start_hijri']), end_hijri: hijriOf(fields['end_hijri']) } : { start_gregorian: fields['start_gregorian'], end_gregorian: fields['end_gregorian'] };
      return windowsResult(await patchUpdateChangeWindows(ctx, { add_blackouts: [{ label: fields['label'], entered_as: fields['entered_as'], ...dates }] }));
    },
    { revalidate: REVALIDATE },
  );
}

export async function removeBlackout(input: BlackoutTarget): Promise<ActionResult<WindowsResult>> {
  return runAction(async (ctx) => windowsResult(await patchUpdateChangeWindows(ctx, { remove_blackout_ids: [pickText(input, 'blackout_id') ?? ''] })), { revalidate: REVALIDATE });
}

/** Whether a second approver is required. The approvers and the emergency policy keep what they had. */
export async function setSecondApprover(input: PolicyInput): Promise<ActionResult<{ second_approver_required: boolean }>> {
  return runAction(
    async (ctx) => {
      const saved = await patchUpdateChangePolicy(ctx, pickFields(input, ['second_approver_required']));
      return { second_approver_required: saved.second_approver_required };
    },
    { revalidate: REVALIDATE },
  );
}
