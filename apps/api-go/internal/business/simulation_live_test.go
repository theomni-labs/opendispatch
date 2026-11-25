// SPDX-License-Identifier: AGPL-3.0-only

// Live-Postgres tests for simulation.go and
// scenarios.go's RunScenario.
package business

import (
	"context"
	"testing"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/access"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/dataerr"
)

func TestRunSimulation_Succeeds(t *testing.T) {
	conn := openConn(t)
	rc, _ := adminCtx(t)
	ctx := context.Background()
	resetRosterDeps()
	resetSimDeps()
	fx := seedRosterFixture(t, ctx, conn, rc)
	planner := roleCtx(rc.CustomerID, "00000000-0000-4000-8000-000000000701", access.RolePlanner)
	roster, err := BuildRoster(ctx, conn, planner, map[string]any{"zone_id": fx.zoneID, "roster_date": "2026-09-14"})
	check(t, err)

	SeedSimZonesForTest([]simZoneRow{{ID: fx.zoneID, NameEn: "Central"}})
	SeedCasesForTest([]Case{{ID: "case-1", ZoneID: fx.zoneID, Handling: "field", RegisteredAt: "2026-09-14T09:00:00+03:00"}})

	run, err := RunSimulation(ctx, conn, planner, map[string]any{"roster_id": roster.ID, "run_date": "2026-09-14"})
	check(t, err)
	if run.Status != "succeeded" || run.RosterID == nil || *run.RosterID != roster.ID {
		t.Fatalf("got %+v, want a succeeded run tied to the roster", run)
	}

	detail, err := GetSimulationRun(ctx, conn, planner, run.ID)
	check(t, err)
	if detail.Output == nil || len(detail.Output.Zones) != 1 || detail.Output.Zones[0].ZoneID != fx.zoneID {
		t.Fatalf("got %+v, want one zone's output", detail)
	}
}

func TestRunSimulation_RequiresWriteZone(t *testing.T) {
	conn := openConn(t)
	rc, tenantID := adminCtx(t)
	ctx := context.Background()
	resetRosterDeps()
	resetSimDeps()
	fx := seedRosterFixture(t, ctx, conn, rc)
	planner := roleCtx(tenantID, "00000000-0000-4000-8000-000000000702", access.RolePlanner)
	roster, err := BuildRoster(ctx, conn, planner, map[string]any{"zone_id": fx.zoneID, "roster_date": "2026-09-14"})
	check(t, err)

	outsider := plannerCtx(tenantID, "00000000-0000-4000-8000-000000000703", []string{"00000000-0000-4000-8000-000000000999"})
	_, err = RunSimulation(ctx, conn, outsider, map[string]any{"roster_id": roster.ID, "run_date": "2026-09-14"})
	if errCode(err) != dataerr.CodeForbidden {
		t.Fatalf("got %v, want Forbidden for a planner outside the roster's zone", err)
	}
}

func TestRunScenario_StoresOptimizerAndSimulation(t *testing.T) {
	conn := openConn(t)
	rc, tenantID := adminCtx(t)
	ctx := context.Background()
	resetRosterDeps()
	resetSimDeps()
	fx := seedRosterFixture(t, ctx, conn, rc)
	planner := roleCtx(tenantID, "00000000-0000-4000-8000-000000000704", access.RolePlanner)
	_, err := BuildRoster(ctx, conn, planner, map[string]any{"zone_id": fx.zoneID, "roster_date": "2026-09-14"})
	check(t, err)

	SeedFieldShareZonesForTest([]string{fx.zoneID})
	SeedSimZonesForTest([]simZoneRow{{ID: fx.zoneID, NameEn: "Central"}})
	SeedCasesForTest([]Case{{ID: "case-1", ZoneID: fx.zoneID, Handling: "field", RegisteredAt: "2026-09-14T09:00:00+03:00"}})

	scenario, err := CreateScenario(ctx, conn, planner, map[string]any{
		"name": "More agents", "base_date": "2026-09-14", "zone_ids": []any{fx.zoneID},
		"adjustments": map[string]any{},
	})
	check(t, err)

	result, err := RunScenario(ctx, conn, planner, scenario.ID)
	check(t, err)
	if result.Optimizer.RosterDate != "2026-09-14" || len(result.Optimizer.RosterAssignments) == 0 {
		t.Fatalf("got %+v, want the built roster's assignments in the optimizer output", result.Optimizer)
	}
	if result.Simulation == nil || len(result.Simulation.Zones) != 1 {
		t.Fatalf("got %+v, want a simulation for the matching history day", result.Simulation)
	}

	updated, err := GetScenario(planner, scenario.ID)
	check(t, err)
	if updated.Status != "completed" || updated.LastRunAt == nil {
		t.Fatalf("got %+v, want status completed with last_run_at set", updated)
	}
}

func TestGetSimulationRun_NullOutputWhenNotSucceeded(t *testing.T) {
	resetSimDeps()
	rc, _ := adminCtx(t)
	conn := openConn(t)
	ctx := context.Background()

	run, err := storeSimulation(context.Background(), roleCtx(rc.CustomerID, "u1", access.RolePlanner), SimulationRunInput{
		RosterID: nil, ScenarioID: nil, RunDate: "2026-09-14", AssignmentPolicy: "nearest",
		PrimaryClockStart: "assignment", ThresholdSeconds: 600, Status: "queued", Illustrative: true,
	}, nil)
	check(t, err)

	detail, err := GetSimulationRun(ctx, conn, roleCtx(rc.CustomerID, "u1", access.RolePlanner), run.ID)
	check(t, err)
	if detail.Output != nil {
		t.Fatalf("got %+v, want a nil output for a queued run", detail.Output)
	}
}
