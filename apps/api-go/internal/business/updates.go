// SPDX-License-Identifier: AGPL-3.0-only

// Ports updates.ts (Admin module 16,
// flow 9): the data behind the five Updates tabs.
//
// STUB. The real update agent belongs to the host platform
// and has not published a contract yet
// (contracts/platform/update-agent.yaml is a
// read-only stub). Until it does, this module is a
// deterministic SCRIPTED state machine over one
// settingsstore key, "updates.state". Nothing here
// checks a signature, pulls an image, runs a
// migration, or talks to a cluster. Every release
// note, history note and audit summary says so
// ("(stub)" / "update agent stub").
//
// Install modes: GetUpdatesSummary
// (version + release notes) works in every install
// mode for a role that may view Updates. Every other
// function refuses (Forbidden) unless the install is
// private, and the denial is audited as "denied".
//
// Access: reads need view on admin.updates; writes
// need edit. Approve/reject need view plus the
// approval check (Change Approver only, nobody
// approves their own; the person who scheduled is
// the requester).
//
// The five scripted runs:
//
//	1.2.0  succeeds, health checks pass
//	1.3.0  smoke test fails, rolls back itself
//	1.4.0  arrives as an offline file, verified
//	1.3.1  migration fails partway, non-transactional
//	1.2.1  a hotfix, for the emergency override
//
// Time. Two things "take time", worked out from the
// clock (datactx.NowISO) each time they're read, no
// timer/sleep/job (update_phases.go holds the pure
// functions): a download (downloading, then
// verifying, then verified/failed --
// StartUpdateDownload accepts it as downloading; the
// first read or write after the time has passed
// applies the end, once); a restore request
// (requested, in_progress, completed -- on
// completion, seen by the first read/write,
// maintenance goes off, the run stops needing
// attention). A resume that comes first drops a
// pending restore (superseded).
//
// A failed verification is scripted: an older
// release or a past release index fail as before; so
// does a download while the proxy address contains
// "tampered" (the worker image's digest "does not
// match"), the same way an offline file's own words
// do.
package business

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/access"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/auditlog"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/dataerr"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/importutil"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/reqctx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/settingsstore"
)

// -------------------------------------------------
// Contract types
// (contracts/platform/update-agent.yaml, under the
// "Update" prefix in contracts/openapi.yaml).
// -------------------------------------------------

// ActingUser mirrors the contract type.
type ActingUser struct {
	UserID      string `json:"user_id"`
	DisplayName string `json:"display_name"`
}

// ImageDigest mirrors the contract type.
type ImageDigest struct {
	Name   string `json:"name"`
	Digest string `json:"digest"`
}

// MigrationInfo mirrors the contract type.
type MigrationInfo struct {
	ID               string  `json:"id"`
	Summary          *string `json:"summary,omitempty"`
	NeedsDowntime    bool    `json:"needs_downtime"`
	NonTransactional bool    `json:"non_transactional"`
}

// ReleaseNotes mirrors ManifestSummary's
// release_notes.
type ReleaseNotes struct {
	En string `json:"en"`
	Ar string `json:"ar"`
}

// ManifestSummary mirrors the contract type.
type ManifestSummary struct {
	Version                   string          `json:"version"`
	Channel                   string          `json:"channel"`
	Kind                      string          `json:"kind"`
	UpgradeFrom               []string        `json:"upgrade_from"`
	Images                    []ImageDigest   `json:"images"`
	Migrations                []MigrationInfo `json:"migrations"`
	NeedsDowntime             bool            `json:"needs_downtime"`
	DowntimeEstimateMinutes   *int            `json:"downtime_estimate_minutes"`
	RequiresRestoreToRollback bool            `json:"requires_restore_to_rollback"`
	LiveAssignmentFallback    bool            `json:"live_assignment_fallback"`
	ReleaseNotes              ReleaseNotes    `json:"release_notes"`
	SignatureKeyID            string          `json:"signature_key_id"`
}

// ReleaseSummary mirrors the contract type.
type ReleaseSummary struct {
	Version                   string `json:"version"`
	Channel                   string `json:"channel"`
	Kind                      string `json:"kind"`
	State                     string `json:"state"`
	PublishedAt               string `json:"published_at"`
	NeedsDowntime             bool   `json:"needs_downtime"`
	RequiresRestoreToRollback bool   `json:"requires_restore_to_rollback"`
	LiveAssignmentFallback    bool   `json:"live_assignment_fallback"`
}

// VerificationResult mirrors the contract type.
type VerificationResult struct {
	Verified           bool    `json:"verified"`
	SignatureValid     bool    `json:"signature_valid"`
	DigestsMatch       bool    `json:"digests_match"`
	KeyRevoked         bool    `json:"key_revoked"`
	OlderThanInstalled bool    `json:"older_than_installed"`
	IndexExpired       bool    `json:"index_expired"`
	KeyID              *string `json:"key_id,omitempty"`
	Message            *string `json:"message,omitempty"`
}

// DownloadImageState: one images[] entry of a
// DownloadState.
type DownloadImageState struct {
	Name  string `json:"name"`
	State string `json:"state"`
}

// UpdateDownloadState mirrors DownloadState.
type UpdateDownloadState struct {
	State        string               `json:"state"`
	BytesDone    int                  `json:"bytes_done"`
	BytesTotal   int                  `json:"bytes_total"`
	Images       []DownloadImageState `json:"images"`
	Verification *VerificationResult  `json:"verification,omitempty"`
	ErrorMessage *string              `json:"error_message,omitempty"`
}

// PreflightCheck mirrors the contract type.
type PreflightCheck struct {
	ID      string  `json:"id"`
	Status  string  `json:"status"`
	Message *string `json:"message,omitempty"`
}

// UpdatePreflightResult mirrors PreflightResult.
type UpdatePreflightResult struct {
	State                        string           `json:"state"`
	RanAt                        *string          `json:"ran_at"`
	Checks                       []PreflightCheck `json:"checks"`
	MigrationTimeEstimateSeconds *int             `json:"migration_time_estimate_seconds"`
}

// ApprovalRecord mirrors the contract type.
type ApprovalRecord struct {
	Approver  ActingUser `json:"approver"`
	Decision  string     `json:"decision"`
	DecidedAt string     `json:"decided_at"`
	Note      *string    `json:"note,omitempty"`
}

// UpdateScheduledUpdate mirrors ScheduledUpdate.
type UpdateScheduledUpdate struct {
	Version                string           `json:"version"`
	WindowStart            string           `json:"window_start"`
	WindowEnd              string           `json:"window_end"`
	RequestedBy            ActingUser       `json:"requested_by"`
	SecondApproverRequired bool             `json:"second_approver_required"`
	Approvals              []ApprovalRecord `json:"approvals"`
	State                  string           `json:"state"`
}

// UpdateReleaseDetail mirrors ReleaseDetail.
type UpdateReleaseDetail struct {
	Summary   ReleaseSummary         `json:"summary"`
	Manifest  ManifestSummary        `json:"manifest"`
	Download  *UpdateDownloadState   `json:"download"`
	Preflight *UpdatePreflightResult `json:"preflight"`
	Scheduled *UpdateScheduledUpdate `json:"scheduled"`
}

// UpdateReleaseList mirrors ReleaseList.
type UpdateReleaseList struct {
	Items []ReleaseSummary `json:"items"`
	Page  datactx.PageInfo `json:"page"`
}

// RunStep mirrors the contract type.
type RunStep struct {
	Name       string  `json:"name"`
	State      string  `json:"state"`
	StartedAt  *string `json:"started_at,omitempty"`
	FinishedAt *string `json:"finished_at,omitempty"`
	Message    *string `json:"message,omitempty"`
}

// UpdateApplyRun mirrors ApplyRun.
type UpdateApplyRun struct {
	RunID                  string    `json:"run_id"`
	Version                string    `json:"version"`
	Kind                   string    `json:"kind"`
	State                  string    `json:"state"`
	Steps                  []RunStep `json:"steps"`
	StartedAt              string    `json:"started_at"`
	FinishedAt             *string   `json:"finished_at,omitempty"`
	MaintenanceOn          bool      `json:"maintenance_on"`
	LiveAssignmentFallback bool      `json:"live_assignment_fallback"`
	HealthCheckPassed      *bool     `json:"health_check_passed"`
	OfferedRecovery        []string  `json:"offered_recovery,omitempty"`
}

// RestoreRequest mirrors the contract type.
type RestoreRequest struct {
	ID              string     `json:"id"`
	State           string     `json:"state"`
	BackupReference *string    `json:"backup_reference,omitempty"`
	RequestedBy     ActingUser `json:"requested_by"`
	RequestedAt     string     `json:"requested_at"`
}

// UpdateRecoveryResult mirrors RecoveryResult.
type UpdateRecoveryResult struct {
	Action         string          `json:"action"`
	State          string          `json:"state"`
	Run            *UpdateApplyRun `json:"run,omitempty"`
	RestoreRequest *RestoreRequest `json:"restore_request,omitempty"`
}

// UpdateRecoveryStatus mirrors the OpenDispatch-only type.
type UpdateRecoveryStatus struct {
	RestoreRequest *RestoreRequest `json:"restore_request"`
	RunID          *string         `json:"run_id"`
	Version        *string         `json:"version"`
	Note           *string         `json:"note"`
	CompletedAt    *string         `json:"completed_at"`
}

// HistoryEntry mirrors the contract type.
type HistoryEntry struct {
	ID          string       `json:"id"`
	Version     string       `json:"version"`
	FromVersion *string      `json:"from_version"`
	Kind        string       `json:"kind"`
	Result      string       `json:"result"`
	StartedAt   string       `json:"started_at"`
	FinishedAt  *string      `json:"finished_at,omitempty"`
	ApprovedBy  []ActingUser `json:"approved_by"`
	WindowStart *string      `json:"window_start"`
	WindowLabel *string      `json:"window_label"`
	Emergency   bool         `json:"emergency,omitempty"`
	Note        *string      `json:"note,omitempty"`
}

// UpdateHistoryList mirrors HistoryList.
type UpdateHistoryList struct {
	Items []HistoryEntry   `json:"items"`
	Page  datactx.PageInfo `json:"page"`
}

// UpdateSettings mirrors the contract type.
type UpdateSettings struct {
	Channel            string `json:"channel"`
	CheckIntervalHours int    `json:"check_interval_hours"`
	AutoDownload       bool   `json:"auto_download"`
	NotifyOnly         bool   `json:"notify_only"`
}

// AllowedEndpoint mirrors the contract type.
type AllowedEndpoint struct {
	Hostname string `json:"hostname"`
	Port     int    `json:"port"`
	Purpose  string `json:"purpose"`
}

// ProxySettingsView mirrors ProxySettings (the read
// view; password/CA are flags only, never echoed).
type ProxySettingsView struct {
	Enabled          bool    `json:"enabled"`
	Address          *string `json:"address,omitempty"`
	Username         *string `json:"username,omitempty"`
	HasPassword      bool    `json:"has_password"`
	HasCACertificate bool    `json:"has_ca_certificate"`
}

// UpdateConnectionSettings mirrors
// ConnectionSettings.
type UpdateConnectionSettings struct {
	Mode              string            `json:"mode"`
	AllowedEndpoints  []AllowedEndpoint `json:"allowed_endpoints"`
	Proxy             ProxySettingsView `json:"proxy"`
	LastContactAt     *string           `json:"last_contact_at,omitempty"`
	LastContactResult *string           `json:"last_contact_result,omitempty"`
}

// UpdateConnectionTestStep mirrors one steps[]
// entry.
type UpdateConnectionTestStep struct {
	Name    string  `json:"name"`
	OK      bool    `json:"ok"`
	Message *string `json:"message,omitempty"`
}

// UpdateConnectionTestResult mirrors the contract
// type.
type UpdateConnectionTestResult struct {
	OK        bool                       `json:"ok"`
	CheckedAt string                     `json:"checked_at"`
	Steps     []UpdateConnectionTestStep `json:"steps"`
}

// UpdateOfflineUploadResult mirrors
// OfflineUploadResult.
type UpdateOfflineUploadResult struct {
	UploadID     string             `json:"upload_id"`
	UploadedAt   string             `json:"uploaded_at"`
	Accepted     bool               `json:"accepted"`
	Verification VerificationResult `json:"verification"`
	Release      *ReleaseSummary    `json:"release,omitempty"`
}

// RecurringWindow mirrors the contract type.
type RecurringWindow struct {
	ID         string `json:"id"`
	Label      string `json:"label"`
	DaysOfWeek []int  `json:"days_of_week"`
	StartTime  string `json:"start_time"`
	EndTime    string `json:"end_time"`
}

// HijriDate reused from leave_calendar.go (same
// shape).

// Blackout mirrors the contract type.
type Blackout struct {
	ID             string     `json:"id"`
	Label          string     `json:"label"`
	EnteredAs      string     `json:"entered_as"`
	StartGregorian string     `json:"start_gregorian"`
	EndGregorian   string     `json:"end_gregorian"`
	StartHijri     *HijriDate `json:"start_hijri,omitempty"`
	EndHijri       *HijriDate `json:"end_hijri,omitempty"`
}

// UpdateUpcomingWindow mirrors UpcomingWindow.
type UpdateUpcomingWindow struct {
	Start             string  `json:"start"`
	End               string  `json:"end"`
	Open              bool    `json:"open"`
	BlockedByBlackout bool    `json:"blocked_by_blackout"`
	WindowLabel       *string `json:"window_label,omitempty"`
}

// UpdateChangeWindows mirrors ChangeWindows.
type UpdateChangeWindows struct {
	Recurring []RecurringWindow      `json:"recurring"`
	Blackouts []Blackout             `json:"blackouts"`
	Upcoming  []UpdateUpcomingWindow `json:"upcoming"`
}

// UpdateChangePolicy mirrors ChangePolicy.
type UpdateChangePolicy struct {
	ApproverUserIDs          []string `json:"approver_user_ids"`
	SecondApproverRequired   bool     `json:"second_approver_required"`
	EmergencyOverrideEnabled bool     `json:"emergency_override_enabled"`
	EmergencyReasonMinLength int      `json:"emergency_reason_min_length"`
}

// UpdateStatus mirrors the platform Status type.
type UpdateStatus struct {
	CurrentVersion               string  `json:"current_version"`
	PreviousVersion              *string `json:"previous_version"`
	AgentVersion                 string  `json:"agent_version"`
	Channel                      string  `json:"channel"`
	ConnectionMode               string  `json:"connection_mode"`
	State                        string  `json:"state"`
	LastCheckAt                  *string `json:"last_check_at"`
	LastCheckResult              *string `json:"last_check_result"`
	ReadyReleaseVersion          *string `json:"ready_release_version"`
	NextWindowStart              *string `json:"next_window_start"`
	ReleaseIndexValidUntil       *string `json:"release_index_valid_until"`
	InMaintenance                bool    `json:"in_maintenance"`
	LiveAssignmentFallbackActive bool    `json:"live_assignment_fallback_active"`
	NotifyOnly                   bool    `json:"notify_only"`
}

// UpdatesSummaryNote: one release_notes[] entry.
type UpdatesSummaryNote struct {
	Version     string  `json:"version"`
	PublishedAt string  `json:"published_at"`
	NotesEn     string  `json:"notes_en"`
	NotesAr     *string `json:"notes_ar,omitempty"`
}

// UpdatesSummary mirrors the OpenDispatch-only contract
// type.
type UpdatesSummary struct {
	InstallMode          access.InstallMode   `json:"install_mode"`
	CurrentVersion       string               `json:"current_version"`
	Channel              *string              `json:"channel,omitempty"`
	FullUpdatesAvailable bool                 `json:"full_updates_available"`
	ReleaseNotes         []UpdatesSummaryNote `json:"release_notes"`
}

// -------------------------------------------------
// Internal state (settingsstore key
// "updates.state").
// -------------------------------------------------

// downloadJob mirrors DownloadJob: a download under
// way -- when it started, how long each phase takes,
// and what it will end in (decided at the start).
type downloadJob struct {
	DownloadTiming
	StartedAt string
	Retry     bool
	Final     UpdateDownloadState
}

// restoreMeta mirrors RestoreMeta: what a restore
// request adds, kept beside it (contract is closed).
type restoreMeta struct {
	RunID       string
	Version     string
	Note        *string
	CompletedAt *string
	Superseded  bool
}

// releaseRecord mirrors ReleaseRecord.
type releaseRecord struct {
	Version         string
	Channel         string
	Kind            string
	State           string
	PublishedAt     string
	Source          string
	Scripted        string
	Manifest        ManifestSummary
	Download        *UpdateDownloadState
	DownloadJob     *downloadJob
	Preflight       *UpdatePreflightResult
	Scheduled       *UpdateScheduledUpdate
	BackupConfirmed bool
	WindowLabel     *string
}

// proxyState mirrors ProxyState.
type proxyState struct {
	Enabled          bool
	Address          *string
	Username         *string
	HasPassword      bool
	HasCACertificate bool
}

// updatesState mirrors UpdatesState.
type updatesState struct {
	Seq               int
	CurrentVersion    string
	PreviousVersion   *string
	ConnectionMode    string
	Proxy             proxyState
	LastContactAt     *string
	LastContactResult *string
	LastCheckAt       *string
	LastCheckResult   *string
	IndexValidUntil   *string
	InMaintenance     bool
	FallbackActive    bool
	AttentionRunID    *string
	Settings          UpdateSettings
	Policy            UpdateChangePolicy
	Recurring         []RecurringWindow
	Blackouts         []Blackout
	Releases          map[string]*releaseRecord
	Runs              map[string]*UpdateApplyRun
	History           []HistoryEntry
	Uploads           map[string]*UpdateOfflineUploadResult
	Restores          []*RestoreRequest
	RestoreMeta       map[string]*restoreMeta
}

// -------------------------------------------------
// Scripted release table (all synthetic).
// -------------------------------------------------

const updatesKey = "updates.state"
const updatesKeyID = "opendispatch-release-key-2026-01"
const updatesAgentVersion = "0.4.0"
const updatesStub = "update agent stub"
const defaultWindowLabel = "Sunday to Thursday, 03:00 to 05:00"

var stepOrder = []string{"record_revisions", "confirm_backup", "fallback_and_maintenance_on", "migrate_platform", "migrate_opendispatch", "helm_upgrade", "smoke_tests", "maintenance_off", "report"}

var imageBytes = map[string]int{"web": 180_000_000, "api": 210_000_000, "worker": 160_000_000, "engines": 620_000_000, "update-agent": 40_000_000}

var updateChannels = []string{"stable", "hotfix"}
var updateModes = []string{"connected", "offline"}
var enteredAsValues = []string{"hijri", "gregorian"}

type releaseSpec struct {
	Version                   string
	Channel                   string
	Kind                      string
	State                     string
	PublishedAt               string
	NeedsDowntime             bool
	DowntimeEstimateMinutes   *int
	RequiresRestoreToRollback bool
	UpgradeFrom               []string
	Migrations                []MigrationInfo
	Images                    []string
	NotesEn                   string
	NotesAr                   string
	Scripted                  string
}

