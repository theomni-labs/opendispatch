// SPDX-License-Identifier: AGPL-3.0-only

package business

import (
	"context"
	"testing"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/access"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/dataerr"
)

func TestDistanceMeters_SanityAndZero(t *testing.T) {
	d := distanceMeters(24.7136, 46.6753, 24.7226, 46.6753)
	if d < 950 || d > 1050 {
		t.Fatalf("got %.1fm, want ~1000m for 0.009 deg latitude", d)
	}
	if distanceMeters(24.7, 46.7, 24.7, 46.7) != 0 {
		t.Fatalf("same point should be 0")
	}
}

func TestPeakStaffByPoint_ExcludesBreakAndPeaksOnOverlap(t *testing.T) {
	day := "2026-09-14"
	brkStart, brkEnd := day+"T11:00:00+03:00", day+"T11:30:00+03:00"
	rows := []standbyAssignment{
		{StandbyPointID: strp("p1"), RosterDate: day, StartAt: day + "T06:00:00+03:00", EndAt: day + "T14:00:00+03:00", BreakStartAt: &brkStart, BreakEndAt: &brkEnd},
		{StandbyPointID: strp("p1"), RosterDate: day, StartAt: day + "T06:00:00+03:00", EndAt: day + "T14:00:00+03:00"},
		{StandbyPointID: strp("p2"), RosterDate: day, StartAt: day + "T14:00:00+03:00", EndAt: day + "T22:00:00+03:00"},
	}
	peak := peakStaffByPoint(rows)
	if peak["p1"] != 2 {
		t.Fatalf("p1 peak = %d, want 2", peak["p1"])
	}
	if peak["p2"] != 1 {
		t.Fatalf("p2 peak = %d, want 1", peak["p2"])
	}
}

func TestCoverageOf_RadiusAndActiveFiltering(t *testing.T) {
	ResetStandbyForTest()
	UpsertZoneForTest(standbyZone{ID: "11111111-1111-4111-8111-111111111111", NameEn: "Zone One"})
	UpsertSubZoneForTest(standbySubZone{ID: "sz-near", ZoneID: "11111111-1111-4111-8111-111111111111", IsActive: true, Latitude: 24.71, Longitude: 46.68, NameEn: "Near"})
	UpsertSubZoneForTest(standbySubZone{ID: "sz-far", ZoneID: "11111111-1111-4111-8111-111111111111", IsActive: true, Latitude: 25.5, Longitude: 47.5, NameEn: "Far"})
	UpsertStandbyPointForTest(standbyPoint{ID: "22222222-2222-4222-8222-222222222222", ZoneID: "11111111-1111-4111-8111-111111111111", IsActive: true, Latitude: 24.71, Longitude: 46.68, CoverageRadiusM: 5000, NameEn: "Point A"})
	UpsertStandbyPointForTest(standbyPoint{ID: "33333333-3333-4333-8333-333333333333", ZoneID: "11111111-1111-4111-8111-111111111111", IsActive: false, Latitude: 24.71, Longitude: 46.68, CoverageRadiusM: 50000, NameEn: "Retired point"})

	admin := roleCtx("t1", "u1", access.RoleAdministrator)
	result := coverageOf(context.Background(), admin, "11111111-1111-4111-8111-111111111111", map[string]int{"22222222-2222-4222-8222-222222222222": 1})
	if len(result.Areas) != 1 {
		t.Fatalf("got %d areas, want 1 (inactive point excluded)", len(result.Areas))
	}
	area := result.Areas[0]
	if len(area.CoveredSubZoneIDs) != 1 || area.CoveredSubZoneIDs[0] != "sz-near" {
		t.Fatalf("covered = %v, want [sz-near]", area.CoveredSubZoneIDs)
	}
	if len(result.Uncovered) != 1 || result.Uncovered[0] != "sz-far" {
		t.Fatalf("uncovered = %v, want [sz-far]", result.Uncovered)
	}
}

