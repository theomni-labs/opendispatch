// SPDX-License-Identifier: AGPL-3.0-only

package business

import (
	"testing"
	"time"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/access"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/dataerr"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/settingsstore"
)

func seedOneControl(id, framework, ref, status string) {
	UpsertControlEvidenceForTest(ControlEvidence{
		BaseRecord: bd(id, "t1"), Framework: framework, ControlRef: ref, TitleEn: ref, Status: status,
	})
}

func TestListControlEvidence_FiltersByFramework(t *testing.T) {
	ResetSecurityComplianceForTest()
	admin := roleCtx("t1", "u1", access.RoleAdministrator)
	seedOneControl("00000000-0000-4000-8000-000000000001", "NCA", "NCA-AC-01", "evidenced")
	seedOneControl("00000000-0000-4000-8000-000000000002", "PDPL", "PDPL-DR-01", "evidenced")

	page, err := ListControlEvidence(admin, ControlEvidenceQuery{Framework: "NCA"})
	check(t, err)
	if len(page.Items) != 1 || page.Items[0].ControlRef != "NCA-AC-01" {
		t.Fatalf("got %+v, want just NCA-AC-01", page.Items)
	}
}

func TestUpdateControlEvidence_SetsStatusAndReviewedAt(t *testing.T) {
	ResetSecurityComplianceForTest()
	admin := roleCtx("t1", "u1", access.RoleAdministrator)
	seedOneControl("00000000-0000-4000-8000-000000000003", "NCA", "NCA-IR-01", "not_started")

	updated, err := UpdateControlEvidence(admin, "00000000-0000-4000-8000-000000000003", map[string]any{"status": "evidenced", "evidence_note": "Incident contact recorded."})
	check(t, err)
	if updated.Status != "evidenced" || updated.ReviewedAt == nil {
		t.Fatalf("got %+v, want status=evidenced and reviewed_at set", updated)
	}

	_, err = UpdateControlEvidence(admin, "00000000-0000-4000-8000-000000000003", map[string]any{"status": "not-a-status"})
	if errCode(err) != dataerr.CodeInvalid {
		t.Fatalf("bad status: got %v, want Invalid", err)
	}
}

func TestSessionPolicy_DefaultRoundTripAndIdleGuard(t *testing.T) {
	admin := roleCtx("t1", "u1", access.RoleAdministrator)
	settingsstore.ResetForTest()

	before, err := GetSessionPolicy(admin)
	check(t, err)
	if before.SessionLengthMinutes != 480 {
		t.Fatalf("default session_length_minutes = %d, want 480", before.SessionLengthMinutes)
	}

	_, err = UpdateSessionPolicy(admin, map[string]any{"session_length_minutes": 30.0, "idle_timeout_minutes": 60.0, "max_concurrent_sessions": 2.0})
	if errCode(err) != dataerr.CodeInvalid {
		t.Fatalf("idle > session: got %v, want Invalid", err)
	}

	updated, err := UpdateSessionPolicy(admin, map[string]any{"session_length_minutes": 60.0, "idle_timeout_minutes": 15.0, "max_concurrent_sessions": 2.0})
	check(t, err)
	if updated.IdleTimeoutMinutes != 15 {
		t.Fatalf("got %+v, want idle=15", updated)
	}
}

func TestSupportAccess_GrantRequiresEnabledAndOnlyOneOpenGrant(t *testing.T) {
	ResetSecurityComplianceForTest()
	settingsstore.ResetForTest()
	admin := roleCtx("t1", "u1", access.RoleAdministrator)

	_, err := GrantSupportAccess(admin, map[string]any{"hours": 2.0, "reason": "Debug a case."})
	if errCode(err) != dataerr.CodeConflict {
		t.Fatalf("disabled: got %v, want Conflict", err)
	}

	_, err = UpdateSupportAccessSetting(admin, map[string]any{"enabled": true, "max_duration_hours": 8.0})
	check(t, err)

	_, err = GrantSupportAccess(admin, map[string]any{"hours": 20.0, "reason": "Too long."})
	if errCode(err) != dataerr.CodeInvalid {
		t.Fatalf("too many hours: got %v, want Invalid", err)
	}

	granted, err := GrantSupportAccess(admin, map[string]any{"hours": 2.0, "reason": "Debug a case."})
	check(t, err)
	if granted.EndedAt == nil {
		t.Fatalf("got %+v, want ended_at set to the grant's end", granted)
	}

	_, err = GrantSupportAccess(admin, map[string]any{"hours": 1.0, "reason": "Again."})
	if errCode(err) != dataerr.CodeConflict {
		t.Fatalf("second grant while one is open: got %v, want Conflict", err)
	}

	ended, err := EndSupportAccess(admin, granted.ID)
	check(t, err)
	endedAt, err := datactx.EpochOf(*ended.EndedAt)
	check(t, err)
	if endedAt.After(time.Now().Add(time.Minute)) {
		t.Fatalf("ended_at %v should be ~now, not the original future end", *ended.EndedAt)
	}

	_, err = EndSupportAccess(admin, ended.ID)
	if errCode(err) != dataerr.CodeConflict {
		t.Fatalf("ending an already-ended grant: got %v, want Conflict", err)
	}

	// Ended now, so a new grant is allowed.
	_, err = GrantSupportAccess(admin, map[string]any{"hours": 1.0, "reason": "Second visit."})
	check(t, err)

	events, err := ListSupportAccessEvents(admin, datactx.PageQuery{})
	check(t, err)
	if len(events.Items) != 2 {
		t.Fatalf("got %d events, want 2", len(events.Items))
	}
}

func TestSecurityCompliance_RefusesWrongRole(t *testing.T) {
	ResetSecurityComplianceForTest()
	planner := roleCtx("t1", "u1", access.RolePlanner)
	_, err := ListControlEvidence(planner, ControlEvidenceQuery{})
	if errCode(err) != dataerr.CodeForbidden {
		t.Fatalf("planner: got %v, want Forbidden", err)
	}
}
