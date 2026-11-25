// SPDX-License-Identifier: AGPL-3.0-only

package backtest

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
)

func splitDataset() *Dataset {
	h := func(day, hm string, total, field int) HistoryRecord {
		return HistoryRecord{SubZoneID: "s1", Start: ts(day, hm), Total: total, Field: field}
	}
	return &Dataset{
		Intervals: []HistoryRecord{h("2026-09-12", "10:00", 1, 1), h("2026-09-13", "10:00", 1, 1),
			h("2026-09-14", "06:00", 4, 1), h("2026-09-14", "06:15", 2, 2), h("2026-09-14", "06:30", 2, 0)},
		ZoneSubs: map[string][]string{"z1": {"s1"}}, Agents: map[string]Agent{}, Standby: map[string]Point{}, DataSource: SourceSynthetic,
	}
}

func splitForecast(r ForecastRequest) []ForecastValue {
	at := func(hm string, exp, field float64) ForecastValue {
		return ForecastValue{ZoneID: "z1", SubZoneID: "s1", Start: ts(r.Origin.Format("2006-01-02"), hm), Expected: exp, Field: field, HasField: true}
	}
	return []ForecastValue{at("06:00", 3, 2), at("06:15", 2, 1), at("06:30", 2, 1)}
}

func splitReport(t *testing.T) *ForecastReport {
	t.Helper()
	cand := func(_ context.Context, r ForecastRequest) ([]ForecastValue, error) { return splitForecast(r), nil }
	rep, err := RunForecast(context.Background(), splitDataset(), ForecastConfig{Horizon: 1, MinHistoryDays: 1, HeldOutDays: 1,
		Candidate: cand, CandidateName: "cand", Baseline: fixedForecast(nil), BaselineName: "zeros"})
	if err != nil {
		t.Fatal(err)
	}
	return rep
}

func TestSplitScoresByHand(t *testing.T) {
	rep := splitReport(t)
	sp := rep.Candidate.Split
	if sp == nil {
		t.Fatal("the engine forecasts a split and has no scores")
	}
	// field: errors 1, 1, 1 on 3 actual cases at 15 minutes
	if f := sp.Field.Quarter; f.Cells != 96 || !isNear(f.WAPE, 1) || f.Bias != round(1.0/96, 4) {
		t.Fatalf("field 15-minute %+v", f)
	}
	// remote: errors 2, 1, 1 on 5 actual cases
	if r := sp.Remote.Quarter; r.Cells != 96 || !isNear(r.WAPE, 0.8) {
		t.Fatalf("remote 15-minute %+v", r)
	}
	// half-hours 06:00 (field 3 against 3, remote 2 against 3) and 06:30 (1 against 0, 1 against 2)
	if f := sp.Field.HalfHour; f.Cells != 48 || !isNear(f.WAPE, 1.0/3) {
		t.Fatalf("field half-hour %+v", f)
	}
	if r := sp.Remote.HalfHour; r.Cells != 48 || !isNear(r.WAPE, 0.4) {
		t.Fatalf("remote half-hour %+v", r)
	}
	// share: forecast 4 of 7, actual 3 of 8, 19.64 points high
	o := sp.ShareOverall
	if o.Days != 1 || !isNear(o.ForecastShare, 0.5714) || !isNear(o.ActualShare, 0.375) || o.MAEPoints != 19.64 || o.BiasPoints != 19.64 {
		t.Fatalf("overall share %+v", o)
	}
	if len(sp.ShareByZone) != 1 || sp.ShareByZone[0].ZoneID != "z1" || sp.ShareByZone[0].MAEPoints != 19.64 {
		t.Fatalf("zone share %+v", sp.ShareByZone)
	}
}

func TestSplitIsAbsentWhenAMethodHasNoSplit(t *testing.T) {
	rep := splitReport(t)
	if rep.Baseline.Split != nil {
		t.Fatalf("a method with no field forecast got scores: %+v", rep.Baseline.Split)
	}
}

func TestSplitInTextAndJSONAndGateUntouched(t *testing.T) {
	rep := splitReport(t)
	r := &Report{DataSource: SourceSynthetic, Illustrative: true, Notice: SyntheticNotice, Forecast: rep}
	j, err := r.JSON()
	if err != nil {
		t.Fatal(err)
	}
	for _, key := range []string{`"split"`, `"share_by_zone"`, `"share_overall"`, `"mae_points"`, `"split_note"`, `"quarter_hour"`} {
		if !strings.Contains(string(j), key) {
			t.Fatalf("json lacks %s", key)
		}
	}
	text := r.Text()
	for _, want := range []string{"FIELD AND REMOTE SPLIT", "field WAPE: 15-minute 100.0%", "remote WAPE: 15-minute 80.0%", "bias +19.64 points", "zone z1"} {
		if !strings.Contains(text, want) {
			t.Fatalf("text lacks %q:\n%s", want, text)
		}
	}
	if !strings.Contains(rep.SplitNote, "The gate stays on the total") {
		t.Fatal("the note must say the gate stays on the total")
	}
}

func TestOldStoredResultStillDecodes(t *testing.T) {
	old := `{"level":"zone x hour","horizon_days":1,"origins":1,"baseline":{"name":"b","overall":{"cells":1,"mae":0,"rmse":0,"wape":null,"range_coverage":0,"actual_total":0},"by_zone":[],"by_hour":[],"by_zone_hour":[],"event_days":{"cells":0,"mae":0,"rmse":0,"wape":null,"range_coverage":0,"actual_total":0},"ordinary_days":{"cells":0,"mae":0,"rmse":0,"wape":null,"range_coverage":0,"actual_total":0}},"held_out":{},"warnings":[]}`
	var rep ForecastReport
	if err := json.Unmarshal([]byte(old), &rep); err != nil {
		t.Fatal(err)
	}
	if rep.Baseline.Split != nil || rep.SplitNote != "" {
		t.Fatalf("an old result grew a split: %+v", rep)
	}
	out, err := json.Marshal(rep)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(out), `"split`) {
		t.Fatalf("an old result re-encodes with split fields: %s", out)
	}
	if text := (&Report{Forecast: &rep}).Text(); strings.Contains(text, "FIELD AND REMOTE SPLIT") {
		t.Fatal("an old result prints a split table")
	}
}

func TestBaselinesUseTheirTrainingFieldShare(t *testing.T) {
	h := []HistoryRecord{{SubZoneID: "s1", Total: 4, Field: 1}, {SubZoneID: "s1", Total: 4, Field: 2}, {SubZoneID: "s2", Total: 0}}
	got := fieldShares(h)
	if got["s1"] != 3.0/8 {
		t.Fatalf("got %v, want 3/8", got)
	}
	if _, ok := got["s2"]; ok {
		t.Fatal("a sub-zone with no cases has no share")
	}
	vs, _ := SeasonalMean(context.Background(), ForecastRequest{Origin: ts("2026-09-14", "00:00"), Days: 1, Zones: []ZoneSpec{{ZoneID: "z1", SubZones: []string{"s1"}}}, History: []HistoryRecord{
		{SubZoneID: "s1", Start: ts("2026-09-07", "06:00"), Total: 8, Field: 2}}, Coverage: 0.8})
	for _, v := range vs {
		if !v.HasField {
			t.Fatal("a baseline value lacks its field forecast")
		}
		if v.Start.Equal(ts("2026-09-14", "06:00")) && (v.Expected != 2 || v.Field != 0.5) {
			t.Fatalf("got %+v, want 2 expected and 0.5 field (a quarter of 2)", v)
		}
	}
}
