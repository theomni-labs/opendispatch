// SPDX-License-Identifier: AGPL-3.0-only

// JSON keys and fixture seeding for scenarios,
// simulation and standby. Pure, no database.
package business

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/access"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"
)

func jsonMap(t *testing.T, v any) map[string]any {
	t.Helper()
	raw, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	var m map[string]any
	if err := json.Unmarshal(raw, &m); err != nil {
		t.Fatal(err)
	}
	return m
}

func needKeys(t *testing.T, label string, m map[string]any, keys ...string) {
	t.Helper()
	for _, k := range keys {
		if _, ok := m[k]; !ok {
			t.Errorf("%s: missing key %q in %v", label, k, m)
		}
	}
}

func TestPlanningJSON_EngineOutputsNestEngineAndHaveNoNulls(t *testing.T) {
	opt := jsonMap(t, OptimizerEngineOutput{EngineName: "opt", EngineVersion: "1"})
	eng, _ := opt["engine"].(map[string]any)
	if eng["name"] != "opt" || eng["version"] != "1" {
		t.Fatalf("optimizer engine = %v", opt["engine"])
	}
	for _, k := range []string{"input_data_sources", "roster_assignments", "vehicle_assignments", "gap_cells", "violations"} {
		if _, ok := opt[k].([]any); !ok {
			t.Errorf("optimizer %s = %v, want []", k, opt[k])
		}
	}
	sim := jsonMap(t, SimulatorEngineOutput{EngineName: "sim", EngineVersion: "2"})
	eng, _ = sim["engine"].(map[string]any)
	if eng["name"] != "sim" || eng["version"] != "2" {
		t.Fatalf("simulator engine = %v", sim["engine"])
	}
	for _, k := range []string{"input_data_sources", "zones"} {
		if _, ok := sim[k].([]any); !ok {
			t.Errorf("simulator %s = %v, want []", k, sim[k])
		}
	}
	if _, ok := sim["engine_name"]; ok {
		t.Error("flat engine_name leaked")
	}
}

func TestPlanningJSON_ScenarioAdjustmentsOmitUnsetLists(t *testing.T) {
	m := jsonMap(t, ScenarioAdjustments{})
	if _, ok := m["remote_share"]; !ok || m["remote_share"] != nil {
		t.Errorf("remote_share = %v, want present null", m["remote_share"])
	}
	if _, ok := m["headcount_delta"]; ok {
		t.Error("unset headcount_delta emitted")
	}
	m = jsonMap(t, ScenarioAdjustments{HeadcountDelta: []HeadcountDelta{{ZoneID: "z"}}})
	needKeys(t, "adjustments", m, "headcount_delta")
	d := m["headcount_delta"].([]any)[0].(map[string]any)
	needKeys(t, "headcount_delta", d, "zone_id", "field_agents", "remote_agents", "vehicles")
}

func TestPlanningJSON_RecordKeys(t *testing.T) {
	needKeys(t, "scenario", jsonMap(t, Scenario{}), "name", "base_date", "zone_ids", "adjustments", "status", "last_run_at", "id", "tenant_id")
	needKeys(t, "run", jsonMap(t, SimulationRun{}), "roster_id", "scenario_id", "run_date", "assignment_policy", "primary_clock_start", "threshold_seconds", "status", "illustrative", "engine_version", "finished_at")
	needKeys(t, "result", jsonMap(t, SimulationResult{}), "simulation_run_id", "zone_id", "interval_start", "case_count", "field_case_count", "from_registration", "from_assignment", "median_assigned_to_arrived_seconds", "p90_assigned_to_arrived_seconds")
	needKeys(t, "coverage", jsonMap(t, Coverage{}), "zone_id", "roster_date", "roster_id", "areas", "uncovered_sub_zone_ids", "illustrative", "data_source")
	needKeys(t, "area", jsonMap(t, CoverageArea{}), "standby_point_id", "latitude", "longitude", "coverage_radius_m", "recommended_agents", "covered_sub_zone_ids")
	needKeys(t, "move", jsonMap(t, StandbyMove{}), "from_standby_point_id", "to_standby_point_id", "agents", "newly_covered_sub_zone_ids", "reason_en")
	needKeys(t, "recommendation", jsonMap(t, StandbyMoveRecommendation{}), "zone_id", "roster_date", "roster_id", "moves", "uncovered_before", "uncovered_after", "illustrative", "data_source")
}

func TestPlanningFixtures_SeedLazilyAndReset(t *testing.T) {
	planner := roleCtx("t1", "u1", access.RolePlanner)
	ReloadScenariosForTest()
	list, err := ListScenarios(planner, datactx.PageQuery{})
	check(t, err)
	if len(list.Items) == 0 {
		t.Fatal("scenarios not seeded from fixtures")
	}
	ResetScenariosForTest()
	list, err = ListScenarios(planner, datactx.PageQuery{})
	check(t, err)
	if len(list.Items) != 0 || strings.Contains(string(mustJSON(t, list)), `"items":null`) {
		t.Fatalf("reset store: %s", mustJSON(t, list))
	}

	ReloadSimulationsForTest()
	ReloadSimZonesForTest()
	runs, err := ListSimulationRuns(context.Background(), nil, planner, SimulationRunQuery{})
	check(t, err)
	if len(runs.Items) == 0 {
		t.Fatal("simulation runs not seeded from fixtures")
	}
	ResetSimulationsForTest()
	ResetSimZonesForTest()
	ReloadStandbyForTest()
	ResetStandbyForTest()
}

func mustJSON(t *testing.T, v any) []byte {
	t.Helper()
	raw, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	return raw
}
