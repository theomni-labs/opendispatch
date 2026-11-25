// SPDX-License-Identifier: AGPL-3.0-only

package business

import (
	"context"
	"encoding/json"
	"fmt"
	"testing"

	"github.com/jackc/pgx/v5"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/access"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/engines/enginetest"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/settingsstore"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
)

func scenarioSimAnswer(zone string, share float64) string {
	within := int(share * 10)
	reading := map[string]any{"within_count": within, "case_count": 10, "share": share}
	level := map[string]any{"case_count": 12, "field_case_count": 10, "remote_case_count": 2, "from_registration": reading, "from_assignment": reading,
		"assigned_to_arrived": map[string]any{"median_seconds": 420.0, "p90_seconds": 800.0}}
	b, _ := json.Marshal(map[string]any{"schema_version": "1.0", "engine": map[string]any{"name": "simulator", "version": "4.1.0"}, "model_version": "sim-4",
		"illustrative": true, "unserved_cases": 0, "zones": []map[string]any{{"zone_id": zone, "service_level": level}}})
	return string(b)
}

// scenarioWorld: a built roster for tomorrow and a day of cases a week earlier.
func scenarioWorld(t *testing.T) engineWorld {
	t.Helper()
	w := newEngineWorld(t)
	ctx := context.Background()
	w.srv.Script(enginetest.Behavior{Kind: enginetest.Answer, Body: w.forecasterAnswer()}, enginetest.Behavior{Kind: enginetest.Answer, Body: w.optimizerAnswer()})
	_, err := RunWorkerCycle(ctx, w.conn, w.actors)
	check(t, err)
	var rows []Case
	for i := 0; i < 10; i++ {
		at := fmt.Sprintf("%sT%02d:07:00+03:00", shiftDateBy(w.tomorrow, -7), 8+i)
		rows = append(rows, Case{ID: datactx.NewID(), TenantID: w.tenantID, CreatedAt: at, UpdatedAt: at, DataSource: "SYNTHETIC", CaseNumber: "C-" + datactx.NewID()[:8],
			ExternalID: datactx.NewID(), RegisteredAt: at, ZoneID: w.zoneID, SubZoneID: w.subID, Latitude: 24.7, Longitude: 46.7, Handling: "field", Extra: map[string]any{}})
	}
	check(t, upsertCasesLive(ctx, w.conn, w.tenantID, rows))
	SeedSimZonesForTest([]simZoneRow{{ID: w.zoneID, NameEn: "Central"}})
	t.Cleanup(func() { ResetSimZonesForTest(); ReloadSimulationsForTest() })
	return w
}

func scriptSimulator(w engineWorld, bodies ...string) {
	var next []enginetest.Behavior
	for _, b := range bodies {
		next = append(next, enginetest.Behavior{Kind: enginetest.Answer, Body: b})
	}
	scriptAfter(w, next...)
}

// scriptAfter answers what was already asked, then the given behaviors.
func scriptAfter(w engineWorld, next ...enginetest.Behavior) {
	var script []enginetest.Behavior
	for range w.srv.Requests() {
		script = append(script, enginetest.Behavior{Kind: enginetest.Answer})
	}
	w.srv.Script(append(script, next...)...)
}

type simRequestView struct {
	Seed   int                         `json:"seed"`
	Cases  []struct{ Handling string } `json:"cases"`
	Roster struct {
		Assignments []map[string]any `json:"assignments"`
	} `json:"roster"`
}

func simRequestOf(t *testing.T, body string) simRequestView {
	t.Helper()
	var v simRequestView
	check(t, json.Unmarshal([]byte(body), &v))
	return v
}

func runScenarioWith(t *testing.T, w engineWorld, adjustments map[string]any) (ScenarioRunResult, Scenario) {
	t.Helper()
	ctx := context.Background()
	planner := roleCtx(w.tenantID, "00000000-0000-4000-8000-000000000704", access.RolePlanner)
	scenario, err := CreateScenario(ctx, w.conn, planner, map[string]any{"name": "More agents", "base_date": w.tomorrow, "zone_ids": []any{w.zoneID}, "adjustments": adjustments})
	check(t, err)
	result, err := RunScenario(ctx, w.conn, planner, scenario.ID)
	check(t, err)
	done, err := GetScenario(planner, scenario.ID)
	check(t, err)
	return result, done
}

