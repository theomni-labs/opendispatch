// SPDX-License-Identifier: AGPL-3.0-only

package business

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/engines/enginetest"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/forecastcal"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
)

type engineWorld struct {
	conn     *tenancy.Connection
	tenantID string
	zoneID   string
	subID    string
	today    string
	tomorrow string
	actors   WorkerActors
	srv      *enginetest.Server
	fx       rosterFixture
}

func newEngineWorld(t *testing.T) engineWorld {
	t.Helper()
	conn := openConn(t)
	rc, tenantID := adminCtx(t)
	ctx := context.Background()
	resetRosterDeps()
	ResetForecastValuesForTest()
	ResetModelVersionsForTest()
	ev := "0.1.0"
	SeedModelVersionsForTest(ModelVersion{BaseRecord: datactx.BaseRecord{ID: datactx.NewID(), TenantID: tenantID, DataSource: "SYNTHETIC", CreatedAt: datactx.NowISO(), UpdatedAt: datactx.NowISO()},
		Version: "placeholder-0.1", Status: "active", IsPlaceholder: true, EngineVersion: &ev})
	t.Cleanup(ReloadModelVersionsForTest)
	noChallenger(t, tenantID)
	fx := seedRosterFixture(t, ctx, conn, rc)
	sub, err := CreateSubZone(ctx, conn, rc, map[string]any{"zone_id": fx.zoneID, "name_en": "Sub A", "latitude": 24.7, "longitude": 46.7})
	check(t, err)
	today := demoToday(context.Background(), tenantID)
	var rows []Case
	for d := 1; d <= 3; d++ {
		at := fmt.Sprintf("%sT09:07:00+03:00", shiftDateBy(today, -d))
		rows = append(rows, Case{ID: datactx.NewID(), TenantID: tenantID, CreatedAt: at, UpdatedAt: at, DataSource: "SYNTHETIC", CaseNumber: "C-" + datactx.NewID()[:8], ExternalID: datactx.NewID(),
			RegisteredAt: at, ZoneID: fx.zoneID, SubZoneID: sub.ID, Latitude: 24.7, Longitude: 46.7, Handling: "field", Extra: map[string]any{}})
	}
	check(t, upsertCasesLive(ctx, conn, tenantID, rows))
	srv := useMockEngines(t, time.Second)
	return engineWorld{conn: conn, tenantID: tenantID, zoneID: fx.zoneID, subID: sub.ID, today: today, tomorrow: shiftDateBy(today, 1), actors: NewWorkerActors(tenantID), srv: srv, fx: fx}
}

func (w engineWorld) forecasterAnswer() string {
	var values []map[string]any
	for i := 28; i < 32; i++ {
		values = append(values, map[string]any{"zone_id": w.zoneID, "sub_zone_id": w.subID, "interval_start": intervalStartOf(w.tomorrow, i), "interval_index": i,
			"low": 0, "expected": 1.5, "high": 3, "field_expected": 1, "remote_inferred_expected": 0.5})
	}
	b, _ := json.Marshal(map[string]any{"schema_version": "1.0", "request_id": datactx.NewID(), "engine": map[string]any{"name": "forecaster", "version": "9.1.0"},
		"model_version": "m-9", "generated_at": "2026-09-13T02:00:00Z", "data_source": "SYNTHETIC", "illustrative": true, "rule_set_version": "rs-1",
		"horizon": map[string]any{"start_date": w.today, "days": forecastcal.DefaultHorizonDays}, "interval_minutes": 15, "intervals_per_day": 96, "range_coverage": 0.8, "values": values})
	return string(b)
}

func (w engineWorld) optimizerAnswer() string {
	return w.optimizerAnswerWith("feasible", w.optimizerLines())
}

// optimizerLines: two agents on one shift.
func (w engineWorld) optimizerLines() []map[string]any {
	var rows []map[string]any
	for _, s := range []string{w.fx.agent1, w.fx.agent2} {
		rows = append(rows, map[string]any{"agent_id": s, "shift_pattern_id": w.fx.patternID, "zone_id": w.zoneID, "roster_date": w.tomorrow,
			"start_at": w.tomorrow + "T06:00:00+03:00", "end_at": w.tomorrow + "T14:00:00+03:00",
			"break_start_at": w.tomorrow + "T10:00:00+03:00", "break_end_at": w.tomorrow + "T10:30:00+03:00", "standby_point_id": w.fx.pointID})
	}
	return rows
}