func updIntp(v int) *int       { return &v }
func updStrp(v string) *string { return &v }

var releaseSpecs = []releaseSpec{
	{
		Version: "1.0.0", Channel: "stable", Kind: "application", State: "applied", PublishedAt: "2026-07-20T10:00:00+03:00",
		NeedsDowntime: false, RequiresRestoreToRollback: false, UpgradeFrom: nil, Migrations: nil,
		Images:  []string{"web", "api", "worker", "engines"},
		NotesEn: "First private install of OpenDispatch. (stub)", NotesAr: "أول تثبيت خاص لنظام OpenDispatch. (نسخة تجريبية)", Scripted: "success",
	},
	{
		Version: "1.1.0", Channel: "stable", Kind: "application", State: "applied", PublishedAt: "2026-08-25T10:00:00+03:00",
		NeedsDowntime: false, RequiresRestoreToRollback: false, UpgradeFrom: []string{"1.0.x"},
		Migrations: []MigrationInfo{{ID: "20260820_add_forecast_run_index", Summary: updStrp("Adds an index on forecast runs."), NeedsDowntime: false, NonTransactional: false}},
		Images:     []string{"web", "api", "worker", "engines"},
		NotesEn:    "Forecast Explorer likely range and faster roster grid. (stub)", NotesAr: "نطاق التوقع المحتمل في مستكشف التوقعات وتسريع شبكة الجداول. (نسخة تجريبية)", Scripted: "success",
	},
	{
		Version: "1.2.0", Channel: "stable", Kind: "application", State: "available", PublishedAt: "2026-09-08T10:00:00+03:00",
		NeedsDowntime: false, RequiresRestoreToRollback: false, UpgradeFrom: []string{"1.0.x", "1.1.x"},
		Migrations: []MigrationInfo{{ID: "20260905_add_break_plan_columns", Summary: updStrp("Adds prayer conflict columns to break plans."), NeedsDowntime: false, NonTransactional: false}},
		Images:     []string{"web", "api", "worker", "engines"},
		NotesEn:    "Prayer-time-aware break planner and general fixes. Scripted to succeed. (stub)", NotesAr: "مخطط استراحات يراعي أوقات الصلاة وإصلاحات عامة. مبرمج للنجاح. (نسخة تجريبية)", Scripted: "success",
	},
	{
		Version: "1.2.1", Channel: "hotfix", Kind: "application", State: "available", PublishedAt: "2026-09-11T09:00:00+03:00",
		NeedsDowntime: false, RequiresRestoreToRollback: false, UpgradeFrom: []string{"1.1.x", "1.2.x"}, Migrations: nil,
		Images:  []string{"web", "api"},
		NotesEn: "Hotfix for a gap calculation error. Used for the emergency override. (stub)", NotesAr: "إصلاح عاجل لخطأ في حساب الفجوات. يستخدم لتجاوز الطوارئ. (نسخة تجريبية)", Scripted: "success",
	},
	{
		Version: "1.3.0", Channel: "stable", Kind: "application", State: "available", PublishedAt: "2026-09-10T10:00:00+03:00",
		NeedsDowntime: true, DowntimeEstimateMinutes: updIntp(12), RequiresRestoreToRollback: false, UpgradeFrom: []string{"1.1.x", "1.2.x"},
		Migrations: []MigrationInfo{
			{ID: "20260908_split_roster_tables", Summary: updStrp("Splits roster assignments by month."), NeedsDowntime: true, NonTransactional: false},
			{ID: "20260909_add_override_reason_index", Summary: updStrp("Adds an index on override reasons."), NeedsDowntime: false, NonTransactional: false},
		},
		Images:   []string{"web", "api", "worker", "engines"},
		NotesEn:  "Database changes for rosters. Live assignment switches to the " + customerEn() + " fallback during the update. Scripted to fail its health check and roll back. (stub)",
		NotesAr:  "تغييرات في قاعدة البيانات للجداول. يتحول الإسناد المباشر إلى نظام " + customerAr() + " البديل أثناء التحديث. مبرمج لفشل فحص السلامة والتراجع. (نسخة تجريبية)",
		Scripted: "health_check_fails",
	},
	{
		Version: "1.3.1", Channel: "stable", Kind: "application", State: "available", PublishedAt: "2026-09-12T10:00:00+03:00",
		NeedsDowntime: true, DowntimeEstimateMinutes: updIntp(20), RequiresRestoreToRollback: true, UpgradeFrom: []string{"1.1.x", "1.2.x"},
		Migrations: []MigrationInfo{{ID: "20260911_backfill_zone_codes", Summary: updStrp("Backfills zone codes outside a transaction."), NeedsDowntime: true, NonTransactional: true}},
		Images:     []string{"web", "api", "worker"},
		NotesEn:    "Zone code backfill. Needs a restore to roll back. Scripted: the migration fails partway. (stub)",
		NotesAr:    "ملء رموز المناطق. يتطلب استعادة للتراجع. مبرمج: يفشل الترحيل في منتصفه. (نسخة تجريبية)",
		Scripted:   "migration_fails",
	},
}

// -------------------------------------------------
// Small pure helpers.
// -------------------------------------------------

func parseVersion(version string) [3]int {
	parts := strings.Split(version, ".")
	var out [3]int
	for i := 0; i < 3 && i < len(parts); i++ {
		n, err := strconv.Atoi(parts[i])
		if err == nil {
			out[i] = n
		}
	}
	return out
}

// compareVersions: negative when a is older than b.
func compareVersions(a, b string) int {
	x, y := parseVersion(a), parseVersion(b)
	for i := 0; i < 3; i++ {
		if x[i] != y[i] {
			return x[i] - y[i]
		}
	}
	return 0
}

// matchesUpgradeFrom: "1.1.x" matches 1.1.0/1.1.7;
// "x.x.x" matches everything; exact matches itself.
func matchesUpgradeFrom(current string, patterns []string) bool {
	have := strings.Split(current, ".")
	for _, pattern := range patterns {
		want := strings.Split(pattern, ".")
		if len(want) != len(have) {
			continue
		}
		ok := true
		for i, part := range want {
			if part != "x" && part != have[i] {
				ok = false
				break
			}
		}
		if ok {
			return true
		}
	}
	return false
}

func addDaysStr(date string, days int) string {
	t, err := time.Parse("2006-01-02", date)
	if err != nil {
		return date
	}
	return t.AddDate(0, 0, days).Format("2006-01-02")
}

func weekdayOf(date string) int {
	t, err := time.Parse("2006-01-02", date)
	if err != nil {
		return 0
	}
	return int(t.UTC().Weekday())
}

func stampAt(date, hhmm string) string {
	return date + "T" + hhmm + ":00+03:00"
}

func digestOf(name, version string) string {
	sum := sha256.Sum256([]byte("opendispatch:" + name + ":" + version))
	return "sha256:" + hex.EncodeToString(sum[:])
}

func isActiveChangeApprover(u User) bool {
	return u.AssignedRole == access.RoleChangeApprover && u.Status == "active"
}

func actingUserOf(userID string, users []User, fallbackName string) ActingUser {
	name := fallbackName
	for _, u := range users {
		if u.ID == userID {
			name = u.DisplayName
			break
		}
	}
	if len(name) > 120 {
		name = name[:120]
	}
	return ActingUser{UserID: userID, DisplayName: name}
}

func actingUser(ctx context.Context, rc reqctx.RequestContext) ActingUser {
	return actingUserOf(rc.UserID, usersOrLog(ctx, rc.CustomerID), string(rc.Role))
}

func updatesToday(ctx context.Context, tenant string) string {
	return demoToday(ctx, tenant)
}

func nextUpdatesID(state *updatesState, kind string) string {
	state.Seq++
	return datactx.DeterministicUUID(fmt.Sprintf("updates:%s:%d", kind, state.Seq))
}

// -------------------------------------------------
// State: build, seed, load, save, deep-copy.
// -------------------------------------------------

func clonePtr[T any](p *T) *T {
	if p == nil {
		return nil
	}
	v := *p
	return &v
}

func cloneStrSlice(s []string) []string {
	if s == nil {
		return nil
	}
	return append([]string{}, s...)
}

func cloneVerification(v *VerificationResult) *VerificationResult {
	if v == nil {
		return nil
	}
	out := *v
	out.KeyID = clonePtr(v.KeyID)
	out.Message = clonePtr(v.Message)
	return &out
}

func cloneDownloadState(d *UpdateDownloadState) *UpdateDownloadState {
	if d == nil {
		return nil
	}
	out := *d
	out.Images = append([]DownloadImageState{}, d.Images...)
	out.Verification = cloneVerification(d.Verification)
	out.ErrorMessage = clonePtr(d.ErrorMessage)
	return &out
}

func cloneManifest(m ManifestSummary) ManifestSummary {
	out := m
	out.UpgradeFrom = cloneStrSlice(m.UpgradeFrom)
	out.Images = append([]ImageDigest{}, m.Images...)
	migs := make([]MigrationInfo, len(m.Migrations))
	for i, mi := range m.Migrations {
		migs[i] = mi
		migs[i].Summary = clonePtr(mi.Summary)
	}
	out.Migrations = migs
	out.DowntimeEstimateMinutes = clonePtr(m.DowntimeEstimateMinutes)
	return out
}

func clonePreflight(p *UpdatePreflightResult) *UpdatePreflightResult {
	if p == nil {
		return nil
	}
	out := *p
	out.RanAt = clonePtr(p.RanAt)
	out.Checks = append([]PreflightCheck{}, p.Checks...)
	for i := range out.Checks {
		out.Checks[i].Message = clonePtr(out.Checks[i].Message)
	}
	out.MigrationTimeEstimateSeconds = clonePtr(p.MigrationTimeEstimateSeconds)
	return &out
}

func cloneScheduled(s *UpdateScheduledUpdate) *UpdateScheduledUpdate {
	if s == nil {
		return nil
	}
	out := *s
	out.Approvals = make([]ApprovalRecord, len(s.Approvals))
	for i, a := range s.Approvals {
		out.Approvals[i] = a
		out.Approvals[i].Note = clonePtr(a.Note)
	}
	return &out
}

func cloneDownloadJob(j *downloadJob) *downloadJob {
	if j == nil {
		return nil
	}
	out := *j
	final := cloneDownloadState(&j.Final)
	out.Final = *final
	return &out
}

func cloneRelease(r *releaseRecord) *releaseRecord {
	if r == nil {
		return nil
	}
	out := *r
	out.Manifest = cloneManifest(r.Manifest)
	out.Download = cloneDownloadState(r.Download)
	out.DownloadJob = cloneDownloadJob(r.DownloadJob)
	out.Preflight = clonePreflight(r.Preflight)
	out.Scheduled = cloneScheduled(r.Scheduled)
	out.WindowLabel = clonePtr(r.WindowLabel)
	return &out
}

func cloneRun(r *UpdateApplyRun) *UpdateApplyRun {
	if r == nil {
		return nil
	}
	out := *r
	out.FinishedAt = clonePtr(r.FinishedAt)
	out.HealthCheckPassed = clonePtr(r.HealthCheckPassed)
	out.OfferedRecovery = cloneStrSlice(r.OfferedRecovery)
	out.Steps = make([]RunStep, len(r.Steps))
	for i, s := range r.Steps {
		out.Steps[i] = s
		out.Steps[i].StartedAt = clonePtr(s.StartedAt)
		out.Steps[i].FinishedAt = clonePtr(s.FinishedAt)
		out.Steps[i].Message = clonePtr(s.Message)
	}
	return &out
}

func cloneHistoryEntry(h HistoryEntry) HistoryEntry {
	out := h
	out.FromVersion = clonePtr(h.FromVersion)
	out.FinishedAt = clonePtr(h.FinishedAt)
	out.WindowStart = clonePtr(h.WindowStart)
	out.WindowLabel = clonePtr(h.WindowLabel)
	out.Note = clonePtr(h.Note)
	out.ApprovedBy = append([]ActingUser{}, h.ApprovedBy...)
	return out
}

func cloneUpload(u *UpdateOfflineUploadResult) *UpdateOfflineUploadResult {
	if u == nil {
		return nil
	}
	out := *u
	v := cloneVerification(&u.Verification)
	out.Verification = *v
	if u.Release != nil {
		r := *u.Release
		out.Release = &r
	}
	return &out
}

func cloneRestoreRequest(r *RestoreRequest) *RestoreRequest {
	if r == nil {
		return nil
	}
	out := *r
	out.BackupReference = clonePtr(r.BackupReference)
	return &out
}

func cloneRestoreMeta(m *restoreMeta) *restoreMeta {
	if m == nil {
		return nil
	}
	out := *m
	out.Note = clonePtr(m.Note)
	out.CompletedAt = clonePtr(m.CompletedAt)
	return &out
}

// cloneState: a private copy of the whole state
// tree. Mirrors structuredClone(state) -- nothing
// shares memory with the settingsstore-held
// original.
func cloneState(s *updatesState) *updatesState {
	if s == nil {
		return nil
	}
	out := *s
	out.PreviousVersion = clonePtr(s.PreviousVersion)
	out.Proxy.Address = clonePtr(s.Proxy.Address)
	out.Proxy.Username = clonePtr(s.Proxy.Username)
	out.LastContactAt = clonePtr(s.LastContactAt)
	out.LastContactResult = clonePtr(s.LastContactResult)
	out.LastCheckAt = clonePtr(s.LastCheckAt)
	out.LastCheckResult = clonePtr(s.LastCheckResult)
	out.IndexValidUntil = clonePtr(s.IndexValidUntil)
	out.AttentionRunID = clonePtr(s.AttentionRunID)
	out.Policy.ApproverUserIDs = cloneStrSlice(s.Policy.ApproverUserIDs)
	out.Recurring = make([]RecurringWindow, len(s.Recurring))
	for i, r := range s.Recurring {
		out.Recurring[i] = r
		out.Recurring[i].DaysOfWeek = append([]int{}, r.DaysOfWeek...)
	}
	out.Blackouts = make([]Blackout, len(s.Blackouts))
	for i, b := range s.Blackouts {
		out.Blackouts[i] = b
		out.Blackouts[i].StartHijri = clonePtr(b.StartHijri)
		out.Blackouts[i].EndHijri = clonePtr(b.EndHijri)
	}
	out.Releases = make(map[string]*releaseRecord, len(s.Releases))
	for k, v := range s.Releases {
		out.Releases[k] = cloneRelease(v)
	}
	out.Runs = make(map[string]*UpdateApplyRun, len(s.Runs))
	for k, v := range s.Runs {
		out.Runs[k] = cloneRun(v)
	}
	out.History = make([]HistoryEntry, len(s.History))
	for i, h := range s.History {
		out.History[i] = cloneHistoryEntry(h)
	}
	out.Uploads = make(map[string]*UpdateOfflineUploadResult, len(s.Uploads))
	for k, v := range s.Uploads {
		out.Uploads[k] = cloneUpload(v)
	}
	out.Restores = make([]*RestoreRequest, len(s.Restores))
	for i, r := range s.Restores {
		out.Restores[i] = cloneRestoreRequest(r)
	}
	out.RestoreMeta = make(map[string]*restoreMeta, len(s.RestoreMeta))
	for k, v := range s.RestoreMeta {
		out.RestoreMeta[k] = cloneRestoreMeta(v)
	}
	return &out
}

func buildRelease(spec releaseSpec) *releaseRecord {
	images := make([]ImageDigest, len(spec.Images))
	for i, name := range spec.Images {
		images[i] = ImageDigest{Name: name, Digest: digestOf(name, spec.Version)}
	}
	migs := make([]MigrationInfo, len(spec.Migrations))
	copy(migs, spec.Migrations)
	manifest := ManifestSummary{
		Version: spec.Version, Channel: spec.Channel, Kind: spec.Kind, UpgradeFrom: cloneStrSlice(spec.UpgradeFrom),
		Images: images, Migrations: migs, NeedsDowntime: spec.NeedsDowntime, DowntimeEstimateMinutes: spec.DowntimeEstimateMinutes,
		RequiresRestoreToRollback: spec.RequiresRestoreToRollback, LiveAssignmentFallback: spec.NeedsDowntime,
		ReleaseNotes: ReleaseNotes{En: spec.NotesEn, Ar: spec.NotesAr}, SignatureKeyID: updatesKeyID,
	}
	return &releaseRecord{
		Version: spec.Version, Channel: spec.Channel, Kind: spec.Kind, State: spec.State, PublishedAt: spec.PublishedAt,
		Source: "index", Scripted: spec.Scripted, Manifest: manifest,
	}
}

func seedUpdatesState(ctx context.Context) *updatesState {
	users := usersOrLog(ctx, ambientTenant())
	var approvers []User
	for _, u := range users {
		if isActiveChangeApprover(u) {
			approvers = append(approvers, u)
		}
	}
	approvedBy := []ActingUser{}
	if len(approvers) > 0 {
		approvedBy = []ActingUser{actingUserOf(approvers[0].ID, users, approvers[0].DisplayName)}
	}
	releases := map[string]*releaseRecord{}
	for _, spec := range releaseSpecs {
		releases[spec.Version] = buildRelease(spec)
	}
	history := []HistoryEntry{
		{
			ID: datactx.DeterministicUUID("updates:history:seed-1"), Version: "1.0.0", Kind: "update", Result: "succeeded",
			StartedAt: "2026-07-21T03:00:00+03:00", FinishedAt: updStrp("2026-07-21T03:22:00+03:00"), ApprovedBy: approvedBy,
			WindowStart: updStrp("2026-07-21T03:00:00+03:00"), WindowLabel: updStrp(defaultWindowLabel), Note: updStrp("Initial install (stub)."),
		},
		{
			ID: datactx.DeterministicUUID("updates:history:seed-2"), Version: "1.1.0", FromVersion: updStrp("1.0.0"), Kind: "update", Result: "succeeded",
			StartedAt: "2026-08-27T03:00:00+03:00", FinishedAt: updStrp("2026-08-27T03:14:00+03:00"), ApprovedBy: approvedBy,
			WindowStart: updStrp("2026-08-27T03:00:00+03:00"), WindowLabel: updStrp(defaultWindowLabel), Note: updStrp("Applied in the change window, health checks passed (stub)."),
		},
	}
	var approverIDs []string
	for _, u := range approvers {
		approverIDs = append(approverIDs, u.ID)
	}
	return &updatesState{
		Seq: 0, CurrentVersion: "1.1.0", PreviousVersion: updStrp("1.0.0"), ConnectionMode: "connected",
		Proxy:         proxyState{Enabled: false},
		LastContactAt: updStrp("2026-09-13T06:00:00+03:00"), LastContactResult: updStrp("ok"),
		LastCheckAt: updStrp("2026-09-13T06:00:00+03:00"), LastCheckResult: updStrp("update_found"),
		IndexValidUntil: updStrp("2026-09-20T00:00:00+03:00"),
		Settings:        UpdateSettings{Channel: "stable", CheckIntervalHours: 6, AutoDownload: false, NotifyOnly: false},
		Policy:          UpdateChangePolicy{ApproverUserIDs: approverIDs, SecondApproverRequired: false, EmergencyOverrideEnabled: true, EmergencyReasonMinLength: 20},
		Recurring:       []RecurringWindow{{ID: datactx.DeterministicUUID("updates:recurring:seed"), Label: defaultWindowLabel, DaysOfWeek: []int{0, 1, 2, 3, 4}, StartTime: "03:00", EndTime: "05:00"}},
		Releases:        releases,
		Runs:            map[string]*UpdateApplyRun{},
		History:         history,
		Uploads:         map[string]*UpdateOfflineUploadResult{},
		RestoreMeta:     map[string]*restoreMeta{},
	}
}

