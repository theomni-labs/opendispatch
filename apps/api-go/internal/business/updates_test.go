// SPDX-License-Identifier: AGPL-3.0-only

// Ports the five scripted scenarios of
// updates.test.ts (no live Postgres: settingsstore,
// auditlog and the in-memory user store are all
// reset per test).
package business

import (
	"context"
	"strings"
	"testing"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/access"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/auditlog"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/dataerr"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/reqctx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/settingsstore"
)

// resetUpdatesTest: a fresh admin ctx and a Change
// Approver ctx/user, at the instant download pace.
func resetUpdatesTest(t *testing.T) (reqctx.RequestContext, reqctx.RequestContext, string) {
	t.Helper()
	settingsstore.ResetForTest()
	ResetUsersForTest()
	auditlog.ResetForTest()
	tenant := "t1"
	now := datactx.NowISO()
	approverID := datactx.DeterministicUUID("test:updates:approver1")
	upsertUserRow(User{
		BaseRecord:   datactx.BaseRecord{ID: approverID, TenantID: tenant, CreatedAt: now, UpdatedAt: now, DataSource: "SYNTHETIC"},
		Email:        "approver1@demo.example",
		DisplayName:  "Saad Al-Nabari",
		AssignedRole: access.RoleChangeApprover,
		Status:       "active",
	})
	_ = settingsstore.Put(context.Background(), "", DownloadPaceSetting, "instant")
	admin := roleCtx(tenant, "admin-user", access.RoleAdministrator)
	approver := roleCtx(tenant, approverID, access.RoleChangeApprover)
	return admin, approver, approverID
}

func wantCode(t *testing.T, err error, code dataerr.Code, label string) {
	t.Helper()
	if err == nil {
		t.Fatalf("%s: want error %s, got nil", label, code)
	}
	de, ok := err.(*dataerr.DataError)
	if !ok {
		t.Fatalf("%s: want *dataerr.DataError, got %T (%v)", label, err, err)
	}
	if de.Code != code {
		t.Fatalf("%s: want code %s, got %s (%v)", label, code, de.Code, err)
	}
}

func checkOK(t *testing.T, err error, label string) {
	t.Helper()
	if err != nil {
		t.Fatalf("%s: unexpected error: %v", label, err)
	}
}

// driveUpdateToApproved: download, confirm the
// backup (re-runs pre-flight), schedule, approve.
func driveUpdateToApproved(t *testing.T, admin, approver reqctx.RequestContext, version string) {
	t.Helper()
	_, err := StartUpdateDownload(admin, version)
	checkOK(t, err, "StartUpdateDownload")
	_, err = ConfirmUpdateBackup(admin, version, map[string]any{})
	checkOK(t, err, "ConfirmUpdateBackup")
	_, err = ScheduleUpdate(admin, version, map[string]any{})
	checkOK(t, err, "ScheduleUpdate")
	_, err = ApproveUpdate(approver, version, map[string]any{"note": "Approved."})
	checkOK(t, err, "ApproveUpdate")
}

