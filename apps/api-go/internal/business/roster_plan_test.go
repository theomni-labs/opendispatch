// SPDX-License-Identifier: AGPL-3.0-only

// Pure-function tests. loadPlan/projectLines/
// scenarioZonePlans need live Postgres, covered
// together with rosters.go's live test.
package business

import (
	"testing"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"
)

func bdAt(id, tenant, createdAt string) datactx.BaseRecord {
	return datactx.BaseRecord{ID: id, TenantID: tenant, CreatedAt: createdAt, UpdatedAt: createdAt, DataSource: "SYNTHETIC"}
}

func planWith(rosters []Roster, lines map[string][]RosterAssignment, leave []LeaveRequest) *PlanReader {
	return &PlanReader{
		Rosters: rosters, LinesByRoster: lines, ApprovedLeave: leave,
		Factor: func(string, string, string) float64 { return 1 },
	}
}

func TestRosterFor_PicksNewestNonSuperseded(t *testing.T) {
	plan := planWith([]Roster{
		{BaseRecord: bdAt("r1", "t1", "2026-09-01T00:00:00+03:00"), ZoneID: "z1", RosterDate: "2026-09-14", Status: "draft"},
		{BaseRecord: bdAt("r2", "t1", "2026-09-02T00:00:00+03:00"), ZoneID: "z1", RosterDate: "2026-09-14", Status: "submitted"},
		{BaseRecord: bdAt("r3", "t1", "2026-09-03T00:00:00+03:00"), ZoneID: "z1", RosterDate: "2026-09-14", Status: "superseded"},
	}, nil, nil)
	got := rosterFor(plan, "z1", "2026-09-14")
	if got == nil || got.ID != "r2" {
		t.Fatalf("got %+v, want r2 (newest non-superseded)", got)
	}
}

func TestOnLeave_WithinRangeInclusive(t *testing.T) {
	plan := planWith(nil, nil, []LeaveRequest{{AgentID: "s1", StartDate: "2026-09-10", EndDate: "2026-09-12"}})
	if !onLeave(plan, "s1", "2026-09-10") || !onLeave(plan, "s1", "2026-09-12") {
		t.Fatalf("boundary dates should count as on leave")
	}
	if onLeave(plan, "s1", "2026-09-13") {
		t.Fatalf("day after the range should not count")
	}
	if onLeave(plan, "s2", "2026-09-11") {
		t.Fatalf("a different agent should not be on leave")
	}
}

func TestDutyLines_CarriesNightShiftPastMidnight(t *testing.T) {
	zone := "z1"
	today := Roster{BaseRecord: bd("today", "t1"), ZoneID: zone, RosterDate: "2026-09-14", Status: "approved"}
	yesterday := Roster{BaseRecord: bd("yesterday", "t1"), ZoneID: zone, RosterDate: "2026-09-13", Status: "approved"}
	lines := map[string][]RosterAssignment{
		"today":     {{BaseRecord: bd("a1", "t1"), RosterID: "today", AgentID: "s1", ZoneID: &zone, RosterDate: "2026-09-14", StartAt: "2026-09-14T06:00:00+03:00", EndAt: "2026-09-14T14:00:00+03:00"}},
		"yesterday": {{BaseRecord: bd("a2", "t1"), RosterID: "yesterday", AgentID: "s2", ZoneID: &zone, RosterDate: "2026-09-13", StartAt: "2026-09-13T22:00:00+03:00", EndAt: "2026-09-14T06:00:00+03:00"}},
	}
	plan := planWith([]Roster{today, yesterday}, lines, nil)
	got := dutyLines(plan, zone, "2026-09-14")
	if len(got) != 2 {
		t.Fatalf("got %d lines, want 2 (today's line plus yesterday's night shift)", len(got))
	}
}

