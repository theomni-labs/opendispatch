// SPDX-License-Identifier: AGPL-3.0-only

package business

import (
	"context"
	"encoding/json"
	"reflect"
	"testing"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/engines/enginetest"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/forecastcal"
)

// optimizerAnswerOn: one answer for date, own gap cells.
func (w engineWorld) optimizerAnswerOn(date string, cells []map[string]any) string {
	var lines []map[string]any
	for _, l := range w.optimizerLines() {
		l["roster_date"], l["start_at"], l["end_at"] = date, date+"T06:00:00+03:00", date+"T14:00:00+03:00"
		l["break_start_at"], l["break_end_at"] = date+"T10:00:00+03:00", date+"T10:30:00+03:00"
		lines = append(lines, l)
	}
	b, _ := json.Marshal(map[string]any{"schema_version": "1.0", "request_id": datactx.NewID(), "engine": map[string]any{"name": "optimizer", "version": "7.0.0"},
		"model_version": "o-7", "roster_date": date, "status": "feasible", "run_seconds": 0.5, "roster_assignments": lines,
		"vehicle_assignments": []map[string]any{}, "violations": []map[string]any{}, "gap_cells": cells})
	return string(b)
}

func gapKinds(t *testing.T, w engineWorld, date string) []GapCell {
	t.Helper()
	rc, _ := adminCtx(t)
	rc.CustomerID = w.tenantID
	view, err := GetGapSurplus(context.Background(), w.conn, rc, GapQuery{ZoneID: w.zoneID, Date: date})
	check(t, err)
	return view.Cells
}

func TestBuildingOneDayLeavesAnotherDaysGapView(t *testing.T) {
	w := newEngineWorld(t)
	ctx := context.Background()
	dayA, dayB := w.tomorrow, shiftDateBy(w.tomorrow, 1)
	need := []map[string]any{{"zone_id": w.zoneID, "interval_index": 40, "required": 5, "planned": 0, "delta": -5, "kind": "gap"}}
	w.srv.Script(enginetest.Behavior{Kind: enginetest.Answer, Body: w.daysAnswer(w.today, forecastcal.DefaultHorizonDays)},
		enginetest.Behavior{Kind: enginetest.Answer, Body: w.optimizerAnswerOn(dayA, need)},
		enginetest.Behavior{Kind: enginetest.Answer, Body: w.optimizerAnswerOn(dayB, []map[string]any{})})
	_, err := CreateForecastRun(ctx, w.conn, w.actors.Forecast, map[string]any{"horizon_start_date": w.today, "horizon_days": float64(forecastcal.DefaultHorizonDays)})
	check(t, err)
	a, err := BuildRoster(ctx, w.conn, w.actors.Roster, map[string]any{"zone_id": w.zoneID, "roster_date": dayA, "forecast_run_id": nil})
	check(t, err)
	if !strPtrIs(a.OptimizerSource, "optimizer") {
		t.Fatalf("day A: got %v %v, want the optimizer", a.OptimizerSource, a.FallbackReason)
	}
	before := gapKinds(t, w, dayA)
	if gaps, _ := countCells(before); gaps == 0 || before[40].Required != 5 {
		t.Fatalf("day A before: %d gaps, required %d at 40, want day A's answer", gaps, before[40].Required)
	}
	b, err := BuildRoster(ctx, w.conn, w.actors.Roster, map[string]any{"zone_id": w.zoneID, "roster_date": dayB, "forecast_run_id": nil})
	check(t, err)
	if !strPtrIs(b.OptimizerSource, "optimizer") {
		t.Fatalf("day B: got %v %v, want the optimizer", b.OptimizerSource, b.FallbackReason)
	}
	if after := gapKinds(t, w, dayA); !reflect.DeepEqual(after, before) {
		ga, _ := countCells(after)
		gb, _ := countCells(before)
		t.Fatalf("day A changed after building day B: %d gaps, was %d", ga, gb)
	}
	if cells := gapKinds(t, w, dayB); cells[40].Required != 0 {
		t.Fatalf("day B: required %d at 40, want day B's own answer (0)", cells[40].Required)
	}
}
