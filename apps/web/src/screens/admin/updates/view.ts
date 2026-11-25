// SPDX-License-Identifier: AGPL-3.0-only
// The server side of the Updates screen: reads through lib/data with the request context and returns plain data.
// Not a Server Component and not an action: `Screen.tsx` calls it and the tests call it directly.
//
// The update agent is a scripted stub. A download, a verification and a restore request take time in it, and every read works
// out where they are from the clock of the data layer: this file only reads, so a screen that shows a phase must read again
// (`polling`, below) and must not pretend to know more than the data says. The five checks of a verification carry no progress:
// while the release is `verifying` the screen shows them as running and the result appears when the phase ends.
//
// Private installs get the full view. Dedicated and shared installs get the reduced one (getUpdatesSummary only): every other
// read throws in those modes and is audited as denied, so it is never called for them.

import { approvalKindsFor, type InstallMode } from '@/lib/access';
import type { RequestContext } from '@/lib/data/guard';
import { ForbiddenError, NotFoundError } from '@/lib/data/errors';
import { listUsers, listUserDisplayNames } from '@/lib/data/users';
import { listHijriMonths } from '@/lib/data/time';
import {
  getNextUpdateWindow,
  getUpdateChangePolicy,
  getUpdateChangeWindows,
  getUpdateConnection,
  getUpdateRecovery,
  getUpdateRelease,
  getUpdateRun,
  getUpdateSettings,
  getUpdateStatus,
  getUpdatesSummary,
  listUpdateHistory,
  listUpdateReleases,
} from '@/lib/data/updates';
import type { UpdateApplyRun, UpdateChangePolicy, UpdateDownloadState, UpdatePreflightResult, UpdateReleaseDetail, UpdateScheduledUpdate } from '@/lib/types';
import type {
  ApprovalView,
  Channel,
  ConnectionView,
  DecisionGate,
  DownloadView,
  EmergencyChoices,
  FullUpdatesView,
  HijriMonthView,
  HistoryRowView,
  LastResult,
  NameRef,
  OverviewMode,
  OverviewView,
  PreflightView,
  RecoveryView,
  ReducedUpdatesView,
  ReleaseRow,
  ReleaseStage,
  ReleaseView,
  RestoreView,
  RunView,
  ScheduleView,
  SettingsView,
  StatusView,
  UpdatesView,
  WindowSlot,
  WindowsView,
} from './types';

export type Locale = 'en' | 'ar';

/** What the address bar may ask for (already validated by parseSearchParams). */
export interface UpdatesQuery {
  /** `?release=1.3.0`: which open release the card shows. Anything that is not an open release is ignored. */
  readonly release?: string | undefined;
}

const PAGE = 200;
/** The releases the screen treats as open: a person can still do something with them. */
const OPEN_STATES: readonly string[] = ['available', 'downloading', 'verified', 'ready', 'scheduled', 'withdrawn'];
/** Order of the card's subject when several releases are open: what is under way first, what waits last. */
const PRIORITY: Readonly<Record<string, number>> = { downloading: 0, scheduled: 1, ready: 2, verified: 3, withdrawn: 4, available: 5 };
const EMERGENCY_STATES: readonly string[] = ['verified', 'ready', 'scheduled'];

const parts = (version: string): [number, number, number] => {
  const [a = 0, b = 0, c = 0] = version.split('.').map((part) => Number.parseInt(part, 10));
  return [a, b, c];
};

/** Negative when a is older than b. */
export function compareVersions(a: string, b: string): number {
  const x = parts(a);
  const y = parts(b);
  return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
}

interface ListedRelease {
  readonly version: string;
  readonly channel: Channel;
  readonly state: string;
  readonly published_at: string;
}

/** The releases a person can still act on: open state and newer than what runs. */
export function openReleases<T extends ListedRelease>(releases: readonly T[], currentVersion: string): T[] {
  return releases.filter((r) => OPEN_STATES.includes(r.state) && compareVersions(r.version, currentVersion) > 0).sort((a, b) => compareVersions(a.version, b.version));
}

/**
 * The release the card shows: the one asked for by `?release=` when it is open, else the one furthest along (downloading,
 * then scheduled, ready, verified, discarded, available), the oldest first among equals, since updates go in order.
 */
