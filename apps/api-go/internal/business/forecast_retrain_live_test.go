// SPDX-License-Identifier: AGPL-3.0-only

package business

import (
	"context"
	"strings"
	"testing"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/access"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/dataerr"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/engines/enginetest"
)

func experimentsOf(t *testing.T, w engineWorld) []ForecastExperiment {
	t.Helper()
	page, err := ListForecastExperiments(w.actors.Forecast, datactx.PageQuery{Limit: 50})
	check(t, err)
	return page.Items
}

// degradedWorld: yesterday missed by WAPE 19.
func degradedWorld(t *testing.T, auto bool) (engineWorld, *DegradationResult) {
	t.Helper()
	w := newEngineWorld(t)
	setForecastSetting(t, w.tenantID, keyDegradationAlerted, map[string]string{}, map[string]string{})
	setForecastSetting(t, w.tenantID, KeyDegradationWindow, 1, defaultDegradeWindow)
	setForecastSetting(t, w.tenantID, KeyAutoRetrain, auto, defaultAutoRetrain)
	yesterday := shiftDateBy(w.today, -1)
	w.srv.Script(enginetest.Behavior{Kind: enginetest.Answer, Body: w.yesterdayAnswer(yesterday)})
	ctx := context.Background()
	_, err := CreateForecastRun(ctx, w.conn, w.actors.Forecast, map[string]any{"horizon_start_date": yesterday, "horizon_days": 1.0})
	check(t, err)
	res, err := RunDegradationCheck(ctx, w.conn, w.actors.Forecast, yesterday)
	check(t, err)
	if res == nil || len(res.Alerted) != 1 {
		t.Fatalf("got %+v, want one zone alerted", res)
	}
	return w, res
}

func TestDegradationRetrainsAndRecordsTheExperiment(t *testing.T) {
	UseMemoryExperiments()
	t.Cleanup(UseMemoryExperiments)
	w, res := degradedWorld(t, true)
	setForecastSetting(t, w.tenantID, "forecast.horizon_days", 7, 10)
	w.srv.Script(enginetest.Behavior{Kind: enginetest.Answer, Body: w.daysAnswer(w.today, 7)})
	before, err := loadForecastRuns(context.Background(), w.tenantID, false)
	check(t, err)
	if !retrainAfterDegradation(context.Background(), w.conn, w.actors.Forecast, res) {
		t.Fatal("want a retrain after the degradation")
	}
	waitBacktest(w.tenantID)
	after, err := loadForecastRuns(context.Background(), w.tenantID, false)
	check(t, err)
	var fresh *ForecastRun
	for _, r := range after {
		if r.HorizonStartDate == w.today {
			fresh = &r
		}
	}
	if len(after) != len(before)+1 || fresh == nil || fresh.HorizonDays != 7 || fresh.DatasetSnapshotID == nil {
		t.Fatalf("runs %+v, want a fresh 7-day run for today with a snapshot", after)
	}
	after[0] = *fresh
	var retrain *ForecastExperiment
	for _, e := range experimentsOf(t, w) {
		if e.Kind == ExperimentRetrain {
			retrain = &e
		}
	}
	if retrain == nil || retrain.Trigger != TriggerDegradation || retrain.Status != "succeeded" || *retrain.ForecastRunID != after[0].ID ||
		*retrain.DatasetSnapshotID != *after[0].DatasetSnapshotID || *retrain.Params.DegradedZones != 1 || *retrain.Metrics.WorstZoneWAPE != 19 {
		t.Fatalf("retrain experiment %+v", retrain)
	}
	got := auditSummaries(t, w, "forecast.retrain")
	if len(got) != 1 || !strings.Contains(got[0], "Forecast retrained (degradation, model ensemble-4, 7 day(s))") {
		t.Fatalf("audit %v", got)
	}
}

func TestNoRetrainWhenTheSettingIsOff(t *testing.T) {
	UseMemoryExperiments()
	t.Cleanup(UseMemoryExperiments)
	w, res := degradedWorld(t, false)
	if retrainAfterDegradation(context.Background(), w.conn, w.actors.Forecast, res) {
		t.Fatal("auto_retrain off must not retrain")
	}
	if n := len(experimentsOf(t, w)); n != 0 {
		t.Fatalf("%d experiments, want none", n)
	}
}

func TestRetrainNowRunsInTheBackground(t *testing.T) {
	UseMemoryExperiments()
	t.Cleanup(UseMemoryExperiments)
	w := newEngineWorld(t)
	w.srv.Script(enginetest.Behavior{Kind: enginetest.Answer, Body: w.daysAnswer(w.today, forecastHorizonDays(context.Background(), w.tenantID))})
	e, err := RetrainForecastModel(context.Background(), w.conn, w.actors.Forecast)
	check(t, err)
	if e.Status != "running" || e.Trigger != TriggerManual || e.Kind != ExperimentRetrain {
		t.Fatalf("got %+v, want a running manual retrain", e)
	}
	retrainWG.Wait()
	waitBacktest(w.tenantID)
	items := experimentsOf(t, w)
	var done *ForecastExperiment
	for _, x := range items {
		if x.ID == e.ID {
			done = &x
		}
	}
	if done == nil || done.Status != "succeeded" || done.ForecastRunID == nil || done.FinishedAt == nil {
		t.Fatalf("experiments %+v", items)
	}
	viewer := w.actors.Forecast
	viewer.Role = access.RolePlanner
	if _, err := RetrainForecastModel(context.Background(), w.conn, viewer); errCodeOf(err) != dataerr.CodeForbidden {
		t.Fatalf("a planner must be refused, got %v", err)
	}
}

func TestModelSettingsSetTheHorizonAndAutoRetrain(t *testing.T) {
	w := newEngineWorld(t)
	setForecastSetting(t, w.tenantID, "forecast.horizon_days", 10, 10)
	setForecastSetting(t, w.tenantID, KeyAutoRetrain, true, true)
	got, err := UpdateForecastModelSettings(w.actors.Forecast, map[string]any{"horizon_days": 30.0, "auto_retrain": false})
	check(t, err)
	if got.HorizonDays != 30 || got.AutoRetrain || forecastHorizonDays(context.Background(), w.tenantID) != 30 {
		t.Fatalf("got %+v", got)
	}
	for _, bad := range []map[string]any{{"horizon_days": 6.0}, {"horizon_days": 31.0}, {"auto_retrain": "yes"}} {
		if _, err := UpdateForecastModelSettings(w.actors.Forecast, bad); errCodeOf(err) != dataerr.CodeInvalid {
			t.Fatalf("%v: want invalid, got %v", bad, err)
		}
	}
	audit := auditSummaries(t, w, "forecast.model_settings")
	if len(audit) == 0 || !strings.Contains(audit[0], "Forecast horizon changed from 10 to 30 days.") || !strings.Contains(audit[0], "Retrain on degradation changed from on to off.") {
		t.Fatalf("audit %v", audit)
	}
}
