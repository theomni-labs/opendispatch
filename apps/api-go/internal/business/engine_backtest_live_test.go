// SPDX-License-Identifier: AGPL-3.0-only

package business

import (
	"context"
	"fmt"
	"strings"
	"testing"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/backtest"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/engines/enginetest"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/forecastcal"
)

const backtestAnswer = `{"model_version":"m-bt","model_info":{"feature_set":["dow","payday","events"],"training_start":"2026-06-01","training_end":"2026-09-11","history_days":28},"values":[]}`

// dailyCases adds one case a day at 09:07 for the days before today.
func dailyCases(t *testing.T, w engineWorld, days int) {
	t.Helper()
	var rows []Case
	for d := 1; d <= days; d++ {
		at := fmt.Sprintf("%sT09:07:00+03:00", shiftDateBy(w.today, -d))
		rows = append(rows, Case{ID: datactx.NewID(), TenantID: w.tenantID, CreatedAt: at, UpdatedAt: at, DataSource: "SYNTHETIC", CaseNumber: "B-" + datactx.NewID()[:8], ExternalID: datactx.NewID(),
			RegisteredAt: at, ZoneID: w.zoneID, SubZoneID: w.subID, Latitude: 24.7, Longitude: 46.7, Handling: "field", Extra: map[string]any{}})
	}
	check(t, upsertCasesLive(context.Background(), w.conn, w.tenantID, rows))
}

func TestBacktestOnAShortHistoryIsNotEnoughHistoryAndIsKept(t *testing.T) {
	w := newEngineWorld(t)
	useSharedAnswers(t, w.conn)
	w.srv.Script(enginetest.Behavior{Kind: enginetest.Answer, Body: backtestAnswer})
	rc, _ := adminCtx(t)
	rc.CustomerID = w.tenantID
	rec, err := RunForecastBacktest(context.Background(), w.conn, rc, BacktestOptions{HeldOutDays: 1})
	check(t, err)
	if rec.GateResult != "not_enough_history" || rec.ModelVersion != DefaultChampionModel || !rec.Illustrative || rec.DataSource != "SYNTHETIC" {
		t.Fatalf("got %+v", rec)
	}
	if rec.Scope != "backtest:"+shiftDateBy(w.today, 0) || len(rec.Report.Warnings) < 2 {
		t.Fatalf("scope %q warnings %v", rec.Scope, rec.Report.Warnings)
	}
	if len(w.srv.Requests()) != 0 {
		t.Fatal("the engine must not be asked when nothing can be scored")
	}
	UsePostgresEngineAnswers(freshConn(t))
	got, err := LatestForecastBacktest(w.tenantID)
	if err != nil || got == nil || got.Scope != rec.Scope || got.GateResult != "not_enough_history" {
		t.Fatalf("a fresh store gave %+v (%v)", got, err)
	}
}

func TestBacktestWithEnoughHistoryFailsAnEngineThatForecastsNothing(t *testing.T) {
	w := newEngineWorld(t)
	useSharedAnswers(t, w.conn)
	dailyCases(t, w, 100)
	w.srv.Script(enginetest.Behavior{Kind: enginetest.Answer, Body: backtestAnswer})
	rc, _ := adminCtx(t)
	rc.CustomerID = w.tenantID
	rec, err := RunForecastBacktest(context.Background(), w.conn, rc, BacktestOptions{HeldOutDays: 14})
	check(t, err)
	r := rec.Report
	reqs := w.srv.Requests()
	if len(reqs) != 14 {
		t.Fatalf("%d engine calls, want one per held-out day", len(reqs))
	}
	checkRequest(t, "forecaster", []byte(reqs[0].Body))
	if !strings.Contains(reqs[0].Body, `"is_payday"`) {
		t.Fatal("the backtest request carries no calendar features")
	}
	if rec.ModelVersion != "m-bt" || rec.ModelInfo == nil || len(rec.ModelInfo.FeatureSet) != 3 || rec.ModelInfo.HistoryDays != 28 || r.MaxRequestBytes == 0 {
		t.Fatalf("model %q info %+v", rec.ModelVersion, rec.ModelInfo)
	}
	UsePostgresEngineAnswers(freshConn(t))
	got, err := LatestForecastBacktest(w.tenantID)
	if err != nil || got == nil || got.Scope != "backtest:"+r.HeldOut.To || got.GateResult != "fail" || got.ModelInfo == nil || got.Report == nil || !got.Illustrative {
		t.Fatalf("a fresh store gave %+v (%v), want the kept result", got, err)
	}
	var doc ForecasterEngineOutput
	if found, _ := readForecasterDocument(context.Background(), w.tenantID, &doc); found && doc.ModelVersion == "m-bt" {
		t.Fatal("the backtest must not be read as a forecast")
	}
	if rec.GateResult != "fail" || r.HeldOut.Days != 14 || r.HeldOut.TrainingDays < 56 {
		t.Fatalf("got %s held out %+v", rec.GateResult, r.HeldOut)
	}
	if r.Candidate.Overall.WAPE == nil || *r.Candidate.Overall.WAPE != 1 || r.Baseline.Overall.WAPE == nil || *r.Baseline.Overall.WAPE >= 0.5 {
		t.Fatalf("candidate %+v baseline %+v", r.Candidate.Overall, r.Baseline.Overall)
	}
	seg := r.SegmentBaseline
	if seg == nil || seg.Overall.WAPE == nil || r.Gate == nil || r.Gate.BaselineName != seg.Name {
		t.Fatalf("segment arm %+v gate %+v, want the segment gate by default", seg, r.Gate)
	}
	if v := backtestView(context.Background(), w.tenantID, rec); v.Segment == nil || v.Segment.WAPE == nil || v.Gate.Baseline != "segment" {
		t.Fatalf("card segment %+v gate %+v", v.Segment, v.Gate)
	}
	if r.Weakest == nil || len(r.Weakest.Zones) != 1 {
		t.Fatalf("weakest %+v", r.Weakest)
	}
	page, err := ListAuditEvents(rc, AuditFilter{ActionPrefix: "forecast.backtest"})
	check(t, err)
	if len(page.Items) != 1 || page.Items[0].Detail["gate_baseline"] != backtest.SegmentBaselineName {
		t.Fatalf("audit events %+v, want 1 naming the segment gate", page.Items)
	}
	setForecastSetting(t, w.tenantID, forecastcal.KeyGateBaseline, "naive", "segment")
	rec, err = RunForecastBacktest(context.Background(), w.conn, rc, BacktestOptions{HeldOutDays: 14})
	check(t, err)
	if g := rec.Report.Gate; g == nil || g.BaselineName != rec.Report.Baseline.Name || backtestView(context.Background(), w.tenantID, rec).Gate.Baseline != "naive" {
		t.Fatalf("gate %+v, want the naive gate from the setting", g)
	}
}

func TestBacktestNeedsTheEngineMode(t *testing.T) {
	w := newEngineWorld(t)
	UseFixtureEngines()
	rc, _ := adminCtx(t)
	rc.CustomerID = w.tenantID
	if _, err := RunForecastBacktest(context.Background(), w.conn, rc, BacktestOptions{}); err == nil || !strings.Contains(err.Error(), "engine") {
		t.Fatalf("got %v", err)
	}
}