// Run 1.2.0: succeeds, health checks pass.
func TestUpdates_Run1_SuccessFlow(t *testing.T) {
	admin, approver, _ := resetUpdatesTest(t)

	checked, err := CheckForUpdatesNow(admin)
	checkOK(t, err, "CheckForUpdatesNow")
	if checked.LastCheckResult == nil || *checked.LastCheckResult != "update_found" {
		t.Fatalf("LastCheckResult = %v, want update_found", checked.LastCheckResult)
	}

	download, err := StartUpdateDownload(admin, "1.2.0")
	checkOK(t, err, "StartUpdateDownload")
	if download.State != "verified" || download.Verification == nil || !download.Verification.Verified {
		t.Fatalf("download = %+v, want verified", download)
	}
	rel, err := GetUpdateRelease(admin, "1.2.0")
	checkOK(t, err, "GetUpdateRelease")
	if rel.Summary.State != "verified" {
		t.Fatalf("release state = %s, want verified", rel.Summary.State)
	}
	if _, err := StartUpdateDownload(admin, "1.2.0"); true {
		wantCode(t, err, dataerr.CodeConflict, "StartUpdateDownload again")
	}

	pre, err := RunUpdatePreflight(admin, "1.2.0")
	checkOK(t, err, "RunUpdatePreflight")
	if pre.State != "failed" {
		t.Fatalf("preflight state = %s, want failed", pre.State)
	}
	var backupStatus string
	for _, c := range pre.Checks {
		if c.ID == "recent_backup" {
			backupStatus = c.Status
		}
	}
	if backupStatus != "needs_confirmation" {
		t.Fatalf("recent_backup status = %s, want needs_confirmation", backupStatus)
	}
	if _, err := ScheduleUpdate(admin, "1.2.0", map[string]any{}); true {
		wantCode(t, err, dataerr.CodeConflict, "ScheduleUpdate before ready")
	}

	confirmed, err := ConfirmUpdateBackup(admin, "1.2.0", map[string]any{"note": "Backup taken at 02:00."})
	checkOK(t, err, "ConfirmUpdateBackup")
	if confirmed.State != "passed" {
		t.Fatalf("preflight after confirm = %s, want passed", confirmed.State)
	}
	status, err := GetUpdateStatus(admin)
	checkOK(t, err, "GetUpdateStatus")
	if status.State != "ready" || status.ReadyReleaseVersion == nil || *status.ReadyReleaseVersion != "1.2.0" {
		t.Fatalf("status = %+v, want ready/1.2.0", status)
	}

	scheduled, err := ScheduleUpdate(admin, "1.2.0", map[string]any{})
	checkOK(t, err, "ScheduleUpdate")
	if scheduled.WindowStart != "2026-09-14T03:00:00+03:00" || scheduled.State != "awaiting_approval" {
		t.Fatalf("scheduled = %+v, want 2026-09-14T03:00:00+03:00/awaiting_approval", scheduled)
	}
	if _, err := ApplyUpdate(admin, "1.2.0"); true {
		wantCode(t, err, dataerr.CodeConflict, "ApplyUpdate before approved")
	}

	approved, err := ApproveUpdate(approver, "1.2.0", map[string]any{"note": "Go."})
	checkOK(t, err, "ApproveUpdate")
	if approved.State != "approved" || len(approved.Approvals) != 1 {
		t.Fatalf("approved = %+v, want approved/1 approval", approved)
	}

	run, err := ApplyUpdate(admin, "1.2.0")
	checkOK(t, err, "ApplyUpdate")
	if run.State != "succeeded" || run.HealthCheckPassed == nil || !*run.HealthCheckPassed || run.MaintenanceOn || run.LiveAssignmentFallback {
		t.Fatalf("run = %+v, want succeeded/health-passed/no-maintenance/no-fallback", run)
	}
	got, err := GetUpdateRun(admin, run.RunID)
	checkOK(t, err, "GetUpdateRun")
	if got.State != run.State {
		t.Fatalf("GetUpdateRun state = %s, want %s", got.State, run.State)
	}

	status, err = GetUpdateStatus(admin)
	checkOK(t, err, "GetUpdateStatus")
	if status.CurrentVersion != "1.2.0" || status.PreviousVersion == nil || *status.PreviousVersion != "1.1.0" || status.State != "idle" || status.ReadyReleaseVersion != nil {
		t.Fatalf("final status = %+v", status)
	}
	rel, err = GetUpdateRelease(admin, "1.2.0")
	checkOK(t, err, "GetUpdateRelease")
	if rel.Summary.State != "applied" || rel.Scheduled == nil || rel.Scheduled.State != "applied" {
		t.Fatalf("final release = %+v", rel)
	}
	history, err := ListUpdateHistory(admin, UpdateHistoryQuery{})
	checkOK(t, err, "ListUpdateHistory")
	if len(history.Items) == 0 || history.Items[0].Version != "1.2.0" || history.Items[0].FromVersion == nil || *history.Items[0].FromVersion != "1.1.0" || history.Items[0].Result != "succeeded" {
		t.Fatalf("history[0] = %+v", history.Items[0])
	}
}

