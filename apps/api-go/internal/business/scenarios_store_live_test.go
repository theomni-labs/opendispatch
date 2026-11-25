// SPDX-License-Identifier: AGPL-3.0-only

// Live: scenarios and simulation runs kept in Postgres.
package business

import (
	"context"
	"testing"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/access"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/fixtures"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
)

func usePgScenarioAndSims(t *testing.T) {
	t.Helper()
	conn := openConn(t)
	UsePostgresScenarios(conn)
	UsePostgresSimulations(conn)
	t.Cleanup(func() { UseMemoryScenarios(); UseMemorySimulations() })
}

func scenarioOf(tenant, zone string) Scenario {
	at := datactx.NowISO()
	share := 0.4
	return Scenario{
		BaseRecord: datactx.BaseRecord{ID: datactx.NewID(), TenantID: tenant, CreatedAt: at, UpdatedAt: at, DataSource: "SYNTHETIC"},
		Name:       "Busy Friday", BaseDate: "2026-09-18", ZoneIDs: []string{zone}, Status: "draft",
		Adjustments: ScenarioAdjustments{HeadcountDelta: []HeadcountDelta{{ZoneID: zone, FieldAgents: 2}}, RemoteShare: &share},
	}
}

func TestPostgresScenariosSurviveARestartAndStayPerCustomer(t *testing.T) {
	usePgScenarioAndSims(t)
	rc, a := adminCtx(t)
	b := freshTenant()
	zone := datactx.NewID()
	s := scenarioOf(a, zone)
	if err := saveScenario(context.Background(), a, s); err != nil {
		t.Fatal(err)
	}
	s.Name, s.Status = "Renamed", "completed"
	if err := saveScenario(context.Background(), a, s); err != nil {
		t.Fatal(err)
	}
	conn := scenarioStoreBackend.(pgScenarios).conn
	UseMemoryScenarios()
	UsePostgresScenarios(conn)
	got, err := loadScenario(context.Background(), a, s.ID)
	if err != nil || got == nil || got.Name != "Renamed" || got.Status != "completed" || got.BaseDate != "2026-09-18" || len(got.ZoneIDs) != 1 || got.ZoneIDs[0] != zone ||
		len(got.Adjustments.HeadcountDelta) != 1 || got.Adjustments.HeadcountDelta[0].FieldAgents != 2 || got.Adjustments.RemoteShare == nil || *got.Adjustments.RemoteShare != 0.4 {
		t.Fatalf("after a restart: %+v %v", got, err)
	}
	if rows, err := loadScenarios(context.Background(), b); err != nil || len(rows) != 0 {
		t.Fatalf("another customer sees %d scenarios, %v", len(rows), err)
	}
	if _, err := visibleScenarios(context.Background(), rc); err != nil {
		t.Fatal(err)
	}
	if err := deleteScenario(context.Background(), a, s.ID); err != nil {
		t.Fatal(err)
	}
	if got, _ := loadScenario(context.Background(), a, s.ID); got != nil {
		t.Fatal("scenario still there after delete")
	}
}

func levels(zones ...string) []ZoneServiceLevel {
	half := 0.5
	med, p90 := 480, 900
	var out []ZoneServiceLevel
	for _, z := range zones {
		out = append(out, ZoneServiceLevel{
			ZoneID: z, CaseCount: 10, FieldCaseCount: 8, RemoteCaseCount: 2,
			FromRegistration: Reading{WithinCount: 4, CaseCount: 8, Share: &half}, FromAssignment: Reading{WithinCount: 5, CaseCount: 8, Share: &half},
			MedianAssignedToArrivedSecond: &med, P90AssignedToArrivedSeconds: &p90,
		})
	}
	return out
}

