// SPDX-License-Identifier: AGPL-3.0-only

// RunWorkerCycle: roster/forecast idempotency.
package business

import (
	"context"
	"testing"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/access"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"
)

func TestRunWorkerCycle_BuildsRosterAndForecastFirstTime(t *testing.T) {
	conn := openConn(t)
	rc, tenantID := adminCtx(t)
	ctx := context.Background()
	resetRosterDeps()
	seedRosterFixture(t, ctx, conn, rc)
	actors := NewWorkerActors(tenantID)

	report, err := RunWorkerCycle(ctx, conn, actors)
	check(t, err)
	if report.RostersBuilt != 1 || report.RostersSkipped != 0 || len(report.RostersFailed) != 0 {
		t.Fatalf("got %+v, want 1 roster built, none skipped or failed", report)
	}
	if !report.ForecastCreated || report.ForecastSkipped {
		t.Fatalf("got %+v, want the first cycle to create a forecast run", report)
	}
}

func TestRunWorkerCycle_SecondCallSkipsForecastAndExistingDraft(t *testing.T) {
	conn := openConn(t)
	rc, tenantID := adminCtx(t)
	ctx := context.Background()
	resetRosterDeps()
	seedRosterFixture(t, ctx, conn, rc)
	actors := NewWorkerActors(tenantID)

	_, err := RunWorkerCycle(ctx, conn, actors)
	check(t, err)

	report, err := RunWorkerCycle(ctx, conn, actors)
	check(t, err)
	if report.ForecastCreated || !report.ForecastSkipped {
		t.Fatalf("got %+v, want the second cycle to skip the forecast run", report)
	}
	if report.RostersBuilt != 0 || report.RostersSkipped != 1 {
		t.Fatalf("got %+v, want the existing draft skipped, never rebuilt", report)
	}
}

// The worker must never wipe a planner's override by
// rebuilding an already-built draft (review finding
// #2): a second cycle must leave an applied override
// on the first cycle's roster completely untouched.
func TestRunWorkerCycle_NeverOverwritesAnAppliedOverride(t *testing.T) {
	conn := openConn(t)
	rc, tenantID := adminCtx(t)
	ctx := context.Background()
	resetRosterDeps()
	fx := seedRosterFixture(t, ctx, conn, rc)
	actors := NewWorkerActors(tenantID)
	tomorrow := shiftDateBy(demoToday(context.Background(), ""), 1)

	first, err := RunWorkerCycle(ctx, conn, actors)
	check(t, err)
	if first.RostersBuilt != 1 {
		t.Fatalf("got %+v, want the first cycle to build the roster", first)
	}
	rosters, err := ListRosters(ctx, conn, rc, RosterQuery{ZoneID: fx.zoneID, Date: tomorrow})
	check(t, err)
	if len(rosters.Items) != 1 {
		t.Fatalf("got %d rosters, want exactly 1", len(rosters.Items))
	}
	roster := rosters.Items[0]
	page, err := ListRosterAssignments(ctx, conn, rc, roster.ID, datactx.PageQuery{})
	check(t, err)
	target := page.Items[0]

	s3, err := CreateAgent(ctx, conn, rc, map[string]any{
		"code": "SUR-3", "name_en": "Agent Three", "kind": "field", "home_zone_id": fx.zoneID,
		"extra": map[string]any{"home_shift": "day_a", "standby_point_id": fx.pointID},
	})
	check(t, err)
	override, err := CreateOverride(ctx, conn, actors.Roster, roster.ID, map[string]any{
		"roster_assignment_id": target.ID, "change_type": "replace_agent", "reason_code": "agent_unavailable", "agent_id": s3.ID,
	})
	check(t, err)
	supervisor := roleCtx(tenantID, "00000000-0000-4000-8000-000000000202", access.RoleDispatchSupervisor)
	_, err = ApproveOverride(ctx, conn, supervisor, override.ID, nil)
	check(t, err)

	second, err := RunWorkerCycle(ctx, conn, actors)
	check(t, err)
	if second.RostersBuilt != 0 || second.RostersSkipped != 1 {
		t.Fatalf("got %+v, want the overridden draft skipped, not rebuilt", second)
	}

	after, err := ListRosterAssignments(ctx, conn, rc, roster.ID, datactx.PageQuery{})
	check(t, err)
	found := false
	for _, a := range after.Items {
		if a.ID == target.ID {
			if a.AgentID != s3.ID || !a.IsOverride {
				t.Fatalf("got %+v, want the override still in place", a)
			}
			found = true
		}
	}
	if !found {
		t.Fatalf("the overridden assignment should still exist")
	}
}

func TestRunWorkerCycle_SkipsRosterPastDraft(t *testing.T) {
	conn := openConn(t)
	rc, tenantID := adminCtx(t)
	ctx := context.Background()
	resetRosterDeps()
	fx := seedRosterFixture(t, ctx, conn, rc)
	actors := NewWorkerActors(tenantID)
	tomorrow := shiftDateBy(demoToday(context.Background(), ""), 1)

	roster, err := BuildRoster(ctx, conn, actors.Roster, map[string]any{"zone_id": fx.zoneID, "roster_date": tomorrow})
	check(t, err)
	_, err = SubmitRoster(ctx, conn, actors.Roster, roster.ID)
	check(t, err)
	supervisor := roleCtx(tenantID, "00000000-0000-4000-8000-000000000201", access.RoleDispatchSupervisor)
	seedUserRow(t, ctx, conn, tenantID, supervisor.UserID)
	_, err = ApproveRoster(ctx, conn, supervisor, roster.ID, nil)
	check(t, err)

	report, err := RunWorkerCycle(ctx, conn, actors)
	check(t, err)
	if report.RostersBuilt != 0 || report.RostersSkipped != 1 || len(report.RostersFailed) != 0 {
		t.Fatalf("got %+v, want the approved roster skipped, not rebuilt or failed", report)
	}
}