func loadUpdates(ctx context.Context, tenant string) (*updatesState, error) {
	stored, err := settingsstore.Get[*updatesState](ctx, tenant, updatesKey, nil)
	if err != nil {
		return nil, err
	}
	if stored == nil {
		return seedUpdatesState(ctx), nil
	}
	return stored, nil
}

func saveUpdates(ctx context.Context, tenant string, s *updatesState) error {
	return settingsstore.Put(ctx, tenant, updatesKey, s)
}

// PatchUpdatesForTest reaches states no call does.
func PatchUpdatesForTest(tenant string, indexValidUntil *string, releaseStates map[string]string) error {
	s, err := loadUpdates(context.Background(), tenant)
	if err != nil {
		return err
	}
	if indexValidUntil != nil {
		s.IndexValidUntil = indexValidUntil
	}
	for version, state := range releaseStates {
		if r, ok := s.Releases[version]; ok {
			r.State = state
		}
	}
	return saveUpdates(context.Background(), tenant, s)
}

// -------------------------------------------------
// Time: what has passed since a download or a
// restore request started.
// -------------------------------------------------

func imageSizesOf(r *releaseRecord) []ImageSize {
	out := make([]ImageSize, len(r.Manifest.Images))
	for i, img := range r.Manifest.Images {
		out[i] = ImageSize{Name: img.Name, Bytes: imageBytes[img.Name]}
	}
	return out
}

// isPendingRestore: made, not overtaken by a resume,
// and not done.
func isPendingRestore(s *updatesState, req *RestoreRequest) bool {
	meta, ok := s.RestoreMeta[req.ID]
	return ok && meta != nil && !meta.Superseded && req.State != "completed"
}

type updatesEffect func()

// finishDownloadOn: the end of a download applied to
// the release -- verified, or withdrawn with the
// alert. audit is false in the call that started it.
func finishDownloadOn(ctx context.Context, rc reqctx.RequestContext, release *releaseRecord, after *[]updatesEffect, audit bool) {
	job := release.DownloadJob
	release.DownloadJob = nil
	if job == nil || release.State != "downloading" {
		return
	}
	version := release.Version
	failed := job.Final.State == "failed"
	final := job.Final
	release.Download = &final
	if failed {
		release.State = "withdrawn"
	} else {
		release.State = "verified"
	}
	if failed {
		msg := "The release failed its verification."
		if job.Final.ErrorMessage != nil {
			msg = *job.Final.ErrorMessage
		}
		*after = append(*after, func() {
			raiseNotification(ctx, rc, "update_failed", RaisedNotification{TitleEn: fmt.Sprintf("Release %s was discarded", version), BodyEn: &msg, LinkPath: updStrp("/admin/updates")})
		})
	}
	if audit {
		st := job.Final.State
		*after = append(*after, func() {
			_, _ = auditlog.RecordAuditIn(ctx, rc, auditlog.AuditInput{
				Action: "update.download_finished", EntityType: "update_release", EntityID: &version,
				ActorType: "system", ActorUserIDGiven: true, ActorUserID: nil,
				SummaryEn: fmt.Sprintf("Release %s %s (%s).", version, st, updatesStub),
				Detail:    map[string]any{"version": version, "state": st, "stub": true},
			}, "", "")
		})
	}
}

// finishRestoreOn: the end of a restore -- the
// backup is back, out of maintenance, the run stops
// needing attention.
func finishRestoreOn(ctx context.Context, rc reqctx.RequestContext, s *updatesState, req *RestoreRequest, meta *restoreMeta, after *[]updatesEffect) {
	at := datactx.NowISO()
	req.State = "completed"
	meta.CompletedAt = &at
	s.InMaintenance = false
	s.FallbackActive = false
	if s.AttentionRunID != nil && *s.AttentionRunID == meta.RunID {
		s.AttentionRunID = nil
	}
	if run, ok := s.Runs[meta.RunID]; ok && run != nil {
		run.State = "failed"
		run.MaintenanceOn = false
		run.FinishedAt = &at
		run.OfferedRecovery = nil
	}
	release, ok := s.Releases[meta.Version]
	if ok && release != nil && release.State == "applying" {
		release.State = "available"
		release.Download = nil
		release.DownloadJob = nil
		release.Preflight = nil
		release.Scheduled = nil
		release.BackupConfirmed = false
		release.WindowLabel = nil
	}
	requestID, runID, version := req.ID, meta.RunID, meta.Version
	*after = append(*after, func() {
		_, _ = auditlog.RecordAuditIn(ctx, rc, auditlog.AuditInput{
			Action: "update.restore_completed", EntityType: "update_run", EntityID: &runID,
			ActorType: "system", ActorUserIDGiven: true, ActorUserID: nil,
			SummaryEn: fmt.Sprintf("The database team restored the backup from before %s; maintenance is off and live assignment is back on OpenDispatch (%s).", version, updatesStub),
			Detail:    map[string]any{"restore_request_id": requestID, "run_id": runID, "version": version, "stub": true},
		}, "", "")
	})
}

// currentUpdates: stored state with the effects of
// elapsed time applied -- a finished download
// becomes verified/withdrawn, a due restore
// completes. The first read or write to see the end
// applies it, once.
func currentUpdates(ctx context.Context, rc reqctx.RequestContext) (*updatesState, error) {
	stored, err := loadUpdates(ctx, rc.CustomerID)
	if err != nil {
		return nil, err
	}
	state, after, changed := applyElapsed(ctx, rc, stored)
	if !changed {
		return stored, nil
	}
	if err := saveUpdates(ctx, rc.CustomerID, state); err != nil {
		return nil, err
	}
	for _, effect := range after {
		effect()
	}
	return state, nil
}

// applyElapsed: a copy with elapsed time applied
// and the effects to run once it is stored; the
// stored state itself when nothing has ended.
func applyElapsed(ctx context.Context, rc reqctx.RequestContext, stored *updatesState) (*updatesState, []updatesEffect, bool) {
	var ending []*releaseRecord
	for _, r := range stored.Releases {
		if r.DownloadJob != nil && DownloadPhaseOf(ElapsedSince(r.DownloadJob.StartedAt), r.DownloadJob.DownloadTiming) == PhaseFinished {
			ending = append(ending, r)
		}
	}
	var due []*RestoreRequest
	for _, req := range stored.Restores {
		if isPendingRestore(stored, req) && RestorePhaseOf(ElapsedSince(req.RequestedAt)) == RestoreCompleted {
			due = append(due, req)
		}
	}
	if len(ending) == 0 && len(due) == 0 {
		return stored, nil, false
	}
	state := cloneState(stored)
	var after []updatesEffect
	for _, r := range ending {
		if release, ok := state.Releases[r.Version]; ok {
			finishDownloadOn(ctx, rc, release, &after, true)
		}
	}
	for _, r := range due {
		req := findRestoreByID(state, r.ID)
		meta := state.RestoreMeta[r.ID]
		if req != nil && meta != nil {
			finishRestoreOn(ctx, rc, state, req, meta, &after)
		}
	}
	return state, after, true
}

func findRestoreByID(s *updatesState, id string) *RestoreRequest {
	for _, r := range s.Restores {
		if r.ID == id {
			return r
		}
	}
	return nil
}

// editUpdates: a private copy to change, with
// elapsed time applied. Nothing stored until
// saveUpdates.
func editUpdates(ctx context.Context, rc reqctx.RequestContext) (*updatesState, error) {
	state, err := currentUpdates(ctx, rc)
	if err != nil {
		return nil, err
	}
	return cloneState(state), nil
}

var releaseVersionPattern = regexp.MustCompile(`^[0-9]+\.[0-9]+\.[0-9]+$`)

func requireUpdateRelease(s *updatesState, version string) (*releaseRecord, error) {
	if !releaseVersionPattern.MatchString(version) {
		return nil, dataerr.Invalid("release_version must look like 1.2.3.")
	}
	r, ok := s.Releases[version]
	if !ok || r == nil {
		return nil, dataerr.NotFound(fmt.Sprintf("Release %s not found.", version))
	}
	return r, nil
}

// -------------------------------------------------
// Guards.
// -------------------------------------------------

func requirePrivateInstall(rc reqctx.RequestContext, what string) error {
	if rc.InstallMode != access.InstallPrivate {
		return dataerr.Forbidden(fmt.Sprintf("%s is available only in private installs. Shared and dedicated installs show the version and release notes only.", what))
	}
	return nil
}

// guardUpdatesRead: view on admin.updates, private
// installs only. An install-mode denial is audited.
func guardUpdatesRead(rc reqctx.RequestContext, what string) error {
	if err := reqctx.RequireAccess(rc, access.ModuleAdminUpdates, access.AccessView); err != nil {
		return err
	}
	if rc.InstallMode != access.InstallPrivate {
		message := fmt.Sprintf("%s is available only in private installs. Shared and dedicated installs show the version and release notes only.", what)
		_, _ = auditlog.RecordAudit(rc, auditlog.AuditInput{Action: "update.read", EntityType: "update", SummaryEn: "Denied: " + message, Outcome: "denied"}, "", "")
		return dataerr.Forbidden(message)
	}
	return nil
}

func updatesWriteGuard(rc reqctx.RequestContext, what string) auditlog.Guard {
	return auditlog.Guard{Func: func() error {
		if err := reqctx.RequireAccess(rc, access.ModuleAdminUpdates, access.AccessEdit); err != nil {
			return err
		}
		return requirePrivateInstall(rc, what)
	}}
}

// rawField: a string field of a request body, for
// the audit event of a call denied before
// validation.
func rawField(body any, key string) *string {
	o, ok := body.(map[string]any)
	if !ok {
		return nil
	}
	if v, ok := o[key].(string); ok {
		return &v
	}
	return nil
}

// approvalGuard: view + private install + a role
// that may approve updates at all (checked here,
// before any id/body is read, so a role that cannot
// approve gets forbidden for any input; the
// per-request checks -- nobody approves their own,
// the listed approvers -- stay in decideUpdate).
func approvalGuard(rc reqctx.RequestContext, what, refusal string) auditlog.Guard {
	return auditlog.Guard{Func: func() error {
		if err := reqctx.RequireAccess(rc, access.ModuleAdminUpdates, access.AccessView); err != nil {
			return err
		}
		if err := requirePrivateInstall(rc, what); err != nil {
			return err
		}
		check := access.CheckApproval(access.ApprovalRequest{
			Role: rc.Role, RequesterUserID: "requester", ApproverUserID: "approver",
			Kind: access.ApprovalUpdate, InstallMode: rc.InstallMode, HasInstallMode: true,
		})
		if !check.Allowed {
			return dataerr.Forbidden(fmt.Sprintf("%s refused: %s.", refusal, check.Reason))
		}
		return nil
	}}
}

// -------------------------------------------------
// Views.
// -------------------------------------------------

func boolp(v bool) *bool { return &v }

func cloneIntSlice(s []int) []int {
	if s == nil {
		return nil
	}
	out := make([]int, len(s))
	copy(out, s)
	return out
}

func containsInt(xs []int, v int) bool {
	for _, x := range xs {
		if x == v {
			return true
		}
	}
	return false
}

func isOpenReleaseState(state string) bool {
	switch state {
	case "available", "downloading", "verified", "ready", "scheduled":
		return true
	}
	return false
}

func summaryOfRelease(r *releaseRecord) ReleaseSummary {
	return ReleaseSummary{
		Version: r.Version, Channel: r.Channel, Kind: r.Kind, State: r.State, PublishedAt: r.PublishedAt,
		NeedsDowntime: r.Manifest.NeedsDowntime, RequiresRestoreToRollback: r.Manifest.RequiresRestoreToRollback,
		LiveAssignmentFallback: r.Manifest.LiveAssignmentFallback,
	}
}

func totalBytesOf(r *releaseRecord) int {
	total := 0
	for _, img := range r.Manifest.Images {
		total += imageBytes[img.Name]
	}
	return total
}

func pendingDownloadOf(r *releaseRecord) UpdateDownloadState {
	images := make([]DownloadImageState, len(r.Manifest.Images))
	for i, img := range r.Manifest.Images {
		images[i] = DownloadImageState{Name: img.Name, State: "pending"}
	}
	return UpdateDownloadState{State: "not_started", BytesTotal: totalBytesOf(r), Images: images}
}

// downloadStateOf: the download now -- the phase it
// is in while running, else how it ended (nil before
// any).
func downloadStateOf(r *releaseRecord) *UpdateDownloadState {
	if r.DownloadJob == nil {
		return r.Download
	}
	d := InFlightDownload(imageSizesOf(r), ElapsedSince(r.DownloadJob.StartedAt), r.DownloadJob.DownloadTiming)
	return &d
}

func detailOfRelease(r *releaseRecord) UpdateReleaseDetail {
	return UpdateReleaseDetail{Summary: summaryOfRelease(r), Manifest: r.Manifest, Download: downloadStateOf(r), Preflight: r.Preflight, Scheduled: r.Scheduled}
}

func agentStateOf(state *updatesState) string {
	if state.AttentionRunID != nil {
		return "needs_attention"
	}
	downloading, verifying := false, false
	for _, r := range state.Releases {
		if r.DownloadJob == nil {
			continue
		}
		switch DownloadPhaseOf(ElapsedSince(r.DownloadJob.StartedAt), r.DownloadJob.DownloadTiming) {
		case PhaseDownloading:
			downloading = true
		case PhaseVerifying:
			verifying = true
		}
	}
	if downloading {
		return "downloading"
	}
	if verifying {
		return "verifying"
	}
	for _, r := range state.Releases {
		if r.State == "scheduled" {
			return "scheduled"
		}
	}
	for _, r := range state.Releases {
		if r.State == "ready" {
			return "ready"
		}
	}
	return "idle"
}

func openReleases(state *updatesState) []*releaseRecord {
	var out []*releaseRecord
	for _, r := range state.Releases {
		if isOpenReleaseState(r.State) && compareVersions(r.Version, state.CurrentVersion) > 0 {
			out = append(out, r)
		}
	}
	return out
}

// -------------------------------------------------
// Change windows.
// -------------------------------------------------

type windowSlot struct {
	Window UpdateUpcomingWindow
}

func windowEndOf(date, start, end string) string {
	if end <= start {
		return stampAt(addDaysStr(date, 1), end)
	}
	return stampAt(date, end)
}

func collectUpdateWindows(state *updatesState, from string, limit int, onlyOpen bool) []UpdateUpcomingWindow {
	out := []UpdateUpcomingWindow{}
	for offset := 1; offset <= 400 && len(out) < limit; offset++ {
		date := addDaysStr(from, offset)
		wd := weekdayOf(date)
		var slots []windowSlot
		for _, rule := range state.Recurring {
			if !containsInt(rule.DaysOfWeek, wd) {
				continue
			}
			endStamp := windowEndOf(date, rule.StartTime, rule.EndTime)
			endDate := endStamp
			if len(endDate) >= 10 {
				endDate = endDate[:10]
			}
			blocked := false
			for _, b := range state.Blackouts {
				if !(endDate < b.StartGregorian || date > b.EndGregorian) {
					blocked = true
					break
				}
			}
			label := rule.Label
			slots = append(slots, windowSlot{Window: UpdateUpcomingWindow{
				Start: stampAt(date, rule.StartTime), End: endStamp, Open: !blocked, BlockedByBlackout: blocked, WindowLabel: &label,
			}})
		}
		sort.Slice(slots, func(i, j int) bool { return slots[i].Window.Start < slots[j].Window.Start })
		for _, slot := range slots {
			if onlyOpen && !slot.Window.Open {
				continue
			}
			if len(out) < limit {
				out = append(out, slot.Window)
			}
		}
	}
	return out
}

func nextOpenUpdateWindow(state *updatesState, from string) *UpdateUpcomingWindow {
	windows := collectUpdateWindows(state, from, 1, true)
	if len(windows) == 0 {
		return nil
	}
	return &windows[0]
}

func changeWindowsViewOf(state *updatesState, from string) UpdateChangeWindows {
	recurring := make([]RecurringWindow, len(state.Recurring))
	for i, r := range state.Recurring {
		recurring[i] = RecurringWindow{ID: r.ID, Label: r.Label, DaysOfWeek: cloneIntSlice(r.DaysOfWeek), StartTime: r.StartTime, EndTime: r.EndTime}
	}
	blackouts := make([]Blackout, len(state.Blackouts))
	copy(blackouts, state.Blackouts)
	return UpdateChangeWindows{Recurring: recurring, Blackouts: blackouts, Upcoming: collectUpdateWindows(state, from, 14, false)}
}

func hijriToGregorianDate(months []HijriMonth, hijri HijriDate) (string, error) {
	var found *HijriMonth
	for i := range months {
		if months[i].HijriYear == hijri.Year && months[i].Month == hijri.Month {
			found = &months[i]
			break
		}
	}
	if found == nil {
		return "", dataerr.Invalid(fmt.Sprintf("Blackout: Hijri month %d-%d is not in the calendar reference data.", hijri.Year, hijri.Month))
	}
	date := addDaysStr(found.GregorianStart, hijri.Day-1)
	if date > found.GregorianEnd {
		return "", dataerr.Invalid(fmt.Sprintf("Blackout: Hijri day %d is past the end of %s %d.", hijri.Day, found.NameEn, found.HijriYear))
	}
	return date, nil
}

func gregorianToHijriDate(months []HijriMonth, date string) *HijriDate {
	var found *HijriMonth
	for i := range months {
		if months[i].GregorianStart <= date && date <= months[i].GregorianEnd {
			found = &months[i]
			break
		}
	}
	if found == nil {
		return nil
	}
	start, err1 := time.Parse("2006-01-02", found.GregorianStart)
	d, err2 := time.Parse("2006-01-02", date)
	day := 1
	if err1 == nil && err2 == nil {
		day = int(d.Sub(start).Hours()/24) + 1
	}
	return &HijriDate{Year: found.HijriYear, Month: found.Month, Day: day}
}

func readHijriDate(raw any, what string) (HijriDate, error) {
	o, err := datactx.Object(raw, what, []string{"year", "month", "day"})
	if err != nil {
		return HijriDate{}, err
	}
	year, err := datactx.Int(o, "year", datactx.NumOpts{Min: 1300, Max: 1600, HasMin: true, HasMax: true})
	if err != nil {
		return HijriDate{}, err
	}
	month, err := datactx.Int(o, "month", datactx.NumOpts{Min: 1, Max: 12, HasMin: true, HasMax: true})
	if err != nil {
		return HijriDate{}, err
	}
	day, err := datactx.Int(o, "day", datactx.NumOpts{Min: 1, Max: 30, HasMin: true, HasMax: true})
	if err != nil {
		return HijriDate{}, err
	}
	return HijriDate{Year: year, Month: month, Day: day}, nil
}

