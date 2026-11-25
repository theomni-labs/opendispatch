// SPDX-License-Identifier: AGPL-3.0-only

package backtest

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
)

func mapeDataset() *Dataset {
	r := func(sub, day, hm string, n int) HistoryRecord {
		return HistoryRecord{SubZoneID: sub, Start: ts(day, hm), Total: n, Field: n}
	}
	return &Dataset{
		Intervals: []HistoryRecord{r("s1", "2026-09-12", "10:00", 1), r("s2", "2026-09-13", "10:00", 1),
			r("s1", "2026-09-14", "10:00", 2), r("s1", "2026-09-14", "11:00", 2)},
		ZoneSubs: map[string][]string{"z1": {"s1"}, "z2": {"s2"}}, Agents: map[string]Agent{}, Standby: map[string]Point{}, DataSource: SourceSynthetic,
	}
}

func mapeForecast(_ context.Context, r ForecastRequest) ([]ForecastValue, error) {
	d := r.Origin.Format("2006-01-02")
	return []ForecastValue{
		{ZoneID: "z1", SubZoneID: "s1", Start: ts(d, "10:00"), Expected: 3},
		{ZoneID: "z1", SubZoneID: "s1", Start: ts(d, "11:00"), Expected: 1},
		{ZoneID: "z2", SubZoneID: "s2", Start: ts(d, "10:00"), Expected: 1},
	}, nil
}

func mapeReport(t *testing.T) *ForecastReport {
	t.Helper()
	rep, err := RunForecast(context.Background(), mapeDataset(), ForecastConfig{Horizon: 1, MinHistoryDays: 1, HeldOutDays: 1,
		Candidate: mapeForecast, CandidateName: "cand", Baseline: fixedForecast(nil), BaselineName: "zeros"})
	if err != nil {
		t.Fatal(err)
	}
	return rep
}

func TestMAPEZoneDayAndZoneHourByHand(t *testing.T) {
	rep := mapeReport(t)
	m := rep.Candidate.MAPE
	if m == nil {
		t.Fatal("no MAPE on the candidate")
	}
	zd := m.ZoneDay
	if zd.Cells != 2 || zd.Excluded != 1 || !isNear(zd.MAPE, 0) || !isNear(zd.WAPE, 0.25) || zd.ActualTotal != 4 {
		t.Fatalf("zone x day %+v", zd)
	}
	zh := m.ZoneHour
	if zh.Cells != 48 || zh.Excluded != 46 || !isNear(zh.MAPE, 0.5) || !isNear(zh.WAPE, 0.75) {
		t.Fatalf("zone x hour %+v", zh)
	}
	if len(m.ByHour) != 24 || len(m.ByDayOfWeek) != 7 {
		t.Fatalf("rows: %d hours, %d weekdays", len(m.ByHour), len(m.ByDayOfWeek))
	}
	h10 := m.ByHour[10]
	if *h10.Hour != 10 || h10.Cells != 2 || h10.Excluded != 1 || !isNear(h10.MAPE, 0.5) || !isNear(h10.WAPE, 1) {
		t.Fatalf("hour 10 %+v", h10)
	}
	if h3 := m.ByHour[3]; h3.MAPE != nil || h3.Excluded != 2 {
		t.Fatalf("hour 3 has only zero actuals: %+v", h3)
	}
	mon, sun := m.ByDayOfWeek[1], m.ByDayOfWeek[0]
	if mon.DayOfWeek != "Mon" || mon.Cells != 2 || !isNear(mon.MAPE, 0) || sun.DayOfWeek != "Sun" || sun.Cells != 0 || sun.MAPE != nil {
		t.Fatalf("weekdays %+v %+v", mon, sun)
	}
	if len(m.ByZone) != 2 || m.ByZone[1].ZoneID != "z2" || m.ByZone[1].MAPE != nil || m.ByZone[1].Excluded != 1 {
		t.Fatalf("by zone %+v", m.ByZone)
	}
	if b := rep.Baseline.MAPE.ZoneDay; !isNear(b.MAPE, 1) || !isNear(b.WAPE, 1) {
		t.Fatalf("zeros baseline %+v", b)
	}
}

func TestMAPEOverallIsMeanOverZoneDays(t *testing.T) {
	m := newMAPEArm()
	add := func(zone, day string, f, a float64) { m.addHour(zone, ts(day, "12:00"), f, a) }
	add("z1", "2026-09-14", 12, 10)
	add("z1", "2026-09-15", 5, 10)
	add("z2", "2026-09-14", 3, 4)
	add("z2", "2026-09-15", 2, 0)
	m.endOrigin()
	r := m.report()
	if r.ZoneDay.Cells != 4 || r.ZoneDay.Excluded != 1 || !isNear(r.ZoneDay.MAPE, 0.3167) || !isNear(r.ZoneDay.WAPE, 0.4167) {
		t.Fatalf("overall %+v", r.ZoneDay)
	}
	if !isNear(r.ByZone[0].MAPE, 0.35) || !isNear(r.ByZone[1].MAPE, 0.25) || r.ByZone[1].Excluded != 1 {
		t.Fatalf("by zone %+v", r.ByZone)
	}
	if !isNear(r.ByDayOfWeek[1].MAPE, 0.225) || !isNear(r.ByDayOfWeek[2].MAPE, 0.5) || r.ByDayOfWeek[2].Excluded != 1 {
		t.Fatalf("by weekday %+v", r.ByDayOfWeek)
	}
	if len(r.ByZoneDayOfWeek) != 4 || r.ByZoneDayOfWeek[0].ZoneID != "z1" || r.ByZoneDayOfWeek[0].DayOfWeek != "Mon" || !isNear(r.ByZoneDayOfWeek[0].MAPE, 0.2) {
		t.Fatalf("zone x weekday %+v", r.ByZoneDayOfWeek)
	}
	if len(r.ByZoneHour) != 2 || *r.ByZoneHour[0].Hour != 12 || !isNear(r.ByZoneHour[0].MAPE, 0.35) {
		t.Fatalf("zone x hour %+v", r.ByZoneHour)
	}
	s := CheckSpec(ForecastArm{Name: "e", MAPE: r}, true)
	if s.Result != SpecNotMet || !strings.Contains(s.Line(), "DOES NOT MEET") || !strings.HasPrefix(s.Line(), "ILLUSTRATIVE") {
		t.Fatalf("spec %+v %s", s, s.Line())
	}
	if l := CheckSpec(ForecastArm{Name: "e", MAPE: r}, false).Line(); strings.Contains(l, "ILLUSTRATIVE") {
		t.Fatalf("real data line %s", l)
	}
	if s := CheckSpec(ForecastArm{Name: "e"}, false); s.Result != SpecNoValue || s.MAPE != nil {
		t.Fatalf("no MAPE %+v", s)
	}
}

