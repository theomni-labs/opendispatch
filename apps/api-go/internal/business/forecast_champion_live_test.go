// SPDX-License-Identifier: AGPL-3.0-only

package business

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/backtest"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/engines/enginetest"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/forecastcal"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/settingsstore"
)

func setForecastSetting(t *testing.T, tenant, key string, value, reset any) {
	t.Helper()
	check(t, settingsstore.Put(context.Background(), tenant, key, value))
	t.Cleanup(func() { _ = settingsstore.Put(context.Background(), tenant, key, reset) })
}

// noBlend: the engines' own forecasts, unblended.
func noBlend(t *testing.T, tenant string) {
	t.Helper()
	setForecastSetting(t, tenant, forecastcal.KeyShapeShare, 1.0, backtest.DefaultShapeShare)
	setForecastSetting(t, tenant, forecastcal.KeySmallZone, 0.0, backtest.DefaultSmallZone)
	setForecastSetting(t, tenant, forecastcal.KeyDayTypes, false, true)
}

// noChallenger: off for this test, default after.
func noChallenger(t *testing.T, tenant string) {
	t.Helper()
	check(t, settingsstore.Put(context.Background(), tenant, KeyChallengerModel, ""))
	t.Cleanup(func() { _ = settingsstore.DeletePrefix(context.Background(), tenant, KeyChallengerModel) })
}

func answerAs(body, model string) string {
	return strings.Replace(body, `"model_version":"m-9"`, `"model_version":"`+model+`"`, 1)
}

func auditSummaries(t *testing.T, w engineWorld, prefix string) []string {
	t.Helper()
	rc, _ := adminCtx(t)
	rc.CustomerID = w.tenantID
	page, err := ListAuditEvents(rc, AuditFilter{ActionPrefix: prefix})
	check(t, err)
	var out []string
	for _, e := range page.Items {
		out = append(out, e.SummaryEn)
	}
	return out
}

func TestWorkerStoresTheChallengerBesideTheChampion(t *testing.T) {
	w := newEngineWorld(t)
	setForecastSetting(t, w.tenantID, KeyChallengerModel, "m-chal", "")
	w.srv.Script(enginetest.Behavior{Kind: enginetest.Answer, Body: w.forecasterAnswer()},
		enginetest.Behavior{Kind: enginetest.Answer, Body: answerAs(w.forecasterAnswer(), "m-chal")},
		enginetest.Behavior{Kind: enginetest.Answer, Body: w.optimizerAnswer()})
	report, err := RunWorkerCycle(context.Background(), w.conn, w.actors)
	check(t, err)
	if !report.ForecastCreated || !report.ChallengerCreated || report.RostersBuilt != 1 {
		t.Fatalf("got %+v, want both runs and a roster", report)
	}
	reqs := w.srv.Requests()
	if len(reqs) != 3 || !strings.Contains(reqs[0].Body, `"model_version":"ensemble-4"`) || !strings.Contains(reqs[1].Body, `"model_version":"m-chal"`) {
		t.Fatalf("%d requests; want the champion ensemble-4, then m-chal", len(reqs))
	}
	latest, err := loadLatestForecastRun(context.Background(), w.tenantID, false)
	check(t, err)
	if latest == nil || latest.ModelVersion != "m-9" {
		t.Fatalf("latest run %+v, want the champion's", latest)
	}
	runs, err := ListForecastRuns(w.actors.Forecast, ForecastRunQuery{})
	check(t, err)
	if len(runs.Items) != 2 || runs.Items[0].ModelVersion != "m-9" || runs.Items[1].ModelVersion != "m-chal" || !isChallengerRun(context.Background(), w.tenantID, runs.Items[1]) {
		t.Fatalf("runs %+v, want the champion first", runs.Items)
	}
	var doc ForecasterEngineOutput
	if found, _ := readForecasterDocument(context.Background(), w.tenantID, &doc); !found || doc.ModelVersion != "m-9" {
		t.Fatalf("kept answer %q, want the champion's", doc.ModelVersion)
	}
	if got := auditSummaries(t, w, "forecast.challenger"); len(got) != 1 || !strings.Contains(got[0], "model m-chal") {
		t.Fatalf("audit %v", got)
	}
}