// -------------------------------------------------
// Verification, pre-flight, runs (the scripted
// machine).
// -------------------------------------------------

func verificationOf(release *releaseRecord, apply func(*VerificationResult)) VerificationResult {
	msg := "Signature and image digests verified (stub: nothing was actually checked)."
	keyID := release.Manifest.SignatureKeyID
	v := VerificationResult{
		Verified: true, SignatureValid: true, DigestsMatch: true, KeyRevoked: false,
		OlderThanInstalled: false, IndexExpired: false, KeyID: &keyID, Message: &msg,
	}
	if apply != nil {
		apply(&v)
	}
	return v
}

func verifiedDownloadOf(release *releaseRecord) UpdateDownloadState {
	total := totalBytesOf(release)
	images := make([]DownloadImageState, len(release.Manifest.Images))
	for i, img := range release.Manifest.Images {
		images[i] = DownloadImageState{Name: img.Name, State: "verified"}
	}
	ver := verificationOf(release, nil)
	return UpdateDownloadState{State: "verified", BytesDone: total, BytesTotal: total, Images: images, Verification: &ver}
}

// failedDownloadOf: verified=false and message are
// always set; apply adds the specific reason flag.
func failedDownloadOf(release *releaseRecord, message string, apply func(*VerificationResult)) UpdateDownloadState {
	images := make([]DownloadImageState, len(release.Manifest.Images))
	for i, img := range release.Manifest.Images {
		images[i] = DownloadImageState{Name: img.Name, State: "failed"}
	}
	ver := verificationOf(release, func(v *VerificationResult) {
		v.Verified = false
		v.Message = &message
		if apply != nil {
			apply(v)
		}
	})
	return UpdateDownloadState{State: "failed", BytesTotal: totalBytesOf(release), Images: images, Verification: &ver, ErrorMessage: &message}
}

const tamperWord = "tampered"

// tamperedProxy: assumption (header) -- while the
// proxy is on and its address contains "tampered",
// one image's digest does not match the signed
// manifest, so the mockup's failed verification is
// reachable with no real registry.
func tamperedProxy(state *updatesState) bool {
	if !state.Proxy.Enabled || state.Proxy.Address == nil {
		return false
	}
	return strings.Contains(strings.ToLower(*state.Proxy.Address), tamperWord)
}

func digestMismatchDownloadOf(release *releaseRecord) UpdateDownloadState {
	total := totalBytesOf(release)
	bad := release.Manifest.Images[0]
	for _, img := range release.Manifest.Images {
		if img.Name == "worker" {
			bad = img
			break
		}
	}
	message := fmt.Sprintf("The digest of the %s image does not match the signed manifest (scripted, %s). The release was discarded.", bad.Name, updatesStub)
	images := make([]DownloadImageState, len(release.Manifest.Images))
	for i, img := range release.Manifest.Images {
		st := "verified"
		if img.Name == bad.Name {
			st = "failed"
		}
		images[i] = DownloadImageState{Name: img.Name, State: st}
	}
	ver := verificationOf(release, func(v *VerificationResult) {
		v.Verified = false
		v.DigestsMatch = false
		v.Message = &message
	})
	return UpdateDownloadState{State: "failed", BytesDone: total, BytesTotal: total, Images: images, Verification: &ver, ErrorMessage: &message}
}

func evaluateUpdatePreflight(state *updatesState, release *releaseRecord, confirmedBy *string) UpdatePreflightResult {
	migrations := len(release.Manifest.Migrations)
	pathAllowed := matchesUpgradeFrom(state.CurrentVersion, release.Manifest.UpgradeFrom)
	var checks []PreflightCheck
	checks = append(checks, PreflightCheck{ID: "disk_and_registry_space", Status: "passed", Message: updStrp("Enough disk and registry space (stub).")})
	checks = append(checks, PreflightCheck{ID: "database_reachable", Status: "passed", Message: updStrp("Database reachable (stub).")})
	if release.BackupConfirmed {
		msg := "A recent backup was confirmed."
		if confirmedBy != nil {
			msg = fmt.Sprintf("A recent backup was confirmed by %s.", *confirmedBy)
		}
		checks = append(checks, PreflightCheck{ID: "recent_backup", Status: "passed", Message: &msg})
	} else {
		checks = append(checks, PreflightCheck{ID: "recent_backup", Status: "needs_confirmation", Message: updStrp("Confirm that a fresh backup of the database exists.")})
	}
	if pathAllowed {
		checks = append(checks, PreflightCheck{ID: "upgrade_path_allowed", Status: "passed", Message: updStrp(fmt.Sprintf("Upgrade from %s to %s is allowed.", state.CurrentVersion, release.Version))})
	} else {
		checks = append(checks, PreflightCheck{ID: "upgrade_path_allowed", Status: "failed", Message: updStrp(fmt.Sprintf("Upgrade from %s to %s is not allowed (needs %s).", state.CurrentVersion, release.Version, strings.Join(release.Manifest.UpgradeFrom, ", ")))})
	}
	if state.AttentionRunID == nil {
		checks = append(checks, PreflightCheck{ID: "system_healthy", Status: "passed", Message: updStrp("System is healthy (stub).")})
	} else {
		checks = append(checks, PreflightCheck{ID: "system_healthy", Status: "failed", Message: updStrp("A previous update needs attention. Resume or restore it first.")})
	}
	migMsg := "No migrations to rehearse."
	if migrations > 0 {
		migMsg = fmt.Sprintf("Rehearsed %d migration(s) on a temporary database with generated rows. The time is an estimate (stub).", migrations)
	}
	checks = append(checks, PreflightCheck{ID: "migration_rehearsal", Status: "passed", Message: &migMsg})
	allPassed := true
	for _, c := range checks {
		if c.Status != "passed" {
			allPassed = false
			break
		}
	}
	resultState := "failed"
	if allPassed {
		resultState = "passed"
	}
	at := datactx.NowISO()
	estimate := 0
	if migrations > 0 {
		estimate = migrations * 45
		if estimate < 10 {
			estimate = 10
		}
	}
	return UpdatePreflightResult{State: resultState, RanAt: &at, Checks: checks, MigrationTimeEstimateSeconds: updIntp(estimate)}
}

func notPreflightedResult() UpdatePreflightResult {
	ids := []string{"disk_and_registry_space", "database_reachable", "recent_backup", "upgrade_path_allowed", "system_healthy", "migration_rehearsal"}
	checks := make([]PreflightCheck, len(ids))
	for i, id := range ids {
		checks[i] = PreflightCheck{ID: id, Status: "pending"}
	}
	return UpdatePreflightResult{State: "not_run", Checks: checks}
}

type stepPlan struct {
	State   string
	Message string
}

func buildRunSteps(release *releaseRecord, outcome string, at string) []RunStep {
	down := release.Manifest.NeedsDowntime
	hasMigrations := len(release.Manifest.Migrations) > 0
	plan := map[string]stepPlan{
		"record_revisions": {"succeeded", "Current Helm revisions and image fingerprints recorded (stub)."},
		"confirm_backup":   {"succeeded", "Backup confirmed."},
		"migrate_platform": {"succeeded", "Platform migrations applied (stub)."},
		"helm_upgrade":     {"succeeded", "Helm release upgraded (stub)."},
		"smoke_tests":      {"succeeded", "Smoke tests passed (stub)."},
		"report":           {"succeeded", "Result recorded in the Audit Log (stub)."},
	}
	if down {
		plan["fallback_and_maintenance_on"] = stepPlan{"succeeded", "Live assignment switched to the " + customerEn() + " fallback and the maintenance page is on (stub)."}
		plan["maintenance_off"] = stepPlan{"succeeded", "Maintenance off, live assignment returned to OpenDispatch."}
	} else {
		plan["fallback_and_maintenance_on"] = stepPlan{"skipped", "No downtime needed."}
		plan["maintenance_off"] = stepPlan{"skipped", "Maintenance was not on."}
	}
	if hasMigrations {
		plan["migrate_opendispatch"] = stepPlan{"succeeded", fmt.Sprintf("%d OpenDispatch migration(s) applied (stub).", len(release.Manifest.Migrations))}
	} else {
		plan["migrate_opendispatch"] = stepPlan{"skipped", "No OpenDispatch migrations."}
	}
	switch outcome {
	case "health_fail":
		plan["smoke_tests"] = stepPlan{"failed", "Readiness check failed after the upgrade (scripted, stub)."}
		if down {
			plan["maintenance_off"] = stepPlan{"succeeded", "Helm release rolled back to the recorded revision; maintenance off (stub)."}
		} else {
			plan["maintenance_off"] = stepPlan{"skipped", "Helm release rolled back to the recorded revision (stub)."}
		}
		plan["report"] = stepPlan{"succeeded", "Rolled back automatically; result recorded in the Audit Log (stub)."}
	case "migration_fail":
		plan["migrate_opendispatch"] = stepPlan{"failed", "A non-transactional migration failed partway (scripted, stub). Maintenance stays on."}
		for _, name := range []string{"helm_upgrade", "smoke_tests", "maintenance_off", "report"} {
			plan[name] = stepPlan{"pending", "Waiting for recovery."}
		}
	case "resume":
		for _, name := range []string{"record_revisions", "confirm_backup", "fallback_and_maintenance_on", "migrate_platform"} {
			plan[name] = stepPlan{"skipped", "Done in the original run."}
		}
		plan["migrate_opendispatch"] = stepPlan{"succeeded", "Resumed after the fixed release (stub)."}
	case "rollback":
		plan["confirm_backup"] = stepPlan{"skipped", "Not needed for a rollback."}
		plan["fallback_and_maintenance_on"] = stepPlan{"skipped", "Not needed for a rollback."}
		plan["migrate_platform"] = stepPlan{"skipped", "Migrations follow expand then contract, so the previous version runs on the migrated database."}
		plan["migrate_opendispatch"] = stepPlan{"skipped", "Not needed for a rollback."}
		plan["helm_upgrade"] = stepPlan{"succeeded", "Helm release rolled back to the recorded revision (stub)."}
		plan["maintenance_off"] = stepPlan{"skipped", "Maintenance was not on."}
	}
	steps := make([]RunStep, len(stepOrder))
	for i, name := range stepOrder {
		item := plan[name]
		msg := item.Message
		if item.State == "pending" {
			steps[i] = RunStep{Name: name, State: "pending", Message: &msg}
		} else {
			startedAt, finishedAt := at, at
			steps[i] = RunStep{Name: name, State: item.State, StartedAt: &startedAt, FinishedAt: &finishedAt, Message: &msg}
		}
	}
	return steps
}

type runInput struct {
	Kind    string
	Release *releaseRecord
	Outcome string
}

func makeUpdateRun(state *updatesState, input runInput) *UpdateApplyRun {
	at := datactx.NowISO()
	down := input.Release.Manifest.NeedsDowntime
	running := input.Outcome == "migration_fail"
	run := &UpdateApplyRun{
		RunID: nextUpdatesID(state, "run"), Version: input.Release.Version, Kind: input.Kind,
		Steps: buildRunSteps(input.Release, input.Outcome, at), StartedAt: at, MaintenanceOn: running,
	}
	if input.Outcome == "health_fail" {
		run.State = "rolled_back"
	} else if running {
		run.State = "needs_attention"
	} else {
		run.State = "succeeded"
	}
	if !running {
		finishedAt := at
		run.FinishedAt = &finishedAt
	}
	if input.Outcome == "rollback" {
		run.LiveAssignmentFallback = false
	} else {
		run.LiveAssignmentFallback = down
	}
	if input.Outcome == "health_fail" {
		run.HealthCheckPassed = boolp(false)
	} else if !running {
		run.HealthCheckPassed = boolp(true)
	}
	if running {
		run.OfferedRecovery = []string{"resume", "restore"}
	}
	return run
}

func outcomeOfRelease(r *releaseRecord) string {
	switch r.Scripted {
	case "health_check_fails":
		return "health_fail"
	case "migration_fails":
		return "migration_fail"
	default:
		return "success"
	}
}

func windowLabelOf(state *updatesState, iso string) string {
	t := iso
	if len(t) >= 16 {
		t = t[11:16]
	}
	for _, r := range state.Recurring {
		if r.StartTime == t {
			return r.Label
		}
	}
	return defaultWindowLabel
}

// applyReleaseTo: applies the scripted outcome of an
// update or emergency run to the state; returns the
// run.
func applyReleaseTo(ctx context.Context, rc reqctx.RequestContext, state *updatesState, release *releaseRecord, kind string, approvedBy []ActingUser, note string) *UpdateApplyRun {
	outcome := outcomeOfRelease(release)
	from := state.CurrentVersion
	release.State = "applying"
	run := makeUpdateRun(state, runInput{Kind: kind, Release: release, Outcome: outcome})
	state.Runs[run.RunID] = run
	var windowStart *string
	if kind == "update" && release.Scheduled != nil {
		windowStart = updStrp(release.Scheduled.WindowStart)
	}
	var windowLabel *string
	if kind == "emergency" {
		windowLabel = updStrp("Outside a change window (emergency override)")
	} else if windowStart != nil {
		if release.WindowLabel != nil {
			windowLabel = release.WindowLabel
		} else {
			windowLabel = updStrp(windowLabelOf(state, *windowStart))
		}
	}
	entryKind := "update"
	emergency := false
	if kind == "emergency" {
		entryKind = "emergency_override"
		emergency = true
	}
	finished := run.StartedAt
	if run.FinishedAt != nil {
		finished = *run.FinishedAt
	}

	switch outcome {
	case "success":
		state.PreviousVersion = updStrp(state.CurrentVersion)
		state.CurrentVersion = release.Version
		release.State = "applied"
		if release.Scheduled != nil {
			sched := *release.Scheduled
			sched.State = "applied"
			release.Scheduled = &sched
		}
		state.InMaintenance = false
		state.FallbackActive = false
		for _, other := range state.Releases {
			if other.Version != release.Version && compareVersions(other.Version, release.Version) <= 0 && isOpenReleaseState(other.State) {
				other.State = "superseded"
				other.DownloadJob = nil
				other.Scheduled = nil
			}
		}
		noteText := note + " Health checks passed (stub)."
		state.History = append(state.History, HistoryEntry{
			ID: nextUpdatesID(state, "history"), Version: release.Version, FromVersion: updStrp(from), Kind: entryKind, Result: "succeeded",
			StartedAt: run.StartedAt, FinishedAt: &finished, ApprovedBy: approvedBy, WindowStart: windowStart, WindowLabel: windowLabel,
			Emergency: emergency, Note: &noteText,
		})
	case "health_fail":
		release.State = "available"
		release.Download = nil
		release.Preflight = nil
		release.Scheduled = nil
		release.BackupConfirmed = false
		release.WindowLabel = nil
		state.InMaintenance = false
		state.FallbackActive = false
		noteText := fmt.Sprintf("%s The health check failed and the system rolled back by itself to %s (stub).", note, from)
		state.History = append(state.History, HistoryEntry{
			ID: nextUpdatesID(state, "history"), Version: release.Version, FromVersion: updStrp(from), Kind: entryKind, Result: "rolled_back",
			StartedAt: run.StartedAt, FinishedAt: &finished, ApprovedBy: approvedBy, WindowStart: windowStart, WindowLabel: windowLabel,
			Emergency: emergency, Note: &noteText,
		})
		title := fmt.Sprintf("Update %s failed its health check and was rolled back", release.Version)
		body := fmt.Sprintf("The system returned to version %s by itself. No restore is needed (update agent stub).", from)
		raiseNotification(ctx, rc, "update_failed", RaisedNotification{TitleEn: title, BodyEn: &body, LinkPath: updStrp("/admin/updates")})
	default:
		state.InMaintenance = true
		state.FallbackActive = release.Manifest.LiveAssignmentFallback
		state.AttentionRunID = updStrp(run.RunID)
		release.State = "applying"
		startedCopy := run.StartedAt
		noteText := fmt.Sprintf("%s A migration failed partway; maintenance stays on. Resume after a fixed release, or restore (stub).", note)
		state.History = append(state.History, HistoryEntry{
			ID: nextUpdatesID(state, "history"), Version: release.Version, FromVersion: updStrp(from), Kind: entryKind, Result: "failed",
			StartedAt: run.StartedAt, FinishedAt: &startedCopy, ApprovedBy: approvedBy, WindowStart: windowStart, WindowLabel: windowLabel,
			Emergency: emergency, Note: &noteText,
		})
		title := fmt.Sprintf("Update %s needs attention", release.Version)
		body := "A migration failed partway and maintenance stays on. Resume after a fixed release, or request a restore (update agent stub)."
		raiseNotification(ctx, rc, "update_failed", RaisedNotification{TitleEn: title, BodyEn: &body, LinkPath: updStrp("/admin/updates")})
	}
	return run
}

// -------------------------------------------------
// Reads.
// -------------------------------------------------

// GetUpdatesSummary mirrors getUpdatesSummary: works
// in every install mode for a role that may view
// Updates.
func GetUpdatesSummary(rc reqctx.RequestContext) (UpdatesSummary, error) {
	if err := reqctx.RequireAccess(rc, access.ModuleAdminUpdates, access.AccessView); err != nil {
		return UpdatesSummary{}, err
	}
	state, err := loadUpdates(context.Background(), rc.CustomerID)
	if err != nil {
		return UpdatesSummary{}, err
	}
	var applied []*releaseRecord
	for _, r := range state.Releases {
		if r.State == "applied" {
			applied = append(applied, r)
		}
	}
	sort.Slice(applied, func(i, j int) bool { return compareVersions(applied[i].Version, applied[j].Version) > 0 })
	notes := make([]UpdatesSummaryNote, len(applied))
	for i, r := range applied {
		notes[i] = UpdatesSummaryNote{Version: r.Version, PublishedAt: r.PublishedAt, NotesEn: r.Manifest.ReleaseNotes.En, NotesAr: updStrp(r.Manifest.ReleaseNotes.Ar)}
	}
	channel := state.Settings.Channel
	return UpdatesSummary{
		InstallMode: rc.InstallMode, CurrentVersion: state.CurrentVersion, Channel: &channel,
		FullUpdatesAvailable: rc.InstallMode == access.InstallPrivate, ReleaseNotes: notes,
	}, nil
}