func TestUpdates_Run1_RefusesStepsOutOfOrder(t *testing.T) {
	admin, approver, _ := resetUpdatesTest(t)
	_, err := RunUpdatePreflight(admin, "1.2.0")
	wantCode(t, err, dataerr.CodeConflict, "RunUpdatePreflight")
	_, err = ScheduleUpdate(admin, "1.2.0", map[string]any{})
	wantCode(t, err, dataerr.CodeConflict, "ScheduleUpdate")
	_, err = ApplyUpdate(admin, "1.2.0")
	wantCode(t, err, dataerr.CodeConflict, "ApplyUpdate")
	_, err = ApproveUpdate(approver, "1.2.0", map[string]any{})
	wantCode(t, err, dataerr.CodeConflict, "ApproveUpdate")
}

// Run 1.3.0: the smoke test fails and the system
// rolls back itself.
func TestUpdates_Run2_HealthCheckFailsRollsBack(t *testing.T) {
	admin, approver, _ := resetUpdatesTest(t)
	driveUpdateToApproved(t, admin, approver, "1.3.0")

	run, err := ApplyUpdate(admin, "1.3.0")
	checkOK(t, err, "ApplyUpdate")
	if run.State != "rolled_back" || run.HealthCheckPassed == nil || *run.HealthCheckPassed || run.MaintenanceOn || !run.LiveAssignmentFallback {
		t.Fatalf("run = %+v, want rolled_back/health-failed/fallback", run)
	}

	status, err := GetUpdateStatus(admin)
	checkOK(t, err, "GetUpdateStatus")
	if status.CurrentVersion != "1.1.0" || status.PreviousVersion == nil || *status.PreviousVersion != "1.0.0" || status.State != "idle" || status.InMaintenance {
		t.Fatalf("status after rollback = %+v", status)
	}
	rel, err := GetUpdateRelease(admin, "1.3.0")
	checkOK(t, err, "GetUpdateRelease")
	if rel.Summary.State != "available" || rel.Scheduled != nil {
		t.Fatalf("release after rollback = %+v", rel)
	}
	history, err := ListUpdateHistory(admin, UpdateHistoryQuery{})
	checkOK(t, err, "ListUpdateHistory")
	entry := history.Items[0]
	if entry.Version != "1.3.0" || entry.Result != "rolled_back" || entry.Note == nil || !strings.Contains(*entry.Note, "rolled back by itself") {
		t.Fatalf("history[0] = %+v", entry)
	}
}

