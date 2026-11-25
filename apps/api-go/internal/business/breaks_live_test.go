// SPDX-License-Identifier: AGPL-3.0-only

// Mirrors breaks.live.test.ts's operations against a
// real roster.
package business

import (
	"context"
	"testing"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/access"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/dataerr"
)

func TestGetBreakPlan_ReflectsTheBuiltRoster(t *testing.T) {
	conn := openConn(t)
	rc, _ := adminCtx(t)
	ctx := context.Background()
	resetRosterDeps()
	fx := seedRosterFixture(t, ctx, conn, rc)
	planner := roleCtx(rc.CustomerID, "00000000-0000-4000-8000-000000000301", access.RolePlanner)
	_, err := BuildRoster(ctx, conn, planner, map[string]any{"zone_id": fx.zoneID, "roster_date": "2026-09-14"})
	check(t, err)

	plan, err := GetBreakPlan(ctx, conn, rc, fx.zoneID, "2026-09-14")
	check(t, err)
	if plan.ZoneID != fx.zoneID || len(plan.Slots) != 2 {
		t.Fatalf("got %+v, want 2 break slots for the zone", plan)
	}
	for _, s := range plan.Slots {
		if s.StartAt == "" || s.EndAt == "" {
			t.Fatalf("got %+v, want a placed break window", s)
		}
	}
}

func TestGetBreakPlan_NoRosterGivesEmptySlots(t *testing.T) {
	conn := openConn(t)
	rc, _ := adminCtx(t)
	ctx := context.Background()
	resetRosterDeps()
	fx := seedRosterFixture(t, ctx, conn, rc)

	plan, err := GetBreakPlan(ctx, conn, rc, fx.zoneID, "2026-09-20")
	check(t, err)
	if len(plan.Slots) != 0 {
		t.Fatalf("got %d slots, want 0 with no roster that day", len(plan.Slots))
	}
}

func TestGenerateBreakPlan_RefusesOnAnUneditableRoster(t *testing.T) {
	conn := openConn(t)
	rc, _ := adminCtx(t)
	ctx := context.Background()
	resetRosterDeps()
	fx := seedRosterFixture(t, ctx, conn, rc)
	planner := roleCtx(rc.CustomerID, "00000000-0000-4000-8000-000000000302", access.RolePlanner)
	roster, err := BuildRoster(ctx, conn, planner, map[string]any{"zone_id": fx.zoneID, "roster_date": "2026-09-14"})
	check(t, err)
	_, err = SubmitRoster(ctx, conn, planner, roster.ID)
	check(t, err)
	supervisor := roleCtx(rc.CustomerID, "00000000-0000-4000-8000-000000000303", access.RoleDispatchSupervisor)
	seedUserRow(t, ctx, conn, rc.CustomerID, supervisor.UserID)
	approved, err := ApproveRoster(ctx, conn, supervisor, roster.ID, nil)
	check(t, err)
	if _, err := PublishRoster(ctx, conn, supervisor, approved.ID); err != nil {
		t.Fatalf("publish: %v", err)
	}
	// PublishRoster is a stub and keeps status approved,
	// so force a non-editable status to test the guard.
	rows, err := allRosters(ctx, conn, rc.CustomerID)
	check(t, err)
	var current Roster
	for _, r := range rows {
		if r.ID == roster.ID {
			current = r
		}
	}
	current.Status = "published"
	check(t, upsertRoster(ctx, conn, rc.CustomerID, current))

	_, err = GenerateBreakPlan(ctx, conn, planner, map[string]any{"zone_id": fx.zoneID, "roster_date": "2026-09-14"})
	if errCode(err) != dataerr.CodeConflict {
		t.Fatalf("got %v, want Conflict for a published roster", err)
	}
}

func TestGenerateBreakPlan_RequiresAnExistingRoster(t *testing.T) {
	conn := openConn(t)
	rc, _ := adminCtx(t)
	ctx := context.Background()
	resetRosterDeps()
	fx := seedRosterFixture(t, ctx, conn, rc)
	planner := roleCtx(rc.CustomerID, "00000000-0000-4000-8000-000000000304", access.RolePlanner)

	_, err := GenerateBreakPlan(ctx, conn, planner, map[string]any{"zone_id": fx.zoneID, "roster_date": "2026-09-21"})
	if errCode(err) != dataerr.CodeNotFound {
		t.Fatalf("got %v, want NotFound with no roster that day", err)
	}
}

func TestUpdateBreakSlot_MovesToAValidQuarterHourSlot(t *testing.T) {
	conn := openConn(t)
	rc, _ := adminCtx(t)
	ctx := context.Background()
	resetRosterDeps()
	fx := seedRosterFixture(t, ctx, conn, rc)
	planner := roleCtx(rc.CustomerID, "00000000-0000-4000-8000-000000000305", access.RolePlanner)
	roster, err := BuildRoster(ctx, conn, planner, map[string]any{"zone_id": fx.zoneID, "roster_date": "2026-09-14"})
	check(t, err)
	page, err := ListRosterAssignments(ctx, conn, rc, roster.ID, datactx.PageQuery{})
	check(t, err)
	target := page.Items[0]

	// Shift 06:00-14:00, break after 5h: earliest 11:00.
	slot, err := UpdateBreakSlot(ctx, conn, planner, target.ID, map[string]any{"start_at": "2026-09-14T11:15:00+03:00"})
	check(t, err)
	if slot.StartAt != "2026-09-14T11:15:00+03:00" {
		t.Fatalf("got %+v, want the break moved to 11:15", slot)
	}
}

func TestUpdateBreakSlot_RefusesOffGridAndOutOfWindow(t *testing.T) {
	conn := openConn(t)
	rc, _ := adminCtx(t)
	ctx := context.Background()
	resetRosterDeps()
	fx := seedRosterFixture(t, ctx, conn, rc)
	planner := roleCtx(rc.CustomerID, "00000000-0000-4000-8000-000000000306", access.RolePlanner)
	roster, err := BuildRoster(ctx, conn, planner, map[string]any{"zone_id": fx.zoneID, "roster_date": "2026-09-14"})
	check(t, err)
	page, err := ListRosterAssignments(ctx, conn, rc, roster.ID, datactx.PageQuery{})
	check(t, err)
	target := page.Items[0]

	if _, err := UpdateBreakSlot(ctx, conn, planner, target.ID, map[string]any{"start_at": "2026-09-14T11:07:00+03:00"}); errCode(err) != dataerr.CodeInvalid {
		t.Fatalf("off-grid: got %v, want Invalid", err)
	}
	// Before the 5h rule allows it (shift starts 06:00).
	if _, err := UpdateBreakSlot(ctx, conn, planner, target.ID, map[string]any{"start_at": "2026-09-14T09:00:00+03:00"}); errCode(err) != dataerr.CodeInvalid {
		t.Fatalf("too early: got %v, want Invalid", err)
	}
	// After the shift ends (14:00).
	if _, err := UpdateBreakSlot(ctx, conn, planner, target.ID, map[string]any{"start_at": "2026-09-14T13:45:00+03:00"}); errCode(err) != dataerr.CodeInvalid {
		t.Fatalf("too late: got %v, want Invalid", err)
	}
}
