// SPDX-License-Identifier: AGPL-3.0-only
// The plain data of the Updates screen: what the server side (view.ts) hands to the client files.
// Everything here is JSON-safe (strings, numbers, booleans, arrays and objects of those), so it can cross from the Server
// Component to the tabs, dialogs and drawers. Nothing here is a context, a customer, the caller's role or an install mode as
// an input: `installMode` is shown, never sent back.
//
// The update agent is a scripted stub (lib/data/updates.ts). Every text the data layer writes is English and says "(stub)":
// the screen translates what it can from the codes (check ids, step names, states) and shows the rest as English data.

import type { InstallMode } from '@/lib/access';

export const TABS = ['overview', 'connection', 'windows', 'history', 'settings'] as const;
export type UpdatesTab = (typeof TABS)[number];

export type Channel = 'stable' | 'hotfix';
export type ConnectionMode = 'connected' | 'offline';

/** The stage of the release card (the mockup's data-stage). */
export type ReleaseStage = 'available' | 'downloading' | 'verifying' | 'verified' | 'verify_failed' | 'ready' | 'awaiting' | 'approved';

/** What the Overview shows in place of (or beside) the release card. */
export type OverviewMode = 'release' | 'up_to_date' | 'needs_attention' | 'restore_requested' | 'restore_in_progress' | 'restored';

/** The last result the screen keeps in view: the newest History entry when it is one of these. */
export type LastResult = 'resumed' | 'rolled_back';

export interface NameRef {
  readonly id: string;
  readonly name: string;
}

// ---------------------------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------------------------

export type ImageName = 'web' | 'api' | 'worker' | 'engines' | 'update-agent';
export type ImageState = 'pending' | 'pulled' | 'pushed_to_registry' | 'verified' | 'failed';

export interface DownloadView {
  readonly state: 'not_started' | 'downloading' | 'downloaded' | 'verifying' | 'verified' | 'failed';
  readonly bytesDone: number;
  readonly bytesTotal: number;
  readonly images: readonly { readonly name: ImageName; readonly state: ImageState }[];
  /** The five results of the verification (present once it has ended). */
  readonly verification: VerificationView | null;
  /** The data layer's English line for a failed download. */
  readonly error: string | null;
}

export interface VerificationView {
  readonly verified: boolean;
  readonly signatureValid: boolean;
  readonly digestsMatch: boolean;
  readonly keyRevoked: boolean;
  readonly olderThanInstalled: boolean;
  readonly indexExpired: boolean;
  readonly keyId: string | null;
  /** English, from the data layer. */
  readonly message: string | null;
}

export type CheckId = 'disk_and_registry_space' | 'database_reachable' | 'recent_backup' | 'upgrade_path_allowed' | 'system_healthy' | 'migration_rehearsal';
export type CheckStatus = 'pending' | 'running' | 'passed' | 'failed' | 'needs_confirmation';

export interface PreflightView {
  readonly state: 'not_run' | 'running' | 'passed' | 'failed';
  readonly checks: readonly { readonly id: CheckId; readonly status: CheckStatus; readonly message: string | null }[];
  readonly estimateSeconds: number | null;
}

export interface ApprovalView {
  readonly name: string;
  readonly decision: 'approved' | 'rejected';
  readonly at: string;
  readonly note: string | null;
}

export interface ScheduleView {
  readonly state: 'awaiting_approval' | 'approved' | 'rejected' | 'applied' | 'cancelled';
  readonly windowStart: string;
  readonly windowEnd: string;
  readonly requestedBy: string;
  readonly secondApproverRequired: boolean;
  readonly approvals: readonly ApprovalView[];
}

export interface MigrationView {
  readonly id: string;
  readonly summary: string | null;
  readonly nonTransactional: boolean;
  readonly needsDowntime: boolean;
}

