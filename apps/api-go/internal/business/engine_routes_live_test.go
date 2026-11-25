// SPDX-License-Identifier: AGPL-3.0-only

package business

import (
	"bytes"
	"context"
	"log"
	"os"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/engines/enginetest"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/forecastcal"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
)

func (w engineWorld) simulatorAnswer(version string) string {
	level := `{"case_count":1,"field_case_count":1,"remote_case_count":0,"from_registration":{"within_count":1,"case_count":1,"share":1},` +
		`"from_assignment":{"within_count":1,"case_count":1,"share":1},"assigned_to_arrived":{"median_seconds":412.4,"p90_seconds":500}}`
	return `{"schema_version":"1.0","engine":{"name":"simulator","version":"` + version + `"},"model_version":"des-nearest-0.1","illustrative":true,` +
		`"unserved_cases":0,"zones":[{"zone_id":"` + w.zoneID + `","service_level":` + level + `}]}`
}

// freshConn opens a second app-role pool, as another process would.
func freshConn(t *testing.T) *tenancy.Connection {
	t.Helper()
	pool, err := pgxpool.New(context.Background(), liveAppDBURL(t))
	check(t, err)
	t.Cleanup(pool.Close)
	return &tenancy.Connection{Pool: pool}
}

func TestPostgresEngineAnswersLatestSkipsScenarioScopesAndEvictsSeparately(t *testing.T) {
	conn := openConn(t)
	tenant := freshTenant()
	checkScenarioScopes(t, pgEngineAnswers{conn: conn}, tenant, func() int {
		var n int
		check(t, ownerPool(t).QueryRow(context.Background(), `SELECT count(*) FROM engine_answers WHERE tenant_id = $1::uuid`, tenant).Scan(&n))
		return n
	})
}

func useSharedAnswers(t *testing.T, conn *tenancy.Connection) {
	t.Helper()
	UsePostgresEngineAnswers(conn)
	t.Cleanup(func() {
		_ = ReseedEngineAnswersForTest(context.Background(), &tenancy.Connection{Pool: ownerPool(t)})
		UseMemoryEngineAnswers()
	})
}

func TestTheForecastRouteRunsTheForecasterAndAnotherProcessSeesTheAnswer(t *testing.T) {
	w := newEngineWorld(t)
	useSharedAnswers(t, w.conn)
	w.srv.Script(enginetest.Behavior{Kind: enginetest.Answer, Body: w.forecasterAnswer()})
	run, err := CreateForecastRun(context.Background(), w.conn, w.actors.Forecast, map[string]any{"horizon_start_date": w.today, "horizon_days": float64(forecastcal.DefaultHorizonDays)})
	check(t, err)
	if run.Status != "succeeded" || run.ModelVersion != "m-9" || run.EngineVersion == nil || *run.EngineVersion != "9.1.0" {
		t.Fatalf("got %+v, want the engine's model and engine versions", run)
	}
	reqs := w.srv.Requests()
	if len(reqs) != 1 {
		t.Fatalf("got %d engine calls, want one", len(reqs))
	}
	checkRequest(t, "forecaster", []byte(reqs[0].Body))

	UsePostgresEngineAnswers(freshConn(t))
	var doc ForecasterEngineOutput
	found, err := readForecasterDocument(context.Background(), w.tenantID, &doc)
	if err != nil || !found || doc.ModelVersion != "m-9" || doc.Engine.Version != "9.1.0" {
		t.Fatalf("a fresh store gave found=%v err=%v doc=%+v, want the kept answer", found, err, doc)
	}
	if again, err := loadLatestForecastRun(context.Background(), w.tenantID, false); err != nil || again == nil || again.ID != run.ID {
		t.Fatalf("got %+v (%v), want the new run as the latest", again, err)
	}
}

