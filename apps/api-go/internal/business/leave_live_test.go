// SPDX-License-Identifier: AGPL-3.0-only

// Mirrors leave.live.test.ts (live Postgres).
package business

import (
	"context"
	"testing"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/access"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/dataerr"
)

func resetLeaveDeps() {
	resetRosterDeps()
	ResetLeaveAgentsForTest()
}

func TestCreateLeaveRequest_ValidatesRangeAndClash(t *testing.T) {
	conn := openConn(t)
	rc, _ := adminCtx(t)
	ctx := context.Background()
	resetLeaveDeps()
	fx := seedRosterFixture(t, ctx, conn, rc)
	SeedLeaveAgentsForTest([]Agent{
		{BaseRecord: bd(fx.agent1, rc.CustomerID), Code: "SUR-1", NameEn: "Agent One", Kind: "field", HomeZoneID: &fx.zoneID, IsActive: true},
	})
	planner := roleCtx(rc.CustomerID, "00000000-0000-4000-8000-000000000401", access.RolePlanner)

	created, err := CreateLeaveRequest(ctx, conn, planner, map[string]any{
		"agent_id": fx.agent1, "start_date": "2026-09-20", "end_date": "2026-09-22", "leave_type": "annual",
	})
	check(t, err)
	if created.Status != "requested" || created.AgentID != fx.agent1 {
		t.Fatalf("got %+v, want a requested leave for agent1", created)
	}

	// end before start
	if _, err := CreateLeaveRequest(ctx, conn, planner, map[string]any{"agent_id": fx.agent1, "start_date": "2026-09-22", "end_date": "2026-09-20", "leave_type": "annual"}); errCode(err) != dataerr.CodeInvalid {
		t.Fatalf("end before start: got %v, want Invalid", err)
	}
	// overlapping clash
	if _, err := CreateLeaveRequest(ctx, conn, planner, map[string]any{"agent_id": fx.agent1, "start_date": "2026-09-21", "end_date": "2026-09-25", "leave_type": "sick"}); errCode(err) != dataerr.CodeConflict {
		t.Fatalf("overlapping leave: got %v, want Conflict", err)
	}
	// too many days
	if _, err := CreateLeaveRequest(ctx, conn, planner, map[string]any{"agent_id": fx.agent1, "start_date": "2026-10-01", "end_date": "2026-12-31", "leave_type": "annual"}); errCode(err) != dataerr.CodeInvalid {
		t.Fatalf("too many days: got %v, want Invalid", err)
	}
}

func TestCreateLeaveRequest_RefusesInactiveAgent(t *testing.T) {
	conn := openConn(t)
	rc, _ := adminCtx(t)
	ctx := context.Background()
	resetLeaveDeps()
	fx := seedRosterFixture(t, ctx, conn, rc)
	SeedLeaveAgentsForTest([]Agent{
		{BaseRecord: bd(fx.agent1, rc.CustomerID), Code: "SUR-1", NameEn: "Agent One", Kind: "field", HomeZoneID: &fx.zoneID, IsActive: false},
	})
	planner := roleCtx(rc.CustomerID, "00000000-0000-4000-8000-000000000402", access.RolePlanner)

	if _, err := CreateLeaveRequest(ctx, conn, planner, map[string]any{"agent_id": fx.agent1, "start_date": "2026-09-20", "end_date": "2026-09-22", "leave_type": "annual"}); errCode(err) != dataerr.CodeInvalid {
		t.Fatalf("inactive agent: got %v, want Invalid", err)
	}
}

