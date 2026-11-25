// SPDX-License-Identifier: AGPL-3.0-only

package backtest

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/forecastcal"
)

func alternating(date string) string {
	t, _ := time.Parse("2006-01-02", date)
	if t.Day()%2 == 0 {
		return "A-even"
	}
	return "A-odd"
}

func rec(day string, hm string, total int) HistoryRecord {
	return HistoryRecord{SubZoneID: "s1", Start: ts(day, hm), Total: total}
}

func meanAt(t *testing.T, vs []ForecastValue, day, hm string) float64 {
	t.Helper()
	for _, v := range vs {
		if v.Start.Equal(ts(day, hm)) {
			return v.Expected
		}
	}
	t.Fatalf("no value at %s %s", day, hm)
	return 0
}

func TestSegmentAverageMeansTheSegmentAndSlot(t *testing.T) {
	hist := []HistoryRecord{
		rec("2026-09-01", "10:00", 3), rec("2026-09-02", "10:00", 4), rec("2026-09-03", "10:00", 9),
		rec("2026-09-04", "10:00", 8), rec("2026-09-05", "10:00", 6), rec("2026-09-05", "10:15", 5),
	}
	req := ForecastRequest{Origin: ts("2026-09-06", "00:00"), Days: 2, Zones: []ZoneSpec{{ZoneID: "z", SubZones: []string{"s1"}}}, History: hist, Coverage: 0.8}
	vs, err := SegmentAverage(alternating)(context.Background(), req)
	if err != nil {
		t.Fatal(err)
	}
	if got := meanAt(t, vs, "2026-09-07", "10:00"); got != 6 {
		t.Errorf("odd days (3, 9, 6): %v, want 6", got)
	}
	if got := meanAt(t, vs, "2026-09-06", "10:00"); got != 6 {
		t.Errorf("even days (4, 8): %v, want 6", got)
	}
	if got := meanAt(t, vs, "2026-09-07", "10:15"); got != 5.0/3 {
		t.Errorf("slot 10:15 over 3 odd days: %v", got)
	}
	if got := meanAt(t, vs, "2026-09-07", "11:00"); got != 0 {
		t.Errorf("no cases at 11:00: %v", got)
	}
}

func TestSegmentAverageFallsBackToTheDayGroup(t *testing.T) {
	seg := func(d string) string {
		if d >= "2026-09-06" {
			return "G-new"
		}
		return "G-old"
	}
	hist := []HistoryRecord{rec("2026-09-01", "10:00", 4), rec("2026-09-02", "10:00", 8)}
	req := ForecastRequest{Origin: ts("2026-09-06", "00:00"), Days: 1, Zones: []ZoneSpec{{ZoneID: "z", SubZones: []string{"s1"}}}, History: hist, Coverage: 0.8}
	vs, _ := SegmentAverage(seg)(context.Background(), req)
	if got := meanAt(t, vs, "2026-09-06", "10:00"); got != 12.0/5 {
		t.Errorf("a segment never seen uses the group mean over its 5 days: %v", got)
	}
}

func TestSegmentFromCalendar(t *testing.T) {
	cfg := forecastcal.Config{
		SchoolTerms: []forecastcal.Range{{Start: "2026-09-01", End: "2026-09-10", Name: "t"}, {Start: "2026-09-20", End: "2026-09-30", Name: "t"}},
	}
	seg := SegmentFromCalendar(cfg)
	for d, want := range map[string]string{
		"2026-09-06": "Weekdays-School",
		"2026-09-10": "Thursday-School",
		"2026-09-11": "Friday-Break",
		"2026-09-12": "Saturday-Break",
		"2026-09-23": "Weekdays-national_day",
		"2025-01-01": "Weekdays-SchoolUnknown",
	} {
		if got := seg(d); got != want {
			t.Errorf("%s: %s, want %s", d, got, want)
		}
	}
}

func TestStaffingCountsUnderOverExact(t *testing.T) {
	var s staffAcc
	s.add(0, 0)
	s.add(1.2, 3)
	s.add(4.0, 3.0)
	s.add(1.5, 2)
	s.add(5.01, 2)
	a := s.arm("x")
	if a.Windows != 4 || a.Under != 1 || a.Over != 2 || a.Exact != 1 {
		t.Fatalf("%+v", a)
	}
	nearP(t, "under", a.UnderShare, 0.25)
	nearP(t, "over", a.OverShare, 0.5)
	if a.NeededActual != 3+3+2+2 || a.NeededMethod != 2+4+2+6 {
		t.Fatalf("%+v", a)
	}
}

func TestRunForecastAddsTheSegmentArmStaffingAndGateBaseline(t *testing.T) {
	ds := dsOf(weeklyCases(30, nil)...)
	seg := func(string) string { return "Weekdays-School" }
	cfg := ForecastConfig{Horizon: 1, MinHistoryDays: 7, Candidate: SeasonalMean, CandidateName: "mean", Segmenter: seg}
	rep, err := RunForecast(context.Background(), ds, cfg)
	if err != nil {
		t.Fatal(err)
	}
	if rep.SegmentBaseline == nil || rep.SegmentBaseline.Overall.Cells != rep.Baseline.Overall.Cells {
		t.Fatalf("segment arm %+v", rep.SegmentBaseline)
	}
	if len(rep.Staffing) != 3 || rep.Staffing[0].Name != "mean" || rep.Staffing[2].Name != SegmentBaselineName {
		t.Fatalf("staffing %+v", rep.Staffing)
	}
	g := rep.Gate
	if g.BaselineName != rep.Baseline.Name || g.ImprovementOverNaive == nil || g.ImprovementOverSegment == nil {
		t.Fatalf("gate %+v", g)
	}
	cfg.GateBaseline = GateBaselineSegment
	rep2, err := RunForecast(context.Background(), ds, cfg)
	if err != nil {
		t.Fatal(err)
	}
	if rep2.Gate.BaselineName != SegmentBaselineName || *rep2.Gate.BaselineWAPE != *rep2.SegmentBaseline.Overall.WAPE {
		t.Fatalf("gate %+v", rep2.Gate)
	}
	if !strings.Contains((&Report{Forecast: rep2}).Text(), "improvement over segment-average") {
		t.Error("the text report must state the improvement over the segment baseline")
	}
	cfg.Segmenter = nil
	if _, err := RunForecast(context.Background(), ds, cfg); err == nil {
		t.Error("gate baseline segment without a segmenter must fail")
	}
}