func TestDutyLines_ExcludesApprovedLeave(t *testing.T) {
	zone := "z1"
	today := Roster{BaseRecord: bd("today", "t1"), ZoneID: zone, RosterDate: "2026-09-14", Status: "approved"}
	lines := map[string][]RosterAssignment{
		"today": {{BaseRecord: bd("a1", "t1"), RosterID: "today", AgentID: "s1", ZoneID: &zone, RosterDate: "2026-09-14", StartAt: "2026-09-14T06:00:00+03:00", EndAt: "2026-09-14T14:00:00+03:00"}},
	}
	plan := planWith([]Roster{today}, lines, []LeaveRequest{{AgentID: "s1", StartDate: "2026-09-14", EndDate: "2026-09-14"}})
	if got := dutyLines(plan, zone, "2026-09-14"); len(got) != 0 {
		t.Fatalf("got %d lines, want 0 (the only agent is on leave)", len(got))
	}
}

func TestCoverageSeries_CountsOnDutyAndWithVehicleExcludingBreak(t *testing.T) {
	zone := "z1"
	vehicle := "v1"
	line := RosterAssignment{
		ZoneID: &zone, RosterDate: "2026-09-14", StartAt: "2026-09-14T06:00:00+03:00", EndAt: "2026-09-14T10:00:00+03:00",
		BreakStartAt: strp("2026-09-14T08:00:00+03:00"), BreakEndAt: strp("2026-09-14T08:30:00+03:00"), VehicleID: &vehicle,
	}
	series := coverageSeries([]RosterAssignment{line}, "2026-09-14")
	// 06:00-10:00 is 16 quarters; the break removes 2.
	total := 0
	for _, n := range series.OnDuty {
		total += n
	}
	if total != 14 {
		t.Fatalf("got %d on-duty quarters, want 14 (16 minus a 2-quarter break)", total)
	}
	if series.WithVehicle[24] != 1 {
		t.Fatalf("quarter 24 should show the vehicle")
	}
	if series.OnDuty[32] != 0 {
		t.Fatalf("quarter 32 (08:00) is inside the break, should be 0")
	}
}

func TestGapCells_ClassifiesBalancedSurplusAndGapCauses(t *testing.T) {
	series := CoverageSeries{OnDuty: make([]int, 96), WithVehicle: make([]int, 96)}
	series.OnDuty[0], series.WithVehicle[0] = 2, 2 // balanced
	series.OnDuty[1], series.WithVehicle[1] = 4, 4 // surplus
	series.OnDuty[2], series.WithVehicle[2] = 3, 1 // gap, vehicles (enough people, not enough vehicles)
	series.OnDuty[3], series.WithVehicle[3] = 1, 1 // gap, people (short by 2)
	required := make([]int, 96)
	required[0], required[1], required[2], required[3] = 2, 2, 3, 3
	cells := gapCells("z1", "2026-09-14", series, required, GeographyInput{}, 1)
	if cells[0].Kind != "balanced" {
		t.Fatalf("interval 0: got %q, want balanced", cells[0].Kind)
	}
	if cells[1].Kind != "surplus" || cells[1].Cause == nil || *cells[1].Cause != "people" {
		t.Fatalf("interval 1: got %+v, want surplus/people", cells[1])
	}
	if cells[2].Kind != "gap" || cells[2].Cause == nil || *cells[2].Cause != "vehicles" {
		t.Fatalf("interval 2: got %+v, want gap/vehicles (onDuty>=need)", cells[2])
	}
	if cells[3].Kind != "gap" || cells[3].Cause == nil || *cells[3].Cause != "people" {
		t.Fatalf("interval 3: got %+v, want gap/people", cells[3])
	}
}

func TestGapCells_GeographyCauseWhenShortByOneAndUncovered(t *testing.T) {
	series := CoverageSeries{OnDuty: make([]int, 96), WithVehicle: make([]int, 96)}
	series.OnDuty[0], series.WithVehicle[0] = 1, 1
	required := make([]int, 96)
	required[0] = 2
	geo := GeographyInput{Uncovered: 1, SubZones: 3, StaffedPoints: 1}
	cells := gapCells("z1", "2026-09-14", series, required, geo, 1)
	if cells[0].Kind != "gap" || cells[0].Cause == nil || *cells[0].Cause != "geography" {
		t.Fatalf("got %+v, want gap/geography (short by 1, an uncovered sub-zone, a staffed point)", cells[0])
	}
}