func TestAChallengerTheEngineDidNotRunIsNotStored(t *testing.T) {
	w := newEngineWorld(t)
	setForecastSetting(t, w.tenantID, KeyChallengerModel, "m-chal", "")
	w.srv.Script(enginetest.Behavior{Kind: enginetest.Answer, Body: w.forecasterAnswer()},
		enginetest.Behavior{Kind: enginetest.Answer, Body: w.forecasterAnswer()},
		enginetest.Behavior{Kind: enginetest.Answer, Body: w.optimizerAnswer()})
	report, err := RunWorkerCycle(context.Background(), w.conn, w.actors)
	check(t, err)
	if !report.ForecastCreated || report.ChallengerCreated {
		t.Fatalf("got %+v, want the champion only", report)
	}
	runs, err := loadForecastRuns(context.Background(), w.tenantID, false)
	check(t, err)
	if len(runs) != 1 || runs[0].ModelVersion != "m-9" {
		t.Fatalf("runs %+v", runs)
	}
	if got := auditSummaries(t, w, "forecast.challenger_skipped"); len(got) != 1 {
		t.Fatalf("audit %v, want one skip", got)
	}
}

func TestOneRunFinishesWhenTheClientLeaves(t *testing.T) {
	w := newEngineWorld(t)
	setForecastSetting(t, w.tenantID, KeyChallengerModel, "m-chal", "")
	w.srv.Script(enginetest.Behavior{Kind: enginetest.Answer, Body: w.forecasterAnswer()},
		enginetest.Behavior{Kind: enginetest.Slow, Delay: 300 * time.Millisecond, Body: answerAs(w.forecasterAnswer(), "m-chal")})
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go func() {
		for len(w.srv.Requests()) < 2 {
			time.Sleep(5 * time.Millisecond)
		}
		cancel()
	}()
	_, err := CreateForecastRun(ctx, w.conn, w.actors.Forecast, map[string]any{"horizon_start_date": w.today, "horizon_days": float64(forecastcal.DefaultHorizonDays)})
	check(t, err)
	if ctx.Err() == nil {
		t.Fatal("the client never left")
	}
	runs, err := loadForecastRuns(context.Background(), w.tenantID, false)
	check(t, err)
	if len(runs) != 2 || runs[0].ModelVersion != "m-9" || runs[1].ModelVersion != "m-chal" {
		t.Fatalf("runs %+v, want the champion and the challenger", runs)
	}
	if got := auditSummaries(t, w, "forecast.run_created"); len(got) != 1 {
		t.Fatalf("audit %v, want the run", got)
	}
}

// yesterdayAnswer: 20 cases forecast for 09:00.
func (w engineWorld) yesterdayAnswer(day string) string { return w.daysAnswer(day, 1) }

// daysAnswer: 20 at 09:00 on each day.
func (w engineWorld) daysAnswer(start string, days int) string {
	var values []map[string]any
	for d := range days {
		for i := 36; i < 40; i++ {
			values = append(values, map[string]any{"zone_id": w.zoneID, "sub_zone_id": w.subID, "interval_start": intervalStartOf(shiftDateBy(start, d), i), "interval_index": i,
				"low": 0, "expected": 5, "high": 9, "field_expected": 3, "remote_inferred_expected": 2})
		}
	}
	b, _ := json.Marshal(map[string]any{"schema_version": "1.0", "request_id": datactx.NewID(), "engine": map[string]any{"name": "forecaster", "version": "9.1.0"},
		"model_version": "ensemble-3", "generated_at": "2026-09-13T02:00:00Z", "data_source": "SYNTHETIC", "illustrative": true,
		"horizon": map[string]any{"start_date": start, "days": days}, "interval_minutes": 15, "intervals_per_day": 96, "range_coverage": 0.8, "values": values})
	return string(b)
}