func TestTheApplicationRoleCanStoreTheEngineForecastValues(t *testing.T) {
	w := newEngineWorld(t)
	UsePostgresForecast(w.conn)
	t.Cleanup(UseMemoryForecast)
	w.srv.Script(enginetest.Behavior{Kind: enginetest.Answer, Body: w.forecasterAnswer()})
	run, err := CreateForecastRun(context.Background(), w.conn, w.actors.Forecast, map[string]any{"horizon_start_date": w.today, "horizon_days": float64(forecastcal.DefaultHorizonDays)})
	check(t, err)
	if run.Status != "succeeded" {
		t.Fatalf("got %+v, want a succeeded run", run)
	}
	var n int
	check(t, ownerPool(t).QueryRow(context.Background(), `SELECT count(*) FROM forecast_values WHERE tenant_id = $1::uuid AND forecast_run_id = $2::uuid`, w.tenantID, run.ID).Scan(&n))
	if n != 4 {
		t.Fatalf("got %d stored values, want the 4 the engine answered", n)
	}
}

func TestAFailingForecasterOnTheRouteGivesAFailedRunAndMarksTheLastGoodOneStale(t *testing.T) {
	w := newEngineWorld(t)
	ctx := context.Background()
	cfg := engineCfg
	UseFixtureEngines()
	good, err := CreateForecastRun(ctx, w.conn, w.actors.Forecast, map[string]any{"horizon_start_date": shiftDateBy(w.today, -1), "horizon_days": 1.0})
	check(t, err)
	UseEngines(cfg)
	w.srv.Script(enginetest.Behavior{Kind: enginetest.Status500})

	run, err := CreateForecastRun(ctx, w.conn, w.actors.Forecast, map[string]any{"horizon_start_date": w.today, "horizon_days": float64(forecastcal.DefaultHorizonDays)})
	check(t, err)
	if run.Status != "failed" || run.ErrorMessage == nil || !strings.Contains(*run.ErrorMessage, "status") {
		t.Fatalf("got %+v, want a failed run that names the error class", run)
	}
	latest, err := loadLatestForecastRun(context.Background(), w.tenantID, false)
	check(t, err)
	if latest == nil || latest.ID != good.ID || latest.ErrorMessage == nil || !strings.HasPrefix(*latest.ErrorMessage, "Stale:") {
		t.Fatalf("got %+v, want the last good run, marked stale", latest)
	}
}

func TestTheSimulationRouteRunsTheSimulator(t *testing.T) {
	w := newEngineWorld(t)
	ctx := context.Background()
	w.srv.Script(enginetest.Behavior{Kind: enginetest.Answer, Body: w.forecasterAnswer()}, enginetest.Behavior{Kind: enginetest.Answer, Body: w.optimizerAnswer()})
	_, err := RunWorkerCycle(ctx, w.conn, w.actors)
	check(t, err)
	rc := w.actors.Roster
	rosters, err := ListRosters(ctx, w.conn, rc, RosterQuery{ZoneID: w.zoneID, Date: w.tomorrow})
	check(t, err)
	if len(rosters.Items) != 1 {
		t.Fatalf("got %d rosters, want one", len(rosters.Items))
	}
	body := map[string]any{"roster_id": rosters.Items[0].ID, "run_date": shiftDateBy(w.today, -1), "assignment_policy": "nearest"}

	w.srv.Script(enginetest.Behavior{Kind: enginetest.Answer, Body: w.simulatorAnswer("4.2.0")})
	run, err := RunSimulation(ctx, w.conn, rc, body)
	check(t, err)
	if run.Status != "succeeded" || run.EngineVersion == nil || *run.EngineVersion != "4.2.0" {
		t.Fatalf("got %+v, want the simulator's version", run)
	}
	reqs := w.srv.Requests()
	checkRequest(t, "simulator", []byte(reqs[len(reqs)-1].Body))
	results, err := loadSimulationResults(context.Background(), w.tenantID, run.ID)
	check(t, err)
	if len(results) != 1 || results[0].MedianAssignedToArrivedSecond == nil || *results[0].MedianAssignedToArrivedSecond != 412 {
		t.Fatalf("got %+v, want the simulator's zone result", results)
	}
	var kept simulatorOutputDoc
	if found, err := readSimulatorDocument(context.Background(), w.tenantID, &kept); err != nil || !found || kept.Engine.Version != "4.2.0" {
		t.Fatalf("got found=%v err=%v doc=%+v, want the answer kept", found, err, kept)
	}

	w.srv.Script(enginetest.Behavior{Kind: enginetest.Status500})
	failed, err := RunSimulation(ctx, w.conn, rc, body)
	check(t, err)
	if failed.Status != "failed" || failed.EngineVersion != nil {
		t.Fatalf("got %+v, want a failed run", failed)
	}
	if rows, err := loadSimulationResults(context.Background(), w.tenantID, failed.ID); err != nil || len(rows) != 0 {
		t.Fatalf("got %d results (%v), want none for a failed run", len(rows), err)
	}
}