func TestCountCells_TalliesGapsAndSurpluses(t *testing.T) {
	cells := []GapCell{{Kind: "gap"}, {Kind: "gap"}, {Kind: "surplus"}, {Kind: "balanced"}}
	gaps, surpluses := countCells(cells)
	if gaps != 2 || surpluses != 1 {
		t.Fatalf("got gaps=%d surpluses=%d, want 2/1", gaps, surpluses)
	}
}

func TestRequiredSeries_ScalesBaselineByFactor(t *testing.T) {
	resetSettings(t)
	plan := &PlanReader{
		Baseline: &OptimizerBaseline{Date: "2026-09-14", Required: map[string][]int{"z1": func() []int { s := make([]int, 96); s[10] = 4; return s }()},
			CasesPerInterval: map[string]float64{"z1": 0.25}},
		Factor: func(string, string, string) float64 { return 0.5 },
	}
	// default: duration, 20 + 30 + 10 min a case
	got := requiredSeries(plan, "z1", "2026-09-15")
	if got[10] != 2 {
		t.Fatalf("got %d, want 2 (4 scaled by 0.5)", got[10])
	}
	plan.Baseline.CasesPerInterval = nil
	if got := requiredSeries(plan, "z1", "2026-09-15"); got[10] != 8 {
		t.Fatalf("got %d, want 8 (4 at capacity 1, x0.5 x4)", got[10])
	}
	putSetting(t, demandMethodKey, demandRate)
	plan.demand, plan.Baseline.CasesPerInterval = nil, map[string]float64{"z1": defaultCustomerCases}
	if got := requiredSeries(plan, "z1", "2026-09-15"); got[10] != 2 {
		t.Fatalf("customer: got %d, want 2", got[10])
	}
}

func TestReadBaseline_FixtureCountsAtItsOwnCapacity(t *testing.T) {
	fixture, err := readBaseline()
	if err != nil || fixture == nil || len(fixture.Required) == 0 {
		t.Fatalf("fixture baseline: %v", err)
	}
	for zoneID := range fixture.Required {
		if fixture.CasesPerInterval[zoneID] != fixtureCasesPerInterval {
			t.Fatalf("fixture %s at %v", zoneID, fixture.CasesPerInterval[zoneID])
		}
	}
}

func TestRequiredSeries_ZeroWithNoBaseline(t *testing.T) {
	plan := &PlanReader{Factor: func(string, string, string) float64 { return 1 }}
	got := requiredSeries(plan, "z1", "2026-09-14")
	for _, n := range got {
		if n != 0 {
			t.Fatalf("got %v, want all zeros with no baseline", got)
		}
	}
}

func TestPatternHours_RamadanOverrideAndOvernightWrap(t *testing.T) {
	normalStart, normalEnd := "22:00", "06:00"
	pattern := ShiftPattern{Normal: ShiftHours{Applies: true, StartTime: &normalStart, EndTime: &normalEnd}}
	startMin, endMin, ok := patternHours(pattern, false)
	if !ok || startMin != 1320 || endMin != 1800 {
		t.Fatalf("got start=%d end=%d ok=%v, want 1320/1800 (wraps past midnight)", startMin, endMin, ok)
	}
	ramStart, ramEnd := "20:00", "04:00"
	pattern.Ramadan = ShiftHours{Applies: true, StartTime: &ramStart, EndTime: &ramEnd}
	rStart, rEnd, ok := patternHours(pattern, true)
	if !ok || rStart != 1200 || rEnd != 1680 {
		t.Fatalf("got start=%d end=%d, want the Ramadan hours (1200/1680)", rStart, rEnd)
	}
}

func TestPatternHours_NotApplicableReturnsFalse(t *testing.T) {
	pattern := ShiftPattern{Normal: ShiftHours{Applies: false}}
	if _, _, ok := patternHours(pattern, false); ok {
		t.Fatalf("a pattern with no hours on this date should return ok=false")
	}
}

func TestPluralWord_SingularAndPlural(t *testing.T) {
	if got := pluralWord(1, "agent", "agents"); got != "1 agent" {
		t.Fatalf("got %q, want singular", got)
	}
	if got := pluralWord(2, "agent", "agents"); got != "2 agents" {
		t.Fatalf("got %q, want plural", got)
	}
}