func statusOfUpdates(ctx context.Context, tenant string, state *updatesState) UpdateStatus {
	var ready *releaseRecord
	for _, r := range state.Releases {
		if r.State != "ready" && r.State != "scheduled" {
			continue
		}
		if ready == nil || compareVersions(r.Version, ready.Version) > 0 {
			ready = r
		}
	}
	var readyVersion *string
	if ready != nil {
		readyVersion = updStrp(ready.Version)
	}
	var nextStart *string
	if next := nextOpenUpdateWindow(state, updatesToday(ctx, tenant)); next != nil {
		nextStart = updStrp(next.Start)
	}
	var indexValidUntil *string
	if state.ConnectionMode != "offline" {
		indexValidUntil = state.IndexValidUntil
	}
	return UpdateStatus{
		CurrentVersion: state.CurrentVersion, PreviousVersion: state.PreviousVersion, AgentVersion: updatesAgentVersion,
		Channel: state.Settings.Channel, ConnectionMode: state.ConnectionMode, State: agentStateOf(state),
		LastCheckAt: state.LastCheckAt, LastCheckResult: state.LastCheckResult, ReadyReleaseVersion: readyVersion,
		NextWindowStart: nextStart, ReleaseIndexValidUntil: indexValidUntil, InMaintenance: state.InMaintenance,
		LiveAssignmentFallbackActive: state.FallbackActive, NotifyOnly: state.Settings.NotifyOnly,
	}
}

// GetUpdateStatus mirrors getUpdateStatus.
func GetUpdateStatus(rc reqctx.RequestContext) (UpdateStatus, error) {
	if err := guardUpdatesRead(rc, "The update status"); err != nil {
		return UpdateStatus{}, err
	}
	state, err := currentUpdates(context.Background(), rc)
	if err != nil {
		return UpdateStatus{}, err
	}
	return statusOfUpdates(context.Background(), rc.CustomerID, state), nil
}

// ListUpdateReleases mirrors listUpdateReleases.
func ListUpdateReleases(rc reqctx.RequestContext, query datactx.PageQuery) (datactx.PageResult[ReleaseSummary], error) {
	if err := guardUpdatesRead(rc, "The release list"); err != nil {
		return datactx.PageResult[ReleaseSummary]{}, err
	}
	state, err := currentUpdates(context.Background(), rc)
	if err != nil {
		return datactx.PageResult[ReleaseSummary]{}, err
	}
	var rows []*releaseRecord
	for _, r := range state.Releases {
		rows = append(rows, r)
	}
	sort.Slice(rows, func(i, j int) bool { return compareVersions(rows[i].Version, rows[j].Version) > 0 })
	summaries := make([]ReleaseSummary, len(rows))
	for i, r := range rows {
		summaries[i] = summaryOfRelease(r)
	}
	return datactx.Paginate(summaries, query)
}

// GetUpdateRelease mirrors getUpdateRelease.
func GetUpdateRelease(rc reqctx.RequestContext, releaseVersion string) (UpdateReleaseDetail, error) {
	if err := guardUpdatesRead(rc, "A release"); err != nil {
		return UpdateReleaseDetail{}, err
	}
	state, err := currentUpdates(context.Background(), rc)
	if err != nil {
		return UpdateReleaseDetail{}, err
	}
	release, err := requireUpdateRelease(state, releaseVersion)
	if err != nil {
		return UpdateReleaseDetail{}, err
	}
	return detailOfRelease(release), nil
}

// GetUpdateDownloadState mirrors
// getUpdateDownloadState.
func GetUpdateDownloadState(rc reqctx.RequestContext, releaseVersion string) (UpdateDownloadState, error) {
	if err := guardUpdatesRead(rc, "The download state"); err != nil {
		return UpdateDownloadState{}, err
	}
	state, err := currentUpdates(context.Background(), rc)
	if err != nil {
		return UpdateDownloadState{}, err
	}
	release, err := requireUpdateRelease(state, releaseVersion)
	if err != nil {
		return UpdateDownloadState{}, err
	}
	if d := downloadStateOf(release); d != nil {
		return *d, nil
	}
	return pendingDownloadOf(release), nil
}

// GetUpdatePreflight mirrors getUpdatePreflight.
func GetUpdatePreflight(rc reqctx.RequestContext, releaseVersion string) (UpdatePreflightResult, error) {
	if err := guardUpdatesRead(rc, "The pre-flight results"); err != nil {
		return UpdatePreflightResult{}, err
	}
	state, err := currentUpdates(context.Background(), rc)
	if err != nil {
		return UpdatePreflightResult{}, err
	}
	release, err := requireUpdateRelease(state, releaseVersion)
	if err != nil {
		return UpdatePreflightResult{}, err
	}
	if release.Preflight != nil {
		return *release.Preflight, nil
	}
	return notPreflightedResult(), nil
}

// GetUpdateRun mirrors getUpdateRun.
func GetUpdateRun(rc reqctx.RequestContext, id string) (UpdateApplyRun, error) {
	if err := guardUpdatesRead(rc, "An update run"); err != nil {
		return UpdateApplyRun{}, err
	}
	runID, err := importutil.RequireID(id, "Update run")
	if err != nil {
		return UpdateApplyRun{}, err
	}
	state, err := currentUpdates(context.Background(), rc)
	if err != nil {
		return UpdateApplyRun{}, err
	}
	found, err := datactx.RequireFound(state.Runs[runID], "Update run")
	if err != nil {
		return UpdateApplyRun{}, err
	}
	return *found, nil
}

// UpdateHistoryQuery mirrors listUpdateHistory's
// query.
type UpdateHistoryQuery struct {
	datactx.PageQuery
	From *string
	To   *string
}

// ListUpdateHistory mirrors listUpdateHistory.
// Newest first; entries stored later win a tie on
// one second.
func ListUpdateHistory(rc reqctx.RequestContext, query UpdateHistoryQuery) (datactx.PageResult[HistoryEntry], error) {
	if err := guardUpdatesRead(rc, "The update history"); err != nil {
		return datactx.PageResult[HistoryEntry]{}, err
	}
	from, to := "", ""
	if query.From != nil {
		from = *query.From
	}
	if query.To != nil {
		to = *query.To
	}
	current, err := currentUpdates(context.Background(), rc)
	if err != nil {
		return datactx.PageResult[HistoryEntry]{}, err
	}
	history := current.History
	type indexedEntry struct {
		Entry HistoryEntry
		Index int
	}
	var filtered []indexedEntry
	for i, e := range history {
		ok, err := datactx.InTimeRange(e.StartedAt, from, to)
		if err != nil {
			return datactx.PageResult[HistoryEntry]{}, err
		}
		if ok {
			filtered = append(filtered, indexedEntry{Entry: e, Index: i})
		}
	}
	sort.SliceStable(filtered, func(i, j int) bool {
		ei, _ := datactx.EpochOf(filtered[i].Entry.StartedAt)
		ej, _ := datactx.EpochOf(filtered[j].Entry.StartedAt)
		if !ei.Equal(ej) {
			return ei.After(ej)
		}
		return filtered[i].Index > filtered[j].Index
	})
	entries := make([]HistoryEntry, len(filtered))
	for i, r := range filtered {
		entries[i] = r.Entry
	}
	return datactx.Paginate(entries, query.PageQuery)
}

// GetUpdateSettings mirrors getUpdateSettings.
func GetUpdateSettings(rc reqctx.RequestContext) (UpdateSettings, error) {
	if err := guardUpdatesRead(rc, "The update settings"); err != nil {
		return UpdateSettings{}, err
	}
	state, err := loadUpdates(context.Background(), rc.CustomerID)
	if err != nil {
		return UpdateSettings{}, err
	}
	return state.Settings, nil
}

func connectionViewOf(state *updatesState) UpdateConnectionSettings {
	proxy := state.Proxy
	endpoints := []AllowedEndpoint{}
	if state.ConnectionMode != "offline" {
		endpoints = []AllowedEndpoint{
			{Hostname: "updates.opendispatch.example", Port: 443, Purpose: "Release index and manifests"},
			{Hostname: "releases.opendispatch.example", Port: 443, Purpose: "Signed release images"},
		}
	}
	return UpdateConnectionSettings{
		Mode: state.ConnectionMode, AllowedEndpoints: endpoints,
		Proxy:         ProxySettingsView{Enabled: proxy.Enabled, Address: proxy.Address, Username: proxy.Username, HasPassword: proxy.HasPassword, HasCACertificate: proxy.HasCACertificate},
		LastContactAt: state.LastContactAt, LastContactResult: state.LastContactResult,
	}
}

// GetUpdateConnection mirrors getUpdateConnection.
func GetUpdateConnection(rc reqctx.RequestContext) (UpdateConnectionSettings, error) {
	if err := guardUpdatesRead(rc, "The connection settings"); err != nil {
		return UpdateConnectionSettings{}, err
	}
	state, err := loadUpdates(context.Background(), rc.CustomerID)
	if err != nil {
		return UpdateConnectionSettings{}, err
	}
	return connectionViewOf(state), nil
}

// GetOfflineUpdateUpload mirrors
// getOfflineUpdateUpload.
func GetOfflineUpdateUpload(rc reqctx.RequestContext, id string) (UpdateOfflineUploadResult, error) {
	if err := guardUpdatesRead(rc, "An offline upload"); err != nil {
		return UpdateOfflineUploadResult{}, err
	}
	uploadID, err := importutil.RequireID(id, "Offline upload")
	if err != nil {
		return UpdateOfflineUploadResult{}, err
	}
	state, err := loadUpdates(context.Background(), rc.CustomerID)
	if err != nil {
		return UpdateOfflineUploadResult{}, err
	}
	found, err := datactx.RequireFound(state.Uploads[uploadID], "Offline upload")
	if err != nil {
		return UpdateOfflineUploadResult{}, err
	}
	return *found, nil
}

// GetUpdateChangeWindows mirrors
// getUpdateChangeWindows.
func GetUpdateChangeWindows(rc reqctx.RequestContext) (UpdateChangeWindows, error) {
	if err := guardUpdatesRead(rc, "The change windows"); err != nil {
		return UpdateChangeWindows{}, err
	}
	state, err := loadUpdates(context.Background(), rc.CustomerID)
	if err != nil {
		return UpdateChangeWindows{}, err
	}
	return changeWindowsViewOf(state, updatesToday(context.Background(), rc.CustomerID)), nil
}

// GetNextUpdateWindow mirrors getNextUpdateWindow.
func GetNextUpdateWindow(rc reqctx.RequestContext) (UpdateUpcomingWindow, error) {
	if err := guardUpdatesRead(rc, "The next change window"); err != nil {
		return UpdateUpcomingWindow{}, err
	}
	state, err := loadUpdates(context.Background(), rc.CustomerID)
	if err != nil {
		return UpdateUpcomingWindow{}, err
	}
	found, err := datactx.RequireFound(nextOpenUpdateWindow(state, updatesToday(context.Background(), rc.CustomerID)), "An open change window")
	if err != nil {
		return UpdateUpcomingWindow{}, err
	}
	return *found, nil
}

// GetUpdateChangePolicy mirrors
// getUpdateChangePolicy.
func GetUpdateChangePolicy(rc reqctx.RequestContext) (UpdateChangePolicy, error) {
	if err := guardUpdatesRead(rc, "The change policy"); err != nil {
		return UpdateChangePolicy{}, err
	}
	state, err := loadUpdates(context.Background(), rc.CustomerID)
	if err != nil {
		return UpdateChangePolicy{}, err
	}
	policy := state.Policy
	policy.ApproverUserIDs = cloneStrSlice(policy.ApproverUserIDs)
	return policy, nil
}

// -------------------------------------------------
// Overview writes: check, download, pre-flight,
// schedule, approve, apply, skip.
// -------------------------------------------------

// CheckForUpdatesNow mirrors checkForUpdatesNow.
func CheckForUpdatesNow(rc reqctx.RequestContext) (UpdateStatus, error) {
	return auditlog.WriteWithAudit(context.Background(), rc, updatesWriteGuard(rc, "Check now"), auditlog.WriteMeta{Action: "update.check", EntityType: "update"}, func(ctx context.Context) (auditlog.AuditedWrite[UpdateStatus], error) {
		state, err := editUpdates(ctx, rc)
		if err != nil {
			return auditlog.AuditedWrite[UpdateStatus]{}, err
		}
		if state.ConnectionMode == "offline" {
			return auditlog.AuditedWrite[UpdateStatus]{}, dataerr.Conflict("The install is in offline mode: upload an update file instead of checking.")
		}
		found := len(openReleases(state)) > 0
		state.LastCheckAt = updStrp(datactx.NowISO())
		resultText := "up to date"
		if found {
			state.LastCheckResult = updStrp("update_found")
			resultText = "an update was found"
		} else {
			state.LastCheckResult = updStrp("up_to_date")
		}
		state.LastContactAt = state.LastCheckAt
		state.LastContactResult = updStrp("ok")
		state.IndexValidUntil = updStrp(addDaysStr(updatesToday(ctx, rc.CustomerID), 7) + "T00:00:00+03:00")
		if err := saveUpdates(ctx, rc.CustomerID, state); err != nil {
			return auditlog.AuditedWrite[UpdateStatus]{}, err
		}
		return auditlog.AuditedWrite[UpdateStatus]{
			Result: statusOfUpdates(ctx, rc.CustomerID, state), SummaryEn: fmt.Sprintf("Checked for updates (%s): %s.", updatesStub, resultText),
			Detail: map[string]any{"result": *state.LastCheckResult, "stub": true},
		}, nil
	})
}

// StartUpdateDownload mirrors startUpdateDownload.
// Takes an available release, or one discarded after
// a failed verification (withdrawn, download
// failed): a retry.
func StartUpdateDownload(rc reqctx.RequestContext, releaseVersion string) (UpdateDownloadState, error) {
	return auditlog.WriteWithAudit(context.Background(), rc, updatesWriteGuard(rc, "Download"), auditlog.WriteMeta{Action: "update.download", EntityType: "update_release", EntityID: &releaseVersion}, func(ctx context.Context) (auditlog.AuditedWrite[UpdateDownloadState], error) {
		state, err := editUpdates(ctx, rc)
		if err != nil {
			return auditlog.AuditedWrite[UpdateDownloadState]{}, err
		}
		release, err := requireUpdateRelease(state, releaseVersion)
		if err != nil {
			return auditlog.AuditedWrite[UpdateDownloadState]{}, err
		}
		if state.ConnectionMode == "offline" && release.Source == "index" {
			return auditlog.AuditedWrite[UpdateDownloadState]{}, dataerr.Conflict("The install is in offline mode: upload the update file instead of downloading.")
		}
		retry := release.State == "withdrawn" && release.Download != nil && release.Download.State == "failed"
		if release.State != "available" && !retry {
			return auditlog.AuditedWrite[UpdateDownloadState]{}, dataerr.Conflict(fmt.Sprintf("Release %s is %s; only an available release, or one discarded after a failed verification, can be downloaded.", release.Version, release.State))
		}
		older := compareVersions(release.Version, state.CurrentVersion) <= 0
		if retry && older {
			return auditlog.AuditedWrite[UpdateDownloadState]{}, dataerr.Conflict(fmt.Sprintf("Release %s is not newer than the installed %s; downloading it again cannot help.", release.Version, state.CurrentVersion))
		}
		expired := state.ConnectionMode == "connected" && state.IndexValidUntil != nil && (*state.IndexValidUntil)[:10] < updatesToday(ctx, rc.CustomerID)
		var previousError *string
		if retry && release.Download != nil {
			previousError = release.Download.ErrorMessage
		}
		var final UpdateDownloadState
		if older || expired {
			var message string
			var apply func(*VerificationResult)
			if older {
				message = fmt.Sprintf("Release %s is not newer than the installed %s. Discarded.", release.Version, state.CurrentVersion)
				apply = func(v *VerificationResult) { v.OlderThanInstalled = true }
			} else {
				message = "The release index is past its valid-until date. Discarded."
				apply = func(v *VerificationResult) { v.IndexExpired = true }
			}
			final = failedDownloadOf(release, message, apply)
		} else if tamperedProxy(state) {
			final = digestMismatchDownloadOf(release)
		} else {
			final = verifiedDownloadOf(release)
		}
		paceSetting, err := settingsstore.Get[any](ctx, rc.CustomerID, DownloadPaceSetting, "demo")
		if err != nil {
			return auditlog.AuditedWrite[UpdateDownloadState]{}, err
		}
		pace := DownloadPaceOf(paceSetting)
		timing := TimingFor(pace)
		release.State = "downloading"
		release.Download = nil
		release.DownloadJob = &downloadJob{DownloadTiming: timing, StartedAt: datactx.NowISO(), Retry: retry, Final: final}
		ended := DownloadPhaseOf(0, timing) == PhaseFinished
		var after []updatesEffect
		if ended {
			finishDownloadOn(ctx, rc, release, &after, false)
		}
		if err := saveUpdates(ctx, rc.CustomerID, state); err != nil {
			return auditlog.AuditedWrite[UpdateDownloadState]{}, err
		}
		for _, effect := range after {
			effect()
		}
		var download UpdateDownloadState
		if ended {
			if release.Download != nil {
				download = *release.Download
			} else {
				download = final
			}
		} else {
			download = InFlightDownload(imageSizesOf(release), 0, timing)
		}
		retrySuffix := ""
		if retry {
			retrySuffix = " on retry"
		}
		var summary string
		if ended {
			summary = fmt.Sprintf("Release %s %s%s (%s).", release.Version, download.State, retrySuffix, updatesStub)
		} else {
			startWord := "started"
			if retry {
				startWord = "retried"
			}
			summary = fmt.Sprintf("Release %s download %s (%s).", release.Version, startWord, updatesStub)
		}
		detail := map[string]any{"version": release.Version, "state": download.State, "stub": true}
		if retry {
			detail["retry"] = true
			detail["previous_error"] = previousError
		}
		return auditlog.AuditedWrite[UpdateDownloadState]{Result: download, SummaryEn: summary, Detail: detail}, nil
	})
}

type preflightRunResult struct {
	Result    UpdatePreflightResult
	SummaryEn string
	Detail    map[string]any
}

func preflightRunOf(ctx context.Context, rc reqctx.RequestContext, releaseVersion string, note *string, hasConfirm bool) (preflightRunResult, error) {
	state, err := editUpdates(ctx, rc)
	if err != nil {
		return preflightRunResult{}, err
	}
	release, err := requireUpdateRelease(state, releaseVersion)
	if err != nil {
		return preflightRunResult{}, err
	}
	if release.State != "verified" && release.State != "ready" {
		return preflightRunResult{}, dataerr.Conflict(fmt.Sprintf("Release %s is %s; download and verify it before the pre-flight checks.", release.Version, release.State))
	}
	by := actingUser(ctx, rc).DisplayName
	var confirmedBy *string
	if hasConfirm {
		release.BackupConfirmed = true
		confirmedBy = &by
	}
	result := evaluateUpdatePreflight(state, release, confirmedBy)
	release.Preflight = &result
	if result.State == "passed" {
		release.State = "ready"
	} else {
		release.State = "verified"
	}
	if err := saveUpdates(ctx, rc.CustomerID, state); err != nil {
		return preflightRunResult{}, err
	}
	action := "Pre-flight checks run"
	if hasConfirm {
		action = "Backup confirmed"
	}
	detail := map[string]any{"version": release.Version, "state": result.State, "stub": true}
	if note != nil && *note != "" {
		detail["note"] = *note
	}
	return preflightRunResult{Result: result, SummaryEn: fmt.Sprintf("%s for %s: %s (%s).", action, release.Version, result.State, updatesStub), Detail: detail}, nil
}

