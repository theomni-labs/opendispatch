// SPDX-License-Identifier: AGPL-3.0-only

// Pure tests for simulation.go.
package business

import (
	"context"
	"math"
	"testing"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/dataerr"
)

func resetSimDeps() {
	ResetForecastCoreForTest()
	ResetSimZonesForTest()
	ResetSimulationsForTest()
}

func TestCoverageRatio_ClampedAndZeroRequired(t *testing.T) {
	if got := coverageRatio(nil); got != 1 {
		t.Fatalf("got %v, want 1 with no cells", got)
	}
	cells := []GapCell{{Required: 2, Planned: 4}, {Required: 2, Planned: 1}}
	// min(4,2)+min(1,2)=3, over required 4 -> 0.75.
	if got := coverageRatio(cells); math.Abs(got-0.75) > 1e-9 {
		t.Fatalf("got %v, want 0.75", got)
	}
	over := []GapCell{{Required: 1, Planned: 5}}
	if got := coverageRatio(over); got != 1 {
		t.Fatalf("got %v, want 1 (clamped, never exceeds full coverage)", got)
	}
}

func TestSimReading_NullShareWhenZeroCases(t *testing.T) {
	r := simReading(3, 0)
	if r.Share != nil {
		t.Fatalf("got %v, want a nil share with zero cases", r.Share)
	}
	r2 := simReading(3, 4)
	if r2.Share == nil || *r2.Share != 0.75 {
		t.Fatalf("got %+v, want share 0.75", r2)
	}
}

func TestCasesByZone_CountsFieldAndAll(t *testing.T) {
	resetSimDeps()
	SeedCasesForTest([]Case{
		{ID: "a", ZoneID: "z1", Handling: "field", RegisteredAt: "2026-09-14T09:00:00+03:00"},
		{ID: "b", ZoneID: "z1", Handling: "remote_inferred", RegisteredAt: "2026-09-14T10:00:00+03:00"},
		{ID: "c", ZoneID: "z1", Handling: "field", RegisteredAt: "2026-09-13T10:00:00+03:00"},
	})
	counts := casesByZone("2026-09-14")
	if counts["z1"].All != 2 || counts["z1"].Field != 1 {
		t.Fatalf("got %+v, want 2 all, 1 field for 2026-09-14", counts["z1"])
	}
}

func TestHistoryDates_MinMaxOverSeededCases(t *testing.T) {
	resetSimDeps()
	SeedCasesForTest([]Case{
		{ID: "a", RegisteredAt: "2026-09-12T09:00:00+03:00"},
		{ID: "b", RegisteredAt: "2026-09-14T09:00:00+03:00"},
	})
	h := historyDates()
	if h == nil || h.First != "2026-09-12" || h.Last != "2026-09-14" {
		t.Fatalf("got %+v, want 2026-09-12 to 2026-09-14", h)
	}
	resetSimDeps()
	// Case has a committed fixture that resetSimDeps'
	// reset would otherwise lazily reseed; force
	// genuinely empty for this case.
	forecastMu.Lock()
	forecastSeeded = true
	forecastMu.Unlock()
	if historyDates() != nil {
		t.Fatalf("got non-nil, want nil with no cases")
	}
}

func TestServiceLevelOf_SumsAndWeightsByFieldCount(t *testing.T) {
	m1, m2 := 400, 800
	rows := []ZoneServiceLevel{
		{ZoneID: "z1", CaseCount: 10, FieldCaseCount: 8, FromRegistration: simReading(2, 8), FromAssignment: simReading(4, 8), MedianAssignedToArrivedSecond: &m1},
		{ZoneID: "z2", CaseCount: 5, FieldCaseCount: 2, FromRegistration: simReading(1, 2), FromAssignment: simReading(1, 2), MedianAssignedToArrivedSecond: &m2},
	}
	level := serviceLevelOf(rows)
	if level.CaseCount != 15 || level.FieldCaseCount != 10 {
		t.Fatalf("got %+v, want case_count 15, field_case_count 10", level)
	}
	// weighted median: (400*8 + 800*2) / 10 = 480.
	if level.AssignedToArrived.MedianSeconds == nil || *level.AssignedToArrived.MedianSeconds != 480 {
		t.Fatalf("got %+v, want weighted median 480", level.AssignedToArrived.MedianSeconds)
	}
	if level.FromAssignment.WithinCount != 5 || level.FromAssignment.CaseCount != 10 {
		t.Fatalf("got %+v, want within=5 case=10", level.FromAssignment)
	}
}

func TestSimulateZones_RejectsDateOutsideHistory(t *testing.T) {
	resetSimDeps()
	rc, _ := adminCtx(t)
	SeedCasesForTest([]Case{{ID: "a", ZoneID: "z1", RegisteredAt: "2026-09-14T09:00:00+03:00"}})
	_, err := simulateZones(context.Background(), rc, "2026-09-01", "nearest", []ZoneCoverage{{ZoneID: "z1", Ratio: 1}})
	if errCode(err) != dataerr.CodeInvalid {
		t.Fatalf("got %v, want Invalid for a date outside the case history", err)
	}
}

func TestSimulateZones_UsesFixtureBaselineWhenNoStoredRun(t *testing.T) {
	resetSimDeps()
	rc, _ := adminCtx(t)
	zoneID := "091ff2b2-f0e1-4b97-bfc9-7cdd0698c32a"
	SeedSimZonesForTest([]simZoneRow{{ID: zoneID, NameEn: "Fixture Zone"}})
	SeedCasesForTest([]Case{
		{ID: "a", ZoneID: zoneID, Handling: "field", RegisteredAt: "2026-09-14T09:00:00+03:00"},
	})
	rows, err := simulateZones(context.Background(), rc, "2026-09-14", "nearest", []ZoneCoverage{{ZoneID: zoneID, Ratio: simReferenceCoverage}})
	check(t, err)
	if len(rows) != 1 || rows[0].ZoneID != zoneID {
		t.Fatalf("got %+v, want one row for the fixture zone", rows)
	}
	// ratio == reference coverage, so f == 1 and
	// share == the fixture's own share.
	want := int(math.Round(0.715278 * 1))
	if rows[0].FromAssignment.WithinCount != want {
		t.Fatalf("got %+v, want from_assignment.within_count %d (fixture baseline at full coverage)", rows[0].FromAssignment, want)
	}
}

func TestSimulateZones_UnreadableOrUnknownZoneSkipped(t *testing.T) {
	resetSimDeps()
	rc, tenantID := adminCtx(t)
	SeedCasesForTest([]Case{{ID: "a", ZoneID: "z1", RegisteredAt: "2026-09-14T09:00:00+03:00"}})
	// z1 never seeded: simZoneExists is false.
	rows, err := simulateZones(context.Background(), rc, "2026-09-14", "nearest", []ZoneCoverage{{ZoneID: "z1", Ratio: 1}})
	check(t, err)
	if len(rows) != 0 {
		t.Fatalf("got %+v, want no rows for a zone not in the snapshot", rows)
	}

	SeedSimZonesForTest([]simZoneRow{{ID: "z1", NameEn: "Z1"}})
	outsider := plannerCtx(tenantID, "u1", []string{"other-zone"})
	rows2, err := simulateZones(context.Background(), outsider, "2026-09-14", "nearest", []ZoneCoverage{{ZoneID: "z1", Ratio: 1}})
	check(t, err)
	if len(rows2) != 0 {
		t.Fatalf("got %+v, want no rows for a zone out of scope", rows2)
	}
}
