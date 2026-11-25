// SPDX-License-Identifier: AGPL-3.0-only

// Mirrors rosters.live.test.ts: roster_plan.go plus
// rosters.go together (loadPlan, projectLines,
// scenarioZonePlans, the full roster CRUD flow).
package business

import (
	"context"
	"testing"

	"github.com/jackc/pgx/v5"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/access"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/dataerr"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/reqctx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
)

// rosterFixture: a zone ready to build a roster in.
type rosterFixture struct {
	zoneID    string
	patternID string
	ruleID    string
	agent1    string
	agent2    string
	vehicleID string
	pointID   string
}

func seedRosterFixture(t *testing.T, ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext) rosterFixture {
	t.Helper()
	city, err := CreateCity(ctx, conn, rc, map[string]any{"case_code": "RY", "name_en": "Riyadh"})
	check(t, err)
	zone, err := CreateZone(ctx, conn, rc, map[string]any{"city_id": city.ID, "name_en": "Central"})
	check(t, err)
	rule, err := CreateBreakRule(ctx, conn, rc, map[string]any{"code": "BRK-A", "name_en": "Rule A", "break_minutes": 30.0, "after_consecutive_hours": 5.0})
	check(t, err)
	pattern, err := CreateShiftPattern(ctx, conn, rc, map[string]any{
		"code": "DAY-A", "name_en": "Day A", "kind": "field", "break_rule_id": rule.ID, "status": "active",
		"normal":  map[string]any{"applies": true, "start_time": "06:00", "end_time": "14:00"},
		"ramadan": map[string]any{"applies": false},
	})
	check(t, err)
	point, err := CreateStandbyPoint(ctx, conn, rc, map[string]any{"zone_id": zone.ID, "name_en": "Point A", "latitude": 24.7, "longitude": 46.7, "coverage_radius_m": 2000.0})
	check(t, err)
	vehicle, err := CreateVehicle(ctx, conn, rc, map[string]any{"code": "VEH-1", "plate_number": "ABC-123", "zone_id": zone.ID})
	check(t, err)
	s1, err := CreateAgent(ctx, conn, rc, map[string]any{
		"code": "SUR-1", "name_en": "Agent One", "kind": "field", "home_zone_id": zone.ID,
		"extra": map[string]any{"home_shift": "day_a", "standby_point_id": point.ID},
	})
	check(t, err)
	s2, err := CreateAgent(ctx, conn, rc, map[string]any{
		"code": "SUR-2", "name_en": "Agent Two", "kind": "field", "home_zone_id": zone.ID,
		"extra": map[string]any{"home_shift": "day_a", "standby_point_id": point.ID},
	})
	check(t, err)
	return rosterFixture{zoneID: zone.ID, patternID: pattern.ID, ruleID: rule.ID, agent1: s1.ID, agent2: s2.ID, vehicleID: vehicle.ID, pointID: point.ID}
}

// seedUserRow: approved_by_user_id FKs to users,
// which the in-memory Users module never writes.
func seedUserRow(t *testing.T, ctx context.Context, conn *tenancy.Connection, tenantID, userID string) {
	t.Helper()
	_, err := tenancy.WithTenant(ctx, conn.Pool, tenantID, func(ctx context.Context, tx pgx.Tx) (struct{}, error) {
		_, err := tx.Exec(ctx, `INSERT INTO users (tenant_id, id, data_source, email, display_name, assigned_role, status, preferred_locale) VALUES ($1,$2,'SYNTHETIC',$3,$4,'dispatch_supervisor','active','en')`,
			tenantID, userID, userID+"@example.test", "Supervisor")
		return struct{}{}, err
	})
	check(t, err)
}

func resetRosterDeps() {
	ResetForecastRunsForTest()
	ResetOverridesForTest()
	ResetRulesForTest()
	ResetScenariosForTest()
	ResetLeaveCalendarForTest()
}

func TestBuildRoster_ProjectsFieldAgentsWithVehicleAndBreak(t *testing.T) {
	conn := openConn(t)
	rc, _ := adminCtx(t)
	ctx := context.Background()
	resetRosterDeps()
	fx := seedRosterFixture(t, ctx, conn, rc)
	planner := roleCtx(rc.CustomerID, "00000000-0000-4000-8000-000000000101", access.RolePlanner)

	roster, err := BuildRoster(ctx, conn, planner, map[string]any{"zone_id": fx.zoneID, "roster_date": "2026-09-14", "forecast_run_id": nil})
	check(t, err)
	if roster.Status != "draft" || roster.ZoneID != fx.zoneID {
		t.Fatalf("got %+v, want a draft roster for the zone", roster)
	}
	if roster.OptimizerSource != nil || roster.FallbackReason != nil {
		t.Fatalf("got %v and %v, want both null with engines off", roster.OptimizerSource, roster.FallbackReason)
	}

	page, err := ListRosterAssignments(ctx, conn, rc, roster.ID, datactx.PageQuery{})
	check(t, err)
	if len(page.Items) != 2 {
		t.Fatalf("got %d assignments, want 2 (both agents)", len(page.Items))
	}
	for _, a := range page.Items {
		if a.VehicleID == nil && a.AgentID == fx.agent1 {
			t.Fatalf("the first agent by code should get the single vehicle: %+v", a)
		}
		if a.StandbyPointID == nil || *a.StandbyPointID != fx.pointID {
			t.Fatalf("got %+v, want the agent's home standby point", a)
		}
		if a.BreakStartAt == nil || a.BreakEndAt == nil {
			t.Fatalf("an 8-hour shift should get a placed break: %+v", a)
		}
	}
}