func TestDegradationScoresTheRollingWindow(t *testing.T) {
	w := newEngineWorld(t)
	setForecastSetting(t, w.tenantID, keyDegradationAlerted, map[string]string{}, map[string]string{})
	start, yesterday := shiftDateBy(w.today, -3), shiftDateBy(w.today, -1)
	w.srv.Script(enginetest.Behavior{Kind: enginetest.Answer, Body: w.daysAnswer(start, 3)})
	ctx := context.Background()
	var older []Case
	for d := 4; d <= 5; d++ {
		at := shiftDateBy(w.today, -d) + "T09:07:00+03:00"
		older = append(older, Case{ID: datactx.NewID(), TenantID: w.tenantID, CreatedAt: at, UpdatedAt: at, DataSource: "SYNTHETIC", CaseNumber: "C-" + datactx.NewID()[:8], ExternalID: datactx.NewID(),
			RegisteredAt: at, ZoneID: w.zoneID, SubZoneID: w.subID, Latitude: 24.7, Longitude: 46.7, Handling: "field", Extra: map[string]any{}})
	}
	check(t, upsertCasesLive(ctx, w.conn, w.tenantID, older))
	_, err := CreateForecastRun(ctx, w.conn, w.actors.Forecast, map[string]any{"horizon_start_date": start, "horizon_days": 3.0})
	check(t, err)
	if res, err := MeasureForecastError(ctx, w.conn, w.tenantID, yesterday); err != nil || res == nil || res.WindowDays != 7 || len(res.Zones) != 0 {
		t.Fatalf("got %+v %v: three days of seven score no zone", res, err)
	}
	setForecastSetting(t, w.tenantID, KeyDegradationWindow, 3, defaultDegradeWindow)
	res, err := MeasureForecastError(ctx, w.conn, w.tenantID, yesterday)
	check(t, err)
	if res == nil || res.From != start || len(res.Zones) != 1 || res.Zones[0].Days != 3 || res.Zones[0].Actual != 3 || res.Zones[0].WAPE != 19 || len(res.Over) != 1 {
		t.Fatalf("got %+v, want one zone over three days at WAPE 19", res)
	}
}

func TestDegradationAlertsOnceWithinTheCooldown(t *testing.T) {
	w := newEngineWorld(t)
	setForecastSetting(t, w.tenantID, keyDegradationAlerted, map[string]string{}, map[string]string{})
	setForecastSetting(t, w.tenantID, KeyDegradationWindow, 1, defaultDegradeWindow)
	yesterday := shiftDateBy(w.today, -1)
	w.srv.Script(enginetest.Behavior{Kind: enginetest.Answer, Body: w.yesterdayAnswer(yesterday)})
	ctx := context.Background()
	_, err := CreateForecastRun(ctx, w.conn, w.actors.Forecast, map[string]any{"horizon_start_date": yesterday, "horizon_days": 1.0})
	check(t, err)
	res, err := RunDegradationCheck(ctx, w.conn, w.actors.Forecast, yesterday)
	check(t, err)
	if res == nil || len(res.Zones) != 1 || res.Zones[0].WAPE != 19 || res.Zones[0].Actual != 1 || len(res.Alerted) != 1 || res.Model != "ensemble-3" || !res.Illustrative {
		t.Fatalf("got %+v, want one zone at WAPE 19 alerted", res)
	}
	count := func() int {
		rows, err := allNotifications(context.Background(), w.tenantID)
		check(t, err)
		n := 0
		for _, r := range rows {
			if r.TitleEn == "Forecast error above the limit" && r.TitleAr != nil && r.Category == "model" && r.Severity == "warning" {
				n++
			}
		}
		return n
	}
	if n := count(); n != 2 {
		t.Fatalf("%d alerts, want one per role (Administrator, Planner)", n)
	}
	again, err := RunDegradationCheck(ctx, w.conn, w.actors.Forecast, yesterday)
	check(t, err)
	if len(again.Alerted) != 0 || again.Suppressed != 1 || count() != 2 {
		t.Fatalf("got %+v, want the cooldown to hold", again)
	}
	if got := auditSummaries(t, w, "forecast.degradation"); len(got) != 1 || !strings.Contains(got[0], "1 zone(s)") {
		t.Fatalf("audit %v", got)
	}
	setForecastSetting(t, w.tenantID, KeyDegradationWAPE, 50.0, defaultDegradationWAPE)
	quiet, err := RunDegradationCheck(ctx, w.conn, w.actors.Forecast, yesterday)
	check(t, err)
	if len(quiet.Over) != 0 {
		t.Fatalf("got %+v, want nothing over a limit of 50", quiet)
	}
}

