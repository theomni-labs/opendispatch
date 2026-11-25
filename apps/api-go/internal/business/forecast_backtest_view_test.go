// SPDX-License-Identifier: AGPL-3.0-only

package business

import (
	"context"
	"testing"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/backtest"
)

func f64(v float64) *float64 { return &v }

func TestTheBacktestViewUsesTheGatesBaselineAndSaysWhenSourcesMix(t *testing.T) {
	hour := 9
	cand := backtest.ForecastArm{Overall: backtest.Metrics{Cells: 10, MAE: 1.5, RMSE: 2, WAPE: f64(0.2), Coverage: 0.8},
		MAPE: &backtest.MAPEReport{ZoneDay: backtest.MAPEMetrics{MAPE: f64(0.25)}}, EventDays: backtest.Metrics{WAPE: f64(0.3)}, OrdinaryDays: backtest.Metrics{WAPE: f64(0.18)},
		ByZoneHour: []backtest.ZoneHourMetrics{{ZoneID: "z1", Hour: hour, Metrics: backtest.Metrics{Cells: 3, WAPE: f64(0.4)}}}}
	naive := backtest.ForecastArm{Name: backtest.NaiveBaselineName, Overall: backtest.Metrics{Cells: 10, MAE: 2, RMSE: 3, WAPE: f64(0.3), Coverage: 0.5}}
	seg := backtest.ForecastArm{Name: backtest.SegmentBaselineName, Overall: backtest.Metrics{Cells: 10, MAE: 1.8, RMSE: 2.5, WAPE: f64(0.25)},
		EventDays: backtest.Metrics{WAPE: f64(0.35)}, ByZoneHour: []backtest.ZoneHourMetrics{{ZoneID: "z1", Hour: hour, Metrics: backtest.Metrics{Cells: 3, WAPE: f64(0.5)}}}}
	rep := &backtest.ForecastReport{Baseline: naive, Candidate: &cand, SegmentBaseline: &seg,
		HeldOut: backtest.HeldOut{From: "2026-08-16", To: "2026-09-12", Days: 28, EventDays: 2},
		Gate:    &backtest.Gate{Result: backtest.GatePass, MinImprovement: 0.1, Improvement: f64(0.2), BaselineName: backtest.SegmentBaselineName, WorseZones: 1, ComparedZones: 8},
		Weakest: &backtest.Weakest{Zones: []backtest.WeakLocation{{ZoneID: "z1", WAPE: f64(0.4), BaselineWAPE: f64(0.5), ActualTotal: 120}}}}
	rec := BacktestRecord{GeneratedAt: "2026-09-13T02:00:00+03:00", DataSource: backtest.SourceMixed, Illustrative: true, ModelVersion: "ensemble-4", HeldOutFrom: "2026-08-16", HeldOutTo: "2026-09-12",
		GateResult: backtest.GatePass, Report: rep, ModelInfo: &backtest.ModelInfo{FeatureSet: []string{"dow", "events"}, TrainingStart: "2025-01-01", TrainingEnd: "2026-08-15"},
		Comparison: &ModelComparison{Champion: "ensemble-4", Challenger: "ensemble-5", Overall: ModelLift{ChampionWAPE: f64(0.2), ChallengerWAPE: f64(0.19), WAPELift: f64(0.05)}}}

	v := backtestView(context.Background(), "t1", rec)
	if v.DataSource != "SYNTHETIC" || !v.MixedSources || !v.Illustrative {
		t.Fatalf("source %q mixed %v", v.DataSource, v.MixedSources)
	}
	if v.Gate.Baseline != "segment" || v.Gate.Result != "pass" || v.Gate.WorseZones != 1 || *v.Gate.Improvement != 0.2 {
		t.Fatalf("gate %+v", v.Gate)
	}
	if *v.Engine.MAPE != 0.25 || *v.Engine.RangeCoverage != 0.8 || v.Naive.RangeCoverage != nil || v.Naive.MAPE != nil || v.Segment == nil || *v.Segment.WAPE != 0.25 {
		t.Fatalf("arms %+v %+v %+v", v.Engine, v.Naive, v.Segment)
	}
	if v.EventDays.Days != 2 || v.OrdinaryDays.Days != 26 || *v.EventDays.BaselineWAPE != 0.35 || *v.EventDays.WAPE != 0.3 {
		t.Fatalf("day types %+v %+v", v.EventDays, v.OrdinaryDays)
	}
	z := v.WeakestZones
	if len(z) != 1 || len(z[0].Hours) != 1 || z[0].Hours[0].Hour != hour || *z[0].Hours[0].BaselineWAPE != 0.5 {
		t.Fatalf("weakest %+v", z)
	}
	if *v.Training.Features != 2 || *v.Training.From != "2025-01-01" || *v.HeldOut.To != "2026-09-12" {
		t.Fatalf("training %+v held out %+v", v.Training, v.HeldOut)
	}
	if v.Challenger == nil || v.Challenger.ChallengerRan != nil || v.Challenger.Error != nil || *v.Challenger.WAPELift != 0.05 {
		t.Fatalf("challenger %+v", v.Challenger)
	}
}

func TestABacktestWithNoReportStillReadsAsNotEnoughHistory(t *testing.T) {
	v := backtestView(context.Background(), "t1", BacktestRecord{DataSource: "IMPORTED", ModelVersion: "m"})
	if v.Gate.Result != backtest.GateNotEnoughHistory || v.DataSource != "IMPORTED" || v.MixedSources || v.Engine.WAPE != nil || len(v.WeakestZones) != 0 || v.HeldOut.From != nil {
		t.Fatalf("got %+v", v)
	}
}