func TestBuildRoster_RefusesPastAndTooFarAheadDates(t *testing.T) {
	conn := openConn(t)
	rc, _ := adminCtx(t)
	ctx := context.Background()
	resetRosterDeps()
	fx := seedRosterFixture(t, ctx, conn, rc)
	planner := roleCtx(rc.CustomerID, "00000000-0000-4000-8000-000000000101", access.RolePlanner)

	_, err := BuildRoster(ctx, conn, planner, map[string]any{"zone_id": fx.zoneID, "roster_date": "2020-01-01"})
	if errCode(err) != dataerr.CodeInvalid {
		t.Fatalf("past date: got %v, want Invalid", err)
	}
	_, err = BuildRoster(ctx, conn, planner, map[string]any{"zone_id": fx.zoneID, "roster_date": "2099-01-01"})
	if errCode(err) != dataerr.CodeInvalid {
		t.Fatalf("too far ahead: got %v, want Invalid", err)
	}
}

func TestRosterApprovalFlow_SubmitApprovePublish(t *testing.T) {
	conn := openConn(t)
	rc, _ := adminCtx(t)
	ctx := context.Background()
	resetRosterDeps()
	fx := seedRosterFixture(t, ctx, conn, rc)
	planner := roleCtx(rc.CustomerID, "00000000-0000-4000-8000-000000000101", access.RolePlanner)

	roster, err := BuildRoster(ctx, conn, planner, map[string]any{"zone_id": fx.zoneID, "roster_date": "2026-09-14"})
	check(t, err)

	submitted, err := SubmitRoster(ctx, conn, planner, roster.ID)
	check(t, err)
	if submitted.Status != "submitted" {
		t.Fatalf("got %q, want submitted", submitted.Status)
	}

	supervisor := roleCtx(rc.CustomerID, "00000000-0000-4000-8000-000000000102", access.RoleDispatchSupervisor)
	seedUserRow(t, ctx, conn, rc.CustomerID, supervisor.UserID)
	approved, err := ApproveRoster(ctx, conn, supervisor, roster.ID, nil)
	check(t, err)
	if approved.Status != "approved" || approved.ApprovedByUserID == nil {
		t.Fatalf("got %+v, want approved with an approver", approved)
	}

	published, err := PublishRoster(ctx, conn, supervisor, roster.ID)
	check(t, err)
	if !published.Stub || published.Published {
		t.Fatalf("got %+v, want the labelled stub (nothing actually sent)", published)
	}
}

func TestRosterApproval_CannotApproveOwnSubmission(t *testing.T) {
	conn := openConn(t)
	rc, _ := adminCtx(t)
	ctx := context.Background()
	resetRosterDeps()
	fx := seedRosterFixture(t, ctx, conn, rc)
	planner := roleCtx(rc.CustomerID, "00000000-0000-4000-8000-000000000103", access.RolePlanner)
	roster, err := BuildRoster(ctx, conn, planner, map[string]any{"zone_id": fx.zoneID, "roster_date": "2026-09-14"})
	check(t, err)
	_, err = SubmitRoster(ctx, conn, planner, roster.ID)
	check(t, err)
	supervisorSelf := roleCtx(rc.CustomerID, "00000000-0000-4000-8000-000000000103", access.RoleDispatchSupervisor)
	if _, err := ApproveRoster(ctx, conn, supervisorSelf, roster.ID, nil); errCode(err) != dataerr.CodeForbidden {
		t.Fatalf("the same person who requested cannot approve: got %v, want Forbidden", err)
	}
}