// scenarioOptimizerAnswer: the roster plus added people.
func scenarioOptimizerAnswer(w engineWorld, added int) string {
	lines := w.optimizerLines()
	for i := 0; i < added; i++ {
		lines = append(lines, map[string]any{"agent_id": datactx.DeterministicUUID(fmt.Sprintf("added:%d", i)), "shift_pattern_id": w.fx.patternID, "zone_id": w.zoneID,
			"roster_date": w.tomorrow, "start_at": w.tomorrow + "T14:00:00+03:00", "end_at": w.tomorrow + "T22:00:00+03:00",
			"break_start_at": w.tomorrow + "T18:00:00+03:00", "break_end_at": w.tomorrow + "T18:30:00+03:00", "standby_point_id": w.fx.pointID})
	}
	return w.optimizerAnswerWith("partial", lines)
}

type optRequestView struct {
	Objective struct {
		ModelVersion string           `json:"model_version"`
		Skills       []map[string]any `json:"skill_requirements"`
	} `json:"objective"`
	Scenario struct {
		HeadcountDelta []map[string]any `json:"headcount_delta"`
	} `json:"scenario_adjustments"`
}

func optRequestOf(t *testing.T, body string) optRequestView {
	t.Helper()
	checkRequest(t, "optimizer", []byte(body))
	var v optRequestView
	check(t, json.Unmarshal([]byte(body), &v))
	return v
}

func TestHeadcountScenarioAsksTheOptimizerThenSimulatesItsRoster(t *testing.T) {
	w := scenarioWorld(t)
	scriptAfter(w, enginetest.Behavior{Kind: enginetest.Answer, Body: scenarioOptimizerAnswer(w, 3)},
		enginetest.Behavior{Kind: enginetest.Answer, Body: scenarioSimAnswer(w.zoneID, 0.4)}, enginetest.Behavior{Kind: enginetest.Answer, Body: scenarioSimAnswer(w.zoneID, 0.7)})
	before := len(w.srv.Requests())
	result, done := runScenarioWith(t, w, map[string]any{"headcount_delta": []any{map[string]any{"zone_id": w.zoneID, "field_agents": 3.0}}})

	reqs := w.srv.Requests()[before:]
	if len(reqs) != 3 {
		t.Fatalf("got %d engine calls, want the optimizer, the baseline and the scenario", len(reqs))
	}
	opt := optRequestOf(t, reqs[0].Body)
	if opt.Objective.ModelVersion != defaultOptimizerModel || len(opt.Scenario.HeadcountDelta) != 1 || opt.Scenario.HeadcountDelta[0]["field_agents"] != 3.0 {
		t.Fatalf("got %+v, want the setting's model and the +3 change", opt)
	}
	base, adj := simRequestOf(t, reqs[1].Body), simRequestOf(t, reqs[2].Body)
	checkRequest(t, "simulator", []byte(reqs[2].Body))
	if len(adj.Roster.Assignments) != len(base.Roster.Assignments)+3 || base.Seed != adj.Seed || len(base.Cases) != len(adj.Cases) || len(base.Cases) != 10 {
		t.Fatalf("got %d then %d lines, %d then %d cases, seeds %d and %d; want the optimizer's 3 more lines, the same cases and seed",
			len(base.Roster.Assignments), len(adj.Roster.Assignments), len(base.Cases), len(adj.Cases), base.Seed, adj.Seed)
	}
	if result.Optimizer.ModelVersion != "o-7" || result.Optimizer.EngineVersion != "7.0.0" || result.Optimizer.Status != "partial" || countCode(result.Optimizer.Violations, "COVERAGE_GAP") != 1 {
		t.Fatalf("got %+v, want the optimizer's own answer", result.Optimizer)
	}
	sim := result.Simulation
	if sim == nil || sim.Overall.FromAssignment.Share == nil || *sim.Overall.FromAssignment.Share != 0.7 || done.Status != "completed" {
		t.Fatalf("got %+v, status %s, want the scenario answer", sim, done.Status)
	}
	kept, err := keptScenarioLines(context.Background(), w.tenantID, &done)
	check(t, err)
	if len(kept[w.zoneID]) != 5 {
		t.Fatalf("got %d kept lines, want the optimizer's 5 for the gap view", len(kept[w.zoneID]))
	}
	planner := roleCtx(w.tenantID, "00000000-0000-4000-8000-000000000704", access.RolePlanner)
	view, err := GetGapSurplus(context.Background(), w.conn, planner, GapQuery{ScenarioID: done.ID})
	check(t, err)
	if len(view.Cells) == 0 {
		t.Fatal("the gap view of a run scenario has no cells")
	}
	edited, err := UpdateScenario(context.Background(), w.conn, planner, done.ID, map[string]any{"name": "Edited", "base_date": done.BaseDate, "zone_ids": []any{w.zoneID}, "adjustments": map[string]any{}})
	check(t, err)
	if kept, err := keptScenarioLines(context.Background(), w.tenantID, &edited); err != nil || kept != nil {
		t.Fatalf("got %v (%v), want the re-plan once the scenario changed", kept, err)
	}
}