func TestDecideLeave_ApproverIsPlannerNotRequester(t *testing.T) {
	conn := openConn(t)
	rc, _ := adminCtx(t)
	ctx := context.Background()
	resetLeaveDeps()
	fx := seedRosterFixture(t, ctx, conn, rc)
	SeedLeaveAgentsForTest([]Agent{
		{BaseRecord: bd(fx.agent1, rc.CustomerID), Code: "SUR-1", NameEn: "Agent One", Kind: "field", HomeZoneID: &fx.zoneID, IsActive: true},
	})
	requester := roleCtx(rc.CustomerID, "00000000-0000-4000-8000-000000000403", access.RolePlanner)
	created, err := CreateLeaveRequest(ctx, conn, requester, map[string]any{"agent_id": fx.agent1, "start_date": "2026-09-20", "end_date": "2026-09-20", "leave_type": "annual"})
	check(t, err)

	// The same person who entered it cannot decide it.
	if _, err := ApproveLeaveRequest(ctx, conn, requester, created.ID, nil); errCode(err) != dataerr.CodeForbidden {
		t.Fatalf("self-decide: got %v, want Forbidden", err)
	}

	other := roleCtx(rc.CustomerID, "00000000-0000-4000-8000-000000000404", access.RolePlanner)
	seedUserRow(t, ctx, conn, rc.CustomerID, other.UserID)
	approved, err := ApproveLeaveRequest(ctx, conn, other, created.ID, nil)
	check(t, err)
	if approved.Status != "approved" || approved.DecidedByUserID == nil {
		t.Fatalf("got %+v, want approved with a decider", approved)
	}

	// Deciding again is refused: already decided.
	if _, err := ApproveLeaveRequest(ctx, conn, other, created.ID, nil); errCode(err) != dataerr.CodeConflict {
		t.Fatalf("re-decide: got %v, want Conflict", err)
	}
}

func TestDecideLeave_OnlyPlannerMayDecide(t *testing.T) {
	conn := openConn(t)
	rc, _ := adminCtx(t)
	ctx := context.Background()
	resetLeaveDeps()
	fx := seedRosterFixture(t, ctx, conn, rc)
	SeedLeaveAgentsForTest([]Agent{
		{BaseRecord: bd(fx.agent1, rc.CustomerID), Code: "SUR-1", NameEn: "Agent One", Kind: "field", HomeZoneID: &fx.zoneID, IsActive: true},
	})
	requester := roleCtx(rc.CustomerID, "00000000-0000-4000-8000-000000000405", access.RolePlanner)
	created, err := CreateLeaveRequest(ctx, conn, requester, map[string]any{"agent_id": fx.agent1, "start_date": "2026-09-20", "end_date": "2026-09-20", "leave_type": "annual"})
	check(t, err)

	supervisor := roleCtx(rc.CustomerID, "00000000-0000-4000-8000-000000000406", access.RoleDispatchSupervisor)
	if _, err := ApproveLeaveRequest(ctx, conn, supervisor, created.ID, nil); errCode(err) != dataerr.CodeForbidden {
		t.Fatalf("dispatch supervisor (view only) deciding: got %v, want Forbidden", err)
	}
}

func TestGetLeaveCoverageEffect_ScheduledAgentShowsAGap(t *testing.T) {
	conn := openConn(t)
	rc, _ := adminCtx(t)
	ctx := context.Background()
	resetLeaveDeps()
	fx := seedRosterFixture(t, ctx, conn, rc)
	SeedLeaveAgentsForTest([]Agent{
		{BaseRecord: bd(fx.agent1, rc.CustomerID), Code: "SUR-1", NameEn: "Agent One", Kind: "field", HomeZoneID: &fx.zoneID, IsActive: true},
		{BaseRecord: bd(fx.agent2, rc.CustomerID), Code: "SUR-2", NameEn: "Agent Two", Kind: "field", HomeZoneID: &fx.zoneID, IsActive: true},
	})
	planner := roleCtx(rc.CustomerID, "00000000-0000-4000-8000-000000000407", access.RolePlanner)
	_, err := BuildRoster(ctx, conn, planner, map[string]any{"zone_id": fx.zoneID, "roster_date": "2026-09-14"})
	check(t, err)

	created, err := CreateLeaveRequest(ctx, conn, planner, map[string]any{"agent_id": fx.agent1, "start_date": "2026-09-14", "end_date": "2026-09-14", "leave_type": "annual"})
	check(t, err)

	effect, err := GetLeaveCoverageEffect(ctx, conn, rc, created.ID)
	check(t, err)
	if effect.ZoneID == nil || *effect.ZoneID != fx.zoneID {
		t.Fatalf("got %+v, want the zone the agent is homed in", effect)
	}
	if len(effect.Cells) == 0 {
		t.Fatalf("got no cells, want the roster to change on that day (the agent is scheduled)")
	}
}

