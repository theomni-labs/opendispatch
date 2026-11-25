// SPDX-License-Identifier: AGPL-3.0-only

package backtest

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
)

func TestHalfWindowsStartAtSixAndWrapPastMidnight(t *testing.T) {
	cases := map[string]struct {
		w     int
		label string
	}{
		"06:00": {0, "06:00"}, "06:29": {0, "06:00"}, "06:30": {1, "06:30"}, "23:30": {35, "23:30"},
		"23:59": {35, "23:30"}, "00:00": {36, "00:00"}, "00:15": {36, "00:00"}, "05:30": {47, "05:30"}, "05:45": {47, "05:30"},
	}
	for hm, c := range cases {
		if w := halfWindow(ts("2026-09-14", hm)); w != c.w || halfLabel(w) != c.label {
			t.Fatalf("%s: window %d label %s", hm, w, halfLabel(w))
		}
	}
	if halfLabel(47) != "05:30" || halfLabel(0) != "06:00" {
		t.Fatal("first or last label")
	}
}

func halfDataset() *Dataset {
	d := func(day, hm string, n int) HistoryRecord {
		return HistoryRecord{SubZoneID: "s1", Start: ts(day, hm), Total: n, Field: n}
	}
	return &Dataset{
		Intervals: []HistoryRecord{d("2026-09-12", "10:00", 1), d("2026-09-13", "10:00", 1),
			d("2026-09-14", "00:00", 3), d("2026-09-14", "00:15", 2), d("2026-09-14", "05:30", 2),
			d("2026-09-14", "06:00", 3), d("2026-09-14", "06:15", 1)},
		ZoneSubs: map[string][]string{"z1": {"s1"}}, Agents: map[string]Agent{}, Standby: map[string]Point{}, DataSource: SourceSynthetic,
	}
}

func fixedForecast(vals map[string]float64) Forecaster {
	return func(_ context.Context, r ForecastRequest) ([]ForecastValue, error) {
		var out []ForecastValue
		for hm, v := range vals {
			out = append(out, ForecastValue{ZoneID: "z1", SubZoneID: "s1", Start: ts(r.Origin.Format("2006-01-02"), hm), Expected: v})
		}
		return out, nil
	}
}

func halfReport(t *testing.T) *ForecastReport {
	t.Helper()
	cand := fixedForecast(map[string]float64{"06:00": 2, "06:15": 2, "00:00": 1, "00:15": 1, "05:30": 3, "05:45": 1})
	rep, err := RunForecast(context.Background(), halfDataset(), ForecastConfig{Horizon: 1, MinHistoryDays: 1, HeldOutDays: 1,
		Candidate: cand, CandidateName: "cand", Baseline: fixedForecast(nil), BaselineName: "zeros"})
	if err != nil {
		t.Fatal(err)
	}
	return rep
}

func isNear(a *float64, b float64) bool { return a != nil && *a > b-1e-4 && *a < b+1e-4 }

func TestHalfHourAggregationByHand(t *testing.T) {
	rep := halfReport(t)
	c := rep.Candidate
	if len(c.ByHalfHour) != 48 || c.ByHalfHour[0].Window != "06:00" || c.ByHalfHour[47].Window != "05:30" || c.ByHalfHour[36].Window != "00:00" {
		t.Fatalf("windows %+v", c.ByHalfHour)
	}
	w06, w00, w0530, w12 := c.ByHalfHour[0], c.ByHalfHour[36], c.ByHalfHour[47], c.ByHalfHour[12]
	if w06.Cells != 1 || w06.MAE != 0 || !isNear(w06.WAPE, 0) || w06.Bias != 0 || w06.ActualTotal != 4 {
		t.Fatalf("06:00 %+v", w06)
	}
	if w00.MAE != 3 || w00.RMSE != 3 || !isNear(w00.WAPE, 0.6) || w00.Bias != -3 || w00.ActualTotal != 5 {
		t.Fatalf("00:00 across the midnight wrap %+v", w00)
	}
	if w0530.MAE != 2 || !isNear(w0530.WAPE, 1) || w0530.Bias != 2 {
		t.Fatalf("05:30 %+v", w0530)
	}
	if w12.WAPE != nil || w12.Cells != 1 {
		t.Fatalf("12:00 has no actual cases and no WAPE: %+v", w12)
	}
	g := c.Grains
	if g.Quarter.Cells != 96 || g.HalfHour.Cells != 48 || !isNear(g.Quarter.WAPE, 7.0/11) || !isNear(g.HalfHour.WAPE, 5.0/11) {
		t.Fatalf("grains %+v", g)
	}
	if g.HalfHour.Bias != round(-1.0/48, 4) {
		t.Fatalf("half-hour bias %v", g.HalfHour.Bias)
	}
	if b := rep.Baseline.Grains; !isNear(b.Quarter.WAPE, 1) || !isNear(b.HalfHour.WAPE, 1) || b.HalfHour.Bias != round(-11.0/48, 4) {
		t.Fatalf("baseline grains %+v", b)
	}
}