// Run 1.4.0: arrives as an offline file and is
// verified.
func TestUpdates_Run3_OfflineUploadVerified(t *testing.T) {
	admin, approver, _ := resetUpdatesTest(t)

	_, err := UploadOfflineUpdate(admin, map[string]any{"file": "opendispatch-release-1.4.0.bundle"})
	wantCode(t, err, dataerr.CodeConflict, "UploadOfflineUpdate before offline mode")

	connection, err := UpdateUpdateConnection(admin, map[string]any{"mode": "offline"})
	checkOK(t, err, "UpdateUpdateConnection")
	if connection.Mode != "offline" || len(connection.AllowedEndpoints) != 0 {
		t.Fatalf("connection = %+v", connection)
	}
	_, err = CheckForUpdatesNow(admin)
	wantCode(t, err, dataerr.CodeConflict, "CheckForUpdatesNow while offline")
	_, err = StartUpdateDownload(admin, "1.2.0")
	wantCode(t, err, dataerr.CodeConflict, "StartUpdateDownload while offline")

	upload, err := UploadOfflineUpdate(admin, map[string]any{"file": "opendispatch-release-1.4.0.bundle"})
	checkOK(t, err, "UploadOfflineUpdate")
	if !upload.Accepted || !upload.Verification.Verified || upload.Release == nil || upload.Release.Version != "1.4.0" || upload.Release.State != "verified" {
		t.Fatalf("upload = %+v", upload)
	}
	got, err := GetOfflineUpdateUpload(admin, upload.UploadID)
	checkOK(t, err, "GetOfflineUpdateUpload")
	if got.UploadID != upload.UploadID || !got.Accepted {
		t.Fatalf("GetOfflineUpdateUpload = %+v", got)
	}
	list, err := ListUpdateReleases(admin, datactx.PageQuery{})
	checkOK(t, err, "ListUpdateReleases")
	if len(list.Items) == 0 || list.Items[0].Version != "1.4.0" {
		t.Fatalf("release list[0] = %+v, want 1.4.0", list.Items[0])
	}
	dl, err := GetUpdateDownloadState(admin, "1.4.0")
	checkOK(t, err, "GetUpdateDownloadState")
	if dl.State != "verified" {
		t.Fatalf("download state = %s, want verified", dl.State)
	}

	_, err = ConfirmUpdateBackup(admin, "1.4.0", map[string]any{})
	checkOK(t, err, "ConfirmUpdateBackup")
	_, err = ScheduleUpdate(admin, "1.4.0", map[string]any{})
	checkOK(t, err, "ScheduleUpdate")
	_, err = ApproveUpdate(approver, "1.4.0", map[string]any{})
	checkOK(t, err, "ApproveUpdate")
	run, err := ApplyUpdate(admin, "1.4.0")
	checkOK(t, err, "ApplyUpdate")
	if run.State != "succeeded" || run.HealthCheckPassed == nil || !*run.HealthCheckPassed {
		t.Fatalf("run = %+v, want succeeded", run)
	}
	status, err := GetUpdateStatus(admin)
	checkOK(t, err, "GetUpdateStatus")
	if status.CurrentVersion != "1.4.0" {
		t.Fatalf("current version = %s, want 1.4.0", status.CurrentVersion)
	}
}

func TestUpdates_Run3_OfflineUploadRefusals(t *testing.T) {
	admin, _, _ := resetUpdatesTest(t)
	_, err := UpdateUpdateConnection(admin, map[string]any{"mode": "offline"})
	checkOK(t, err, "UpdateUpdateConnection")

	tampered, err := UploadOfflineUpdate(admin, map[string]any{"file": "opendispatch-release-1.4.0-tampered.bundle"})
	checkOK(t, err, "UploadOfflineUpdate tampered")
	if tampered.Accepted || tampered.Verification.Verified || tampered.Verification.SignatureValid || tampered.Verification.DigestsMatch || tampered.Release != nil {
		t.Fatalf("tampered = %+v", tampered)
	}
	revoked, err := UploadOfflineUpdate(admin, map[string]any{"file": "opendispatch-release-1.4.0-revoked-key.bundle"})
	checkOK(t, err, "UploadOfflineUpdate revoked")
	if revoked.Accepted || revoked.Verification.Verified || !revoked.Verification.SignatureValid || !revoked.Verification.KeyRevoked {
		t.Fatalf("revoked = %+v", revoked)
	}
	older, err := UploadOfflineUpdate(admin, map[string]any{"file": "opendispatch-release-1.1.0.bundle"})
	checkOK(t, err, "UploadOfflineUpdate older")
	if older.Accepted || !older.Verification.OlderThanInstalled {
		t.Fatalf("older = %+v", older)
	}
	junk, err := UploadOfflineUpdate(admin, map[string]any{"file": "not a release"})
	checkOK(t, err, "UploadOfflineUpdate junk")
	if junk.Accepted {
		t.Fatalf("junk = %+v, want refused", junk)
	}
	list, err := ListUpdateReleases(admin, datactx.PageQuery{})
	checkOK(t, err, "ListUpdateReleases")
	for _, r := range list.Items {
		if r.Version == "1.4.0" {
			t.Fatalf("1.4.0 should not have been kept as a release")
		}
	}
	_, err = UploadOfflineUpdate(admin, map[string]any{"file": ""})
	wantCode(t, err, dataerr.CodeInvalid, "UploadOfflineUpdate empty file")
}

