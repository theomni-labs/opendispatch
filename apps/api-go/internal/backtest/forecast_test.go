// SPDX-License-Identifier: AGPL-3.0-only

package backtest

import (
	"context"
	"fmt"
	"math"
	"testing"
	"time"
)

func weeklyCases(days int, extra map[string]int) []Case {
	var cs []Case
	start := ts("2026-09-01", "00:00")
	for d := 0; d < days; d++ {
		day := addDays(start, d)
		date := day.Format("2006-01-02")
		n := 2 + extra[date]
		for i := 0; i < n; i++ {
			cs = append(cs, Case{
				ID: fmt.Sprintf("c-%s-%d", date, i), DataSource: SourceSynthetic, ZoneID: "z1", SubZoneID: "s1",
				RegisteredAt: day.Add(8*time.Hour + time.Duration(i)*time.Minute), Handling: "field",
			})
		}
	}
	return cs
}

func TestRunForecastPerfectSeasonalPattern(t *testing.T) {
	ds := dsOf(weeklyCases(15, nil)...)
	rep, err := RunForecast(context.Background(), ds, ForecastConfig{Horizon: 1, MinHistoryDays: 7})
	if err != nil {
		t.Fatal(err)
	}
	if rep.Origins != 8 {
		t.Fatalf("origins %d", rep.Origins)
	}
	m := rep.Baseline.Overall
	if m.MAE != 0 || m.WAPE == nil || *m.WAPE != 0 {
		t.Fatalf("metrics %+v", m)
	}
	if m.Cells != 8*24 || m.ActualTotal != 16 {
		t.Fatalf("cells %d actual %v", m.Cells, m.ActualTotal)
	}
	if m.Coverage != 1 {
		t.Fatalf("coverage %v", m.Coverage)
	}
}

func TestRunForecastErrorMetrics(t *testing.T) {
	ds := dsOf(weeklyCases(15, map[string]int{"2026-09-15": 4})...)
	rep, err := RunForecast(context.Background(), ds, ForecastConfig{Horizon: 1, MinHistoryDays: 14})
	if err != nil {
		t.Fatal(err)
	}
	if rep.Origins != 1 {
		t.Fatalf("origins %d", rep.Origins)
	}
	m := rep.Baseline.Overall
	if m.Cells != 24 || m.ActualTotal != 6 {
		t.Fatalf("cells %d actual %v", m.Cells, m.ActualTotal)
	}
	if math.Abs(m.MAE-4.0/24) > 1e-3 || m.WAPE == nil || math.Abs(*m.WAPE-4.0/6) > 1e-3 {
		t.Fatalf("metrics %+v", m)
	}
	want := 23.0 / 24
	if math.Abs(m.Coverage-want) > 1e-3 {
		t.Fatalf("coverage %v want %v", m.Coverage, want)
	}
	if len(rep.Baseline.ByZone) != 1 || rep.Baseline.ByZone[0].ZoneID != "z1" {
		t.Fatalf("by zone %+v", rep.Baseline.ByZone)
	}
}

func TestForecasterSeesOnlyThePast(t *testing.T) {
	ds := dsOf(weeklyCases(12, nil)...)
	calls := 0
	spy := func(_ context.Context, r ForecastRequest) ([]ForecastValue, error) {
		calls++
		for _, h := range r.History {
			if !h.Start.Before(r.Origin) {
				t.Fatalf("history %s reaches origin %s", h.Start, r.Origin)
			}
		}
		return nil, nil
	}
	rep, err := RunForecast(context.Background(), ds, ForecastConfig{
		Horizon: 2, MinHistoryDays: 7, Candidate: spy, CandidateName: "spy"})
	if err != nil {
		t.Fatal(err)
	}
	if calls != rep.Origins || rep.Origins != 4 {
		t.Fatalf("calls %d origins %d", calls, rep.Origins)
	}
	c := rep.Candidate.Overall
	if c.WAPE == nil || *c.WAPE != 1 {
		t.Fatalf("an empty forecast has WAPE 1, got %+v", c)
	}
}

func TestRunForecastNeedsHistory(t *testing.T) {
	ds := dsOf(weeklyCases(5, nil)...)
	if _, err := RunForecast(context.Background(), ds, ForecastConfig{MinHistoryDays: 7}); err == nil {
		t.Fatal("expected an error")
	}
}

func TestPoissonRange(t *testing.T) {
	lo, hi := poissonRange(10, 0.8)
	if lo != 6 || hi != 14 {
		t.Fatalf("got %v %v", lo, hi)
	}
	if lo, hi := poissonRange(0, 0.8); lo != 0 || hi != 0 {
		t.Fatalf("zero mean gave %v %v", lo, hi)
	}
}

func TestSeasonalMeanAveragesWeeks(t *testing.T) {
	ds := dsOf(weeklyCases(29, map[string]int{"2026-09-08": 4, "2026-09-15": 4, "2026-09-22": 4})...)
	origin := ts("2026-09-29", "00:00")
	var past []Case
	for _, c := range ds.Cases {
		if c.RegisteredAt.Before(origin) {
			past = append(past, c)
		}
	}
	req := ForecastRequest{Origin: origin, Days: 1, Zones: zoneSpecs(ds), History: buildHistory(past), Coverage: 0.8}
	for name, want := range map[string]float64{"mean": 5, "naive": 6} {
		f := SeasonalMean
		if name == "naive" {
			f = SeasonalNaive
		}
		vs, err := f(context.Background(), req)
		if err != nil {
			t.Fatal(err)
		}
		for _, v := range vs {
			if v.Start.Equal(ts("2026-09-29", "08:00")) && v.Expected != want {
				t.Fatalf("%s: expected %v want %v", name, v.Expected, want)
			}
		}
	}
}