func TestHalfHourStaffingByHand(t *testing.T) {
	rep := halfReport(t)
	if len(rep.StaffingHalfHour) != 2 || rep.StaffingHalfHour[0].Name != "cand" {
		t.Fatalf("%+v", rep.StaffingHalfHour)
	}
	s := rep.StaffingHalfHour[0]
	if s.Windows != 3 || s.Exact != 1 || s.Under != 1 || s.Over != 1 || s.NeededActual != 11 || s.NeededMethod != 10 {
		t.Fatalf("candidate %+v", s)
	}
	if b := rep.StaffingHalfHour[1]; b.Windows != 3 || b.Under != 3 || b.NeededMethod != 0 {
		t.Fatalf("baseline %+v", b)
	}
	if len(rep.Staffing) != 2 {
		t.Fatal("the zone staffing table must stay")
	}
}

const oldForecastJSON = `{"level":"zone x hour","horizon_days":1,"min_history_days":7,"origins":2,"first_origin":"2026-09-13","last_origin":"2026-09-14",
"range_target":0.8,"range_note":"n",
"baseline":{"name":"naive","overall":{"cells":48,"mae":1.5,"rmse":2,"wape":0.5,"range_coverage":0.7,"actual_total":90},"by_zone":[],"by_hour":[],"by_zone_hour":[],
"event_days":{"cells":0,"mae":0,"rmse":0,"wape":null,"range_coverage":0,"actual_total":0},"ordinary_days":{"cells":48,"mae":1.5,"rmse":2,"wape":0.5,"range_coverage":0.7,"actual_total":90}},
"staffing":[{"name":"naive","windows":10,"under":2,"over":3,"exact":5,"under_share":0.2,"over_share":0.3,"exact_share":0.5,"needed_staff_actual":40,"needed_staff_method":41}],
"staffing_note":"old","held_out":{"from":"2026-09-13","to":"2026-09-14","days":2,"event_days":0,"training_days":60,"data_days":62},"warnings":[]}`

func TestStoredResultOfThePreviousShapeStillDecodes(t *testing.T) {
	var f ForecastReport
	if err := json.Unmarshal([]byte(oldForecastJSON), &f); err != nil {
		t.Fatal(err)
	}
	if f.Origins != 2 || f.Baseline.Name != "naive" || f.Staffing[0].NeededMethod != 41 || !isNear(f.Baseline.Overall.WAPE, 0.5) {
		t.Fatalf("%+v", f)
	}
	if f.Baseline.ByHalfHour != nil || f.Baseline.Grains != nil || f.StaffingHalfHour != nil {
		t.Fatal("new fields must be empty for an old result")
	}
	again, err := json.Marshal(f)
	if err != nil {
		t.Fatal(err)
	}
	for _, key := range []string{"by_half_hour", "grains", "staffing_half_hour", "half_hour_note"} {
		if strings.Contains(string(again), key) {
			t.Fatalf("old result re-encoded with %q", key)
		}
	}
	rep := &Report{Forecast: &f}
	if !strings.Contains(rep.Text(), "naive") || strings.Contains(rep.Text(), "BY HALF-HOUR") {
		t.Fatal("text of an old result")
	}
}

func TestReportTextAndJSONCarryTheHalfHourTables(t *testing.T) {
	rep := &Report{Forecast: halfReport(t)}
	txt := rep.Text()
	for _, want := range []string{"BY HALF-HOUR WINDOW (06:00 to 05:30)", "    00:00  WAPE 60.0%", "    05:30  WAPE 100.0%", "15-minute WAPE 63.6% (96 cells)  half-hour WAPE 45.5% (48 cells)",
		"STAFFING CONSEQUENCE AT THE HALF-HOUR GRAIN"} {
		if !strings.Contains(txt, want) {
			t.Fatalf("text lacks %q\n%s", want, txt)
		}
	}
	j, err := rep.JSON()
	if err != nil {
		t.Fatal(err)
	}
	var back Report
	if err := json.Unmarshal(j, &back); err != nil {
		t.Fatal(err)
	}
	if len(back.Forecast.Candidate.ByHalfHour) != 48 || back.Forecast.Candidate.Grains == nil || len(back.Forecast.StaffingHalfHour) != 2 {
		t.Fatal("the JSON round trip lost the half-hour fields")
	}
}
