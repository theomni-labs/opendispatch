// SPDX-License-Identifier: AGPL-3.0-only

// Identity-dependent update approvals: the web
// session carries no user id, so these run here.
package business

import (
	"testing"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/access"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/dataerr"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/reqctx"
)

func scheduleOnly(t *testing.T, admin reqctx.RequestContext, version string) {
	t.Helper()
	_, err := StartUpdateDownload(admin, version)
	checkOK(t, err, "StartUpdateDownload")
	_, err = ConfirmUpdateBackup(admin, version, map[string]any{})
	checkOK(t, err, "ConfirmUpdateBackup")
	_, err = ScheduleUpdate(admin, version, map[string]any{})
	checkOK(t, err, "ScheduleUpdate")
}

func secondApproverCtx() (reqctx.RequestContext, string) {
	id := datactx.DeterministicUUID("test:second-approver")
	now := datactx.NowISO()
	upsertUserRow(User{
		BaseRecord:   datactx.BaseRecord{ID: id, TenantID: "t1", CreatedAt: now, UpdatedAt: now, DataSource: "SYNTHETIC"},
		Email:        "second.approver@demo.example",
		DisplayName:  "Second Approver",
		AssignedRole: access.RoleChangeApprover,
		Status:       "active",
	})
	return roleCtx("t1", id, access.RoleChangeApprover), id
}

func TestUpdates_Approval_NeverOwnRequest(t *testing.T) {
	admin, approver, _ := resetUpdatesTest(t)
	scheduleOnly(t, admin, "1.2.0")
	self := approver
	self.UserID = admin.UserID
	_, err := ApproveUpdate(self, "1.2.0", map[string]any{})
	wantCode(t, err, dataerr.CodeForbidden, "self approval")
	rel, err := GetUpdateRelease(admin, "1.2.0")
	checkOK(t, err, "GetUpdateRelease")
	if rel.Scheduled == nil || rel.Scheduled.State != "awaiting_approval" {
		t.Fatalf("release should still await approval: %+v", rel.Scheduled)
	}
}

func TestUpdates_Approval_SecondApproverNeedsTwoPeople(t *testing.T) {
	admin, approver, approverID := resetUpdatesTest(t)
	second, secondID := secondApproverCtx()
	_, err := UpdateUpdateChangePolicy(admin, map[string]any{
		"approver_user_ids": []any{approverID, secondID}, "second_approver_required": true,
		"emergency_override_enabled": true, "emergency_reason_min_length": float64(20),
	})
	checkOK(t, err, "UpdateUpdateChangePolicy")
	scheduleOnly(t, admin, "1.2.0")
	one, err := ApproveUpdate(approver, "1.2.0", map[string]any{})
	checkOK(t, err, "first approval")
	if one.State != "awaiting_approval" || len(one.Approvals) != 1 {
		t.Fatalf("after one approval: %+v", one)
	}
	_, err = ApproveUpdate(approver, "1.2.0", map[string]any{})
	wantCode(t, err, dataerr.CodeConflict, "same person twice")
	_, err = ApplyUpdate(admin, "1.2.0")
	wantCode(t, err, dataerr.CodeConflict, "apply before second approval")
	two, err := ApproveUpdate(second, "1.2.0", map[string]any{})
	checkOK(t, err, "second approval")
	if two.State != "approved" || len(two.Approvals) != 2 || two.Approvals[1].Approver.DisplayName != "Second Approver" {
		t.Fatalf("after two approvals: %+v", two)
	}
	run, err := ApplyUpdate(admin, "1.2.0")
	checkOK(t, err, "ApplyUpdate")
	if run.State != "succeeded" {
		t.Fatalf("apply state %s", run.State)
	}
}

func TestUpdates_Approval_RefusesUnlistedApprover(t *testing.T) {
	admin, _, _ := resetUpdatesTest(t)
	scheduleOnly(t, admin, "1.2.0")
	stranger, _ := secondApproverCtx()
	_, err := ApproveUpdate(stranger, "1.2.0", map[string]any{})
	wantCode(t, err, dataerr.CodeForbidden, "unlisted approver")
	rel, err := GetUpdateRelease(admin, "1.2.0")
	checkOK(t, err, "GetUpdateRelease")
	if rel.Scheduled == nil || rel.Scheduled.State != "awaiting_approval" {
		t.Fatalf("release should still await approval: %+v", rel.Scheduled)
	}
}