func TestTheRosterRouteAsksTheOptimizer(t *testing.T) {
	w := newEngineWorld(t)
	ctx := context.Background()
	useSharedAnswers(t, w.conn)
	w.srv.Script(enginetest.Behavior{Kind: enginetest.Answer, Body: w.forecasterAnswer()}, enginetest.Behavior{Kind: enginetest.Answer, Body: w.optimizerAnswer()})
	_, err := CreateForecastRun(ctx, w.conn, w.actors.Forecast, map[string]any{"horizon_start_date": w.today, "horizon_days": float64(forecastcal.DefaultHorizonDays)})
	check(t, err)
	roster, err := BuildRoster(ctx, w.conn, w.actors.Roster, map[string]any{"zone_id": w.zoneID, "roster_date": w.tomorrow, "forecast_run_id": nil})
	check(t, err)
	if roster.EngineVersion == nil || *roster.EngineVersion != "7.0.0" {
		t.Fatalf("got %+v, want the optimizer's version", roster.EngineVersion)
	}
	reqs := w.srv.Requests()
	if len(reqs) != 2 {
		t.Fatalf("got %d engine calls, want forecaster then optimizer", len(reqs))
	}
	checkRequest(t, "optimizer", []byte(reqs[1].Body))

	UsePostgresEngineAnswers(freshConn(t))
	var doc optimizerOutputDoc
	if found, err := readOptimizerDocument(context.Background(), w.tenantID, &doc); err != nil || !found || doc.ModelVersion != "o-7" || doc.RosterDate != w.tomorrow {
		t.Fatalf("a fresh store gave found=%v err=%v doc=%+v, want the kept answer", found, err, doc)
	}
}

func TestAFailingOptimizerOnTheRosterRouteStillBuildsTheRoster(t *testing.T) {
	w := newEngineWorld(t)
	ctx := context.Background()
	w.srv.Script(enginetest.Behavior{Kind: enginetest.Answer, Body: w.forecasterAnswer()}, enginetest.Behavior{Kind: enginetest.Status500})
	_, err := CreateForecastRun(ctx, w.conn, w.actors.Forecast, map[string]any{"horizon_start_date": w.today, "horizon_days": float64(forecastcal.DefaultHorizonDays)})
	check(t, err)
	roster, err := BuildRoster(ctx, w.conn, w.actors.Roster, map[string]any{"zone_id": w.zoneID, "roster_date": w.tomorrow, "forecast_run_id": nil})
	check(t, err)
	if roster.Status != "draft" || roster.EngineVersion == nil || *roster.EngineVersion == "7.0.0" {
		t.Fatalf("got %+v, want a roster built without the optimizer's answer", roster)
	}
	fails := engineFailures(t, w)
	if len(fails) != 1 || fails[0]["engine"] != "optimizer" {
		t.Fatalf("got %v, want one optimizer failure", fails)
	}
}