func TestScenarioRemoteShareChangesTheCasesAndRemoteIsNotSimulated(t *testing.T) {
	w := scenarioWorld(t)
	scriptAfter(w, enginetest.Behavior{Kind: enginetest.Answer, Body: scenarioOptimizerAnswer(w, 0)},
		enginetest.Behavior{Kind: enginetest.Answer, Body: scenarioSimAnswer(w.zoneID, 0.4)}, enginetest.Behavior{Kind: enginetest.Answer, Body: scenarioSimAnswer(w.zoneID, 0.5)})
	before := len(w.srv.Requests())
	result, _ := runScenarioWith(t, w, map[string]any{"remote_share": 0.3,
		"headcount_delta": []any{map[string]any{"zone_id": w.zoneID, "remote_agents": 2.0, "vehicles": 1.0}}})

	reqs := w.srv.Requests()[before:]
	opt := optRequestOf(t, reqs[0].Body)
	if d := opt.Scenario.HeadcountDelta; len(d) != 1 || d[0]["remote_agents"] != 2.0 || d[0]["vehicles"] != 1.0 {
		t.Fatalf("got %+v, want the remote and vehicle changes sent to the optimizer", d)
	}
	count := func(r simRequestView) int {
		n := 0
		for _, c := range r.Cases {
			if c.Handling == "remote_inferred" {
				n++
			}
		}
		return n
	}
	if b, a := count(simRequestOf(t, reqs[1].Body)), count(simRequestOf(t, reqs[2].Body)); b != 0 || a != 3 {
		t.Fatalf("got %d then %d remote cases, want 0 then 3 of 10", b, a)
	}
	var notes []OptimizerViolation
	for _, v := range result.Optimizer.Violations {
		if v.Code == "unsupported_adjustment" {
			notes = append(notes, v)
		}
	}
	if len(notes) != 1 || notes[0].ZoneID != nil {
		t.Fatalf("got %+v, want one pool-wide remote note and the vehicle change applied", notes)
	}
}

func TestScenarioFallsBackToTheReplanWhenTheOptimizerFails(t *testing.T) {
	w := scenarioWorld(t)
	scriptAfter(w, enginetest.Behavior{Kind: enginetest.Status500},
		enginetest.Behavior{Kind: enginetest.Answer, Body: scenarioSimAnswer(w.zoneID, 0.4)}, enginetest.Behavior{Kind: enginetest.Answer, Body: scenarioSimAnswer(w.zoneID, 0.6)})
	before := len(w.srv.Requests())
	result, done := runScenarioWith(t, w, map[string]any{"headcount_delta": []any{map[string]any{"zone_id": w.zoneID, "field_agents": 3.0, "vehicles": 1.0}}})

	reqs := w.srv.Requests()[before:]
	if len(reqs) != 3 {
		t.Fatalf("got %d engine calls, want the failed optimizer and two simulator runs", len(reqs))
	}
	base, adj := simRequestOf(t, reqs[1].Body), simRequestOf(t, reqs[2].Body)
	if len(adj.Roster.Assignments) != len(base.Roster.Assignments)+3 {
		t.Fatalf("got %d then %d lines, want the re-plan's 3 more", len(base.Roster.Assignments), len(adj.Roster.Assignments))
	}
	if countCode(result.Optimizer.Violations, "optimizer_unavailable") != 1 || countCode(result.Optimizer.Violations, "unsupported_adjustment") != 1 || done.Status != "completed" {
		t.Fatalf("got %+v, want the fallback said and the vehicle change still unsupported", result.Optimizer.Violations)
	}
	if kept, err := keptScenarioLines(context.Background(), w.tenantID, &done); err != nil || kept != nil {
		t.Fatalf("got %v (%v), want no optimizer lines kept", kept, err)
	}
}