func (w engineWorld) optimizerAnswerWith(status string, lines []map[string]any) string {
	vehicles := []map[string]any{}
	for i, l := range lines {
		if i == 0 {
			vehicles = append(vehicles, map[string]any{"vehicle_id": w.fx.vehicleID, "agent_id": l["agent_id"], "zone_id": w.zoneID, "roster_date": w.tomorrow, "shift_pattern_id": w.fx.patternID})
		}
	}
	b, _ := json.Marshal(map[string]any{"schema_version": "1.0", "request_id": datactx.NewID(), "engine": map[string]any{"name": "optimizer", "version": "7.0.0"},
		"model_version": "o-7", "roster_date": w.tomorrow, "status": status, "run_seconds": 0.5, "roster_assignments": lines, "vehicle_assignments": vehicles,
		"violations": []map[string]any{{"code": "COVERAGE_GAP", "message": "gaps remain"}},
		"gap_cells":  []map[string]any{{"zone_id": w.zoneID, "interval_index": 28, "required": 2, "planned": 2, "delta": 0, "kind": "balanced"}}})
	return string(b)
}

func engineFailures(t *testing.T, w engineWorld) []map[string]any {
	t.Helper()
	rc, _ := adminCtx(t)
	rc.CustomerID = w.tenantID
	page, err := ListAuditEvents(rc, AuditFilter{ActionPrefix: "engine."})
	check(t, err)
	var out []map[string]any
	for _, e := range page.Items {
		out = append(out, e.Detail)
	}
	return out
}

func TestWorkerAsksTheEnginesAndUsesTheAnswers(t *testing.T) {
	w := newEngineWorld(t)
	w.srv.Script(enginetest.Behavior{Kind: enginetest.Answer, Body: w.forecasterAnswer()}, enginetest.Behavior{Kind: enginetest.Answer, Body: w.optimizerAnswer()})
	ctx := context.Background()

	report, err := RunWorkerCycle(ctx, w.conn, w.actors)
	check(t, err)
	if !report.ForecastCreated || report.ForecastStale || report.RostersBuilt != 1 || len(report.RostersStale) != 0 {
		t.Fatalf("got %+v, want a forecast run, a roster, nothing stale", report)
	}
	reqs := w.srv.Requests()
	if len(reqs) != 2 {
		t.Fatalf("got %d engine calls, want forecaster then optimizer", len(reqs))
	}
	checkRequest(t, "forecaster", []byte(reqs[0].Body))
	checkRequest(t, "optimizer", []byte(reqs[1].Body))

	run, err := loadLatestForecastRun(context.Background(), w.tenantID, false)
	check(t, err)
	if run == nil || run.ModelVersion != "m-9" || run.EngineVersion == nil || *run.EngineVersion != "9.1.0" || !run.Illustrative || run.ErrorMessage != nil || run.HorizonDays != forecastcal.DefaultHorizonDays {
		t.Fatalf("got %+v, want the engine's versions and the illustrative flag kept", run)
	}
	rc, _ := adminCtx(t)
	rc.CustomerID = w.tenantID
	rosters, err := ListRosters(ctx, w.conn, rc, RosterQuery{ZoneID: w.zoneID, Date: w.tomorrow})
	check(t, err)
	if len(rosters.Items) != 1 || rosters.Items[0].EngineVersion == nil || *rosters.Items[0].EngineVersion != "7.0.0" {
		t.Fatalf("got %+v, want the roster to carry the optimizer's version", rosters.Items)
	}
	demand, err := zoneDemand(context.Background(), rc, w.zoneID, w.tomorrow, nil, run.ID)
	check(t, err)
	if demand[28].Expected != 1.5 {
		t.Fatalf("got %+v, want the engine's demand at interval 28", demand[28])
	}
	if fails := engineFailures(t, w); len(fails) != 0 {
		t.Fatalf("got %v, want no failures", fails)
	}
}

func TestAFailingForecasterKeepsTheLastGoodRunAndSaysStale(t *testing.T) {
	w := newEngineWorld(t)
	ctx := context.Background()
	cfg := engineCfg
	UseFixtureEngines()
	good, err := CreateForecastRun(ctx, w.conn, w.actors.Forecast, map[string]any{"horizon_start_date": shiftDateBy(w.today, -1), "horizon_days": 1.0})
	check(t, err)
	UseEngines(cfg)
	w.srv.Script(enginetest.Behavior{Kind: enginetest.Status500}, enginetest.Behavior{Kind: enginetest.Status500})

	report, err := RunWorkerCycle(ctx, w.conn, w.actors)
	check(t, err)
	if report.ForecastCreated || !report.ForecastStale || len(report.RostersStale) != 1 || report.RostersBuilt != 1 {
		t.Fatalf("got %+v, want stale forecast and a roster built without the optimizer", report)
	}
	runs, err := loadForecastRuns(context.Background(), w.tenantID, false)
	check(t, err)
	if len(runs) != 1 || runs[0].ID != good.ID || runs[0].ErrorMessage == nil || !strings.HasPrefix(*runs[0].ErrorMessage, "Stale:") || runs[0].Status != "succeeded" {
		t.Fatalf("got %+v, want only the last good run, marked stale", runs)
	}
	classes := map[any]any{}
	for _, d := range engineFailures(t, w) {
		if len(d) != 2 {
			t.Fatalf("got %v, want only the engine and its error class", d)
		}
		classes[d["engine"]] = d["error_class"]
	}
	if classes["forecaster"] != "status" || classes["optimizer"] != "request_not_built" {
		t.Fatalf("got %v, want a status failure and an optimizer that had no values to ask with", classes)
	}
}