// RunUpdatePreflight mirrors runUpdatePreflight.
func RunUpdatePreflight(rc reqctx.RequestContext, releaseVersion string) (UpdatePreflightResult, error) {
	return auditlog.WriteWithAudit(context.Background(), rc, updatesWriteGuard(rc, "Pre-flight"), auditlog.WriteMeta{Action: "update.preflight", EntityType: "update_release", EntityID: &releaseVersion}, func(ctx context.Context) (auditlog.AuditedWrite[UpdatePreflightResult], error) {
		r, err := preflightRunOf(ctx, rc, releaseVersion, nil, false)
		if err != nil {
			return auditlog.AuditedWrite[UpdatePreflightResult]{}, err
		}
		return auditlog.AuditedWrite[UpdatePreflightResult]{Result: r.Result, SummaryEn: r.SummaryEn, Detail: r.Detail}, nil
	})
}

// ConfirmUpdateBackup mirrors confirmUpdateBackup.
// assumption: also re-runs the pre-flight
// evaluation.
func ConfirmUpdateBackup(rc reqctx.RequestContext, releaseVersion string, body any) (UpdatePreflightResult, error) {
	return auditlog.WriteWithAudit(context.Background(), rc, updatesWriteGuard(rc, "Backup confirmation"), auditlog.WriteMeta{Action: "update.backup_confirmed", EntityType: "update_release", EntityID: &releaseVersion}, func(ctx context.Context) (auditlog.AuditedWrite[UpdatePreflightResult], error) {
		if body == nil {
			body = map[string]any{}
		}
		input, err := datactx.Object(body, "Backup confirmation", []string{"note"})
		if err != nil {
			return auditlog.AuditedWrite[UpdatePreflightResult]{}, err
		}
		note, err := datactx.NullableString(input, "note", datactx.StrOpts{Max: 300, HasMax: true})
		if err != nil {
			return auditlog.AuditedWrite[UpdatePreflightResult]{}, err
		}
		r, err := preflightRunOf(ctx, rc, releaseVersion, note, true)
		if err != nil {
			return auditlog.AuditedWrite[UpdatePreflightResult]{}, err
		}
		return auditlog.AuditedWrite[UpdatePreflightResult]{Result: r.Result, SummaryEn: r.SummaryEn, Detail: r.Detail}, nil
	})
}

// ScheduleUpdate mirrors scheduleUpdate.
func ScheduleUpdate(rc reqctx.RequestContext, releaseVersion string, body any) (UpdateScheduledUpdate, error) {
	return auditlog.WriteWithAudit(context.Background(), rc, updatesWriteGuard(rc, "Schedule"), auditlog.WriteMeta{Action: "update.schedule", EntityType: "update_release", EntityID: &releaseVersion}, func(ctx context.Context) (auditlog.AuditedWrite[UpdateScheduledUpdate], error) {
		if body == nil {
			body = map[string]any{}
		}
		input, err := datactx.Object(body, "Schedule request", []string{"window_start"})
		if err != nil {
			return auditlog.AuditedWrite[UpdateScheduledUpdate]{}, err
		}
		requested, hasRequested, err := datactx.OptDateTime(input, "window_start")
		if err != nil {
			return auditlog.AuditedWrite[UpdateScheduledUpdate]{}, err
		}
		state, err := editUpdates(ctx, rc)
		if err != nil {
			return auditlog.AuditedWrite[UpdateScheduledUpdate]{}, err
		}
		release, err := requireUpdateRelease(state, releaseVersion)
		if err != nil {
			return auditlog.AuditedWrite[UpdateScheduledUpdate]{}, err
		}
		if release.State != "ready" {
			return auditlog.AuditedWrite[UpdateScheduledUpdate]{}, dataerr.Conflict(fmt.Sprintf("Release %s is %s; it must be ready (downloaded, verified, pre-flight passed) to schedule.", release.Version, release.State))
		}
		for _, other := range state.Releases {
			if other.State == "scheduled" && other.Version != release.Version {
				return auditlog.AuditedWrite[UpdateScheduledUpdate]{}, dataerr.Conflict(fmt.Sprintf("Release %s is already scheduled.", other.Version))
			}
		}
		open := collectUpdateWindows(state, updatesToday(ctx, rc.CustomerID), 400, true)
		var slot *UpdateUpcomingWindow
		if !hasRequested {
			if len(open) > 0 {
				slot = &open[0]
			}
		} else {
			reqEpoch, _ := datactx.EpochOf(requested)
			for i := range open {
				e, err2 := datactx.EpochOf(open[i].Start)
				if err2 == nil && e.Equal(reqEpoch) {
					slot = &open[i]
					break
				}
			}
		}
		if slot == nil {
			if !hasRequested {
				return auditlog.AuditedWrite[UpdateScheduledUpdate]{}, dataerr.Conflict("There is no open change window to schedule into.")
			}
			return auditlog.AuditedWrite[UpdateScheduledUpdate]{}, dataerr.Invalid("window_start is not the start of an open change window.")
		}
		needed := state.Policy.SecondApproverRequired || len(state.Policy.ApproverUserIDs) > 0
		scheduledState := "approved"
		if needed {
			scheduledState = "awaiting_approval"
		}
		scheduled := UpdateScheduledUpdate{
			Version: release.Version, WindowStart: slot.Start, WindowEnd: slot.End, RequestedBy: actingUser(ctx, rc),
			SecondApproverRequired: state.Policy.SecondApproverRequired, Approvals: []ApprovalRecord{}, State: scheduledState,
		}
		release.Scheduled = &scheduled
		release.WindowLabel = slot.WindowLabel
		release.State = "scheduled"
		if err := saveUpdates(ctx, rc.CustomerID, state); err != nil {
			return auditlog.AuditedWrite[UpdateScheduledUpdate]{}, err
		}
		return auditlog.AuditedWrite[UpdateScheduledUpdate]{
			Result: scheduled, SummaryEn: fmt.Sprintf("Release %s scheduled for %s (%s).", release.Version, slot.Start, updatesStub),
			Detail: map[string]any{"version": release.Version, "window_start": slot.Start, "state": scheduled.State, "stub": true},
		}, nil
	})
}

// CancelScheduledUpdate mirrors
// cancelScheduledUpdate: OpenDispatch-only (the agent stub
// has no such operation). A release that is not
// scheduled cannot be cancelled.
func CancelScheduledUpdate(rc reqctx.RequestContext, releaseVersion string) (UpdateReleaseDetail, error) {
	return auditlog.WriteWithAudit(context.Background(), rc, updatesWriteGuard(rc, "Cancel schedule"), auditlog.WriteMeta{Action: "update.schedule_cancelled", EntityType: "update_release", EntityID: &releaseVersion}, func(ctx context.Context) (auditlog.AuditedWrite[UpdateReleaseDetail], error) {
		state, err := editUpdates(ctx, rc)
		if err != nil {
			return auditlog.AuditedWrite[UpdateReleaseDetail]{}, err
		}
		release, err := requireUpdateRelease(state, releaseVersion)
		if err != nil {
			return auditlog.AuditedWrite[UpdateReleaseDetail]{}, err
		}
		scheduled := release.Scheduled
		if release.State != "scheduled" || scheduled == nil {
			return auditlog.AuditedWrite[UpdateReleaseDetail]{}, dataerr.Conflict(fmt.Sprintf("Release %s is %s and has no schedule to cancel.", release.Version, release.State))
		}
		at := datactx.NowISO()
		windowLabel := release.WindowLabel
		release.State = "ready"
		release.Scheduled = nil
		release.WindowLabel = nil
		note := fmt.Sprintf("Schedule cancelled by %s (stub).", actingUser(ctx, rc).DisplayName)
		state.History = append(state.History, HistoryEntry{
			ID: nextUpdatesID(state, "history"), Version: release.Version, FromVersion: updStrp(state.CurrentVersion), Kind: "update", Result: "cancelled",
			StartedAt: at, FinishedAt: &at, ApprovedBy: []ActingUser{}, WindowStart: updStrp(scheduled.WindowStart), WindowLabel: windowLabel, Note: &note,
		})
		if err := saveUpdates(ctx, rc.CustomerID, state); err != nil {
			return auditlog.AuditedWrite[UpdateReleaseDetail]{}, err
		}
		return auditlog.AuditedWrite[UpdateReleaseDetail]{
			Result: detailOfRelease(release), SummaryEn: fmt.Sprintf("Schedule of release %s cancelled (%s).", release.Version, updatesStub),
			Detail: map[string]any{"version": release.Version, "window_start": scheduled.WindowStart, "was": scheduled.State, "stub": true},
		}, nil
	})
}

type decideResult struct {
	Result    UpdateScheduledUpdate
	SummaryEn string
	Detail    map[string]any
}

func decideUpdate(ctx context.Context, rc reqctx.RequestContext, releaseVersion string, body any, decision string) (decideResult, error) {
	if body == nil {
		body = map[string]any{}
	}
	input, err := datactx.Object(body, "Decision", []string{"note"})
	if err != nil {
		return decideResult{}, err
	}
	note, err := datactx.NullableString(input, "note", datactx.StrOpts{Max: 500, HasMax: true})
	if err != nil {
		return decideResult{}, err
	}
	state, err := editUpdates(ctx, rc)
	if err != nil {
		return decideResult{}, err
	}
	release, err := requireUpdateRelease(state, releaseVersion)
	if err != nil {
		return decideResult{}, err
	}
	scheduled := release.Scheduled
	if scheduled == nil || scheduled.State != "awaiting_approval" {
		return decideResult{}, dataerr.Conflict(fmt.Sprintf("Release %s is not awaiting approval.", release.Version))
	}
	check := access.CheckApproval(access.ApprovalRequest{
		Role: rc.Role, RequesterUserID: scheduled.RequestedBy.UserID, ApproverUserID: rc.UserID,
		Kind: access.ApprovalUpdate, InstallMode: rc.InstallMode, HasInstallMode: true,
	})
	if !check.Allowed {
		refusal := "Approval"
		if decision == "rejected" {
			refusal = "Rejection"
		}
		return decideResult{}, dataerr.Forbidden(fmt.Sprintf("%s refused: %s.", refusal, check.Reason))
	}
	if len(state.Policy.ApproverUserIDs) > 0 && !containsStr(state.Policy.ApproverUserIDs, rc.UserID) {
		return decideResult{}, dataerr.Forbidden("You are not one of the approvers listed in the change policy.")
	}
	for _, a := range scheduled.Approvals {
		if a.Approver.UserID == rc.UserID {
			return decideResult{}, dataerr.Conflict("You have already decided on this update.")
		}
	}
	record := ApprovalRecord{Approver: actingUser(ctx, rc), Decision: decision, DecidedAt: datactx.NowISO()}
	if note != nil {
		record.Note = note
	}
	approvals := append(append([]ApprovalRecord{}, scheduled.Approvals...), record)
	next := "awaiting_approval"
	if decision == "rejected" {
		next = "rejected"
	} else {
		approvedCount := 0
		for _, a := range approvals {
			if a.Decision == "approved" {
				approvedCount++
			}
		}
		needed := 1
		if scheduled.SecondApproverRequired {
			needed = 2
		}
		if approvedCount >= needed {
			next = "approved"
		}
	}
	updatedScheduled := *scheduled
	updatedScheduled.Approvals = approvals
	updatedScheduled.State = next
	release.Scheduled = &updatedScheduled
	if next == "rejected" {
		release.State = "rejected"
		noteText := fmt.Sprintf("Rejected by %s", record.Approver.DisplayName)
		if note != nil {
			noteText += ": " + *note
		}
		noteText += " (stub)."
		state.History = append(state.History, HistoryEntry{
			ID: nextUpdatesID(state, "history"), Version: release.Version, FromVersion: updStrp(state.CurrentVersion), Kind: "update", Result: "cancelled",
			StartedAt: record.DecidedAt, FinishedAt: &record.DecidedAt, ApprovedBy: []ActingUser{}, WindowStart: updStrp(scheduled.WindowStart), WindowLabel: release.WindowLabel, Note: &noteText,
		})
	}
	if err := saveUpdates(ctx, rc.CustomerID, state); err != nil {
		return decideResult{}, err
	}
	verb := "approved"
	if decision != "approved" {
		verb = "rejected"
	}
	suffix := ""
	if next == "approved" {
		suffix = " (fully approved)"
	}
	return decideResult{
		Result:    updatedScheduled,
		SummaryEn: fmt.Sprintf("Update %s %s by %s%s (%s).", release.Version, verb, record.Approver.DisplayName, suffix, updatesStub),
		Detail:    map[string]any{"version": release.Version, "decision": decision, "state": next, "approvals": len(approvals), "stub": true},
	}, nil
}

// ApproveUpdate mirrors approveUpdate.
func ApproveUpdate(rc reqctx.RequestContext, releaseVersion string, body any) (UpdateScheduledUpdate, error) {
	return auditlog.WriteWithAudit(context.Background(), rc, approvalGuard(rc, "Approving an update", "Approval"), auditlog.WriteMeta{Action: "update.approve", EntityType: "update_release", EntityID: &releaseVersion}, func(ctx context.Context) (auditlog.AuditedWrite[UpdateScheduledUpdate], error) {
		r, err := decideUpdate(ctx, rc, releaseVersion, body, "approved")
		if err != nil {
			return auditlog.AuditedWrite[UpdateScheduledUpdate]{}, err
		}
		return auditlog.AuditedWrite[UpdateScheduledUpdate]{Result: r.Result, SummaryEn: r.SummaryEn, Detail: r.Detail}, nil
	})
}

// RejectUpdate mirrors rejectUpdate.
func RejectUpdate(rc reqctx.RequestContext, releaseVersion string, body any) (UpdateScheduledUpdate, error) {
	return auditlog.WriteWithAudit(context.Background(), rc, approvalGuard(rc, "Rejecting an update", "Rejection"), auditlog.WriteMeta{Action: "update.reject", EntityType: "update_release", EntityID: &releaseVersion}, func(ctx context.Context) (auditlog.AuditedWrite[UpdateScheduledUpdate], error) {
		r, err := decideUpdate(ctx, rc, releaseVersion, body, "rejected")
		if err != nil {
			return auditlog.AuditedWrite[UpdateScheduledUpdate]{}, err
		}
		return auditlog.AuditedWrite[UpdateScheduledUpdate]{Result: r.Result, SummaryEn: r.SummaryEn, Detail: r.Detail}, nil
	})
}

// ApplyUpdate mirrors applyUpdate.
func ApplyUpdate(rc reqctx.RequestContext, releaseVersion string) (UpdateApplyRun, error) {
	return auditlog.WriteWithAudit(context.Background(), rc, updatesWriteGuard(rc, "Apply"), auditlog.WriteMeta{Action: "update.apply", EntityType: "update_release", EntityID: &releaseVersion}, func(ctx context.Context) (auditlog.AuditedWrite[UpdateApplyRun], error) {
		state, err := editUpdates(ctx, rc)
		if err != nil {
			return auditlog.AuditedWrite[UpdateApplyRun]{}, err
		}
		release, err := requireUpdateRelease(state, releaseVersion)
		if err != nil {
			return auditlog.AuditedWrite[UpdateApplyRun]{}, err
		}
		if state.Settings.NotifyOnly {
			return auditlog.AuditedWrite[UpdateApplyRun]{}, dataerr.Conflict("Notify-only mode: the agent downloads and verifies; the customer's own pipeline applies the chart.")
		}
		if state.AttentionRunID != nil {
			return auditlog.AuditedWrite[UpdateApplyRun]{}, dataerr.Conflict("A previous update needs attention. Resume or restore it first.")
		}
		scheduled := release.Scheduled
		if release.State != "scheduled" || scheduled == nil {
			return auditlog.AuditedWrite[UpdateApplyRun]{}, dataerr.Conflict(fmt.Sprintf("Release %s is %s; schedule it into a change window first.", release.Version, release.State))
		}
		if scheduled.State != "approved" {
			return auditlog.AuditedWrite[UpdateApplyRun]{}, dataerr.Conflict(fmt.Sprintf("The scheduled update is %s; it needs approval before it can be applied.", strings.ReplaceAll(scheduled.State, "_", " ")))
		}
		if !matchesUpgradeFrom(state.CurrentVersion, release.Manifest.UpgradeFrom) {
			return auditlog.AuditedWrite[UpdateApplyRun]{}, dataerr.Conflict(fmt.Sprintf("Upgrading from %s to %s is not allowed.", state.CurrentVersion, release.Version))
		}
		approvedBy := []ActingUser{}
		for _, a := range scheduled.Approvals {
			if a.Decision == "approved" {
				approvedBy = append(approvedBy, a.Approver)
			}
		}
		run := applyReleaseTo(ctx, rc, state, release, "update", approvedBy, fmt.Sprintf("Applied in the change window (%s).", scheduled.WindowStart))
		if err := saveUpdates(ctx, rc.CustomerID, state); err != nil {
			return auditlog.AuditedWrite[UpdateApplyRun]{}, err
		}
		var healthCheckPassed any
		if run.HealthCheckPassed != nil {
			healthCheckPassed = *run.HealthCheckPassed
		}
		return auditlog.AuditedWrite[UpdateApplyRun]{
			Result: *run, SummaryEn: fmt.Sprintf("Update %s applied (%s): %s.", release.Version, updatesStub, run.State),
			Detail: map[string]any{"version": release.Version, "run_id": run.RunID, "state": run.State, "health_check_passed": healthCheckPassed, "stub": true},
		}, nil
	})
}

// SkipUpdate mirrors skipUpdate. A release discarded
// after a failed verification can be skipped too.
func SkipUpdate(rc reqctx.RequestContext, releaseVersion string, body any) (UpdateReleaseDetail, error) {
	return auditlog.WriteWithAudit(context.Background(), rc, updatesWriteGuard(rc, "Skip"), auditlog.WriteMeta{Action: "update.skip", EntityType: "update_release", EntityID: &releaseVersion}, func(ctx context.Context) (auditlog.AuditedWrite[UpdateReleaseDetail], error) {
		input, err := datactx.Object(body, "Skip request", []string{"reason"})
		if err != nil {
			return auditlog.AuditedWrite[UpdateReleaseDetail]{}, err
		}
		reason, err := datactx.String(input, "reason", datactx.StrOpts{Min: 1, Max: 300, HasMin: true, HasMax: true})
		if err != nil {
			return auditlog.AuditedWrite[UpdateReleaseDetail]{}, err
		}
		state, err := editUpdates(ctx, rc)
		if err != nil {
			return auditlog.AuditedWrite[UpdateReleaseDetail]{}, err
		}
		release, err := requireUpdateRelease(state, releaseVersion)
		if err != nil {
			return auditlog.AuditedWrite[UpdateReleaseDetail]{}, err
		}
		discarded := release.State == "withdrawn" && release.Download != nil && release.Download.State == "failed"
		skippable := release.State == "available" || release.State == "verified" || release.State == "ready" || release.State == "scheduled"
		if !skippable && !discarded {
			return auditlog.AuditedWrite[UpdateReleaseDetail]{}, dataerr.Conflict(fmt.Sprintf("Release %s is %s and cannot be skipped.", release.Version, release.State))
		}
		at := datactx.NowISO()
		release.State = "skipped"
		release.Scheduled = nil
		release.WindowLabel = nil
		note := fmt.Sprintf("%s (stub)", reason)
		state.History = append(state.History, HistoryEntry{
			ID: nextUpdatesID(state, "history"), Version: release.Version, FromVersion: updStrp(state.CurrentVersion), Kind: "skip", Result: "skipped",
			StartedAt: at, FinishedAt: &at, ApprovedBy: []ActingUser{}, Note: &note,
		})
		if err := saveUpdates(ctx, rc.CustomerID, state); err != nil {
			return auditlog.AuditedWrite[UpdateReleaseDetail]{}, err
		}
		return auditlog.AuditedWrite[UpdateReleaseDetail]{
			Result: detailOfRelease(release), SummaryEn: fmt.Sprintf("Release %s skipped: %s (%s).", release.Version, reason, updatesStub),
			Detail: map[string]any{"version": release.Version, "reason": reason, "stub": true},
		}, nil
	})
}

