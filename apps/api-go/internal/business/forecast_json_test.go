// SPDX-License-Identifier: AGPL-3.0-only

// JSON keys and lazy fixture seeds for forecast and models.
package business

import (
	"encoding/json"
	"sort"
	"testing"
)

func keysOf(t *testing.T, v any) []string {
	t.Helper()
	raw, err := json.Marshal(v)
	check(t, err)
	var m map[string]json.RawMessage
	check(t, json.Unmarshal(raw, &m))
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

func wantKeys(t *testing.T, v any, want ...string) {
	t.Helper()
	sort.Strings(want)
	got := keysOf(t, v)
	if len(got) != len(want) {
		t.Fatalf("got keys %v, want %v", got, want)
	}
	for i := range got {
		if got[i] != want[i] {
			t.Fatalf("got keys %v, want %v", got, want)
		}
	}
}

func TestModelState_JSONKeys(t *testing.T) {
	wantKeys(t, ModelState{RetrainingSchedule: RetrainingSchedule{}}, "active_version", "is_paused", "paused_at", "paused_by_user_id", "pause_reason", "retraining_schedule", "last_forecast_run_id", "data_source")
	wantKeys(t, RetrainingSchedule{}, "cadence", "day_of_week", "time_of_day")
}

func TestModelVersion_JSONKeys(t *testing.T) {
	keys := keysOf(t, ModelVersion{})
	for _, k := range []string{"id", "tenant_id", "data_source", "version", "status", "is_placeholder", "engine_version", "trained_at", "notes_en"} {
		found := false
		for _, g := range keys {
			found = found || g == k
		}
		if !found {
			t.Fatalf("missing key %q in %v", k, keys)
		}
	}
}

func TestForecastShapes_JSONKeysAndEmptyArrays(t *testing.T) {
	wantKeys(t, ForecastTimeline{Intervals: []ForecastTimelineInterval{}}, "zone_id", "date", "forecast_run_id", "illustrative", "data_source", "intervals")
	wantKeys(t, ForecastSplit{Zones: []ForecastSplitZone{}}, "rule_set_version", "generated_at", "illustrative", "data_source", "zones")
	for _, v := range []any{ForecastTimeline{Intervals: []ForecastTimelineInterval{}}, ForecastSplit{Zones: []ForecastSplitZone{}}} {
		raw, err := json.Marshal(v)
		check(t, err)
		var m map[string]any
		check(t, json.Unmarshal(raw, &m))
		for _, k := range []string{"intervals", "zones"} {
			if a, ok := m[k]; ok {
				if _, isArr := a.([]any); !isArr {
					t.Fatalf("%s: got %v, want an empty array not null", k, a)
				}
			}
		}
	}
	keys := keysOf(t, ForecastValue{})
	if len(keys) < 8 {
		t.Fatalf("got %v, want the snake_case ForecastValue keys", keys)
	}
	for _, k := range keys {
		for _, c := range k {
			if c >= 'A' && c <= 'Z' {
				t.Fatalf("key %q is not snake_case", k)
			}
		}
	}
}

func TestLazySeeds_LoadFixturesOnceAndResetEmpties(t *testing.T) {
	ReloadForecastFixturesForTest()
	t.Cleanup(ResetForecastValuesForTest)
	if len(allForecastValueRows()) == 0 {
		t.Fatal("forecast values: want the fixture rows after a reload")
	}
	if len(allModelVersionRows()) == 0 {
		t.Fatal("model versions: want the fixture rows after a reload")
	}
	if subZoneNameOf("no-such-sub-zone") != "" {
		t.Fatal("unknown sub-zone should have no name")
	}
	ResetForecastValuesForTest()
	ResetModelVersionsForTest()
	if len(allForecastValueRows()) != 0 || len(allModelVersionRows()) != 0 {
		t.Fatal("a reset should leave the stores empty, not re-seed")
	}
}

func TestFixtureRunOverlay_OnAfterReloadOffAfterReset(t *testing.T) {
	ReloadForecastFixturesForTest()
	t.Cleanup(ResetForecastValuesForTest)
	if len(forecastRunRows()) == 0 {
		t.Fatal("overlay on: want the fixture run in the forecast reads")
	}
	if oneForecastRunRow("5a1c9ff5-b337-4215-ac9c-43193c0ee54a") != nil {
		t.Fatal("the shared run store must stay unseeded (roster FK)")
	}
	ResetForecastValuesForTest()
	if n := len(forecastRunRows()); n != len(allForecastRunRows()) {
		t.Fatalf("overlay off: got %d rows, want only the store's %d", n, len(allForecastRunRows()))
	}
}

func TestPauseModel_NoUserIDLeavesPausedByNull(t *testing.T) {
	resetModelDeps()
	rc, _ := adminCtx(t)
	rc.UserID = ""
	SeedModelVersionsForTest(newModelVersion(rc, "v1", "active"))
	got, err := PauseModel(rc, map[string]any{"reason": "check"})
	check(t, err)
	if got.PausedByUserID != nil {
		t.Fatalf("got %q, want nil when the token has no user id", *got.PausedByUserID)
	}
}

func TestForecastSplitZone_JSONKeys(t *testing.T) {
	wantKeys(t, ForecastSplitZone{}, "zone_id", "field_expected", "remote_inferred_expected", "field_share")
	wantKeys(t, ForecastTimelineInterval{}, "interval_start", "interval_index", "low", "expected", "high", "field_expected", "remote_inferred_expected")
}