export interface ReleaseView {
  readonly version: string;
  readonly channel: Channel;
  readonly state: string;
  readonly publishedAt: string;
  /** The release notes in the reader's language (English when the release has no Arabic text). */
  readonly notes: string;
  readonly images: readonly ImageName[];
  readonly migrations: readonly MigrationView[];
  readonly needsDowntime: boolean;
  readonly downtimeMinutes: number | null;
  readonly liveFallback: boolean;
  readonly restoreToRollback: boolean;
  readonly stage: ReleaseStage | null;
  readonly download: DownloadView | null;
  readonly preflight: PreflightView | null;
  /** The pre-flight ended `failed` with a check that needs confirmation and none failed: it waits for the backup. */
  readonly waitingForBackup: boolean;
  readonly schedule: ScheduleView | null;
}

/** One line of "Other releases": the releases that are not the one the card shows. */
export interface ReleaseRow {
  readonly version: string;
  readonly channel: Channel;
  readonly state: string;
  readonly publishedAt: string;
  readonly focus: boolean;
}

export interface WindowSlot {
  readonly start: string;
  readonly end: string;
  readonly open: boolean;
  readonly blockedByBlackout: boolean;
}

export type RunStepName = 'record_revisions' | 'confirm_backup' | 'fallback_and_maintenance_on' | 'migrate_platform' | 'migrate_opendispatch' | 'helm_upgrade' | 'smoke_tests' | 'maintenance_off' | 'report';
export type RunStepState = 'pending' | 'running' | 'succeeded' | 'failed' | 'skipped';

export interface RunView {
  readonly runId: string;
  readonly version: string;
  readonly kind: 'update' | 'rollback' | 'resume' | 'restore' | 'emergency';
  readonly state: 'running' | 'succeeded' | 'failed' | 'rolled_back' | 'needs_attention';
  readonly startedAt: string;
  readonly finishedAt: string | null;
  readonly maintenanceOn: boolean;
  readonly steps: readonly { readonly name: RunStepName; readonly state: RunStepState; readonly message: string | null }[];
}

export interface RestoreView {
  readonly state: 'requested' | 'in_progress' | 'completed';
  readonly requestedBy: string;
  readonly requestedAt: string;
  readonly backupReference: string | null;
  readonly version: string | null;
}

export interface RecoveryView {
  /** The release whose update failed partway (state `applying`). */
  readonly version: string | null;
  /** The migration that stopped, when the manifest names a non-transactional one. */
  readonly failedMigration: string | null;
  readonly restore: RestoreView | null;
  /** The run behind the restore, or the run of a result the screen was just told about; null when nothing names it. */
  readonly run: RunView | null;
  readonly note: string | null;
  /** The backup taken before the failed update, as the restore request names it. */
  readonly backupReference: string | null;
}

export interface OverviewView {
  readonly mode: OverviewMode;
  readonly release: ReleaseView | null;
  /** The other open releases, for the small list under the card. Empty when there is one or none. */
  readonly others: readonly ReleaseRow[];
  readonly nextWindow: WindowSlot | null;
  readonly recovery: RecoveryView | null;
  readonly lastResult: { readonly kind: LastResult; readonly version: string; readonly from: string | null; readonly at: string } | null;
  /** True while a download phase or a restore request is under way: the screen asks the server again every second. */
  readonly polling: boolean;
  /** Names of the approvers the change policy lists, and whether a second one is required. */
  readonly approvers: readonly NameRef[];
  readonly secondApproverRequired: boolean;
  /** For the Change Approver: whether they may decide the release's scheduled update right now, or why not. */
  readonly decision: DecisionGate;
}

export type DecisionGate = 'allowed' | 'not_an_approver_role' | 'own_request' | 'not_listed' | 'already_decided' | 'nothing_to_decide';

