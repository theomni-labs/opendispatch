// SPDX-License-Identifier: AGPL-3.0-only

// Live: planning measures against the gap view.
package business

import (
	"context"
	"math"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/access"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/dataerr"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
)

func TestOverCapacity_MatchesTheGapView(t *testing.T) {
	conn := openConn(t)
	rc, _ := adminCtx(t)
	ctx := context.Background()
	resetRosterDeps()
	fx := seedRosterFixture(t, ctx, conn, rc)
	planner := roleCtx(rc.CustomerID, "00000000-0000-4000-8000-000000000101", access.RolePlanner)
	_, err := BuildRoster(ctx, conn, planner, map[string]any{"zone_id": fx.zoneID, "roster_date": "2026-09-14"})
	check(t, err)

	got, err := GetOverCapacity(ctx, conn, rc, PeriodQuery{DateFrom: "2026-09-13", DateTo: "2026-09-15", ZoneID: fx.zoneID})
	check(t, err)
	var cells []GapCell
	for _, d := range []string{"2026-09-13", "2026-09-14", "2026-09-15"} {
		view, err := GetGapSurplus(ctx, conn, rc, GapQuery{ZoneID: fx.zoneID, Date: d})
		check(t, err)
		cells = append(cells, view.Cells...)
	}
	runs, minutes, peak := 0, 0, 0
	for i, c := range cells {
		if c.Kind != "surplus" {
			continue
		}
		if i == 0 || cells[i-1].Kind != "surplus" {
			runs++
		}
		minutes += 15
		peak = max(peak, c.Delta)
	}
	if len(got.Zones) != 1 || got.Zones[0].WindowCount != runs || got.Zones[0].PeakSurplus != peak || !got.Illustrative {
		t.Fatalf("got %+v, want %d runs, peak %d", got.Zones, runs, peak)
	}
	sum := 0
	for _, w := range got.Zones[0].Windows {
		sum += w.Minutes
	}
	if sum != minutes || runs == 0 {
		t.Fatalf("minutes %d, want %d (runs %d)", sum, minutes, runs)
	}
}

func TestOverrideRate_CountsApprovedOverrides(t *testing.T) {
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
	q := PeriodQuery{DateFrom: "2026-09-13", DateTo: "2026-09-15", ZoneID: fx.zoneID}
	before, err := GetOverrideRate(ctx, conn, rc, q)
	check(t, err)
	if len(before.Zones) != 1 || before.Zones[0].Assignments != len(page.Items) || before.Zones[0].Overridden != 0 || before.TargetShare != 0.05 {
		t.Fatalf("before %+v", before)
	}
	o, err := CreateOverride(ctx, conn, planner, roster.ID, map[string]any{
		"roster_assignment_id": page.Items[0].ID, "change_type": "change_vehicle", "reason_code": "vehicle_unavailable", "vehicle_id": fx.vehicleID,
	})
	check(t, err)
	pending, err := GetOverrideRate(ctx, conn, rc, q)
	check(t, err)
	if pending.Zones[0].Overridden != 0 {
		t.Fatal("a pending override counted")
	}
	supervisor := roleCtx(rc.CustomerID, "00000000-0000-4000-8000-000000000104", access.RoleDispatchSupervisor)
	_, err = ApproveOverride(ctx, conn, supervisor, o.ID, nil)
	check(t, err)
	after, err := GetOverrideRate(ctx, conn, rc, q)
	check(t, err)
	z := after.Zones[0]
	if z.Overridden != 1 || z.Share == nil || *z.Share != math.Round(1/float64(z.Assignments)*1e4)/1e4 || after.Total.Overridden != 1 {
		t.Fatalf("after %+v", after)
	}
}

func TestUtilization_RosterOrHomeShiftsAndCases(t *testing.T) {
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
	line := page.Items[0]
	start, err := time.Parse(time.RFC3339, line.StartAt)
	check(t, err)
	_, err = tenancy.WithTenant(ctx, conn.Pool, rc.CustomerID, func(ctx context.Context, tx pgx.Tx) (struct{}, error) {
		_, err := tx.Exec(ctx, `INSERT INTO cases (tenant_id, id, data_source, case_number, registered_at, zone_id, handling, assigned_at, on_scene_completed_at, agent_id, external_id)
			VALUES ($1,$2,'SYNTHETIC','UT-1',$3,$4,'field',$5,$6,$7,'UT-1')`, rc.CustomerID, datactx.NewID(), start.Add(50*time.Minute), fx.zoneID,
			start.Add(time.Hour), start.Add(2*time.Hour), line.AgentID)
		return struct{}{}, err
	})
	check(t, err)
	got, err := GetUtilization(ctx, conn, rc, PeriodQuery{DateFrom: "2026-09-13", DateTo: "2026-09-14", ZoneID: fx.zoneID})
	check(t, err)
	z := got.Zones[0]
	if z.RosteredDays != 1 || z.ProjectedDays != 1 || z.WorkedHours != 1 || z.AvailableHours <= 0 || z.Share == nil {
		t.Fatalf("zone %+v", z)
	}
	worked := 0.0
	for _, s := range z.Shifts {
		worked += s.WorkedHours
		if s.ShiftPatternID == patternIDOf(line) && s.WorkedHours != 1 {
			t.Fatalf("shift %+v", s)
		}
	}
	if worked != 1 {
		t.Fatalf("shifts %+v", z.Shifts)
	}
}

func TestPlanningMeasures_RejectAndScope(t *testing.T) {
	conn := openConn(t)
	rc, tenantID := adminCtx(t)
	ctx := context.Background()
	for _, q := range []PeriodQuery{
		{}, {DateFrom: "2026-09-13"}, {DateFrom: "2026-09-15", DateTo: "2026-09-13"},
		{DateFrom: "2026-08-31", DateTo: "2026-10-01"}, {DateFrom: "2026-09-13", DateTo: "2026-09-13", ZoneID: "nope"},
	} {
		if _, err := GetOverCapacity(ctx, conn, rc, q); errCode(err) != dataerr.CodeInvalid {
			t.Fatalf("%+v: want invalid, got %v", q, err)
		}
	}
	dispatcher := roleCtx(tenantID, "00000000-0000-4000-8000-000000000102", access.RoleDispatcher)
	if _, err := GetOverCapacity(ctx, conn, dispatcher, PeriodQuery{DateFrom: "2026-09-13", DateTo: "2026-09-13"}); errCode(err) != dataerr.CodeForbidden {
		t.Fatalf("dispatcher: got %v", err)
	}
	fx := seedRosterFixture(t, ctx, conn, rc)
	other := plannerCtx(tenantID, "00000000-0000-4000-8000-000000000103", []string{"00000000-0000-4000-8000-0000000000aa"})
	if _, err := GetOverCapacity(ctx, conn, other, PeriodQuery{DateFrom: "2026-09-13", DateTo: "2026-09-13", ZoneID: fx.zoneID}); errCode(err) != dataerr.CodeNotFound {
		t.Fatalf("out of scope: got %v", err)
	}
	mine, err := GetOverCapacity(ctx, conn, other, PeriodQuery{DateFrom: "2026-09-13", DateTo: "2026-09-13"})
	check(t, err)
	if len(mine.Zones) != 0 {
		t.Fatalf("scoped planner saw %d zones", len(mine.Zones))
	}
}