func TestGetCoverage_RoleAccessAndZoneNotFound(t *testing.T) {
	ResetStandbyForTest()
	UpsertZoneForTest(standbyZone{ID: "11111111-1111-4111-8111-111111111111", NameEn: "Zone One"})

	viewRoles := []access.Role{access.RoleAdministrator, access.RoleDispatchSupervisor, access.RoleDispatcher, access.RolePlanner, access.RoleViewerAuditor}
	for _, r := range viewRoles {
		ctx := roleCtx("t1", "u1", r)
		if _, err := GetCoverage(ctx, CoverageQuery{ZoneID: strp("11111111-1111-4111-8111-111111111111"), Date: strp("2026-09-14")}); err != nil {
			t.Fatalf("%s: got %v, want nil", r, err)
		}
	}
	for _, r := range []access.Role{access.RoleRemoteTeamLead, access.RoleChangeApprover} {
		ctx := roleCtx("t1", "u1", r)
		_, err := GetCoverage(ctx, CoverageQuery{ZoneID: strp("11111111-1111-4111-8111-111111111111"), Date: strp("2026-09-14")})
		if errCode(err) != dataerr.CodeForbidden {
			t.Fatalf("%s: got %v, want Forbidden", r, err)
		}
	}

	admin := roleCtx("t1", "u1", access.RoleAdministrator)
	_, err := GetCoverage(admin, CoverageQuery{ZoneID: strp("00000000-0000-4000-8000-000000000000"), Date: strp("2026-09-14")})
	if errCode(err) != dataerr.CodeNotFound {
		t.Fatalf("unknown zone: got %v, want NotFound", err)
	}
	_, err = GetCoverage(admin, CoverageQuery{Date: strp("2026-09-14")})
	if errCode(err) != dataerr.CodeInvalid {
		t.Fatalf("missing zone_id: got %v, want Invalid", err)
	}
	_, err = GetCoverage(admin, CoverageQuery{ZoneID: strp("11111111-1111-4111-8111-111111111111"), Date: strp("later")})
	if errCode(err) != dataerr.CodeInvalid {
		t.Fatalf("bad date: got %v, want Invalid", err)
	}
}

// seedRecommendScenario: one overstaffed point, one
// empty point reaching an uncovered sub-zone.
func seedRecommendScenario(t *testing.T) {
	t.Helper()
	ResetStandbyForTest()
	UpsertZoneForTest(standbyZone{ID: "11111111-1111-4111-8111-111111111111", NameEn: "Zone One"})
	UpsertSubZoneForTest(standbySubZone{ID: "sz-a", ZoneID: "11111111-1111-4111-8111-111111111111", IsActive: true, Latitude: 24.71, Longitude: 46.68, NameEn: "A"})
	UpsertSubZoneForTest(standbySubZone{ID: "sz-b", ZoneID: "11111111-1111-4111-8111-111111111111", IsActive: true, Latitude: 25.00, Longitude: 47.00, NameEn: "B"})
	UpsertStandbyPointForTest(standbyPoint{ID: "44444444-4444-4444-8444-444444444444", ZoneID: "11111111-1111-4111-8111-111111111111", IsActive: true, Latitude: 24.71, Longitude: 46.68, CoverageRadiusM: 3000, NameEn: "Busy Point"})
	UpsertStandbyPointForTest(standbyPoint{ID: "55555555-5555-4555-8555-555555555555", ZoneID: "11111111-1111-4111-8111-111111111111", IsActive: true, Latitude: 25.00, Longitude: 47.00, CoverageRadiusM: 3000, NameEn: "Empty Point"})

	roster := standbyRoster{ID: "r1", ZoneID: "11111111-1111-4111-8111-111111111111", RosterDate: "2026-09-14", Status: "draft", CreatedAt: "2026-09-13T00:00:00+03:00"}
	UpsertRosterForTest(roster)
	UpsertRosterAssignmentForTest(standbyAssignment{ID: "a1", RosterID: "r1", ZoneID: "11111111-1111-4111-8111-111111111111", StandbyPointID: strp("44444444-4444-4444-8444-444444444444"), RosterDate: "2026-09-14", StartAt: "2026-09-14T06:00:00+03:00", EndAt: "2026-09-14T14:00:00+03:00"})
	UpsertRosterAssignmentForTest(standbyAssignment{ID: "a2", RosterID: "r1", ZoneID: "11111111-1111-4111-8111-111111111111", StandbyPointID: strp("44444444-4444-4444-8444-444444444444"), RosterDate: "2026-09-14", StartAt: "2026-09-14T06:00:00+03:00", EndAt: "2026-09-14T14:00:00+03:00"})
}

