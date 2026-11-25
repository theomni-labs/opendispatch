// SPDX-License-Identifier: AGPL-3.0-only

package business

import (
	"context"
	"errors"
	"testing"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/access"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/backtest"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/dataerr"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/reqctx"
)

func experimentCtx(role access.Role) reqctx.RequestContext {
	return reqctx.RequestContext{CustomerID: "11111111-1111-4111-8111-111111111111", UserID: "22222222-2222-4222-8222-222222222222",
		Role: role, ZoneScope: access.ZoneScope{Kind: access.ScopeWholeInstall}, InstallMode: access.InstallPrivate}
}

func TestExperimentsListNewestFirstAndPage(t *testing.T) {
	UseMemoryExperiments()
	t.Cleanup(UseMemoryExperiments)
	rc := experimentCtx(access.RoleAdministrator)
	for i, at := range []string{"2026-09-10T02:00:00+03:00", "2026-09-12T02:00:00+03:00", "2026-09-11T02:00:00+03:00"} {
		e := newExperiment(rc, ExperimentBacktest, TriggerManual, "ensemble-4")
		e.CreatedAt = at
		e.Params.HeldOutDays = intPtr(28 + i)
		finishExperiment(&e, nil)
		saveExperiment(context.Background(), rc.CustomerID, e)
	}
	other := experimentCtx(access.RoleAdministrator)
	other.CustomerID = "33333333-3333-4333-8333-333333333333"
	saveExperiment(context.Background(), other.CustomerID, newExperiment(other, ExperimentRetrain, TriggerManual, "ensemble-4"))
	page, err := ListForecastExperiments(rc, datactx.PageQuery{Limit: 2})
	if err != nil {
		t.Fatal(err)
	}
	if page.Page.Total != 3 || len(page.Items) != 2 || page.Items[0].CreatedAt != "2026-09-12T02:00:00+03:00" || !page.Page.HasMore {
		t.Fatalf("got %+v", page)
	}
	if page.Items[0].Status != "succeeded" || page.Items[0].FinishedAt == nil || page.Items[0].DataSource != "SYNTHETIC" {
		t.Fatalf("finished experiment %+v", page.Items[0])
	}
	if _, err := ListForecastExperiments(experimentCtx(access.RoleDispatcher), datactx.PageQuery{}); !errors.As(err, new(*dataerr.DataError)) {
		t.Fatalf("a dispatcher must be refused, got %v", err)
	}
}

func TestFailedExperimentKeepsTheClass(t *testing.T) {
	e := newExperiment(experimentCtx(access.RoleAdministrator), ExperimentRetrain, TriggerDegradation, "ensemble-4")
	finishExperiment(&e, ErrBacktestNeedsEngine)
	if e.Status != "failed" || e.ErrorClass == nil || *e.ErrorClass != "engine_off" {
		t.Fatalf("got %+v", e)
	}
}

func TestBacktestExperimentCarriesTheScores(t *testing.T) {
	wape, mape, base, imp, chW, lift := 0.21, 0.18, 0.3, 0.3, 0.25, -0.19
	rec := BacktestRecord{ModelVersion: "ensemble-4", DataSource: "SYNTHETIC", Illustrative: true, GateResult: "pass",
		Report:     &backtest.ForecastReport{Candidate: &backtest.ForecastArm{}, Gate: &backtest.Gate{Result: "pass", Improvement: &imp, BaselineName: "naive"}},
		Comparison: &ModelComparison{Champion: "ensemble-4", Challenger: "lightgbm-1", Overall: ModelLift{ChampionWAPE: &wape, ChallengerWAPE: &chW, WAPELift: &lift}}}
	rec.Report.Candidate.Overall.WAPE = &wape
	rec.Report.Candidate.MAPE = &backtest.MAPEReport{ZoneDay: backtest.MAPEMetrics{MAPE: &mape}}
	rec.Report.Baseline.Overall.WAPE = &base
	o := BacktestOptions{HeldOutDays: 28, HistoryLoad: 400, Trigger: TriggerDegradation}
	e := backtestExperiment(context.Background(), experimentCtx(access.RoleAdministrator), o, rec, "ds-0000000000000001", "2026-09-13T02:00:00+03:00")
	m := e.Metrics
	if e.Kind != ExperimentBacktest || e.Trigger != TriggerDegradation || e.Status != "succeeded" || *e.DatasetSnapshotID != "ds-0000000000000001" {
		t.Fatalf("got %+v", e)
	}
	if *m.WAPE != wape || *m.MAPE != mape || *m.BaselineWAPE != base || *m.Improvement != imp || *m.GateResult != "pass" || *m.ChallengerWAPE != chW || *m.WAPELift != lift {
		t.Fatalf("metrics %+v", m)
	}
	if *e.ChallengerModel != "lightgbm-1" || *e.Params.HeldOutDays != 28 || *e.Params.HistoryDays != 400 || !e.Illustrative {
		t.Fatalf("params %+v", e.Params)
	}
}