func TestSpecCheckIsIllustrativeOnSyntheticAndLeavesGate(t *testing.T) {
	rep := mapeReport(t)
	s := rep.SpecCheck
	if s == nil || s.Result != SpecMeets || !s.Illustrative || s.Arm != "cand" || s.Target != 0.15 {
		t.Fatalf("spec %+v", s)
	}
	if !strings.Contains(s.Line(), "Spec target MAPE <= 15.0% (zone x day, rolling window): 0.0% -> MEETS") {
		t.Fatalf("line %s", s.Line())
	}
	if rep.Gate == nil || rep.Gate.BaselineWAPE == nil {
		t.Fatal("gate still judged on WAPE")
	}
}

func TestReportTextAndJSONCarryMAPE(t *testing.T) {
	r := NewReport(mapeDataset())
	r.Forecast = mapeReport(t)
	j, err := r.JSON()
	if err != nil {
		t.Fatal(err)
	}
	for _, k := range []string{`"mape"`, `"zone_day"`, `"by_day_of_week"`, `"by_zone_hour"`, `"by_zone_day_of_week"`, `"excluded_zero_actual"`, `"spec_check"`, `"mape_note"`} {
		if !strings.Contains(string(j), k) {
			t.Fatalf("json lacks %s", k)
		}
	}
	txt := r.Text()
	for _, k := range []string{"SPEC CHECK", "ILLUSTRATIVE Spec target MAPE <= 15.0%", "MAPE BY HOUR OF DAY", "MAPE BY DAY OF WEEK", "MAPE BY ZONE", "unstable", "zone x day: MAPE 0.0%  WAPE 25.0%"} {
		if !strings.Contains(txt, k) {
			t.Fatalf("text lacks %q:\n%s", k, txt)
		}
	}
}

const oldReport = `{"data_source":"SYNTHETIC","illustrative":true,"notice":"n","cases_in_data":4,
"forecast":{"level":"zone x hour","horizon_days":1,"min_history_days":1,"origins":1,"first_origin":"2026-09-14","last_origin":"2026-09-14",
"range_target":0.8,"range_note":"r","baseline":{"name":"zeros","overall":{"cells":48,"mae":0.08,"rmse":0.4,"wape":1,"range_coverage":0.9,"actual_total":4},
"by_zone":[],"by_hour":[],"by_zone_hour":[],"event_days":{"cells":0,"mae":0,"rmse":0,"wape":null,"range_coverage":0,"actual_total":0},
"ordinary_days":{"cells":0,"mae":0,"rmse":0,"wape":null,"range_coverage":0,"actual_total":0}},
"candidate":{"name":"cand","overall":{"cells":48,"mae":0.06,"rmse":0.3,"wape":0.75,"range_coverage":0.9,"actual_total":4},"by_zone":[],"by_hour":[],"by_zone_hour":[],
"event_days":{"cells":0,"mae":0,"rmse":0,"wape":null,"range_coverage":0,"actual_total":0},"ordinary_days":{"cells":0,"mae":0,"rmse":0,"wape":null,"range_coverage":0,"actual_total":0}},
"held_out":{"from":"2026-09-14","to":"2026-09-14","days":1,"training_days_before_first_origin":2,"data_days":3,"event_days":0},
"gate":{"result":"not_enough_history","min_improvement":0.1,"max_worse_zone_share":0.25,"baseline_wape":1,"candidate_wape":0.75,"improvement":0.25,"worse_zones":0,"compared_zones":0,"worse_zone_share":null,"reasons":["x"]},
"warnings":[]}}`

func TestOldStoredReportStillDecodes(t *testing.T) {
	var r Report
	if err := json.Unmarshal([]byte(oldReport), &r); err != nil {
		t.Fatal(err)
	}
	f := r.Forecast
	if f == nil || f.Candidate == nil || f.Candidate.MAPE != nil || f.Baseline.MAPE != nil || f.SpecCheck != nil || f.MAPENote != "" {
		t.Fatalf("old report %+v", f)
	}
	if !isNear(f.Candidate.Overall.WAPE, 0.75) || f.Gate.Result != GateNotEnoughHistory {
		t.Fatalf("old fields lost %+v", f)
	}
	if strings.Contains(r.Text(), "SPEC CHECK") || strings.Contains(r.Text(), "MAPE BY") {
		t.Fatal("old report must print no MAPE section")
	}
	j, err := json.Marshal(f)
	if err != nil {
		t.Fatal(err)
	}
	for _, k := range []string{`"mape"`, `"spec_check"`, `"mape_note"`} {
		if strings.Contains(string(j), k) {
			t.Fatalf("re-encoded old report gained %s", k)
		}
	}
}