func TestAnOptimizerThatCannotAnswerSaysWhyInTheLog(t *testing.T) {
	w := newEngineWorld(t)
	ctx := context.Background()
	w.srv.Script(enginetest.Behavior{Kind: enginetest.Answer, Body: w.forecasterAnswer()})
	_, err := CreateForecastRun(ctx, w.conn, w.actors.Forecast, map[string]any{"horizon_start_date": w.today, "horizon_days": float64(forecastcal.DefaultHorizonDays)})
	check(t, err)
	var buf bytes.Buffer
	log.SetOutput(&buf)
	t.Cleanup(func() { log.SetOutput(os.Stderr) })
	far := shiftDateBy(w.today, forecastcal.DefaultHorizonDays+3)
	roster, err := BuildRoster(ctx, w.conn, w.actors.Roster, map[string]any{"zone_id": w.zoneID, "roster_date": far, "forecast_run_id": nil})
	check(t, err)
	out := buf.String()
	if roster.Status != "draft" || !strings.Contains(out, "optimizer gave no answer") || !strings.Contains(out, "request_not_built") || !strings.Contains(out, "has no values for "+far) {
		t.Fatalf("got roster %q and log %q, want a draft and the reason logged", roster.Status, out)
	}
}

func TestKeptAnswersSurviveAFreshStoreAreBoundedAndPerCustomer(t *testing.T) {
	conn := openConn(t)
	useSharedAnswers(t, conn)
	_, tenant := adminCtx(t)
	_, other := adminCtx(t)
	first := pgEngineAnswers{conn: conn}
	var seenPrev string
	merge := func(prev, _ []byte) []byte { seenPrev = string(prev); return []byte(`{"a":1,"b":2}`) }
	check(t, first.keep(context.Background(), tenant, "optimizer", "2026-09-01", []byte(`{"a":1}`), nil))
	check(t, first.keep(context.Background(), tenant, "optimizer", "2026-09-01", []byte(`{"b":2}`), merge))
	var merged map[string]int
	check(t, ownerPool(t).QueryRow(context.Background(), `SELECT body FROM engine_answers WHERE tenant_id = $1::uuid AND scope_key = '2026-09-01'`, tenant).Scan(&merged))
	if seenPrev != `{"a": 1}` || merged["a"] != 1 || merged["b"] != 2 {
		t.Fatalf("got prev %q and %v, want the merge to see the kept answer", seenPrev, merged)
	}
	for i := 2; i <= 9; i++ {
		check(t, first.keep(context.Background(), tenant, "optimizer", "2026-09-0"+string(rune('0'+i)), []byte(`{"n":`+string(rune('0'+i))+`}`), nil))
	}
	second := pgEngineAnswers{conn: freshConn(t)}
	body, err := second.latest(context.Background(), tenant, "optimizer")
	check(t, err)
	if string(body) != `{"n": 9}` && string(body) != `{"n":9}` {
		t.Fatalf("got %s, want the newest answer", body)
	}
	var n int
	check(t, ownerPool(t).QueryRow(context.Background(), `SELECT count(*) FROM engine_answers WHERE tenant_id = $1::uuid AND engine = 'optimizer'`, tenant).Scan(&n))
	if n != engineAnswerKeep {
		t.Fatalf("got %d kept scopes, want %d", n, engineAnswerKeep)
	}
	if none, err := second.latest(context.Background(), other, "optimizer"); err != nil || none != nil {
		t.Fatalf("another customer sees %s (%v)", none, err)
	}
	if none, err := second.latest(context.Background(), tenant, "forecaster"); err != nil || none != nil {
		t.Fatalf("another engine sees %s (%v)", none, err)
	}
	broken := pgEngineAnswers{conn: freshConn(t)}
	broken.conn.Pool.Close()
	if _, err := broken.latest(context.Background(), tenant, "optimizer"); err == nil {
		t.Fatal("a read from a closed pool must return an error")
	}
}