func TestAFailingOptimizerStillBuildsTheRosterAndSaysStale(t *testing.T) {
	w := newEngineWorld(t)
	w.srv.Script(enginetest.Behavior{Kind: enginetest.Answer, Body: w.forecasterAnswer()}, enginetest.Behavior{Kind: enginetest.Status500})
	report, err := RunWorkerCycle(context.Background(), w.conn, w.actors)
	check(t, err)
	if !report.ForecastCreated || report.RostersBuilt != 1 || len(report.RostersStale) != 1 {
		t.Fatalf("got %+v, want the roster built locally and reported stale", report)
	}
	fails := engineFailures(t, w)
	if len(fails) != 1 || fails[0]["engine"] != "optimizer" || fails[0]["error_class"] != "status" {
		t.Fatalf("got %v, want one optimizer failure", fails)
	}
}

func TestAnInvalidEngineAnswerIsAFailureNotACrash(t *testing.T) {
	cases := map[string]struct {
		b     enginetest.Behavior
		class string
	}{
		"invalid": {enginetest.Behavior{Kind: enginetest.InvalidJSON}, "invalid_response"},
		"wrong":   {enginetest.Behavior{Kind: enginetest.Answer, Body: `{"ok":true}`}, "invalid_response"},
	}
	for name, c := range cases {
		t.Run(name, func(t *testing.T) {
			w := newEngineWorld(t)
			w.srv.Script(c.b)
			report, err := RunWorkerCycle(context.Background(), w.conn, w.actors)
			check(t, err)
			if report.ForecastCreated || !report.ForecastStale {
				t.Fatalf("got %+v, want a stale forecast", report)
			}
			found := false
			for _, d := range engineFailures(t, w) {
				found = found || d["error_class"] == c.class
			}
			if !found {
				t.Fatalf("want an engine.failed event of class %s", c.class)
			}
		})
	}
}

// checkRunClock: started <= finished, our clock.
func checkRunClock(t *testing.T, run ForecastRun, before, after time.Time) {
	t.Helper()
	if run.StartedAt == nil || run.FinishedAt == nil {
		t.Fatalf("got %+v, want both times", run)
	}
	started, err := datactx.EpochOf(*run.StartedAt)
	check(t, err)
	finished, err := datactx.EpochOf(*run.FinishedAt)
	check(t, err)
	if finished.Before(started) {
		t.Fatalf("started_at %s is after finished_at %s", *run.StartedAt, *run.FinishedAt)
	}
	lo, hi := before.Truncate(time.Second), after.Add(time.Second)
	if started.Before(lo) || finished.After(hi) {
		t.Fatalf("got %s..%s, want both within the call (%s..%s)", *run.StartedAt, *run.FinishedAt, lo, hi)
	}
}

func TestTheWorkersEngineRunStartsBeforeItFinishes(t *testing.T) {
	w := newEngineWorld(t)
	w.srv.Script(enginetest.Behavior{Kind: enginetest.Answer, Body: w.forecasterAnswer()}, enginetest.Behavior{Kind: enginetest.Answer, Body: w.optimizerAnswer()})
	before := time.Now()
	_, err := RunWorkerCycle(context.Background(), w.conn, w.actors)
	check(t, err)
	run, err := loadLatestForecastRun(context.Background(), w.tenantID, false)
	check(t, err)
	if run == nil {
		t.Fatal("want a run")
	}
	checkRunClock(t, *run, before, time.Now())
}

func TestTheApiEngineRunStartsBeforeItFinishes(t *testing.T) {
	w := newEngineWorld(t)
	w.srv.Script(enginetest.Behavior{Kind: enginetest.Answer, Body: w.forecasterAnswer()})
	before := time.Now()
	run, err := CreateForecastRun(context.Background(), w.conn, w.actors.Forecast, map[string]any{"horizon_start_date": w.today, "horizon_days": float64(forecastcal.DefaultHorizonDays)})
	check(t, err)
	if run.Status != "succeeded" {
		t.Fatalf("got %+v, want a succeeded run", run)
	}
	checkRunClock(t, run, before, time.Now())
}