// -------------------------------------------------
// Emergency override and recovery.
// -------------------------------------------------

// RequestUpdateEmergencyOverride mirrors
// requestUpdateEmergencyOverride. assumption: needs
// a verified release, the caller as first approver,
// a second different Change Approver; pre-flight is
// skipped for the hotfix.
func RequestUpdateEmergencyOverride(rc reqctx.RequestContext, body any) (UpdateApplyRun, error) {
	return auditlog.WriteWithAudit(context.Background(), rc, updatesWriteGuard(rc, "The emergency override"), auditlog.WriteMeta{Action: "update.emergency_override", EntityType: "update_release", EntityID: rawField(body, "version")}, func(ctx context.Context) (auditlog.AuditedWrite[UpdateApplyRun], error) {
		input, err := datactx.Object(body, "Emergency override", []string{"version", "second_approver_user_id", "reason"})
		if err != nil {
			return auditlog.AuditedWrite[UpdateApplyRun]{}, err
		}
		version, err := datactx.String(input, "version", datactx.StrOpts{Pattern: releaseVersionPattern, Max: 32, HasMax: true})
		if err != nil {
			return auditlog.AuditedWrite[UpdateApplyRun]{}, err
		}
		secondID, err := datactx.UUID(input, "second_approver_user_id")
		if err != nil {
			return auditlog.AuditedWrite[UpdateApplyRun]{}, err
		}
		reason, err := datactx.String(input, "reason", datactx.StrOpts{Min: 20, Max: 1000, HasMin: true, HasMax: true})
		if err != nil {
			return auditlog.AuditedWrite[UpdateApplyRun]{}, err
		}
		state, err := editUpdates(ctx, rc)
		if err != nil {
			return auditlog.AuditedWrite[UpdateApplyRun]{}, err
		}
		if !state.Policy.EmergencyOverrideEnabled {
			return auditlog.AuditedWrite[UpdateApplyRun]{}, dataerr.Forbidden("The change policy switches the emergency override off.")
		}
		if len(strings.TrimSpace(reason)) < state.Policy.EmergencyReasonMinLength {
			return auditlog.AuditedWrite[UpdateApplyRun]{}, dataerr.Invalid(fmt.Sprintf("reason must have at least %d characters.", state.Policy.EmergencyReasonMinLength))
		}
		if secondID == rc.UserID {
			return auditlog.AuditedWrite[UpdateApplyRun]{}, dataerr.Invalid("The emergency override needs two different approvers.")
		}
		users, err := allUsers(ctx, rc.CustomerID)
		if err != nil {
			return auditlog.AuditedWrite[UpdateApplyRun]{}, err
		}
		second, err := oneUser(ctx, rc.CustomerID, secondID)
		if err != nil {
			return auditlog.AuditedWrite[UpdateApplyRun]{}, err
		}
		if second == nil || !isActiveChangeApprover(*second) {
			return auditlog.AuditedWrite[UpdateApplyRun]{}, dataerr.Invalid("second_approver_user_id must be an active Change Approver.")
		}
		release, err := requireUpdateRelease(state, version)
		if err != nil {
			return auditlog.AuditedWrite[UpdateApplyRun]{}, err
		}
		if state.Settings.NotifyOnly {
			return auditlog.AuditedWrite[UpdateApplyRun]{}, dataerr.Conflict("Notify-only mode: the customer's own pipeline applies the chart.")
		}
		if state.AttentionRunID != nil {
			return auditlog.AuditedWrite[UpdateApplyRun]{}, dataerr.Conflict("A previous update needs attention. Resume or restore it first.")
		}
		if release.State != "verified" && release.State != "ready" && release.State != "scheduled" {
			return auditlog.AuditedWrite[UpdateApplyRun]{}, dataerr.Conflict(fmt.Sprintf("Release %s is %s; download and verify it before an emergency override.", release.Version, release.State))
		}
		if !matchesUpgradeFrom(state.CurrentVersion, release.Manifest.UpgradeFrom) {
			return auditlog.AuditedWrite[UpdateApplyRun]{}, dataerr.Conflict(fmt.Sprintf("Upgrading from %s to %s is not allowed.", state.CurrentVersion, release.Version))
		}
		approvedBy := []ActingUser{actingUser(ctx, rc), actingUserOf(second.ID, users, second.DisplayName)}
		run := applyReleaseTo(ctx, rc, state, release, "emergency", approvedBy, fmt.Sprintf("EMERGENCY OVERRIDE outside a change window: %s.", reason))
		if err := saveUpdates(ctx, rc.CustomerID, state); err != nil {
			return auditlog.AuditedWrite[UpdateApplyRun]{}, err
		}
		return auditlog.AuditedWrite[UpdateApplyRun]{
			Result:    *run,
			SummaryEn: fmt.Sprintf("EMERGENCY OVERRIDE (%s): release %s applied outside a change window with two approvers. Reason: %s", updatesStub, release.Version, reason),
			Detail:    map[string]any{"emergency": true, "version": release.Version, "first_approver_user_id": rc.UserID, "second_approver_user_id": second.ID, "reason": reason, "run_id": run.RunID, "state": run.State, "stub": true},
		}, nil
	})
}

// RequestUpdateRecovery mirrors
// requestUpdateRecovery.
func RequestUpdateRecovery(rc reqctx.RequestContext, body any) (UpdateRecoveryResult, error) {
	return auditlog.WriteWithAudit(context.Background(), rc, updatesWriteGuard(rc, "Recovery"), auditlog.WriteMeta{Action: "update.recovery", EntityType: "update_run", EntityID: rawField(body, "run_id")}, func(ctx context.Context) (auditlog.AuditedWrite[UpdateRecoveryResult], error) {
		input, err := datactx.Object(body, "Recovery request", []string{"action", "run_id", "note"})
		if err != nil {
			return auditlog.AuditedWrite[UpdateRecoveryResult]{}, err
		}
		action, err := datactx.EnumOf(input, "action", []string{"rollback", "resume", "restore"})
		if err != nil {
			return auditlog.AuditedWrite[UpdateRecoveryResult]{}, err
		}
		runID, err := datactx.NullableUUID(input, "run_id")
		if err != nil {
			return auditlog.AuditedWrite[UpdateRecoveryResult]{}, err
		}
		note, err := datactx.NullableString(input, "note", datactx.StrOpts{Max: 500, HasMax: true})
		if err != nil {
			return auditlog.AuditedWrite[UpdateRecoveryResult]{}, err
		}
		state, err := editUpdates(ctx, rc)
		if err != nil {
			return auditlog.AuditedWrite[UpdateRecoveryResult]{}, err
		}
		users, err := allUsers(ctx, rc.CustomerID)
		if err != nil {
			return auditlog.AuditedWrite[UpdateRecoveryResult]{}, err
		}
		actor := actingUserOf(rc.UserID, users, string(rc.Role))
		refuse := func(why string) auditlog.AuditedWrite[UpdateRecoveryResult] {
			return auditlog.AuditedWrite[UpdateRecoveryResult]{
				Result:    UpdateRecoveryResult{Action: action, State: "refused"},
				SummaryEn: fmt.Sprintf("Recovery request (%s) refused: %s (%s).", action, why, updatesStub),
				Detail:    map[string]any{"action": action, "refused": true, "why": why, "stub": true},
			}
		}
		var target *UpdateApplyRun
		if runID == nil {
			if state.AttentionRunID != nil {
				target = state.Runs[*state.AttentionRunID]
			}
		} else {
			found, err := datactx.RequireFound(state.Runs[*runID], "Update run")
			if err != nil {
				return auditlog.AuditedWrite[UpdateRecoveryResult]{}, err
			}
			target = found
		}

		if action == "restore" {
			if target == nil || target.State != "needs_attention" {
				return refuse("there is no run that needs attention"), nil
			}
			pending := false
			for _, r := range state.Restores {
				if isPendingRestore(state, r) {
					pending = true
					break
				}
			}
			if pending {
				return refuse("a restore is already requested or in progress"), nil
			}
			request := &RestoreRequest{
				ID: nextUpdatesID(state, "restore"), State: "requested", BackupReference: updStrp(fmt.Sprintf("backup-before-%s", target.Version)),
				RequestedBy: actor, RequestedAt: datactx.NowISO(),
			}
			state.Restores = append(state.Restores, request)
			if state.RestoreMeta == nil {
				state.RestoreMeta = map[string]*restoreMeta{}
			}
			state.RestoreMeta[request.ID] = &restoreMeta{RunID: target.RunID, Version: target.Version, Note: note, Superseded: false}
			if err := saveUpdates(ctx, rc.CustomerID, state); err != nil {
				return auditlog.AuditedWrite[UpdateRecoveryResult]{}, err
			}
			detail := map[string]any{"action": action, "run_id": target.RunID, "restore_request_id": request.ID, "stub": true}
			if note != nil {
				detail["note"] = *note
			}
			return auditlog.AuditedWrite[UpdateRecoveryResult]{
				Result:    UpdateRecoveryResult{Action: action, State: "requested", RestoreRequest: request},
				SummaryEn: fmt.Sprintf("Restore requested for the run of %s; the database team carries it out (%s).", target.Version, updatesStub),
				Detail:    detail,
			}, nil
		}

		if action == "resume" {
			if target == nil || target.State != "needs_attention" {
				return refuse("there is no run that needs attention"), nil
			}
			release, err := requireUpdateRelease(state, target.Version)
			if err != nil {
				return auditlog.AuditedWrite[UpdateRecoveryResult]{}, err
			}
			from := state.CurrentVersion
			run := makeUpdateRun(state, runInput{Kind: "resume", Release: release, Outcome: "resume"})
			state.Runs[run.RunID] = run
			oldRun := *target
			oldRun.State = "failed"
			oldRun.MaintenanceOn = false
			finishedAt := run.StartedAt
			oldRun.FinishedAt = &finishedAt
			oldRun.OfferedRecovery = nil
			state.Runs[target.RunID] = &oldRun
			state.PreviousVersion = updStrp(state.CurrentVersion)
			state.CurrentVersion = release.Version
			release.State = "applied"
			if release.Scheduled != nil {
				sched := *release.Scheduled
				sched.State = "applied"
				release.Scheduled = &sched
			}
			state.AttentionRunID = nil
			state.InMaintenance = false
			state.FallbackActive = false
			// A pending restore does not stop a resume (the
			// caller may prefer the fixed release): dropped.
			for _, request := range state.Restores {
				meta := state.RestoreMeta[request.ID]
				if meta != nil && isPendingRestore(state, request) {
					meta.Superseded = true
				}
			}
			noteText := "Resumed after the fixed release; health checks passed (stub)."
			if note != nil {
				noteText += " " + *note
			}
			finished := run.StartedAt
			if run.FinishedAt != nil {
				finished = *run.FinishedAt
			}
			state.History = append(state.History, HistoryEntry{
				ID: nextUpdatesID(state, "history"), Version: release.Version, FromVersion: updStrp(from), Kind: "resume", Result: "succeeded",
				StartedAt: run.StartedAt, FinishedAt: &finished, ApprovedBy: []ActingUser{actor}, Note: &noteText,
			})
			if err := saveUpdates(ctx, rc.CustomerID, state); err != nil {
				return auditlog.AuditedWrite[UpdateRecoveryResult]{}, err
			}
			return auditlog.AuditedWrite[UpdateRecoveryResult]{
				Result:    UpdateRecoveryResult{Action: action, State: "started", Run: run},
				SummaryEn: fmt.Sprintf("Update %s resumed and finished (%s).", release.Version, updatesStub),
				Detail:    map[string]any{"action": action, "run_id": run.RunID, "stub": true},
			}, nil
		}

		// rollback: back to the recorded previous version.
		if state.PreviousVersion == nil {
			return refuse("no previous version is recorded"), nil
		}
		if state.AttentionRunID != nil {
			return refuse("a run needs attention: resume or request a restore"), nil
		}
		installed, err := requireUpdateRelease(state, state.CurrentVersion)
		if err != nil {
			return auditlog.AuditedWrite[UpdateRecoveryResult]{}, err
		}
		if installed.Manifest.RequiresRestoreToRollback {
			return refuse(fmt.Sprintf("release %s needs a restore to roll back", installed.Version)), nil
		}
		previous := *state.PreviousVersion
		previousRelease, ok := state.Releases[previous]
		if !ok || previousRelease == nil {
			return refuse(fmt.Sprintf("release %s is no longer known", previous)), nil
		}
		from := state.CurrentVersion
		run := makeUpdateRun(state, runInput{Kind: "rollback", Release: previousRelease, Outcome: "rollback"})
		state.Runs[run.RunID] = run
		state.CurrentVersion = previous
		state.PreviousVersion = nil
		installed.State = "available"
		installed.Download = nil
		installed.Preflight = nil
		installed.Scheduled = nil
		installed.BackupConfirmed = false
		installed.WindowLabel = nil
		previousRelease.State = "applied"
		noteText := fmt.Sprintf("Rolled back from %s to %s (stub).", from, previous)
		if note != nil {
			noteText += " " + *note
		}
		finished := run.StartedAt
		if run.FinishedAt != nil {
			finished = *run.FinishedAt
		}
		state.History = append(state.History, HistoryEntry{
			ID: nextUpdatesID(state, "history"), Version: previous, FromVersion: updStrp(from), Kind: "rollback", Result: "succeeded",
			StartedAt: run.StartedAt, FinishedAt: &finished, ApprovedBy: []ActingUser{actor}, Note: &noteText,
		})
		if err := saveUpdates(ctx, rc.CustomerID, state); err != nil {
			return auditlog.AuditedWrite[UpdateRecoveryResult]{}, err
		}
		return auditlog.AuditedWrite[UpdateRecoveryResult]{
			Result:    UpdateRecoveryResult{Action: action, State: "started", Run: run},
			SummaryEn: fmt.Sprintf("Rolled back from %s to %s (%s).", from, previous, updatesStub),
			Detail:    map[string]any{"action": action, "from": from, "to": previous, "run_id": run.RunID, "stub": true},
		}, nil
	})
}

// recoveryViewOf: the latest restore request a
// resume did not overtake. One already completed
// becomes history once another run has started.
func recoveryViewOf(state *updatesState) UpdateRecoveryStatus {
	none := UpdateRecoveryStatus{}
	var request *RestoreRequest
	for i := len(state.Restores) - 1; i >= 0; i-- {
		r := state.Restores[i]
		meta := state.RestoreMeta[r.ID]
		if meta != nil && !meta.Superseded {
			request = r
			break
		}
	}
	if request == nil {
		return none
	}
	meta := state.RestoreMeta[request.ID]
	if meta == nil {
		return none
	}
	completedAt := meta.CompletedAt
	if completedAt != nil {
		if ce, err := datactx.EpochOf(*completedAt); err == nil {
			for _, run := range state.Runs {
				if re, err2 := datactx.EpochOf(run.StartedAt); err2 == nil && !re.Before(ce) {
					return none
				}
			}
		}
	}
	reqState := "completed"
	if request.State != "completed" {
		reqState = string(RestorePhaseOf(ElapsedSince(request.RequestedAt)))
	}
	viewRequest := *request
	viewRequest.State = reqState
	return UpdateRecoveryStatus{RestoreRequest: &viewRequest, RunID: updStrp(meta.RunID), Version: updStrp(meta.Version), Note: meta.Note, CompletedAt: completedAt}
}

// GetUpdateRecovery mirrors getUpdateRecovery: OpenDispatch
// contract only (the agent stub has no such read).
// It moves on with time; the effects on completion
// happen once (currentUpdates applies them, see the
// header).
func GetUpdateRecovery(rc reqctx.RequestContext) (UpdateRecoveryStatus, error) {
	if err := guardUpdatesRead(rc, "The restore request"); err != nil {
		return UpdateRecoveryStatus{}, err
	}
	state, err := currentUpdates(context.Background(), rc)
	if err != nil {
		return UpdateRecoveryStatus{}, err
	}
	return recoveryViewOf(state), nil
}

// -------------------------------------------------
// Settings, connection, offline upload, windows,
// policy.
// -------------------------------------------------

// UpdateUpdateSettings mirrors updateUpdateSettings.
func UpdateUpdateSettings(rc reqctx.RequestContext, body any) (UpdateSettings, error) {
	return auditlog.WriteWithAudit(context.Background(), rc, updatesWriteGuard(rc, "The update settings"), auditlog.WriteMeta{Action: "update.settings_changed", EntityType: "update_settings", EntityID: updStrp("settings")}, func(ctx context.Context) (auditlog.AuditedWrite[UpdateSettings], error) {
		input, err := datactx.Object(body, "Update settings", []string{"channel", "check_interval_hours", "auto_download", "notify_only"})
		if err != nil {
			return auditlog.AuditedWrite[UpdateSettings]{}, err
		}
		channel, err := datactx.EnumOf(input, "channel", updateChannels)
		if err != nil {
			return auditlog.AuditedWrite[UpdateSettings]{}, err
		}
		interval, err := datactx.Int(input, "check_interval_hours", datactx.NumOpts{Min: 1, Max: 168, HasMin: true, HasMax: true})
		if err != nil {
			return auditlog.AuditedWrite[UpdateSettings]{}, err
		}
		autoDownload, err := datactx.Bool(input, "auto_download")
		if err != nil {
			return auditlog.AuditedWrite[UpdateSettings]{}, err
		}
		notifyOnly, err := datactx.Bool(input, "notify_only")
		if err != nil {
			return auditlog.AuditedWrite[UpdateSettings]{}, err
		}
		next := UpdateSettings{Channel: channel, CheckIntervalHours: interval, AutoDownload: autoDownload, NotifyOnly: notifyOnly}
		state, err := editUpdates(ctx, rc)
		if err != nil {
			return auditlog.AuditedWrite[UpdateSettings]{}, err
		}
		before := state.Settings
		state.Settings = next
		if err := saveUpdates(ctx, rc.CustomerID, state); err != nil {
			return auditlog.AuditedWrite[UpdateSettings]{}, err
		}
		return auditlog.AuditedWrite[UpdateSettings]{
			Result: next, SummaryEn: fmt.Sprintf("Update settings changed (%s).", updatesStub),
			Detail: map[string]any{"from": before, "to": next, "stub": true},
		}, nil
	})
}

