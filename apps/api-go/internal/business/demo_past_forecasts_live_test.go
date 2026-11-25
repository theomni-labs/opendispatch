// SPDX-License-Identifier: AGPL-3.0-only

package business

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/engines/enginetest"
)

// dayAnswer: a one-day forecaster answer for day.
func (w engineWorld) dayAnswer(day string) string {
	var values []map[string]any
	for i := 36; i < 40; i++ {
		values = append(values, map[string]any{"zone_id": w.zoneID, "sub_zone_id": w.subID, "interval_start": intervalStartOf(day, i), "interval_index": i,
			"low": 0, "expected": 0.5, "high": 2, "field_expected": 0.4, "remote_inferred_expected": 0.1})
	}
	b, _ := json.Marshal(map[string]any{"schema_version": "1.0", "request_id": datactx.NewID(), "engine": map[string]any{"name": "forecaster", "version": "9.1.0"},
		"model_version": "m-past", "generated_at": "2026-09-13T02:00:00Z", "data_source": "SYNTHETIC", "illustrative": true, "rule_set_version": "rs-1",
		"horizon": map[string]any{"start_date": day, "days": 1}, "interval_minutes": 15, "intervals_per_day": 96, "range_coverage": 0.8, "values": values})
	return string(b)
}

func TestPastForecastsAreMadeAsOfEachDayAndShowAgainstActual(t *testing.T) {
	w := newEngineWorld(t)
	useSharedAnswers(t, w.conn)
	dailyCases(t, w, 10)
	noBlend(t, w.tenantID)
	d2, d1 := shiftDateBy(w.today, -2), shiftDateBy(w.today, -1)
	w.srv.Script(enginetest.Behavior{Kind: enginetest.Answer, Body: w.dayAnswer(d2)}, enginetest.Behavior{Kind: enginetest.Answer, Body: w.dayAnswer(d1)})
	ctx := context.Background()

	var seen []string
	out, err := BackfillPastForecasts(ctx, w.conn, w.actors.Forecast, 2, func(p PastForecast) { seen = append(seen, p.Date) })
	check(t, err)
	if len(out) != 2 || out[0].Date != d2 || out[1].Date != d1 || out[0].RunID == "" || out[1].Skipped {
		t.Fatalf("got %+v", out)
	}
	if len(seen) != 2 || seen[0] != d2 || seen[1] != d1 {
		t.Fatalf("progress %v", seen)
	}
	// made as of its day: never the newest run
	for _, p := range out {
		run, err := loadForecastRun(ctx, w.tenantID, p.RunID, false)
		check(t, err)
		if run == nil || !parseBefore(run.CreatedAt, p.Date) || parseBefore(run.CreatedAt, shiftDateBy(p.Date, -1)) {
			t.Fatalf("run for %s created at %v", p.Date, run)
		}
	}
	reqs := w.srv.Requests()
	if len(reqs) != 2 {
		t.Fatalf("%d engine calls, want one per day", len(reqs))
	}
	for i, day := range []string{d2, d1} {
		checkRequest(t, "forecaster", []byte(reqs[i].Body))
		var in struct {
			Horizon struct {
				StartDate string `json:"start_date"`
				Days      int    `json:"days"`
			} `json:"horizon"`
			History struct {
				Records []struct {
					IntervalStart string `json:"interval_start"`
				} `json:"records"`
			} `json:"history"`
		}
		check(t, json.Unmarshal([]byte(reqs[i].Body), &in))
		midnight, err := riyadhMidnight(day)
		check(t, err)
		if in.Horizon.StartDate != day || in.Horizon.Days != 1 || len(in.History.Records) == 0 {
			t.Fatalf("request %d: horizon %+v, %d history rows", i, in.Horizon, len(in.History.Records))
		}
		for _, r := range in.History.Records {
			at, err := time.Parse(time.RFC3339, r.IntervalStart)
			if err != nil || !at.Before(midnight) {
				t.Fatalf("request for %s carries history at %s", day, r.IntervalStart)
			}
		}
	}

	rc, _ := adminCtx(t)
	rc.CustomerID = w.tenantID
	got, err := GetForecastAccuracy(ctx, w.conn, rc, ForecastAccuracyQuery{})
	check(t, err)
	if len(got.Dates) != 2 || got.Dates[0] != d1 || got.Run == nil || got.Run.ModelVersion != "m-past" || got.Overall == nil || got.Overall.Forecast != 2 || got.Overall.Actual < 1 || !got.Illustrative {
		t.Fatalf("against actual: dates %v run %+v overall %+v", got.Dates, got.Run, got.Overall)
	}

	again, err := BackfillPastForecasts(ctx, w.conn, w.actors.Forecast, 2, nil)
	check(t, err)
	if len(again) != 2 || !again[0].Skipped || !again[1].Skipped || len(w.srv.Requests()) != 2 {
		t.Fatalf("a second backfill must skip both days: %+v", again)
	}
}