func TestCreateAndApproveOverride_ReplaceAgent(t *testing.T) {
	conn := openConn(t)
	rc, _ := adminCtx(t)
	ctx := context.Background()
	resetRosterDeps()
	fx := seedRosterFixture(t, ctx, conn, rc)
	planner := roleCtx(rc.CustomerID, "00000000-0000-4000-8000-000000000101", access.RolePlanner)
	roster, err := BuildRoster(ctx, conn, planner, map[string]any{"zone_id": fx.zoneID, "roster_date": "2026-09-14"})
	check(t, err)
	page, err := ListRosterAssignments(ctx, conn, rc, roster.ID, datactx.PageQuery{})
	check(t, err)
	target := page.Items[0]

	// A third agent, unused here, to replace onto it.
	s3, err := CreateAgent(ctx, conn, rc, map[string]any{
		"code": "SUR-3", "name_en": "Agent Three", "kind": "field", "home_zone_id": fx.zoneID,
		"extra": map[string]any{"home_shift": "day_a", "standby_point_id": fx.pointID},
	})
	check(t, err)

	override, err := CreateOverride(ctx, conn, planner, roster.ID, map[string]any{
		"roster_assignment_id": target.ID, "change_type": "replace_agent", "reason_code": "agent_unavailable", "agent_id": s3.ID,
	})
	check(t, err)
	if override.Status != "pending" {
		t.Fatalf("got %q, want pending", override.Status)
	}

	supervisor := roleCtx(rc.CustomerID, "00000000-0000-4000-8000-000000000104", access.RoleDispatchSupervisor)
	approved, err := ApproveOverride(ctx, conn, supervisor, override.ID, nil)
	check(t, err)
	if approved.Status != "approved" {
		t.Fatalf("got %q, want approved", approved.Status)
	}

	after, err := ListRosterAssignments(ctx, conn, rc, roster.ID, datactx.PageQuery{})
	check(t, err)
	found := false
	for _, a := range after.Items {
		if a.ID == target.ID {
			if a.AgentID != s3.ID || !a.IsOverride {
				t.Fatalf("got %+v, want agent_id=%s and is_override=true", a, s3.ID)
			}
			found = true
		}
	}
	if !found {
		t.Fatalf("the overridden assignment should still exist")
	}
}

func TestGetGapSurplus_ByRosterAndByDate(t *testing.T) {
	conn := openConn(t)
	rc, _ := adminCtx(t)
	ctx := context.Background()
	resetRosterDeps()
	fx := seedRosterFixture(t, ctx, conn, rc)
	planner := roleCtx(rc.CustomerID, "00000000-0000-4000-8000-000000000101", access.RolePlanner)
	roster, err := BuildRoster(ctx, conn, planner, map[string]any{"zone_id": fx.zoneID, "roster_date": "2026-09-14"})
	check(t, err)

	byRoster, err := GetGapSurplus(ctx, conn, rc, GapQuery{RosterID: roster.ID})
	check(t, err)
	if byRoster.RosterID == nil || *byRoster.RosterID != roster.ID || len(byRoster.Cells) != 96 {
		t.Fatalf("got %+v, want 96 cells for the roster", byRoster)
	}

	byDate, err := GetGapSurplus(ctx, conn, rc, GapQuery{ZoneID: fx.zoneID, Date: "2026-09-14"})
	check(t, err)
	if len(byDate.Cells) != 96 {
		t.Fatalf("got %d cells, want 96 for one zone/date", len(byDate.Cells))
	}

	_, err = GetGapSurplus(ctx, conn, rc, GapQuery{RosterID: roster.ID, ScenarioID: "00000000-0000-4000-8000-000000000001"})
	if errCode(err) != dataerr.CodeInvalid {
		t.Fatalf("both roster and scenario: got %v, want Invalid", err)
	}
}

func TestScenarioZonePlans_ShiftPatternAdjustment(t *testing.T) {
	conn := openConn(t)
	rc, _ := adminCtx(t)
	ctx := context.Background()
	resetRosterDeps()
	fx := seedRosterFixture(t, ctx, conn, rc)

	scenario := upsertScenarioRowMemory(Scenario{
		BaseRecord: bd("scn-1", rc.CustomerID), Name: "Test", BaseDate: "2026-09-14", ZoneIDs: []string{fx.zoneID},
		Adjustments: ScenarioAdjustments{HeadcountDelta: []HeadcountDelta{{ZoneID: fx.zoneID, FieldAgents: 1}}}, Status: "draft",
	})
	plan, err := loadPlan(ctx, conn, rc)
	check(t, err)
	plans, err := scenarioZonePlans(context.Background(), rc, plan, &scenario, "")
	check(t, err)
	if len(plans) != 1 {
		t.Fatalf("got %d zone plans, want 1", len(plans))
	}
	// no roster: projectLines gives 2, +1 headcount = 3.
	if len(plans[0].Lines) != 3 {
		t.Fatalf("got %d lines, want 3 (2 projected + 1 headcount delta)", len(plans[0].Lines))
	}
	if len(plans[0].Cells) != 96 {
		t.Fatalf("got %d cells, want 96", len(plans[0].Cells))
	}
}

func TestLoadPlan_ZoneScopeRestrictsVisibleRosters(t *testing.T) {
	conn := openConn(t)
	admin, _ := adminCtx(t)
	ctx := context.Background()
	resetRosterDeps()
	fx := seedRosterFixture(t, ctx, conn, admin)
	adminPlanner := roleCtx(admin.CustomerID, "00000000-0000-4000-8000-000000000105", access.RolePlanner)
	_, err := BuildRoster(ctx, conn, adminPlanner, map[string]any{"zone_id": fx.zoneID, "roster_date": "2026-09-14"})
	check(t, err)

	outsider := plannerCtx(admin.CustomerID, "00000000-0000-4000-8000-000000000106", []string{"00000000-0000-4000-8000-000000000099"})
	plan, err := loadPlan(ctx, conn, outsider)
	check(t, err)
	for _, r := range plan.Rosters {
		if r.ZoneID == fx.zoneID {
			t.Fatalf("a planner scoped to another zone should not see this roster")
		}
	}
}