type proxyWrite struct {
	Enabled  bool
	Address  *string
	Username *string
	Password *string
	CA       *string
}

// UpdateUpdateConnection mirrors
// updateUpdateConnection. The proxy
// password/certificate are never stored or echoed:
// only flags say whether they are set.
func UpdateUpdateConnection(rc reqctx.RequestContext, body any) (UpdateConnectionSettings, error) {
	return auditlog.WriteWithAudit(context.Background(), rc, updatesWriteGuard(rc, "The connection settings"), auditlog.WriteMeta{Action: "update.connection_changed", EntityType: "update_connection", EntityID: updStrp("connection")}, func(ctx context.Context) (auditlog.AuditedWrite[UpdateConnectionSettings], error) {
		input, err := datactx.Object(body, "Connection settings", []string{"mode", "proxy"})
		if err != nil {
			return auditlog.AuditedWrite[UpdateConnectionSettings]{}, err
		}
		mode, err := datactx.EnumOf(input, "mode", updateModes)
		if err != nil {
			return auditlog.AuditedWrite[UpdateConnectionSettings]{}, err
		}
		var write *proxyWrite
		if datactx.Has(input, "proxy") {
			p, err := datactx.Object(input["proxy"], "Proxy", []string{"enabled", "address", "username", "password", "ca_certificate_pem"})
			if err != nil {
				return auditlog.AuditedWrite[UpdateConnectionSettings]{}, err
			}
			enabled, err := datactx.Bool(p, "enabled")
			if err != nil {
				return auditlog.AuditedWrite[UpdateConnectionSettings]{}, err
			}
			address, err := datactx.NullableString(p, "address", datactx.StrOpts{Max: 300, HasMax: true})
			if err != nil {
				return auditlog.AuditedWrite[UpdateConnectionSettings]{}, err
			}
			if err := checkProxy(proxyState{Enabled: enabled, Address: address}); err != nil {
				return auditlog.AuditedWrite[UpdateConnectionSettings]{}, err
			}
			password, hasPassword, err := datactx.OptString(p, "password", datactx.StrOpts{Max: 512, HasMax: true})
			if err != nil {
				return auditlog.AuditedWrite[UpdateConnectionSettings]{}, err
			}
			ca, hasCA, err := datactx.OptString(p, "ca_certificate_pem", datactx.StrOpts{Max: 20000, HasMax: true})
			if err != nil {
				return auditlog.AuditedWrite[UpdateConnectionSettings]{}, err
			}
			username, err := datactx.NullableString(p, "username", datactx.StrOpts{Max: 120, HasMax: true})
			if err != nil {
				return auditlog.AuditedWrite[UpdateConnectionSettings]{}, err
			}
			write = &proxyWrite{Enabled: enabled, Address: address, Username: username}
			if hasPassword {
				write.Password = &password
			}
			if hasCA {
				write.CA = &ca
			}
		}
		state, err := editUpdates(ctx, rc)
		if err != nil {
			return auditlog.AuditedWrite[UpdateConnectionSettings]{}, err
		}
		before := map[string]any{"mode": state.ConnectionMode, "proxy_enabled": state.Proxy.Enabled}
		state.ConnectionMode = mode
		if write != nil {
			hasPassword := state.Proxy.HasPassword
			if write.Password != nil {
				hasPassword = *write.Password != ""
			}
			hasCA := state.Proxy.HasCACertificate
			if write.CA != nil {
				hasCA = *write.CA != ""
			}
			state.Proxy = proxyState{Enabled: write.Enabled, Address: write.Address, Username: write.Username, HasPassword: hasPassword, HasCACertificate: hasCA}
		}
		if err := saveUpdates(ctx, rc.CustomerID, state); err != nil {
			return auditlog.AuditedWrite[UpdateConnectionSettings]{}, err
		}
		proxySuffix := ""
		if state.Proxy.Enabled {
			proxySuffix = " through a proxy"
		}
		return auditlog.AuditedWrite[UpdateConnectionSettings]{
			Result: connectionViewOf(state), SummaryEn: fmt.Sprintf("Connection changed to %s%s (%s).", mode, proxySuffix, updatesStub),
			Detail: map[string]any{"from": before, "to": map[string]any{"mode": mode, "proxy_enabled": state.Proxy.Enabled}, "stub": true},
		}, nil
	})
}

// TestUpdateConnection mirrors testUpdateConnection.
func TestUpdateConnection(rc reqctx.RequestContext) (UpdateConnectionTestResult, error) {
	return auditlog.WriteWithAudit(context.Background(), rc, updatesWriteGuard(rc, "The connection test"), auditlog.WriteMeta{Action: "update.connection_tested", EntityType: "update_connection", EntityID: updStrp("connection")}, func(ctx context.Context) (auditlog.AuditedWrite[UpdateConnectionTestResult], error) {
		state, err := editUpdates(ctx, rc)
		if err != nil {
			return auditlog.AuditedWrite[UpdateConnectionTestResult]{}, err
		}
		checkedAt := datactx.NowISO()
		var result UpdateConnectionTestResult
		if state.ConnectionMode == "offline" {
			result = UpdateConnectionTestResult{OK: false, CheckedAt: checkedAt, Steps: []UpdateConnectionTestStep{
				{Name: "dns", OK: false, Message: updStrp("Offline mode: the agent makes no outbound connection. Upload an update file instead.")},
			}}
		} else if state.Proxy.Enabled && (state.Proxy.Address == nil || *state.Proxy.Address == "") {
			result = UpdateConnectionTestResult{OK: false, CheckedAt: checkedAt, Steps: []UpdateConnectionTestStep{
				{Name: "proxy", OK: false, Message: updStrp("The proxy is enabled but has no address.")},
			}}
		} else {
			proxyMsg := "No proxy in use."
			if state.Proxy.Enabled {
				proxyMsg = "Proxy reachable (stub)."
			}
			result = UpdateConnectionTestResult{OK: true, CheckedAt: checkedAt, Steps: []UpdateConnectionTestStep{
				{Name: "proxy", OK: true, Message: &proxyMsg},
				{Name: "dns", OK: true, Message: updStrp("updates.opendispatch.example resolves (stub).")},
				{Name: "tcp", OK: true, Message: updStrp("Port 443 reachable (stub).")},
				{Name: "tls", OK: true, Message: updStrp("TLS handshake succeeded (stub).")},
				{Name: "release_index_signature", OK: true, Message: updStrp("Release index signature is valid (stub).")},
			}}
			state.LastContactAt = &checkedAt
		}
		if result.OK {
			state.LastContactResult = updStrp("ok")
		} else {
			state.LastContactResult = updStrp("failed")
		}
		if err := saveUpdates(ctx, rc.CustomerID, state); err != nil {
			return auditlog.AuditedWrite[UpdateConnectionTestResult]{}, err
		}
		verb := "failed"
		if result.OK {
			verb = "passed"
		}
		return auditlog.AuditedWrite[UpdateConnectionTestResult]{
			Result: result, SummaryEn: fmt.Sprintf("Connection test %s (%s).", verb, updatesStub),
			Detail: map[string]any{"ok": result.OK, "stub": true},
		}, nil
	})
}

var offlineVersionPattern = regexp.MustCompile(`\d+\.\d+\.\d+`)

// UploadOfflineUpdate mirrors uploadOfflineUpdate.
// The `file` string stands for the signed update
// file. assumption (scripted verification): the
// first x.y.z in it is the version;
// "tampered"/"invalid" fail signature and digests,
// "revoked" marks the key revoked, and a version not
// newer than installed is refused. The content is
// never stored or audited.
func UploadOfflineUpdate(rc reqctx.RequestContext, body any) (UpdateOfflineUploadResult, error) {
	return auditlog.WriteWithAudit(context.Background(), rc, updatesWriteGuard(rc, "The offline upload"), auditlog.WriteMeta{Action: "update.offline_upload", EntityType: "update_upload"}, func(ctx context.Context) (auditlog.AuditedWrite[UpdateOfflineUploadResult], error) {
		input, err := datactx.Object(body, "Offline upload", []string{"file"})
		if err != nil {
			return auditlog.AuditedWrite[UpdateOfflineUploadResult]{}, err
		}
		file, err := datactx.String(input, "file", datactx.StrOpts{Min: 1, Max: 2_000_000, HasMin: true, HasMax: true})
		if err != nil {
			return auditlog.AuditedWrite[UpdateOfflineUploadResult]{}, err
		}
		state, err := editUpdates(ctx, rc)
		if err != nil {
			return auditlog.AuditedWrite[UpdateOfflineUploadResult]{}, err
		}
		if state.ConnectionMode != "offline" {
			return auditlog.AuditedWrite[UpdateOfflineUploadResult]{}, dataerr.Conflict("Switch the connection mode to offline to upload an update file.")
		}
		match := offlineVersionPattern.FindString(file)
		hasVersion := match != ""
		lower := strings.ToLower(file)
		tampered := !hasVersion || strings.Contains(lower, "tampered") || strings.Contains(lower, "invalid")
		revoked := !tampered && strings.Contains(lower, "revoked")
		older := hasVersion && compareVersions(match, state.CurrentVersion) <= 0
		ok := hasVersion && !tampered && !revoked && !older
		var message string
		switch {
		case !hasVersion:
			message = "The file is not a signed OpenDispatch release: no version found."
		case tampered:
			message = "The signature or an image digest does not match. The file was discarded."
		case revoked:
			message = "The file is signed with a revoked key. It was discarded."
		case older:
			message = fmt.Sprintf("Version %s is not newer than the installed %s. It was discarded.", match, state.CurrentVersion)
		default:
			message = fmt.Sprintf("Signature and image digests verified for %s (stub: nothing was actually checked).", match)
		}
		result := UpdateOfflineUploadResult{
			UploadID: nextUpdatesID(state, "upload"), UploadedAt: datactx.NowISO(), Accepted: ok,
			Verification: VerificationResult{
				Verified: ok, SignatureValid: !tampered, DigestsMatch: !tampered, KeyRevoked: revoked, OlderThanInstalled: older,
				IndexExpired: false, KeyID: updStrp(updatesKeyID), Message: &message,
			},
		}
		if ok && hasVersion {
			release, exists := state.Releases[match]
			if !exists {
				major := parseVersion(match)[0]
				spec := releaseSpec{
					Version: match, Channel: "stable", Kind: "application", State: "verified", PublishedAt: result.UploadedAt,
					NeedsDowntime: false, RequiresRestoreToRollback: false, UpgradeFrom: []string{fmt.Sprintf("%d.x.x", major)},
					Images:   []string{"web", "api", "worker"},
					NotesEn:  fmt.Sprintf("Offline update %s uploaded by hand. Scripted to succeed. (stub)", match),
					NotesAr:  fmt.Sprintf("تحديث غير متصل %s تم رفعه يدويًا. مبرمج للنجاح. (نسخة تجريبية)", match),
					Scripted: "success",
				}
				release = buildRelease(spec)
				release.Source = "offline"
				state.Releases[match] = release
			} else if release.State == "available" || release.State == "skipped" || release.State == "withdrawn" || release.State == "rejected" {
				release.State = "verified"
				release.DownloadJob = nil
				release.Scheduled = nil
				release.Preflight = nil
				release.BackupConfirmed = false
			}
			if release.State == "verified" {
				dl := verifiedDownloadOf(release)
				release.Download = &dl
			}
			summary := summaryOfRelease(release)
			result.Release = &summary
		} else {
			raiseNotification(ctx, rc, "update_failed", RaisedNotification{TitleEn: "An offline update file was discarded", BodyEn: &message, LinkPath: updStrp("/admin/updates")})
		}
		state.Uploads[result.UploadID] = &result
		if err := saveUpdates(ctx, rc.CustomerID, state); err != nil {
			return auditlog.AuditedWrite[UpdateOfflineUploadResult]{}, err
		}
		detail := map[string]any{"accepted": result.Accepted, "stub": true}
		if hasVersion {
			detail["version"] = match
		}
		verb := "refused"
		if result.Accepted {
			verb = "accepted"
		}
		return auditlog.AuditedWrite[UpdateOfflineUploadResult]{
			Result: result, EntityID: updStrp(result.UploadID),
			SummaryEn: fmt.Sprintf("Offline update file %s (%s): %s", verb, updatesStub, message),
			Detail:    detail,
		}, nil
	})
}

func uniqueSortedInts(xs []int) []int {
	seen := map[int]bool{}
	var out []int
	for _, x := range xs {
		if !seen[x] {
			seen[x] = true
			out = append(out, x)
		}
	}
	sort.Ints(out)
	return out
}

// UpdateUpdateChangeWindows mirrors
// updateUpdateChangeWindows.
func UpdateUpdateChangeWindows(rc reqctx.RequestContext, body any) (UpdateChangeWindows, error) {
	return auditlog.WriteWithAudit(context.Background(), rc, updatesWriteGuard(rc, "The change windows"), auditlog.WriteMeta{Action: "update.windows_changed", EntityType: "update_change_windows", EntityID: updStrp("change_windows")}, func(ctx context.Context) (auditlog.AuditedWrite[UpdateChangeWindows], error) {
		input, err := datactx.Object(body, "Change windows", []string{"recurring", "blackouts"})
		if err != nil {
			return auditlog.AuditedWrite[UpdateChangeWindows]{}, err
		}
		recurringRaw, ok1 := input["recurring"].([]any)
		blackoutsRaw, ok2 := input["blackouts"].([]any)
		if !ok1 || !ok2 {
			return auditlog.AuditedWrite[UpdateChangeWindows]{}, dataerr.Invalid("Change windows: recurring and blackouts must be lists.")
		}
		if len(recurringRaw) > 50 || len(blackoutsRaw) > 200 {
			return auditlog.AuditedWrite[UpdateChangeWindows]{}, dataerr.Invalid("Change windows: too many entries.")
		}
		recurring := make([]RecurringWindow, len(recurringRaw))
		for i, raw := range recurringRaw {
			o, err := datactx.Object(raw, "Recurring window", []string{"label", "days_of_week", "start_time", "end_time"})
			if err != nil {
				return auditlog.AuditedWrite[UpdateChangeWindows]{}, err
			}
			days, err := readDaysOfWeek(o)
			if err != nil {
				return auditlog.AuditedWrite[UpdateChangeWindows]{}, err
			}
			label, err := datactx.String(o, "label", datactx.StrOpts{Min: 1, Max: 120, HasMin: true, HasMax: true})
			if err != nil {
				return auditlog.AuditedWrite[UpdateChangeWindows]{}, err
			}
			start, err := datactx.Time(o, "start_time")
			if err != nil {
				return auditlog.AuditedWrite[UpdateChangeWindows]{}, err
			}
			end, err := datactx.Time(o, "end_time")
			if err != nil {
				return auditlog.AuditedWrite[UpdateChangeWindows]{}, err
			}
			recurring[i] = RecurringWindow{ID: recurringWindowID(label, days, start, end), Label: label, DaysOfWeek: uniqueSortedInts(days), StartTime: start, EndTime: end}
		}
		months := allHijriMonths()
		blackouts := make([]Blackout, len(blackoutsRaw))
		for i, raw := range blackoutsRaw {
			b, err := readBlackout(raw, months)
			if err != nil {
				return auditlog.AuditedWrite[UpdateChangeWindows]{}, err
			}
			blackouts[i] = b
		}
		state, err := editUpdates(ctx, rc)
		if err != nil {
			return auditlog.AuditedWrite[UpdateChangeWindows]{}, err
		}
		state.Recurring = recurring
		state.Blackouts = blackouts
		if err := saveUpdates(ctx, rc.CustomerID, state); err != nil {
			return auditlog.AuditedWrite[UpdateChangeWindows]{}, err
		}
		return auditlog.AuditedWrite[UpdateChangeWindows]{
			Result:    changeWindowsViewOf(state, updatesToday(ctx, rc.CustomerID)),
			SummaryEn: fmt.Sprintf("Change windows replaced: %d recurring, %d blackout period(s) (%s).", len(recurring), len(blackouts), updatesStub),
			Detail:    map[string]any{"recurring": len(recurring), "blackouts": len(blackouts), "stub": true},
		}, nil
	})
}

// UpdateUpdateChangePolicy mirrors
// updateUpdateChangePolicy. assumption: when a
// second approver is required, at least two must be
// listed.
func UpdateUpdateChangePolicy(rc reqctx.RequestContext, body any) (UpdateChangePolicy, error) {
	return auditlog.WriteWithAudit(context.Background(), rc, updatesWriteGuard(rc, "The change policy"), auditlog.WriteMeta{Action: "update.policy_changed", EntityType: "update_change_policy", EntityID: updStrp("change_policy")}, func(ctx context.Context) (auditlog.AuditedWrite[UpdateChangePolicy], error) {
		input, err := datactx.Object(body, "Change policy", []string{"approver_user_ids", "second_approver_required", "emergency_override_enabled", "emergency_reason_min_length"})
		if err != nil {
			return auditlog.AuditedWrite[UpdateChangePolicy]{}, err
		}
		ids, err := datactx.UUIDList(input, "approver_user_ids", false)
		if err != nil {
			return auditlog.AuditedWrite[UpdateChangePolicy]{}, err
		}
		secondRequired, err := datactx.Bool(input, "second_approver_required")
		if err != nil {
			return auditlog.AuditedWrite[UpdateChangePolicy]{}, err
		}
		overrideEnabled, err := datactx.Bool(input, "emergency_override_enabled")
		if err != nil {
			return auditlog.AuditedWrite[UpdateChangePolicy]{}, err
		}
		minLength, err := datactx.Int(input, "emergency_reason_min_length", datactx.NumOpts{Min: 20, Max: 1000, HasMin: true, HasMax: true})
		if err != nil {
			return auditlog.AuditedWrite[UpdateChangePolicy]{}, err
		}
		next := UpdateChangePolicy{ApproverUserIDs: ids, SecondApproverRequired: secondRequired, EmergencyOverrideEnabled: overrideEnabled, EmergencyReasonMinLength: minLength}
		if err := requireChangeApprovers(ctx, rc, ids); err != nil {
			return auditlog.AuditedWrite[UpdateChangePolicy]{}, err
		}
		if err := checkPolicy(next); err != nil {
			return auditlog.AuditedWrite[UpdateChangePolicy]{}, err
		}
		state, err := editUpdates(ctx, rc)
		if err != nil {
			return auditlog.AuditedWrite[UpdateChangePolicy]{}, err
		}
		before := state.Policy
		state.Policy = next
		if err := saveUpdates(ctx, rc.CustomerID, state); err != nil {
			return auditlog.AuditedWrite[UpdateChangePolicy]{}, err
		}
		result := next
		result.ApproverUserIDs = cloneStrSlice(ids)
		return auditlog.AuditedWrite[UpdateChangePolicy]{
			Result: result, SummaryEn: fmt.Sprintf("Change policy changed (%s).", updatesStub),
			Detail: map[string]any{"from": before, "to": next, "stub": true},
		}, nil
	})
}
