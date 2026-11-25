// SPDX-License-Identifier: AGPL-3.0-only

// Mirrors forecast.ts's tests.
package business

import (
	"context"
	"testing"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/access"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/dataerr"
)

func resetForecastDeps() {
	ResetForecastCoreForTest()
	ResetForecastValuesForTest()
	ResetForecastRunsForTest()
	ResetForecastSubZonesForTest()
	ResetFieldShareForTest()
	ResetRulesForTest()
}

// The real fixtures/engines/forecaster.output.json.
const fixtureZoneID = "091ff2b2-f0e1-4b97-bfc9-7cdd0698c32a"
const fixtureDate = "2026-09-14"

func seedFixtureMatchingRun(id string) ForecastRun {
	engineVersion := "0.1.0"
	finishedAt := "2026-09-13T02:04:00+03:00"
	run := ForecastRun{
		BaseRecord:       bd(id, "t1"),
		ModelVersion:     "placeholder-0.1",
		EngineVersion:    &engineVersion,
		Status:           "succeeded",
		HorizonStartDate: fixtureDate,
		HorizonDays:      1,
		RangeCoverage:    0.8,
		Illustrative:     true,
		FinishedAt:       &finishedAt,
	}
	UpsertForecastRunForTest(run)
	return run
}

func TestForecastAccess_ChangeApproverForbidden(t *testing.T) {
	resetForecastDeps()
	approver := roleCtx("t1", "u1", access.RoleChangeApprover)
	_, err := ListForecastRuns(approver, ForecastRunQuery{})
	if errCode(err) != dataerr.CodeForbidden {
		t.Fatalf("got %v, want Forbidden (change_approver has no view access)", err)
	}
}

const (
	runOldID     = "00000000-0000-4000-8000-000000000101"
	runRunningID = "00000000-0000-4000-8000-000000000102"
	runNewID     = "00000000-0000-4000-8000-000000000103"
	runOtherID   = "00000000-0000-4000-8000-000000000104"
	runEmptyID   = "00000000-0000-4000-8000-000000000105"
	runValuesID  = "00000000-0000-4000-8000-000000000106"
)

func TestRequireRun_FallsBackToLatestSucceeded(t *testing.T) {
	resetForecastDeps()
	old := ForecastRun{BaseRecord: bd(runOldID, "t1"), Status: "succeeded", HorizonStartDate: "2026-09-01"}
	old.CreatedAt = "2026-09-01T00:00:00+03:00"
	UpsertForecastRunForTest(old)
	running := ForecastRun{BaseRecord: bd(runRunningID, "t1"), Status: "running", HorizonStartDate: "2026-09-14"}
	running.CreatedAt = "2026-09-14T00:00:00+03:00"
	UpsertForecastRunForTest(running)
	newest := ForecastRun{BaseRecord: bd(runNewID, "t1"), Status: "succeeded", HorizonStartDate: "2026-09-14"}
	newest.CreatedAt = "2026-09-14T00:00:00+03:00"
	UpsertForecastRunForTest(newest)

	got, err := requireRun(context.Background(), "", "")
	check(t, err)
	if got.ID != runNewID {
		t.Fatalf("got %q, want the newest succeeded run (running is skipped)", got.ID)
	}
}

func TestRequireRun_MissingWithNoSucceededRun(t *testing.T) {
	resetForecastDeps()
	_, err := requireRun(context.Background(), "", "")
	if errCode(err) != dataerr.CodeNotFound {
		t.Fatalf("got %v, want NotFound with no succeeded run", err)
	}
}

func TestZoneDemand_UsesEngineOutputWhenRunMatchesTheFixture(t *testing.T) {
	resetForecastDeps()
	SeedFieldShareZonesForTest([]string{fixtureZoneID})
	run := seedFixtureMatchingRun("00000000-0000-4000-8000-000000000100")
	admin := roleCtx("t1", "u1", access.RoleAdministrator)

	demand, err := zoneDemand(context.Background(), admin, fixtureZoneID, fixtureDate, nil, run.ID)
	check(t, err)
	if len(demand) != Intervals {
		t.Fatalf("got %d intervals, want %d", len(demand), Intervals)
	}
	// Interval 0 sums across sub-zones to a positive
	// count (not the zero the stored/day-factor
	// fallback gives with nothing else seeded).
	if demand[0].Expected <= 0 {
		t.Fatalf("got %+v, want a positive expected from the engine output", demand[0])
	}
}