export function pickFocus<T extends ListedRelease>(open: readonly T[], requested: string | undefined): T | undefined {
  const asked = requested === undefined ? undefined : open.find((r) => r.version === requested);
  if (asked !== undefined) return asked;
  return [...open].sort((a, b) => (PRIORITY[a.state] ?? 9) - (PRIORITY[b.state] ?? 9) || compareVersions(a.version, b.version))[0];
}

/** The stage of the release card (the mockup's data-stage) from the state the agent reports. */
export function stageOf(state: string, download: { readonly state: string } | null | undefined, scheduled: { readonly state: string } | null | undefined): ReleaseStage | null {
  switch (state) {
    case 'available':
      return 'available';
    case 'downloading':
      return download?.state === 'verifying' ? 'verifying' : 'downloading';
    case 'verified':
      return 'verified';
    case 'ready':
      return 'ready';
    case 'scheduled':
      return scheduled?.state === 'approved' ? 'approved' : 'awaiting';
    case 'withdrawn':
      return 'verify_failed';
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------------------------
// Small readers
// ---------------------------------------------------------------------------------------------

async function tryOrAsync<T>(read: () => Promise<T>, fallback: T, alsoNotFound = false): Promise<T> {
  try {
    return await read();
  } catch (error) {
    if (error instanceof ForbiddenError || (alsoNotFound && error instanceof NotFoundError)) return fallback;
    throw error;
  }
}

async function namesOf(ctx: RequestContext, ids: readonly string[]): Promise<NameRef[]> {
  if (ids.length === 0) return [];
  return tryOrAsync(async () => (await listUserDisplayNames(ctx, ids)).items.map((item) => ({ id: item.id, name: item.display_name })), [] as NameRef[], true);
}

const first = (values: readonly string[]): string | null => values[0] ?? null;

function downloadView(download: UpdateDownloadState | null | undefined): DownloadView | null {
  if (download === null || download === undefined) return null;
  const v = download.verification;
  return {
    state: download.state,
    bytesDone: download.bytes_done,
    bytesTotal: download.bytes_total,
    images: download.images.map((image) => ({ name: image.name, state: image.state })),
    verification:
      v === null || v === undefined
        ? null
        : { verified: v.verified, signatureValid: v.signature_valid, digestsMatch: v.digests_match, keyRevoked: v.key_revoked, olderThanInstalled: v.older_than_installed, indexExpired: v.index_expired, keyId: v.key_id ?? null, message: v.message ?? null },
    error: download.error_message ?? null,
  };
}

function preflightView(preflight: UpdatePreflightResult | null | undefined): PreflightView | null {
  if (preflight === null || preflight === undefined) return null;
  return {
    state: preflight.state,
    checks: preflight.checks.map((check) => ({ id: check.id, status: check.status, message: check.message ?? null })),
    estimateSeconds: preflight.migration_time_estimate_seconds ?? null,
  };
}

function approvalView(approval: UpdateScheduledUpdate['approvals'][number]): ApprovalView {
  return { name: approval.approver.display_name, decision: approval.decision, at: approval.decided_at, note: approval.note ?? null };
}

function scheduleView(scheduled: UpdateScheduledUpdate | null | undefined): ScheduleView | null {
  if (scheduled === null || scheduled === undefined) return null;
  return {
    state: scheduled.state,
    windowStart: scheduled.window_start,
    windowEnd: scheduled.window_end,
    requestedBy: scheduled.requested_by.display_name,
    secondApproverRequired: scheduled.second_approver_required,
    approvals: scheduled.approvals.map(approvalView),
  };
}

/** The run of an apply, a resume or a restore, as the client files draw it. Also used by the actions for their results. */
export function runView(run: UpdateApplyRun): RunView {
  return {
    runId: run.run_id,
    version: run.version,
    kind: run.kind,
    state: run.state,
    startedAt: run.started_at,
    finishedAt: run.finished_at ?? null,
    maintenanceOn: run.maintenance_on,
    steps: run.steps.map((step) => ({ name: step.name, state: step.state, message: step.message ?? null })),
  };
}

/** The pre-flight ended `failed` because a check waits for a person, not because one failed (see the header of updates.ts). */
export function isWaitingForBackup(preflight: PreflightView | null): boolean {
  if (preflight === null || preflight.state !== 'failed') return false;
  return preflight.checks.some((check) => check.status === 'needs_confirmation') && !preflight.checks.some((check) => check.status === 'failed');
}

function releaseView(detail: UpdateReleaseDetail, locale: Locale): ReleaseView {
  const { summary, manifest } = detail;
  const preflight = preflightView(detail.preflight);
  const notes = locale === 'ar' && manifest.release_notes.ar.trim() !== '' ? manifest.release_notes.ar : manifest.release_notes.en;
  return {
    version: summary.version,
    channel: summary.channel,
    state: summary.state,
    publishedAt: summary.published_at,
    notes,
    images: manifest.images.map((image) => image.name),
    migrations: manifest.migrations.map((m) => ({ id: m.id, summary: m.summary ?? null, nonTransactional: m.non_transactional, needsDowntime: m.needs_downtime })),
    needsDowntime: manifest.needs_downtime,
    downtimeMinutes: manifest.downtime_estimate_minutes ?? null,
    liveFallback: manifest.live_assignment_fallback,
    restoreToRollback: manifest.requires_restore_to_rollback,
    stage: stageOf(summary.state, detail.download, detail.scheduled),
    download: downloadView(detail.download),
    preflight,
    waitingForBackup: isWaitingForBackup(preflight),
    schedule: scheduleView(detail.scheduled),
  };
}

/** Whether the caller may approve or reject the release's scheduled update now, and if not why (the data layer refuses the same cases). */
export function decisionGate(ctx: RequestContext, scheduled: UpdateScheduledUpdate | null | undefined, policy: UpdateChangePolicy): DecisionGate {
  if (scheduled === null || scheduled === undefined || scheduled.state !== 'awaiting_approval') return 'nothing_to_decide';
  if (!approvalKindsFor(ctx.role, ctx.installMode).includes('update')) return 'not_an_approver_role';
  if (scheduled.requested_by.user_id === ctx.userId) return 'own_request';
  if (policy.approver_user_ids.length > 0 && !policy.approver_user_ids.includes(ctx.userId)) return 'not_listed';
  if (scheduled.approvals.some((approval) => approval.approver.user_id === ctx.userId)) return 'already_decided';
  return 'allowed';
}

function restoreView(request: NonNullable<Awaited<ReturnType<typeof getUpdateRecovery>>['restore_request']>, version: string | null): RestoreView {
  return { state: request.state, requestedBy: request.requested_by.display_name, requestedAt: request.requested_at, backupReference: request.backup_reference ?? null, version };
}

// ---------------------------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------------------------

async function nextWindowOf(ctx: RequestContext): Promise<WindowSlot | null> {
  const slot = await tryOrAsync(() => getNextUpdateWindow(ctx), null);
  return slot === null ? null : { start: slot.start, end: slot.end, open: slot.open, blockedByBlackout: slot.blocked_by_blackout };
}

async function loadOverview(ctx: RequestContext, status: StatusView, locale: Locale, query: UpdatesQuery, policy: UpdateChangePolicy): Promise<OverviewView> {
  const listed = (await listUpdateReleases(ctx, { limit: PAGE })).items;
  const recovery = await getUpdateRecovery(ctx);
  const history = (await listUpdateHistory(ctx, { limit: PAGE })).items;
  const request = recovery.restore_request;

  const restoring = request !== null && (request.state === 'requested' || request.state === 'in_progress');
  const restored = request !== null && request.state === 'completed' && status.agentState !== 'needs_attention';
  const attention = status.agentState === 'needs_attention';
  const mode: OverviewMode = restoring ? (request.state === 'requested' ? 'restore_requested' : 'restore_in_progress') : attention ? 'needs_attention' : restored ? 'restored' : 'up_to_date';

  const failed = listed.find((r) => r.state === 'applying');
  const failedDetail = failed === undefined ? null : await getUpdateRelease(ctx, failed.version);
  const failedMigration = failedDetail?.manifest.migrations.find((m) => m.non_transactional)?.id ?? null;
  const runId = recovery.run_id;
  const run = runId === null ? null : await tryOrAsync(async () => runView(await getUpdateRun(ctx, runId)), null, true);
  const recoveryView: RecoveryView | null =
    mode === 'up_to_date'
      ? null
      : {
          version: recovery.version ?? failed?.version ?? null,
          failedMigration,
          restore: request === null ? null : restoreView(request, recovery.version),
          run,
          note: recovery.note,
          backupReference: request?.backup_reference ?? (failed === undefined ? null : `backup-before-${failed.version}`),
        };

  const open = openReleases(listed, status.currentVersion);
  const focus = mode === 'needs_attention' || restoring ? undefined : pickFocus(open, query.release);
  const detail = focus === undefined ? null : await getUpdateRelease(ctx, focus.version);
  const release = detail === null ? null : releaseView(detail, locale);
  const others: ReleaseRow[] = open.filter((r) => r.version !== focus?.version).map((r) => ({ version: r.version, channel: r.channel, state: r.state, publishedAt: r.published_at, focus: false }));

  const latest = history[0];
  let lastResult: OverviewView['lastResult'] = null;
  if (latest !== undefined && mode === 'up_to_date') {
    const kind: LastResult | null = latest.kind === 'resume' && latest.result === 'succeeded' ? 'resumed' : latest.result === 'rolled_back' ? 'rolled_back' : null;
    if (kind !== null) lastResult = { kind, version: latest.version, from: latest.from_version ?? null, at: latest.started_at };
  }

  const approverNames = await namesOf(ctx, policy.approver_user_ids);
  const polling = status.agentState === 'downloading' || status.agentState === 'verifying' || restoring;
  return {
    mode: mode === 'up_to_date' && release !== null ? 'release' : mode,
    release,
    others,
    nextWindow: await nextWindowOf(ctx),
    recovery: recoveryView,
    lastResult,
    polling,
    approvers: approverNames,
    secondApproverRequired: policy.second_approver_required,
    decision: decisionGate(ctx, detail?.scheduled, policy),
  };
}

// ---------------------------------------------------------------------------------------------
// The other tabs
// ---------------------------------------------------------------------------------------------

async function statusOf(ctx: RequestContext): Promise<StatusView> {
  const status = await getUpdateStatus(ctx);
  return {
    currentVersion: status.current_version,
    channel: status.channel,
    connectionMode: status.connection_mode,
    agentState: status.state,
    lastCheckAt: status.last_check_at ?? null,
    lastCheckResult: status.last_check_result ?? null,
    indexValidUntil: status.release_index_valid_until ?? null,
    inMaintenance: status.in_maintenance,
    fallbackActive: status.live_assignment_fallback_active,
  };
}

async function connectionOf(ctx: RequestContext, status: StatusView): Promise<ConnectionView> {
  const connection = await getUpdateConnection(ctx);
  return {
    mode: connection.mode,
    endpoints: connection.allowed_endpoints.map((e) => ({ hostname: e.hostname, port: e.port, purpose: e.purpose })),
    proxy: { enabled: connection.proxy.enabled, address: connection.proxy.address ?? '', username: connection.proxy.username ?? '', hasPassword: connection.proxy.has_password === true, hasCertificate: connection.proxy.has_ca_certificate === true },
    lastContactAt: connection.last_contact_at ?? null,
    lastContactResult: connection.last_contact_result ?? null,
    indexValidUntil: status.indexValidUntil,
  };
}

async function windowsOf(ctx: RequestContext, policy: UpdateChangePolicy): Promise<WindowsView> {
  const windows = await getUpdateChangeWindows(ctx);
  const months: HijriMonthView[] = await tryOrAsync(
    async () => (await listHijriMonths(ctx, { limit: PAGE })).items.map((m) => ({ year: m.hijri_year, month: m.hijri_month, nameEn: m.name_en, nameAr: m.name_ar, gregorianStart: m.gregorian_start, gregorianEnd: m.gregorian_end })),
    [],
    true,
  );
  return {
    recurring: windows.recurring.map((r) => ({ id: r.id, label: r.label, days: [...r.days_of_week], start: r.start_time, end: r.end_time })),
    blackouts: windows.blackouts.map((b) => ({ id: b.id, label: b.label, enteredAs: b.entered_as, startGregorian: b.start_gregorian, endGregorian: b.end_gregorian })),
    upcoming: windows.upcoming.map((slot) => {
      const day = slot.start.slice(0, 10);
      const blackout = slot.blocked_by_blackout ? windows.blackouts.find((b) => b.start_gregorian <= day && day <= b.end_gregorian) : undefined;
      return { start: slot.start, end: slot.end, open: slot.open, blockedByBlackout: slot.blocked_by_blackout, blackoutLabel: blackout?.label ?? null };
    }),
    approvers: await namesOf(ctx, policy.approver_user_ids),
    secondApproverRequired: policy.second_approver_required,
    emergencyEnabled: policy.emergency_override_enabled,
    emergencyMinLength: policy.emergency_reason_min_length,
    months,
  };
}

async function historyOf(ctx: RequestContext): Promise<HistoryRowView[]> {
  return (await listUpdateHistory(ctx, { limit: PAGE })).items.map((entry) => ({
    id: entry.id,
    version: entry.version,
    fromVersion: entry.from_version ?? null,
    kind: entry.kind,
    result: entry.result,
    note: entry.note ?? null,
    approvedBy: entry.approved_by.map((person) => person.display_name),
    windowStart: entry.window_start ?? null,
    windowLabel: entry.window_label ?? null,
    startedAt: entry.started_at,
  }));
}

async function emergencyOf(ctx: RequestContext, status: StatusView, releases: readonly ListedRelease[], policy: UpdateChangePolicy): Promise<EmergencyChoices> {
  const eligible = releases.filter((r) => EMERGENCY_STATES.includes(r.state) && compareVersions(r.version, status.currentVersion) > 0).sort((a, b) => Number(b.channel === 'hotfix') - Number(a.channel === 'hotfix') || compareVersions(a.version, b.version));
  const approvers = await tryOrAsync(async () => (await listUsers(ctx, { assigned_role: 'change_approver', status: 'active', limit: PAGE })).items.map((u) => ({ id: u.id, name: u.display_name })), [] as NameRef[], true);
  const me = first((await namesOf(ctx, [ctx.userId])).map((n) => n.name));
  return {
    releases: eligible.map((r) => ({ version: r.version, channel: r.channel })),
    secondApprovers: approvers.filter((a) => a.id !== ctx.userId),
    firstApprover: me ?? '',
    minLength: policy.emergency_reason_min_length,
    enabled: policy.emergency_override_enabled,
  };
}

// ---------------------------------------------------------------------------------------------
// The view
// ---------------------------------------------------------------------------------------------

/** The reduced screen (dedicated and shared installs): the version and the release notes, in the reader's language. */
export async function loadReducedView(ctx: RequestContext, locale: Locale): Promise<ReducedUpdatesView> {
  const summary = await getUpdatesSummary(ctx);
  return {
    kind: 'reduced',
    installMode: ctx.installMode,
    currentVersion: summary.current_version,
    channel: summary.channel ?? null,
    notes: summary.release_notes.map((note) => ({ version: note.version, publishedAt: note.published_at, text: locale === 'ar' && (note.notes_ar ?? '').trim() !== '' ? (note.notes_ar as string) : note.notes_en })),
  };
}

/**
 * Everything the screen needs. `reduced` comes from the access model (Administrator in a dedicated or shared install): only
 * getUpdatesSummary runs then, because every other read is refused (and audited) outside private installs.
 */
export async function loadUpdatesView(ctx: RequestContext, options: { readonly reduced: boolean; readonly locale: Locale; readonly query?: UpdatesQuery | undefined }): Promise<UpdatesView> {
  if (options.reduced || ctx.installMode !== 'private') {
    return loadReducedView(ctx, options.locale);
  }
  const status = await statusOf(ctx);
  const policy = await getUpdateChangePolicy(ctx);
  const releases = (await listUpdateReleases(ctx, { limit: PAGE })).items;
  const settings = await getUpdateSettings(ctx);
  const settingsView: SettingsView = { channel: settings.channel, checkIntervalHours: settings.check_interval_hours, autoDownload: settings.auto_download, notifyOnly: settings.notify_only };
  return {
    kind: 'full',
    installMode: ctx.installMode satisfies InstallMode,
    status,
    overview: await loadOverview(ctx, status, options.locale, options.query ?? {}, policy),
    emergency: await emergencyOf(ctx, status, releases, policy),
    connection: await connectionOf(ctx, status),
    windows: await windowsOf(ctx, policy),
    history: await historyOf(ctx),
    settings: settingsView,
  } satisfies FullUpdatesView;
}
