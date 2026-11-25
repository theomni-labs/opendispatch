// SPDX-License-Identifier: AGPL-3.0-only

// Mirrors the shift/break part of time.live.test.ts.
package business

import (
	"context"
	"testing"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/access"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/dataerr"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/reqctx"
)

// roleCtx: whole-install ctx for any role.
func roleCtx(tenantID, userID string, role access.Role) reqctx.RequestContext {
	return reqctx.RequestContext{
		CustomerID:  tenantID,
		UserID:      userID,
		Role:        role,
		ZoneScope:   access.ZoneScope{Kind: access.ScopeWholeInstall},
		InstallMode: access.InstallPrivate,
	}
}

func TestShiftBreak_CreateBreakRuleAndShiftPattern(t *testing.T) {
	conn := openConn(t)
	rc, _ := adminCtx(t)
	ctx := context.Background()

	rule, err := CreateBreakRule(ctx, conn, rc, map[string]any{"code": "BRK-A", "name_en": "Rule A", "break_minutes": 30.0, "after_consecutive_hours": 4.0})
	check(t, err)
	if rule.AfterConsecutiveHours != 4 {
		t.Fatalf("after_consecutive_hours = %v, want 4", rule.AfterConsecutiveHours)
	}

	shift, err := CreateShiftPattern(ctx, conn, rc, map[string]any{
		"code": "DAY-A", "name_en": "Day A", "kind": "field",
		"normal":        map[string]any{"applies": true, "start_time": "20:00", "end_time": "04:00"},
		"ramadan":       map[string]any{"applies": true, "start_time": "18:00", "end_time": "00:00"},
		"break_rule_id": rule.ID,
	})
	check(t, err)
	if shift.Status != ShiftStatusDraft {
		t.Fatalf("status = %q, want draft", shift.Status)
	}
	if !shift.Normal.CrossesMidnight {
		t.Fatal("normal.crosses_midnight should be true (20:00-04:00)")
	}
	if shift.Ramadan.CrossesMidnight {
		t.Fatal("ramadan.crosses_midnight should be false (end 00:00)")
	}

	got, err := GetShiftPattern(ctx, conn, rc, shift.ID)
	check(t, err)
	if got.Code != "DAY-A" {
		t.Fatalf("GetShiftPattern code = %q, want DAY-A", got.Code)
	}

	updated, err := UpdateShiftPattern(ctx, conn, rc, shift.ID, map[string]any{
		"code": "DAY-A", "name_en": "Day A late", "kind": "field",
		"normal":        map[string]any{"applies": true, "start_time": "20:00", "end_time": "04:00"},
		"ramadan":       map[string]any{"applies": false},
		"break_rule_id": rule.ID,
		"status":        "active",
	})
	check(t, err)
	if updated.NameEn != "Day A late" || updated.Status != ShiftStatusActive {
		t.Fatalf("update: got %+v", updated)
	}

	_, err = CreateShiftPattern(ctx, conn, rc, map[string]any{
		"code": "DAY-A", "name_en": "Dup", "kind": "field",
		"normal": map[string]any{"applies": false}, "ramadan": map[string]any{"applies": false},
		"break_rule_id": rule.ID,
	})
	if errCode(err) != dataerr.CodeConflict {
		t.Fatalf("duplicate code: got %v, want Conflict", err)
	}
}

func TestShiftBreak_ListsAcrossRoles(t *testing.T) {
	conn := openConn(t)
	rc, tenantID := adminCtx(t)
	ctx := context.Background()

	rule, err := CreateBreakRule(ctx, conn, rc, map[string]any{"code": "BRK-B", "name_en": "Rule B", "break_minutes": 15.0, "after_consecutive_hours": 5.0})
	check(t, err)
	_, err = CreateShiftPattern(ctx, conn, rc, map[string]any{
		"code": "NIGHT-B", "name_en": "Night B", "kind": "remote",
		"normal": map[string]any{"applies": false}, "ramadan": map[string]any{"applies": false},
		"break_rule_id": rule.ID,
	})
	check(t, err)

	readable := []access.Role{access.RoleDispatchSupervisor, access.RoleDispatcher, access.RolePlanner, access.RoleRemoteTeamLead, access.RoleViewerAuditor}
	for _, role := range readable {
		page, err := ListShiftPatterns(ctx, conn, roleCtx(tenantID, "u", role), ShiftPatternQuery{})
		if err != nil || len(page.Items) == 0 {
			t.Errorf("%s: list shift patterns: %d items, err=%v", role, len(page.Items), err)
		}
	}
	_, err = ListShiftPatterns(ctx, conn, roleCtx(tenantID, "u", access.RoleChangeApprover), ShiftPatternQuery{})
	if errCode(err) != dataerr.CodeForbidden {
		t.Fatalf("change_approver: got %v, want Forbidden", err)
	}
}

func TestShiftBreak_RefusesInvalidInputAndOtherRoles(t *testing.T) {
	conn := openConn(t)
	rc, tenantID := adminCtx(t)
	ctx := context.Background()

	rule, err := CreateBreakRule(ctx, conn, rc, map[string]any{"code": "BRK-C", "name_en": "Rule C", "break_minutes": 30.0, "after_consecutive_hours": 3.0})
	check(t, err)

	_, err = CreateShiftPattern(ctx, conn, rc, map[string]any{
		"code": "BAD-1", "name_en": "X", "kind": "field",
		"normal":        map[string]any{"applies": true, "start_time": "25:00", "end_time": "04:00"},
		"ramadan":       map[string]any{"applies": false},
		"break_rule_id": rule.ID,
	})
	if errCode(err) != dataerr.CodeInvalid {
		t.Fatalf("bad start_time: got %v, want Invalid", err)
	}

	_, err = CreateBreakRule(ctx, conn, rc, map[string]any{"code": "BRK-D", "name_en": "B", "break_minutes": 30.0, "after_consecutive_hours": 0.0})
	if errCode(err) != dataerr.CodeInvalid {
		t.Fatalf("hours=0: got %v, want Invalid", err)
	}

	_, err = CreateBreakRule(ctx, conn, roleCtx(tenantID, "u", access.RolePlanner), map[string]any{"code": "BRK-E", "name_en": "B", "break_minutes": 30.0, "after_consecutive_hours": 5.0})
	if errCode(err) != dataerr.CodeForbidden {
		t.Fatalf("planner create: got %v, want Forbidden", err)
	}

	// 4.5 is valid: TS's own test, a double column.
	made, err := CreateBreakRule(ctx, conn, rc, map[string]any{"code": "BRK-F", "name_en": "B", "break_minutes": 20.0, "after_consecutive_hours": 4.5})
	check(t, err)
	if made.AfterConsecutiveHours != 4.5 {
		t.Fatalf("after_consecutive_hours = %v, want 4.5", made.AfterConsecutiveHours)
	}
	updated, err := UpdateBreakRule(ctx, conn, rc, made.ID, map[string]any{"code": made.Code, "name_en": "B2", "break_minutes": 25.0, "after_consecutive_hours": 4.5})
	check(t, err)
	if updated.BreakMinutes != 25 {
		t.Fatalf("break_minutes = %d, want 25", updated.BreakMinutes)
	}
}
