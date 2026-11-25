// SPDX-License-Identifier: AGPL-3.0-only

// Pure tests of adjustScenarioLines.
package business

import (
	"fmt"
	"testing"
)

const slDate = "2026-09-14"

func slPattern(id, code, from, to string) ShiftPattern {
	return ShiftPattern{
		BaseRecord: bdAt(id, "t1", "2026-09-01T00:00:00+03:00"), Code: code, Kind: "field", Status: "active",
		Normal: ShiftHours{Applies: true, StartTime: &from, EndTime: &to},
	}
}

func slPlan() *PlanReader {
	zone := "z1"
	plan := planWith(nil, nil, nil)
	plan.Patterns = []ShiftPattern{slPattern("pa", "DAY-A", "06:00", "14:00"), slPattern("pb", "DAY-B", "14:00", "22:00"), slPattern("pe", "EVENING", "18:00", "23:59")}
	for i := 0; i < 4; i++ {
		plan.Vehicles = append(plan.Vehicles, Vehicle{BaseRecord: bdAt(fmt.Sprintf("v%d", i), "t1", "2026-09-01T00:00:00+03:00"), Code: fmt.Sprintf("V%d", i), ZoneID: &zone, IsActive: true})
	}
	plan.prayerMemo = map[string][]PrayerMinute{"z1|" + slDate: {}}
	return plan
}

func slLine(i int, pattern string, from, to int, vehicle *string) RosterAssignment {
	zone, pid := "z1", pattern
	return RosterAssignment{
		BaseRecord: bdAt(fmt.Sprintf("l%d", i), "t1", "2026-09-01T00:00:00+03:00"), AgentID: fmt.Sprintf("s%d", i),
		ShiftPatternID: &pid, ZoneID: &zone, RosterDate: slDate, VehicleID: vehicle,
		StartAt: fmt.Sprintf("%sT%02d:00:00+03:00", slDate, from), EndAt: fmt.Sprintf("%sT%02d:00:00+03:00", slDate, to),
	}
}

func slBase() []RosterAssignment {
	v0, v1 := "v0", "v1"
	a := slLine(1, "pa", 6, 14, &v0)
	bs, be := slDate+"T10:00:00+03:00", slDate+"T10:30:00+03:00"
	a.BreakStartAt, a.BreakEndAt = &bs, &be
	return []RosterAssignment{a, slLine(2, "pb", 14, 22, &v1), slLine(3, "pa", 6, 14, nil)}
}

func slScenario() *Scenario {
	return &Scenario{BaseRecord: bdAt("sc1", "t1", "2026-09-01T00:00:00+03:00"), BaseDate: slDate}
}

func slChosen(plan *PlanReader, ids ...string) []ShiftPattern {
	var out []ShiftPattern
	for _, id := range ids {
		for _, p := range plan.Patterns {
			if p.ID == id {
				out = append(out, p)
			}
		}
	}
	return out
}

func TestAdjustScenarioLines_AddedAgentsOnlyAddCover(t *testing.T) {
	plan := slPlan()
	base := slBase()
	for _, tc := range []struct{ field, vehicles int }{{4, 0}, {4, 2}, {1, 5}, {0, 3}} {
		got, err := adjustScenarioLines(plan, slScenario(), "z1", slDate, base, slChosen(plan, "pa", "pb"), tc.field, tc.vehicles, false, nil)
		if err != nil {
			t.Fatal(err)
		}
		if len(got) != len(base)+tc.field {
			t.Fatalf("%+v: got %d lines, want %d", tc, len(got), len(base)+tc.field)
		}
		for i := range base {
			if got[i].StartAt != base[i].StartAt || got[i].EndAt != base[i].EndAt || fmt.Sprint(got[i].BreakStartAt) != fmt.Sprint(base[i].BreakStartAt) {
				t.Fatalf("%+v: roster line %d changed: %+v", tc, i, got[i])
			}
			if base[i].VehicleID != nil && (got[i].VehicleID == nil || *got[i].VehicleID != *base[i].VehicleID) {
				t.Fatalf("%+v: roster line %d lost its vehicle", tc, i)
			}
		}
		before, after := coverageSeries(base, slDate), coverageSeries(got, slDate)
		for i := 0; i < 96; i++ {
			if after.OnDuty[i] < before.OnDuty[i] || after.WithVehicle[i] < before.WithVehicle[i] {
				t.Fatalf("%+v: interval %d lost cover: on duty %d to %d, with vehicle %d to %d", tc, i, before.OnDuty[i], after.OnDuty[i], before.WithVehicle[i], after.WithVehicle[i])
			}
		}
	}
}

func TestAdjustScenarioLines_PatternsOnlyMoveLinesWhenTheSetDiffers(t *testing.T) {
	plan := slPlan()
	base := slBase()
	same, err := adjustScenarioLines(plan, slScenario(), "z1", slDate, base, slChosen(plan, "pa", "pb"), 0, 0, false, nil)
	if err != nil {
		t.Fatal(err)
	}
	for i := range base {
		if same[i].StartAt != base[i].StartAt || patternIDOf(same[i]) != patternIDOf(base[i]) {
			t.Fatalf("same pattern set moved line %d", i)
		}
	}
	moved, err := adjustScenarioLines(plan, slScenario(), "z1", slDate, base, slChosen(plan, "pa", "pb", "pe"), 0, 0, false, nil)
	if err != nil {
		t.Fatal(err)
	}
	if patternIDOf(moved[2]) != "pe" || moved[2].BreakStartAt == nil {
		t.Fatalf("third line should move to the evening pattern with a break, got %+v", moved[2])
	}
	if moved[0].VehicleID == nil || *moved[0].VehicleID != "v0" {
		t.Fatalf("a moved line keeps its vehicle")
	}
}

func TestAdjustScenarioLines_FewerVehiclesAndAgentsOnlyRemoveCover(t *testing.T) {
	plan := slPlan()
	base := slBase()
	got, err := adjustScenarioLines(plan, slScenario(), "z1", slDate, base, nil, -1, -1, false, nil)
	if err != nil {
		t.Fatal(err)
	}
	before, after := coverageSeries(base, slDate), coverageSeries(got, slDate)
	for i := 0; i < 96; i++ {
		if after.OnDuty[i] > before.OnDuty[i] || after.WithVehicle[i] > before.WithVehicle[i] {
			t.Fatalf("interval %d gained cover", i)
		}
	}
}