// 1.3.1: a non-transactional migration fails
// partway; stops in maintenance, then resumes.
func TestUpdates_Recovery_MigrationFailsThenResume(t *testing.T) {
	admin, approver, _ := resetUpdatesTest(t)
	driveUpdateToApproved(t, admin, approver, "1.3.1")

	failed, err := ApplyUpdate(admin, "1.3.1")
	checkOK(t, err, "ApplyUpdate")
	if failed.State != "needs_attention" || !failed.MaintenanceOn || !failed.LiveAssignmentFallback || failed.HealthCheckPassed != nil {
		t.Fatalf("failed run = %+v", failed)
	}
	if len(failed.OfferedRecovery) != 2 || failed.OfferedRecovery[0] != "resume" || failed.OfferedRecovery[1] != "restore" {
		t.Fatalf("offered_recovery = %v, want [resume restore]", failed.OfferedRecovery)
	}
	status, err := GetUpdateStatus(admin)
	checkOK(t, err, "GetUpdateStatus")
	if status.State != "needs_attention" || status.CurrentVersion != "1.1.0" || !status.InMaintenance {
		t.Fatalf("status after failure = %+v", status)
	}

	restore, err := RequestUpdateRecovery(admin, map[string]any{"action": "restore", "run_id": failed.RunID, "note": "Please restore."})
	checkOK(t, err, "RequestUpdateRecovery restore")
	if restore.Action != "restore" || restore.State != "requested" || restore.RestoreRequest == nil || restore.RestoreRequest.State != "requested" {
		t.Fatalf("restore result = %+v", restore)
	}
	if restore.RestoreRequest.BackupReference == nil || *restore.RestoreRequest.BackupReference != "backup-before-1.3.1" {
		t.Fatalf("backup_reference = %v", restore.RestoreRequest.BackupReference)
	}
	run, err := GetUpdateRun(admin, failed.RunID)
	checkOK(t, err, "GetUpdateRun")
	if run.State != "needs_attention" {
		t.Fatalf("run state after restore request = %s, want needs_attention", run.State)
	}

	resumed, err := RequestUpdateRecovery(admin, map[string]any{"action": "resume"})
	checkOK(t, err, "RequestUpdateRecovery resume")
	if resumed.State != "started" || resumed.Run == nil || resumed.Run.Kind != "resume" || resumed.Run.Version != "1.3.1" || resumed.Run.State != "succeeded" {
		t.Fatalf("resumed = %+v", resumed)
	}
	run, err = GetUpdateRun(admin, failed.RunID)
	checkOK(t, err, "GetUpdateRun")
	if run.State != "failed" {
		t.Fatalf("original run state after resume = %s, want failed", run.State)
	}
	status, err = GetUpdateStatus(admin)
	checkOK(t, err, "GetUpdateStatus")
	if status.CurrentVersion != "1.3.1" || status.PreviousVersion == nil || *status.PreviousVersion != "1.1.0" || status.InMaintenance {
		t.Fatalf("status after resume = %+v", status)
	}

	refused, err := RequestUpdateRecovery(admin, map[string]any{"action": "rollback"})
	checkOK(t, err, "RequestUpdateRecovery rollback")
	if refused.State != "refused" {
		t.Fatalf("rollback of 1.3.1 = %+v, want refused (needs a restore)", refused)
	}
}