func TestPostgresSimulationsSurviveARestartAndStayPerCustomer(t *testing.T) {
	usePgScenarioAndSims(t)
	conn := openConn(t)
	rc, a := adminCtx(t)
	fx := seedRosterFixture(t, context.Background(), conn, rc)
	s := scenarioOf(a, fx.zoneID)
	if err := saveScenario(context.Background(), a, s); err != nil {
		t.Fatal(err)
	}
	done := s
	done.Status = "completed"
	at := datactx.NowISO()
	done.LastRunAt = &at
	planner := roleCtx(a, datactx.NewID(), access.RolePlanner)
	run, err := storeSimulation(context.Background(), planner, SimulationRunInput{
		ScenarioID: &s.ID, RunDate: "2026-09-14", AssignmentPolicy: "nearest", PrimaryClockStart: "assignment", ThresholdSeconds: 600,
		Status: "succeeded", Illustrative: true, FinishedAt: &at, CompleteScenario: &done,
	}, levels(fx.zoneID))
	if err != nil {
		t.Fatal(err)
	}
	UseMemorySimulations()
	UseMemoryScenarios()
	UsePostgresSimulations(conn)
	UsePostgresScenarios(conn)
	runs, err := loadSimulationRuns(context.Background(), a)
	if err != nil || len(runs) != 1 || runs[0].ID != run.ID || runs[0].RunDate != "2026-09-14" || runs[0].ScenarioID == nil || !runs[0].Illustrative || runs[0].FinishedAt == nil {
		t.Fatalf("after a restart: %+v %v", runs, err)
	}
	res, err := simResultsOf(context.Background(), planner, run.ID)
	if err != nil || len(res) != 1 || res[0].ZoneID != fx.zoneID || res[0].CaseCount != 10 || res[0].FromAssignment.Share == nil || *res[0].FromAssignment.Share != 0.5 ||
		res[0].P90AssignedToArrivedSeconds == nil || *res[0].P90AssignedToArrivedSeconds != 900 {
		t.Fatalf("results after a restart: %+v %v", res, err)
	}
	if got, err := loadScenario(context.Background(), a, s.ID); err != nil || got == nil || got.Status != "completed" || got.LastRunAt == nil {
		t.Fatalf("scenario after the run: %+v %v", got, err)
	}
	if other, err := loadSimulationRuns(context.Background(), freshTenant()); err != nil || len(other) != 0 {
		t.Fatalf("another customer sees %d runs, %v", len(other), err)
	}
}

func TestPostgresSimulationWriteIsAllOrNothing(t *testing.T) {
	usePgScenarioAndSims(t)
	conn := openConn(t)
	rc, a := adminCtx(t)
	fx := seedRosterFixture(t, context.Background(), conn, rc)
	s := scenarioOf(a, fx.zoneID)
	if err := saveScenario(context.Background(), a, s); err != nil {
		t.Fatal(err)
	}
	done := s
	done.Status = "completed"
	ghost := datactx.NewID()
	planner := roleCtx(a, datactx.NewID(), access.RolePlanner)
	_, err := storeSimulation(context.Background(), planner, SimulationRunInput{
		ScenarioID: &s.ID, RunDate: "2026-09-14", AssignmentPolicy: "nearest", PrimaryClockStart: "assignment", ThresholdSeconds: 600,
		Status: "succeeded", Illustrative: true, CompleteScenario: &done,
	}, levels(fx.zoneID, ghost))
	if err == nil {
		t.Fatal("a result for a zone that does not exist was accepted")
	}
	if runs, _ := loadSimulationRuns(context.Background(), a); len(runs) != 0 {
		t.Fatalf("%d runs kept from a failed write", len(runs))
	}
	if got, _ := loadScenario(context.Background(), a, s.ID); got == nil || got.Status != "draft" {
		t.Fatalf("scenario changed by a failed write: %+v", got)
	}
}

func TestReseedScenariosAndSimulationsLoadTheFixtures(t *testing.T) {
	usePgScenarioAndSims(t)
	owner := &tenancy.Connection{Pool: ownerPool(t)}
	if err := ReseedScenariosForTest(context.Background(), owner); err != nil {
		t.Fatal(err)
	}
	if err := ReseedSimulationsForTest(context.Background(), owner); err != nil {
		t.Skipf("fixture zones or rosters are not loaded in this database: %v", err)
	}
	tenant, err := fixtures.TenantID()
	if err != nil {
		t.Fatal(err)
	}
	want, _ := fixtures.Records[SimulationRun]("SimulationRun")
	got, err := loadSimulationRuns(context.Background(), tenant)
	if err != nil || len(got) != len(want) {
		t.Fatalf("got %d runs, want %d, %v", len(got), len(want), err)
	}
}