func TestRecommendStandbyMoves_SuggestsMoveThatClosesGap(t *testing.T) {
	seedRecommendScenario(t)
	planner := roleCtx("t1", "u1", access.RolePlanner)

	before, err := GetCoverage(planner, CoverageQuery{ZoneID: strp("11111111-1111-4111-8111-111111111111"), Date: strp("2026-09-14")})
	check(t, err)
	if len(before.UncoveredSubZoneIDs) != 1 || before.UncoveredSubZoneIDs[0] != "sz-b" {
		t.Fatalf("baseline uncovered = %v, want [sz-b]", before.UncoveredSubZoneIDs)
	}

	rec, err := RecommendStandbyMoves(planner, CoverageQuery{ZoneID: strp("11111111-1111-4111-8111-111111111111"), Date: strp("2026-09-14")})
	check(t, err)
	if len(rec.Moves) != 1 {
		t.Fatalf("got %d moves, want 1", len(rec.Moves))
	}
	move := rec.Moves[0]
	if move.FromStandbyPointID != "44444444-4444-4444-8444-444444444444" || move.ToStandbyPointID != "55555555-5555-4555-8555-555555555555" {
		t.Fatalf("move = %+v, want p-busy -> p-empty", move)
	}
	if len(move.NewlyCoveredSubZoneIDs) != 1 || move.NewlyCoveredSubZoneIDs[0] != "sz-b" {
		t.Fatalf("newly covered = %v, want [sz-b]", move.NewlyCoveredSubZoneIDs)
	}
	if rec.UncoveredAfter != 0 {
		t.Fatalf("uncovered_after = %d, want 0", rec.UncoveredAfter)
	}
}

func TestApplyStandbyMove_HappyPathAndGuards(t *testing.T) {
	seedRecommendScenario(t)
	planner := roleCtx("t1", "u1", access.RolePlanner)

	dispatcher := roleCtx("t1", "u2", access.RoleDispatcher)
	_, err := ApplyStandbyMove(dispatcher, map[string]any{"zone_id": "11111111-1111-4111-8111-111111111111", "roster_date": "2026-09-14", "from_standby_point_id": "44444444-4444-4444-8444-444444444444", "to_standby_point_id": "55555555-5555-4555-8555-555555555555", "agents": 1.0})
	if errCode(err) != dataerr.CodeForbidden {
		t.Fatalf("dispatcher: got %v, want Forbidden", err)
	}

	_, err = ApplyStandbyMove(planner, map[string]any{"zone_id": "11111111-1111-4111-8111-111111111111", "roster_date": "2026-09-14", "from_standby_point_id": "44444444-4444-4444-8444-444444444444", "to_standby_point_id": "44444444-4444-4444-8444-444444444444", "agents": 1.0})
	if errCode(err) != dataerr.CodeInvalid {
		t.Fatalf("same point: got %v, want Invalid", err)
	}

	_, err = ApplyStandbyMove(planner, map[string]any{"zone_id": "11111111-1111-4111-8111-111111111111", "roster_date": "2026-09-14", "from_standby_point_id": "44444444-4444-4444-8444-444444444444", "to_standby_point_id": "55555555-5555-4555-8555-555555555555", "agents": 40.0})
	if errCode(err) != dataerr.CodeConflict {
		t.Fatalf("not enough agents: got %v, want Conflict", err)
	}

	moved, err := ApplyStandbyMove(planner, map[string]any{"zone_id": "11111111-1111-4111-8111-111111111111", "roster_date": "2026-09-14", "from_standby_point_id": "44444444-4444-4444-8444-444444444444", "to_standby_point_id": "55555555-5555-4555-8555-555555555555", "agents": 1.0})
	check(t, err)
	var busyCount, emptyCount int
	for _, a := range moved.Areas {
		if a.StandbyPointID == "44444444-4444-4444-8444-444444444444" {
			busyCount = a.RecommendedAgents
		}
		if a.StandbyPointID == "55555555-5555-4555-8555-555555555555" {
			emptyCount = a.RecommendedAgents
		}
	}
	if busyCount != 1 || emptyCount != 1 {
		t.Fatalf("after move: p-busy=%d p-empty=%d, want 1 and 1", busyCount, emptyCount)
	}

	UpsertRosterForTest(standbyRoster{ID: "r1", ZoneID: "11111111-1111-4111-8111-111111111111", RosterDate: "2026-09-14", Status: "published", CreatedAt: "2026-09-13T00:00:00+03:00"})
	_, err = ApplyStandbyMove(planner, map[string]any{"zone_id": "11111111-1111-4111-8111-111111111111", "roster_date": "2026-09-14", "from_standby_point_id": "55555555-5555-4555-8555-555555555555", "to_standby_point_id": "44444444-4444-4444-8444-444444444444", "agents": 1.0})
	if errCode(err) != dataerr.CodeConflict {
		t.Fatalf("published roster: got %v, want Conflict", err)
	}
}