func TestSkillSettingReachesTheOptimizerWithTheCaseTypeMix(t *testing.T) {
	w := scenarioWorld(t)
	ctx := context.Background()
	typeID := datactx.NewID()
	_, err := tenancy.WithTenant(ctx, w.conn.Pool, w.tenantID, func(ctx context.Context, tx pgx.Tx) (struct{}, error) {
		if _, err := tx.Exec(ctx, `INSERT INTO case_types (tenant_id, id, data_source, name_en) VALUES ($1,$2,'SYNTHETIC','Rollover')`, w.tenantID, typeID); err != nil {
			return struct{}{}, err
		}
		_, err := tx.Exec(ctx, `UPDATE cases SET case_type_id = $1 WHERE zone_id = $2 AND registered_at::date = $3::date`, typeID, w.zoneID, shiftDateBy(w.tomorrow, -7))
		return struct{}{}, err
	})
	check(t, err)
	check(t, settingsstore.Put(ctx, w.tenantID, skillRequirementsKey, []any{map[string]any{"case_type_id": typeID, "skill": "heavy", "share": 0.5}, map[string]any{"skill": "arabic", "share": 1.0}}))
	t.Cleanup(func() { _ = settingsstore.Put(context.Background(), w.tenantID, skillRequirementsKey, []any{}) })
	scriptAfter(w, enginetest.Behavior{Kind: enginetest.Answer, Body: scenarioOptimizerAnswer(w, 1)},
		enginetest.Behavior{Kind: enginetest.Answer, Body: scenarioSimAnswer(w.zoneID, 0.4)}, enginetest.Behavior{Kind: enginetest.Answer, Body: scenarioSimAnswer(w.zoneID, 0.6)})
	before := len(w.srv.Requests())
	runScenarioWith(t, w, map[string]any{"headcount_delta": []any{map[string]any{"zone_id": w.zoneID, "field_agents": 1.0}}})

	skills := optRequestOf(t, w.srv.Requests()[before].Body).Objective.Skills
	if len(skills) != 2 || skills[0]["skill"] != "arabic" || skills[0]["share"] != 1.0 || skills[1]["skill"] != "heavy" || skills[1]["case_type_id"] != typeID || skills[1]["zone_id"] != w.zoneID {
		t.Fatalf("got %+v, want arabic for every case and heavy for the rollover share", skills)
	}
	if share := skills[1]["share"].(float64); share <= 0.3 || share >= 0.5 {
		t.Fatalf("got share %v, want 0.5 of the rollover cases' part of field demand", share)
	}
}

func TestScenarioRunFailsHonestlyWhenTheSimulatorFails(t *testing.T) {
	w := scenarioWorld(t)
	scriptAfter(w, enginetest.Behavior{Kind: enginetest.Answer, Body: scenarioSimAnswer(w.zoneID, 0.4)}, enginetest.Behavior{Kind: enginetest.Status500})
	result, done := runScenarioWith(t, w, map[string]any{})
	if result.Simulation != nil || done.Status != "failed" {
		t.Fatalf("got simulation %v, status %s, want no reading and a failed scenario", result.Simulation, done.Status)
	}
	failures := engineFailures(t, w)
	if len(failures) == 0 || failures[len(failures)-1]["engine"] != "simulator" {
		t.Fatalf("got %v, want an engine.failed audit for the simulator", failures)
	}
}