func TestUpdates_Recovery_Rollback(t *testing.T) {
	admin, approver, _ := resetUpdatesTest(t)
	driveUpdateToApproved(t, admin, approver, "1.2.0")
	_, err := ApplyUpdate(admin, "1.2.0")
	checkOK(t, err, "ApplyUpdate")

	result, err := RequestUpdateRecovery(admin, map[string]any{"action": "rollback", "note": "Rolling back."})
	checkOK(t, err, "RequestUpdateRecovery rollback")
	if result.State != "started" || result.Run == nil || result.Run.Kind != "rollback" || result.Run.Version != "1.1.0" || result.Run.State != "succeeded" {
		t.Fatalf("rollback result = %+v", result)
	}
	status, err := GetUpdateStatus(admin)
	checkOK(t, err, "GetUpdateStatus")
	if status.CurrentVersion != "1.1.0" || status.PreviousVersion != nil {
		t.Fatalf("status after rollback = %+v", status)
	}
	rel, err := GetUpdateRelease(admin, "1.2.0")
	checkOK(t, err, "GetUpdateRelease")
	if rel.Summary.State != "available" {
		t.Fatalf("1.2.0 state after rollback = %s, want available", rel.Summary.State)
	}
	again, err := RequestUpdateRecovery(admin, map[string]any{"action": "rollback"})
	checkOK(t, err, "RequestUpdateRecovery second rollback")
	if again.State != "refused" {
		t.Fatalf("second rollback = %+v, want refused", again)
	}
}

func TestUpdates_Recovery_NothingNeedsAttention(t *testing.T) {
	admin, _, _ := resetUpdatesTest(t)
	resume, err := RequestUpdateRecovery(admin, map[string]any{"action": "resume"})
	checkOK(t, err, "RequestUpdateRecovery resume")
	if resume.State != "refused" {
		t.Fatalf("resume = %+v, want refused", resume)
	}
	restore, err := RequestUpdateRecovery(admin, map[string]any{"action": "restore"})
	checkOK(t, err, "RequestUpdateRecovery restore")
	if restore.State != "refused" {
		t.Fatalf("restore = %+v, want refused", restore)
	}
	_, err = RequestUpdateRecovery(admin, map[string]any{"action": "explode"})
	wantCode(t, err, dataerr.CodeInvalid, "RequestUpdateRecovery bad action")
}

// 1.2.1: a hotfix, for the emergency override.
func TestUpdates_EmergencyOverride(t *testing.T) {
	admin, _, approverID := resetUpdatesTest(t)
	_, err := StartUpdateDownload(admin, "1.2.1")
	checkOK(t, err, "StartUpdateDownload")

	reason := "Gap calculation error hides a two hour shortfall in Riyadh Central."
	run, err := RequestUpdateEmergencyOverride(admin, map[string]any{"version": "1.2.1", "second_approver_user_id": approverID, "reason": reason})
	checkOK(t, err, "RequestUpdateEmergencyOverride")
	if run.Kind != "emergency" || run.Version != "1.2.1" || run.State != "succeeded" || run.HealthCheckPassed == nil || !*run.HealthCheckPassed {
		t.Fatalf("run = %+v", run)
	}
	status, err := GetUpdateStatus(admin)
	checkOK(t, err, "GetUpdateStatus")
	if status.CurrentVersion != "1.2.1" {
		t.Fatalf("current version = %s, want 1.2.1", status.CurrentVersion)
	}
	rel, err := GetUpdateRelease(admin, "1.2.0")
	checkOK(t, err, "GetUpdateRelease")
	if rel.Summary.State != "superseded" {
		t.Fatalf("1.2.0 state = %s, want superseded", rel.Summary.State)
	}
	history, err := ListUpdateHistory(admin, UpdateHistoryQuery{})
	checkOK(t, err, "ListUpdateHistory")
	entry := history.Items[0]
	if entry.Kind != "emergency_override" || !entry.Emergency || entry.Result != "succeeded" || entry.WindowStart != nil || entry.Version != "1.2.1" {
		t.Fatalf("history[0] = %+v", entry)
	}
	if len(entry.ApprovedBy) != 2 || entry.ApprovedBy[0].UserID != admin.UserID || entry.ApprovedBy[1].UserID != approverID {
		t.Fatalf("approved_by = %+v", entry.ApprovedBy)
	}
}