export interface StatusView {
  readonly currentVersion: string;
  readonly channel: Channel;
  readonly connectionMode: ConnectionMode;
  readonly agentState: string;
  readonly lastCheckAt: string | null;
  readonly lastCheckResult: 'up_to_date' | 'update_found' | 'failed' | null;
  readonly indexValidUntil: string | null;
  /** The maintenance page is on (a recovery is waiting). */
  readonly inMaintenance: boolean;
  /** Live assignment is on the customer's fallback. */
  readonly fallbackActive: boolean;
}

// ---------------------------------------------------------------------------------------------
// Connection, windows, history, settings
// ---------------------------------------------------------------------------------------------

export interface ConnectionView {
  readonly mode: ConnectionMode;
  readonly endpoints: readonly { readonly hostname: string; readonly port: number; readonly purpose: string }[];
  readonly proxy: { readonly enabled: boolean; readonly address: string; readonly username: string; readonly hasPassword: boolean; readonly hasCertificate: boolean };
  readonly lastContactAt: string | null;
  readonly lastContactResult: 'ok' | 'failed' | null;
  readonly indexValidUntil: string | null;
}

export interface RecurringWindowView {
  readonly id: string;
  readonly label: string;
  readonly days: readonly number[];
  readonly start: string;
  readonly end: string;
}

export interface BlackoutView {
  readonly id: string;
  readonly label: string;
  readonly enteredAs: 'hijri' | 'gregorian';
  readonly startGregorian: string;
  readonly endGregorian: string;
}

/** A month of the Hijri reference table (2026 only): what the blackout drawer's three Selects are built from. */
export interface HijriMonthView {
  readonly year: number;
  readonly month: number;
  readonly nameEn: string;
  readonly nameAr: string;
  readonly gregorianStart: string;
  readonly gregorianEnd: string;
}

export interface WindowsView {
  readonly recurring: readonly RecurringWindowView[];
  readonly blackouts: readonly BlackoutView[];
  readonly upcoming: readonly (WindowSlot & { readonly blackoutLabel: string | null })[];
  readonly approvers: readonly NameRef[];
  readonly secondApproverRequired: boolean;
  readonly emergencyEnabled: boolean;
  readonly emergencyMinLength: number;
  readonly months: readonly HijriMonthView[];
}

export interface HistoryRowView {
  readonly id: string;
  readonly version: string;
  readonly fromVersion: string | null;
  readonly kind: 'update' | 'rollback' | 'resume' | 'restore' | 'skip' | 'emergency_override';
  readonly result: 'succeeded' | 'failed' | 'rolled_back' | 'skipped' | 'cancelled';
  readonly note: string | null;
  readonly approvedBy: readonly string[];
  readonly windowStart: string | null;
  readonly windowLabel: string | null;
  readonly startedAt: string;
}

export interface SettingsView {
  readonly channel: Channel;
  readonly checkIntervalHours: number;
  readonly autoDownload: boolean;
  readonly notifyOnly: boolean;
}

/** Whom the emergency override may name as the second approver, and which releases it can take. */
export interface EmergencyChoices {
  readonly releases: readonly { readonly version: string; readonly channel: Channel }[];
  readonly secondApprovers: readonly NameRef[];
  readonly firstApprover: string;
  readonly minLength: number;
  readonly enabled: boolean;
}

// ---------------------------------------------------------------------------------------------
// The two shapes of the whole view
// ---------------------------------------------------------------------------------------------

export interface ReducedUpdatesView {
  readonly kind: 'reduced';
  readonly installMode: InstallMode;
  readonly currentVersion: string;
  readonly channel: Channel | null;
  readonly notes: readonly { readonly version: string; readonly publishedAt: string; readonly text: string }[];
}

export interface FullUpdatesView {
  readonly kind: 'full';
  readonly installMode: InstallMode;
  readonly status: StatusView;
  readonly overview: OverviewView;
  readonly emergency: EmergencyChoices;
  readonly connection: ConnectionView;
  readonly windows: WindowsView;
  readonly history: readonly HistoryRowView[];
  readonly settings: SettingsView;
}

