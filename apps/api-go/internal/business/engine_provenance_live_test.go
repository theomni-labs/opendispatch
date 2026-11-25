// SPDX-License-Identifier: AGPL-3.0-only

package business

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/engines/enginetest"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/forecastcal"
)

// forecastWith edits the first value of the mock answer.
func (w engineWorld) forecastWith(t *testing.T, edit func(doc map[string]any, first map[string]any)) string {
	t.Helper()
	var doc map[string]any
	check(t, json.Unmarshal([]byte(w.forecasterAnswer()), &doc))
	edit(doc, doc["values"].([]any)[0].(map[string]any))
	b, err := json.Marshal(doc)
	check(t, err)
	return string(b)
}

func TestAForecasterClaimingRealDataOnSyntheticInputIsStoredIllustrative(t *testing.T) {
	w := newEngineWorld(t)
	useSharedAnswers(t, w.conn)
	claim := w.forecastWith(t, func(doc, _ map[string]any) { doc["illustrative"], doc["data_source"] = false, "LIVE" })
	w.srv.Script(enginetest.Behavior{Kind: enginetest.Answer, Body: claim})
	run, err := CreateForecastRun(context.Background(), w.conn, w.actors.Forecast, map[string]any{"horizon_start_date": w.today, "horizon_days": float64(forecastcal.DefaultHorizonDays)})
	check(t, err)
	if run.Status != "succeeded" || !run.Illustrative || run.DataSource != "SYNTHETIC" {
		t.Fatalf("got %+v, want a run stored illustrative and SYNTHETIC", run)
	}
	var doc ForecasterEngineOutput
	found, err := readForecasterDocument(context.Background(), w.tenantID, &doc)
	if err != nil || !found || !doc.Illustrative || doc.DataSource != "SYNTHETIC" {
		t.Fatalf("got found=%v err=%v doc.Illustrative=%v %q, want the kept answer illustrative too", found, err, doc.Illustrative, doc.DataSource)
	}
}

func TestForecastsWithInvalidValuesAreRejectedLikeAnyBadAnswer(t *testing.T) {
	edits := map[string]func(first map[string]any){
		"negative":  func(f map[string]any) { f["low"], f["expected"] = -1, -0.5 },
		"inverted":  func(f map[string]any) { f["low"], f["high"] = 4, 0.5 },
		"split off": func(f map[string]any) { f["field_expected"] = 0.1 },
		"off grid": func(f map[string]any) {
			f["interval_start"] = strings.Replace(f["interval_start"].(string), ":00:00", ":07:00", 1)
		},
	}
	for name, edit := range edits {
		t.Run(name, func(t *testing.T) {
			w := newEngineWorld(t)
			w.srv.Script(enginetest.Behavior{Kind: enginetest.Answer, Body: w.forecastWith(t, func(_, first map[string]any) { edit(first) })})
			run, err := CreateForecastRun(context.Background(), w.conn, w.actors.Forecast, map[string]any{"horizon_start_date": w.today, "horizon_days": float64(forecastcal.DefaultHorizonDays)})
			check(t, err)
			if run.Status != "failed" {
				t.Fatalf("got %+v, want a failed run for the %s answer", run, name)
			}
		})
	}
}

func TestASimulatorClaimingRealDataOnSyntheticInputIsStoredIllustrative(t *testing.T) {
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
	claim := strings.ReplaceAll(w.simulatorAnswer("4.2.0"), `"illustrative":true`, `"illustrative":false`)
	w.srv.Script(enginetest.Behavior{Kind: enginetest.Answer, Body: claim})
	run, err := RunSimulation(ctx, w.conn, rc, map[string]any{"roster_id": rosters.Items[0].ID, "run_date": shiftDateBy(w.today, -1), "assignment_policy": "nearest"})
	check(t, err)
	if run.Status != "succeeded" || !run.Illustrative {
		t.Fatalf("got %+v, want a succeeded run stored illustrative", run)
	}
}