// modelCaller answers per model: 3 or 1 at 09:00.
type modelCaller struct{ ran string }

func (m modelCaller) Call(_ context.Context, request []byte) ([]byte, error) {
	var req struct {
		Model struct {
			ModelVersion string `json:"model_version"`
		} `json:"model"`
		Horizon struct {
			StartDate string `json:"start_date"`
			Days      int    `json:"days"`
		} `json:"horizon"`
		Zones []struct {
			ZoneID   string `json:"zone_id"`
			SubZones []struct {
				SubZoneID string `json:"sub_zone_id"`
			} `json:"sub_zones"`
		} `json:"zones"`
	}
	if err := json.Unmarshal(request, &req); err != nil {
		return nil, err
	}
	model, e := req.Model.ModelVersion, 3.0
	if m.ran != "" {
		model = m.ran
	}
	if model != "ensemble-4" {
		e = 1
	}
	values := []map[string]any{}
	for d := 0; d < req.Horizon.Days; d++ {
		day := shiftDateBy(req.Horizon.StartDate, d)
		for _, z := range req.Zones {
			for _, s := range z.SubZones {
				values = append(values, map[string]any{"zone_id": z.ZoneID, "sub_zone_id": s.SubZoneID, "interval_start": intervalStartOf(day, 36), "low": 0, "expected": e, "high": e + 2})
			}
		}
	}
	return json.Marshal(map[string]any{"model_version": model, "values": values})
}

func TestBacktestScoresTheChallengerOnTheSameDays(t *testing.T) {
	w := newEngineWorld(t)
	useSharedAnswers(t, w.conn)
	dailyCases(t, w, 100)
	setForecastSetting(t, w.tenantID, KeyChallengerModel, "m-chal", "")
	noBlend(t, w.tenantID)
	rc, _ := adminCtx(t)
	rc.CustomerID = w.tenantID
	rec, err := RunForecastBacktest(context.Background(), w.conn, rc, BacktestOptions{HeldOutDays: 7, EngineCaller: modelCaller{}})
	check(t, err)
	c := rec.Comparison
	if rec.ModelVersion != "ensemble-4" || c == nil || c.Champion != "ensemble-4" || c.Challenger != "m-chal" || c.ChallengerRan != "m-chal" || c.Error != "" {
		t.Fatalf("model %q comparison %+v", rec.ModelVersion, c)
	}
	if c.Overall.WAPELift == nil || *c.Overall.WAPELift <= 0.5 || c.Overall.MAPELift == nil || *c.Overall.MAPELift <= 0.5 {
		t.Fatalf("overall %+v, want the challenger far better", c.Overall)
	}
	if len(c.ByZone) != 1 || c.ByZone[0].ZoneID != w.zoneID || c.ByZone[0].WAPELift == nil || *c.ByZone[0].WAPELift <= 0.5 {
		t.Fatalf("by zone %+v", c.ByZone)
	}
	got, err := LatestForecastBacktest(w.tenantID)
	check(t, err)
	if got == nil || got.Comparison == nil || got.Comparison.Challenger != "m-chal" {
		t.Fatalf("kept %+v", got)
	}
	if s := auditSummaries(t, w, "forecast.backtest"); len(s) != 1 || !strings.Contains(s[0], "Challenger m-chal against ensemble-4: WAPE lift +") {
		t.Fatalf("audit %v", s)
	}
}

func TestBacktestGivesNoLiftWhenTheEngineRanAnotherModel(t *testing.T) {
	w := newEngineWorld(t)
	useSharedAnswers(t, w.conn)
	dailyCases(t, w, 100)
	setForecastSetting(t, w.tenantID, KeyChallengerModel, "m-chal", "")
	rc, _ := adminCtx(t)
	rc.CustomerID = w.tenantID
	rec, err := RunForecastBacktest(context.Background(), w.conn, rc, BacktestOptions{HeldOutDays: 7, EngineCaller: modelCaller{ran: "ensemble-3"}})
	check(t, err)
	if c := rec.Comparison; c == nil || c.Error == "" || c.Overall.WAPELift != nil {
		t.Fatalf("comparison %+v, want an error and no lift", c)
	}
}