export type UpdatesView = ReducedUpdatesView | FullUpdatesView;

// ---------------------------------------------------------------------------------------------
// What the browser sends to the actions (actions.ts). The scanner of tools/rules/context-rules.test.ts reads these types:
// no field here is a context, customer, user, role, zone scope or install mode. The release a person acts on is `version`;
// the second approver of the emergency override is `second_approver_user_id` (what a person picked).
// ---------------------------------------------------------------------------------------------

export interface VersionInput {
  readonly version: string;
}

export interface ScheduleInput {
  readonly version: string;
  /** The start of one of the open windows the dialog listed. */
  readonly window_start: string;
}

export interface DecisionInput {
  readonly version: string;
  readonly note: string;
}

export interface SkipInput {
  readonly version: string;
  readonly reason: string;
}

export interface EmergencyInput {
  readonly version: string;
  readonly second_approver_user_id: string;
  readonly reason: string;
}

export interface RecoveryInput {
  readonly action: 'resume' | 'restore';
  readonly note: string;
}

export interface SettingsInput {
  readonly channel: string;
  readonly check_interval_hours: number;
  readonly auto_download: boolean;
  readonly notify_only: boolean;
}

export interface ModeInput {
  readonly mode: string;
}

export interface ProxyInput {
  readonly proxy_enabled: boolean;
  readonly proxy_address: string;
  readonly proxy_username: string;
  /** Empty keeps the password already stored. Never read back. */
  readonly proxy_password: string;
  /** The text of the proxy's certificate (PEM), read in the browser; empty keeps the one already stored. */
  readonly proxy_certificate: string;
}

export interface RecurringInput {
  /** The window to change; none adds one. */
  readonly window_id?: string | undefined;
  readonly days_of_week: readonly number[];
  readonly start_time: string;
  readonly end_time: string;
}

export interface BlackoutInput {
  readonly label: string;
  readonly entered_as: 'gregorian' | 'hijri';
  readonly start_gregorian?: string | undefined;
  readonly end_gregorian?: string | undefined;
  readonly start_hijri?: { readonly year: number; readonly month: number; readonly day: number } | undefined;
  readonly end_hijri?: { readonly year: number; readonly month: number; readonly day: number } | undefined;
}

export interface BlackoutTarget {
  readonly blackout_id: string;
}

export interface PolicyInput {
  readonly second_approver_required: boolean;
}

export interface UploadInput {
  /** The text of the update file, read in the browser with File.text(). */
  readonly file: string;
}

/** What an action gives back for a toast: enough to say what happened, nothing private. */
export interface CheckOutcome {
  readonly result: 'up_to_date' | 'update_found' | 'failed' | null;
  readonly version: string | null;
}

export interface DownloadOutcome {
  readonly version: string;
  readonly state: 'not_started' | 'downloading' | 'downloaded' | 'verifying' | 'verified' | 'failed';
}

export interface PreflightOutcome {
  readonly version: string;
  readonly state: 'not_run' | 'running' | 'passed' | 'failed';
}

export interface ScheduleOutcome {
  readonly version: string;
  readonly state: ScheduleView['state'];
  readonly windowStart: string;
  readonly windowEnd: string;
}

export interface ApplyOutcome {
  readonly run: RunView;
}

export interface ReleaseOutcome {
  readonly version: string;
  readonly state: string;
}

export interface RecoveryOutcome {
  readonly action: 'resume' | 'restore';
  readonly state: 'started' | 'requested' | 'refused';
  readonly run: RunView | null;
}

export interface ConnectionTestView {
  readonly ok: boolean;
  readonly checkedAt: string;
  readonly steps: readonly { readonly name: 'proxy' | 'dns' | 'tcp' | 'tls' | 'release_index_signature'; readonly ok: boolean; readonly message: string | null }[];
}

export interface UploadOutcome {
  readonly accepted: boolean;
  readonly verification: VerificationView;
  readonly version: string | null;
}