func TestUpdates_EmergencyOverride_Refusals(t *testing.T) {
	admin, _, approverID := resetUpdatesTest(t)
	_, err := StartUpdateDownload(admin, "1.2.1")
	checkOK(t, err, "StartUpdateDownload")
	reason := "Gap calculation error hides a two hour shortfall in Riyadh Central."

	_, err = RequestUpdateEmergencyOverride(admin, map[string]any{"version": "1.2.1", "second_approver_user_id": admin.UserID, "reason": reason})
	wantCode(t, err, dataerr.CodeInvalid, "same person twice")
	_, err = RequestUpdateEmergencyOverride(admin, map[string]any{"version": "1.2.1", "second_approver_user_id": approverID, "reason": "too short"})
	wantCode(t, err, dataerr.CodeInvalid, "reason too short")
	_, err = RequestUpdateEmergencyOverride(admin, map[string]any{"version": "1.2.0", "second_approver_user_id": approverID, "reason": reason})
	wantCode(t, err, dataerr.CodeConflict, "1.2.0 was never downloaded")

	_, err = UpdateUpdateChangePolicy(admin, map[string]any{"approver_user_ids": []any{approverID}, "second_approver_required": false, "emergency_override_enabled": false, "emergency_reason_min_length": float64(20)})
	checkOK(t, err, "UpdateUpdateChangePolicy")
	_, err = RequestUpdateEmergencyOverride(admin, map[string]any{"version": "1.2.1", "second_approver_user_id": approverID, "reason": reason})
	wantCode(t, err, dataerr.CodeForbidden, "emergency override disabled")
	status, err := GetUpdateStatus(admin)
	checkOK(t, err, "GetUpdateStatus")
	if status.CurrentVersion != "1.1.0" {
		t.Fatalf("current version = %s, want unchanged 1.1.0", status.CurrentVersion)
	}
}

func TestUpdates_EmergencyOverride_NotOpenToChangeApprover(t *testing.T) {
	admin, approver, approverID := resetUpdatesTest(t)
	_, err := StartUpdateDownload(admin, "1.2.1")
	checkOK(t, err, "StartUpdateDownload")
	reason := "Gap calculation error hides a two hour shortfall in Riyadh Central."
	_, err = RequestUpdateEmergencyOverride(approver, map[string]any{"version": "1.2.1", "second_approver_user_id": approverID, "reason": reason})
	wantCode(t, err, dataerr.CodeForbidden, "change approver cannot override")
}

// A Change Approver may read but never change
// anything.
func TestUpdates_AccessControl_ChangeApproverReadOnly(t *testing.T) {
	admin, approver, _ := resetUpdatesTest(t)
	status, err := GetUpdateStatus(approver)
	checkOK(t, err, "GetUpdateStatus")
	if status.CurrentVersion != "1.1.0" {
		t.Fatalf("current version = %s, want 1.1.0", status.CurrentVersion)
	}
	_, err = CheckForUpdatesNow(approver)
	wantCode(t, err, dataerr.CodeForbidden, "CheckForUpdatesNow as approver")
	_, err = ScheduleUpdate(approver, "1.2.0", map[string]any{})
	wantCode(t, err, dataerr.CodeForbidden, "ScheduleUpdate as approver")
	_, err = ApplyUpdate(approver, "1.2.0")
	wantCode(t, err, dataerr.CodeForbidden, "ApplyUpdate as approver")
	_ = admin
}

// install modes: every write, and every
// read but the summary, is Forbidden outside a
// private install; the denial is audited.
func TestUpdates_AccessControl_InstallModeGuardsWrites(t *testing.T) {
	admin, _, _ := resetUpdatesTest(t)
	shared := admin
	shared.InstallMode = access.InstallShared
	_, err := GetUpdatesSummary(shared)
	checkOK(t, err, "GetUpdatesSummary works in every install mode")
	_, err = GetUpdateStatus(shared)
	wantCode(t, err, dataerr.CodeForbidden, "GetUpdateStatus outside private")
	_, err = CheckForUpdatesNow(shared)
	wantCode(t, err, dataerr.CodeForbidden, "CheckForUpdatesNow outside private")
}
