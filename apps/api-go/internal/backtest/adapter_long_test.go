// SPDX-License-Identifier: AGPL-3.0-only

package backtest

import (
	"context"
	"testing"
	"time"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/forecasthist"
)

func longHist(origin time.Time, days int) []HistoryRecord {
	var hist []HistoryRecord
	for d := days; d >= 1; d-- {
		for i := 0; i < 96; i += 8 {
			hist = append(hist, HistoryRecord{SubZoneID: "s1", Start: addDays(origin, -d).Add(time.Duration(i) * 15 * time.Minute), Total: 2, Field: 1})
		}
	}
	return hist
}

func TestEngineCandidateSendsOlderHistoryAsTotals(t *testing.T) {
	origin := ts("2026-09-14", "00:00")
	hist := longHist(origin, 3*365+30)
	zones := []ZoneSpec{{ZoneID: "z1", SubZones: []string{"s1"}}}
	hs := forecasthist.Settings{DetailWeeks: 4, Years: 3, AggMinutes: 1440}
	ask := func(o EngineOptions) (*fakeCaller, EngineMeta) {
		fc := &fakeCaller{resp: `{"values":[]}`}
		o.ModelVersion, o.Source, o.Long = "m", SourceSynthetic, &hs
		c := NewEngineCandidate(fc, o)
		if _, err := c.Forecast(context.Background(), ForecastRequest{Origin: origin, Days: 1, Coverage: 0.8, Zones: zones, History: hist}); err != nil {
			t.Fatal(err)
		}
		return fc, c.Meta()
	}
	fc, m := ask(EngineOptions{})
	h := fc.got["history"].(map[string]any)
	recs, agg := h["records"].([]any), h["aggregated_records"].([]any)
	first := agg[0].(map[string]any)
	if len(recs) != 28*12 || len(agg) != 3*365+1-28 || first["period_start"] != "2023-09-14T00:00:00+03:00" || first["cases_total"].(float64) != 24 {
		t.Fatalf("%d records, %d totals, first %v", len(recs), len(agg), first)
	}
	if recs[0].(map[string]any)["interval_start"] != "2026-08-17T00:00:00+03:00" {
		t.Fatalf("detail starts %v", recs[0])
	}
	cal := fc.got["calendar"].([]any)
	if cal[0].(map[string]any)["date"] != "2023-09-14" || cal[len(cal)-1].(map[string]any)["date"] != "2026-09-14" {
		t.Fatal("the calendar must cover the totals and the horizon")
	}
	if m.MaxAggregated != len(agg) || m.MaxRecords != len(recs) || m.TrimmedRequests != 0 || m.MaxSpanDays != len(cal)-1 {
		t.Fatalf("meta %+v", m)
	}
	fc, m = ask(EngineOptions{RawCap: m.MaxRequestBytes - 20000})
	h = fc.got["history"].(map[string]any)
	kept := h["aggregated_records"].([]any)
	if len(h["records"].([]any)) != len(recs) || len(kept) >= len(agg) || len(kept) == 0 || m.TrimmedRequests != 1 {
		t.Fatalf("trim kept %d of %d totals, meta %+v", len(kept), len(agg), m)
	}
	cal = fc.got["calendar"].([]any)
	if cal[0].(map[string]any)["date"] != kept[0].(map[string]any)["period_start"].(string)[:10] {
		t.Fatal("the trimmed calendar starts with the kept history")
	}
}
