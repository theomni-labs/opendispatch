// SPDX-License-Identifier: AGPL-3.0-only

package backtest

import (
	"context"
	"testing"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/forecastcal"
)

func TestEngineCandidateSendsCalendarFeaturesAndKeepsModelInfo(t *testing.T) {
	fc := &fakeCaller{resp: `{"model_version":"m9","model_info":{"feature_set":["dow","payday"],"training_start":"2026-09-01","training_end":"2026-09-13","history_days":13},"values":[]}`}
	cand := NewEngineCandidate(fc, EngineOptions{ModelVersion: "m1", Source: SourceSynthetic, HistoryDays: 3,
		Calendar: forecastcal.Config{PaydayDay: 12},
		Holiday:  func(d string) (bool, string) { return d == "2026-09-12", "H" }})
	origin := ts("2026-09-14", "00:00")
	hist := []HistoryRecord{{SubZoneID: "s1", Start: ts("2026-09-01", "07:00"), Total: 1}, {SubZoneID: "s1", Start: ts("2026-09-12", "07:00"), Total: 2}}
	req := ForecastRequest{Origin: origin, Days: 1, Coverage: 0.8, Zones: []ZoneSpec{{ZoneID: "z1", SubZones: []string{"s1"}}}, History: hist}
	if _, err := cand.Forecast(context.Background(), req); err != nil {
		t.Fatal(err)
	}
	cal := fc.got["calendar"].([]any)
	if len(cal) != 4 {
		t.Fatalf("3 history days and 1 horizon day, got %d", len(cal))
	}
	d11, d12 := cal[0].(map[string]any), cal[1].(map[string]any)
	if d11["date"] != "2026-09-11" || d11["is_payday"] != false || d11["hijri_date"] == nil {
		t.Fatalf("day %v", d11)
	}
	if d12["is_payday"] != true || d12["is_holiday"] != true {
		t.Fatalf("day %v", d12)
	}
	if _, has := d11["school_in_session"]; has {
		t.Fatal("unknown school term must be omitted")
	}
	if recs := fc.got["history"].(map[string]any)["records"].([]any); len(recs) != 1 {
		t.Fatalf("only the 3-day window is sent, got %d records", len(recs))
	}
	m := cand.Meta()
	if m.ModelVersion != "m9" || m.ModelInfo == nil || m.ModelInfo.HistoryDays != 13 || m.ModelInfo.FeatureSet[1] != "payday" || m.MaxRequestBytes == 0 {
		t.Fatalf("meta %+v", m)
	}
}
