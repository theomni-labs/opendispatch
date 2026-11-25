// SPDX-License-Identifier: AGPL-3.0-only

package backtest

import (
	"context"
	"strings"
	"testing"
)

func TestRunEngineOnTooFewDaysIsNotEnoughHistoryNotAnError(t *testing.T) {
	fc := &fakeCaller{resp: `{"values":[]}`}
	ds := dsOf(weeklyCases(4, nil)...)
	rep, err := RunEngine(context.Background(), ds, fc, EngineOptions{ModelVersion: "m", Source: SourceSynthetic}, ForecastConfig{Horizon: 1, MinHistoryDays: 7})
	if err != nil {
		t.Fatal(err)
	}
	if rep.Gate == nil || rep.Gate.Result != GateNotEnoughHistory || rep.HeldOut.DataDays != 4 {
		t.Fatalf("gate %+v held out %+v", rep.Gate, rep.HeldOut)
	}
	if fc.got != nil {
		t.Fatal("the engine must not be asked when nothing can be scored")
	}
	if !strings.Contains(strings.Join(rep.Warnings, "|"), "52 weeks") {
		t.Fatalf("warnings %v", rep.Warnings)
	}
}

func TestRunEngineNamesTheModelFromTheAnswer(t *testing.T) {
	fc := &fakeCaller{resp: `{"model_version":"m-7","values":[]}`}
	ds := dsOf(weeklyCases(12, nil)...)
	rep, err := RunEngine(context.Background(), ds, fc, EngineOptions{ModelVersion: "m", Source: SourceSynthetic}, ForecastConfig{Horizon: 1, MinHistoryDays: 7, HeldOutDays: 3})
	if err != nil {
		t.Fatal(err)
	}
	if rep.ModelVersion != "m-7" || !strings.Contains(rep.Candidate.Name, "m-7") || rep.Weakest.Arm != rep.GateArm().Name || rep.MaxRequestBytes == 0 {
		t.Fatalf("report %+v", rep)
	}
	if rep.HeldOut.Days != 3 || rep.Origins != 3 {
		t.Fatalf("held out %+v origins %d", rep.HeldOut, rep.Origins)
	}
}