func TestZoneDemand_FallsBackToRawRowsWhenTheRunDoesNotMatch(t *testing.T) {
	resetForecastDeps()
	SeedFieldShareZonesForTest([]string{"z1"})
	run := ForecastRun{BaseRecord: bd(runOtherID, "t1"), Status: "succeeded", HorizonStartDate: "2026-09-14", ModelVersion: "other"}
	UpsertForecastRunForTest(run)
	admin := roleCtx("t1", "u1", access.RoleAdministrator)

	demand, err := zoneDemand(context.Background(), admin, "z1", "2026-09-14", nil, run.ID)
	check(t, err)
	if len(demand) != Intervals {
		t.Fatalf("got %d intervals, want %d", len(demand), Intervals)
	}
	for _, d := range demand {
		if d.Expected != 0 {
			t.Fatalf("got %+v, want all zero with no stored values or history", d)
		}
	}
}

func TestGetForecastSplit_NullFieldShareWhenTotalIsZero(t *testing.T) {
	resetForecastDeps()
	SeedFieldShareZonesForTest([]string{"z1"})
	run := ForecastRun{BaseRecord: bd(runEmptyID, "t1"), Status: "succeeded", HorizonStartDate: "2026-09-14", ModelVersion: "other"}
	UpsertForecastRunForTest(run)
	admin := roleCtx("t1", "u1", access.RoleAdministrator)

	split, err := GetForecastSplit(admin, ForecastSplitQuery{})
	check(t, err)
	if len(split.Zones) != 1 {
		t.Fatalf("got %+v, want 1 zone", split.Zones)
	}
	if split.Zones[0].FieldShare != nil {
		t.Fatalf("got %v, want nil field_share with zero demand", split.Zones[0].FieldShare)
	}
}

func TestListForecastValues_SortsBySubZoneNameAndDerivesIdsForAnotherDate(t *testing.T) {
	resetForecastDeps()
	SeedFieldShareZonesForTest([]string{"z1"})
	SeedForecastSubZonesForTest([]ForecastSubZoneSeed{
		{ID: "sz-b", NameEn: "Beta"},
		{ID: "sz-a", NameEn: "Alpha"},
	})
	run := ForecastRun{BaseRecord: bd(runValuesID, "t1"), Status: "succeeded", HorizonStartDate: "2026-09-14", ModelVersion: "other"}
	UpsertForecastRunForTest(run)
	SeedForecastValuesForTest([]ForecastValue{
		{BaseRecord: bd("v-b0", "t1"), ForecastRunID: run.ID, ZoneID: "z1", SubZoneID: "sz-b", IntervalStart: "2026-09-14T00:00:00+03:00", IntervalIndex: 0, Expected: 2},
		{BaseRecord: bd("v-a0", "t1"), ForecastRunID: run.ID, ZoneID: "z1", SubZoneID: "sz-a", IntervalStart: "2026-09-14T00:00:00+03:00", IntervalIndex: 0, Expected: 1},
	})
	admin := roleCtx("t1", "u1", access.RoleAdministrator)

	page, err := ListForecastValues(admin, ForecastValueQuery{RunID: run.ID, Date: "2026-09-14"})
	check(t, err)
	if len(page.Items) != 2 || page.Items[0].SubZoneID != "sz-a" || page.Items[1].SubZoneID != "sz-b" {
		t.Fatalf("got %+v, want Alpha (sz-a) before Beta (sz-b)", page.Items)
	}
	if page.Items[0].ID != "v-a0" {
		t.Fatalf("got id %q, want the stored row's own id for the same date", page.Items[0].ID)
	}

	scaled, err := ListForecastValues(admin, ForecastValueQuery{RunID: run.ID, Date: "2026-09-21"})
	check(t, err)
	if len(scaled.Items) != 2 {
		t.Fatalf("got %d items, want 2 scaled rows", len(scaled.Items))
	}
	for _, item := range scaled.Items {
		if item.ID == "v-a0" || item.ID == "v-b0" {
			t.Fatalf("got %+v, want a derived id for a different date", item)
		}
	}
}