func TestGetLeaveCoverageEffects_BatchMatchesSingle(t *testing.T) {
	conn := openConn(t)
	rc, _ := adminCtx(t)
	ctx := context.Background()
	resetLeaveDeps()
	fx := seedRosterFixture(t, ctx, conn, rc)
	SeedLeaveAgentsForTest([]Agent{
		{BaseRecord: bd(fx.agent1, rc.CustomerID), Code: "SUR-1", NameEn: "Agent One", Kind: "field", HomeZoneID: &fx.zoneID, IsActive: true},
	})
	planner := roleCtx(rc.CustomerID, "00000000-0000-4000-8000-000000000408", access.RolePlanner)
	created, err := CreateLeaveRequest(ctx, conn, planner, map[string]any{"agent_id": fx.agent1, "start_date": "2026-09-20", "end_date": "2026-09-20", "leave_type": "annual"})
	check(t, err)

	single, err := GetLeaveCoverageEffect(ctx, conn, rc, created.ID)
	check(t, err)
	batch, err := GetLeaveCoverageEffects(ctx, conn, rc, []string{created.ID})
	check(t, err)
	if len(batch) != 1 || batch[0].NewGapIntervals != single.NewGapIntervals || batch[0].SummaryEn != single.SummaryEn {
		t.Fatalf("got %+v, want it to match the single-request call %+v", batch, single)
	}
}

func TestListLeaveWindows_RecommendsSpareCapacityWeeks(t *testing.T) {
	conn := openConn(t)
	rc, _ := adminCtx(t)
	ctx := context.Background()
	resetLeaveDeps()
	fx := seedRosterFixture(t, ctx, conn, rc)
	SeedLeaveAgentsForTest(nil)

	page, err := ListLeaveWindows(ctx, conn, rc, LeaveWindowQuery{ZoneID: fx.zoneID, DateFrom: "2026-09-14", DateTo: "2026-09-27"})
	check(t, err)
	if len(page.Items) != 2 {
		t.Fatalf("got %d windows, want 2 (two full weeks)", len(page.Items))
	}
	for _, w := range page.Items {
		if w.ZoneID != fx.zoneID {
			t.Fatalf("got %+v, want the fixture zone", w)
		}
	}
}

func TestListLeaveWindows_RefusesRangeTooWide(t *testing.T) {
	conn := openConn(t)
	rc, _ := adminCtx(t)
	ctx := context.Background()
	resetLeaveDeps()
	_ = seedRosterFixture(t, ctx, conn, rc)

	_, err := ListLeaveWindows(ctx, conn, rc, LeaveWindowQuery{DateFrom: "2026-09-14", DateTo: "2027-06-01"})
	if errCode(err) != dataerr.CodeInvalid {
		t.Fatalf("got %v, want Invalid (more than 12 weeks)", err)
	}
}

func TestListLeaveRequests_ZoneScopedVisibility(t *testing.T) {
	conn := openConn(t)
	rc, _ := adminCtx(t)
	ctx := context.Background()
	resetLeaveDeps()
	fx := seedRosterFixture(t, ctx, conn, rc)
	SeedLeaveAgentsForTest([]Agent{
		{BaseRecord: bd(fx.agent1, rc.CustomerID), Code: "SUR-1", NameEn: "Agent One", Kind: "field", HomeZoneID: &fx.zoneID, IsActive: true},
	})
	planner := roleCtx(rc.CustomerID, "00000000-0000-4000-8000-000000000409", access.RolePlanner)
	_, err := CreateLeaveRequest(ctx, conn, planner, map[string]any{"agent_id": fx.agent1, "start_date": "2026-09-20", "end_date": "2026-09-20", "leave_type": "annual"})
	check(t, err)

	outsider := plannerCtx(rc.CustomerID, "00000000-0000-4000-8000-000000000410", []string{"00000000-0000-4000-8000-000000000499"})
	page, err := ListLeaveRequests(ctx, conn, outsider, LeaveRequestQuery{})
	check(t, err)
	if len(page.Items) != 0 {
		t.Fatalf("got %d, want 0 for a planner scoped to another zone", len(page.Items))
	}

	page, err = ListLeaveRequests(ctx, conn, rc, LeaveRequestQuery{})
	check(t, err)
	if len(page.Items) != 1 {
		t.Fatalf("got %d, want 1 for the whole-install admin", len(page.Items))
	}
}
