// SPDX-License-Identifier: AGPL-3.0-only

package backtest

import (
	"context"
	"math"
	"strings"
	"testing"
	"time"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/forecastcal"
)

func near(t *testing.T, what string, got, want float64) {
	t.Helper()
	if math.Abs(got-want) > 1e-3 {
		t.Fatalf("%s: got %v want %v", what, got, want)
	}
}

func nearP(t *testing.T, what string, got *float64, want float64) {
	t.Helper()
	if got == nil {
		t.Fatalf("%s: nil, want %v", what, want)
	}
	near(t, what, *got, want)
}

func casesAt(day string, zone, sub string, hour, n int) []Case {
	var cs []Case
	for i := 0; i < n; i++ {
		cs = append(cs, Case{ID: day + zone + string(rune('a'+hour)) + string(rune('a'+i)), DataSource: SourceSynthetic, ZoneID: zone, SubZoneID: sub,
			RegisteredAt: ts(day, "00:00").Add(time.Duration(hour)*time.Hour + time.Duration(i)*time.Minute), Handling: "field"})
	}
	return cs
}

// stub forecasts z1: 3 at 08h, 2 at 09h; z2: 3 at 08h; every day.
func stub(_ context.Context, r ForecastRequest) ([]ForecastValue, error) {
	var out []ForecastValue
	for d := 0; d < r.Days; d++ {
		day := addDays(r.Origin, d)
		add := func(z, s string, hour int, v float64) {
			out = append(out, ForecastValue{ZoneID: z, SubZoneID: s, Start: day.Add(time.Duration(hour) * time.Hour), Low: v, Expected: v, High: v})
		}
		add("z1", "s1", 8, 3)
		add("z1", "s1", 9, 2)
		add("z2", "s2", 8, 3)
	}
	return out, nil
}

func smallDataset() *Dataset {
	var cs []Case
	cs = append(cs, casesAt("2026-09-01", "z1", "s1", 8, 1)...)
	cs = append(cs, casesAt("2026-09-02", "z1", "s1", 8, 1)...)
	cs = append(cs, casesAt("2026-09-03", "z1", "s1", 8, 4)...)
	cs = append(cs, casesAt("2026-09-03", "z1", "s1", 9, 2)...)
	cs = append(cs, casesAt("2026-09-03", "z2", "s2", 8, 1)...)
	cs = append(cs, casesAt("2026-09-04", "z1", "s1", 8, 2)...)
	cs = append(cs, casesAt("2026-09-01", "z2", "s2", 8, 1)...)
	return dsOf(cs...)
}

func runSmall(t *testing.T) *ForecastReport {
	t.Helper()
	rep, err := RunForecast(context.Background(), smallDataset(), ForecastConfig{
		Horizon: 1, MinHistoryDays: 1, HeldOutDays: 2, Candidate: stub, CandidateName: "stub", WeakestN: 2,
		Calendar:  forecastcal.Config{SeasonEvents: []forecastcal.Range{{Start: "2026-09-03", End: "2026-09-03", Name: "E"}}},
		GatePoint: GatePointExpected,
	})
	if err != nil {
		t.Fatal(err)
	}
	return rep
}

func TestMetricsAgainstHandComputedNumbers(t *testing.T) {
	rep := runSmall(t)
	if rep.Origins != 2 || rep.HeldOut.From != "2026-09-03" || rep.HeldOut.To != "2026-09-04" || rep.HeldOut.Days != 2 {
		t.Fatalf("held out %+v origins %d", rep.HeldOut, rep.Origins)
	}
	c := rep.Candidate
	m := c.Overall
	if m.Cells != 96 || m.ActualTotal != 9 {
		t.Fatalf("overall %+v", m)
	}
	near(t, "MAE", m.MAE, 9.0/96)
	near(t, "RMSE", m.RMSE, math.Sqrt(19.0/96))
	nearP(t, "WAPE", m.WAPE, 1.0)
	z := map[string]ZoneMetrics{}
	for _, x := range c.ByZone {
		z[x.ZoneID] = x
	}
	nearP(t, "z1 WAPE", z["z1"].WAPE, 0.5)
	near(t, "z1 RMSE", z["z1"].RMSE, math.Sqrt(6.0/48))
	nearP(t, "z2 WAPE", z["z2"].WAPE, 5.0)
	near(t, "z2 RMSE", z["z2"].RMSE, math.Sqrt(13.0/48))
	h8, h9, h10 := c.ByHour[8], c.ByHour[9], c.ByHour[10]
	if h8.Hour != 8 || h9.Hour != 9 || len(c.ByHour) != 24 {
		t.Fatalf("hours %+v", c.ByHour)
	}
	near(t, "h8 MAE", h8.MAE, 1.75)
	near(t, "h8 RMSE", h8.RMSE, math.Sqrt(15.0/4))
	nearP(t, "h8 WAPE", h8.WAPE, 1.0)
	near(t, "h9 MAE", h9.MAE, 0.5)
	if h10.WAPE != nil {
		t.Fatal("an hour with no actual cases has no WAPE")
	}
	if len(c.ByZoneHour) != 48 {
		t.Fatalf("zone-hours %d", len(c.ByZoneHour))
	}
	b := rep.Baseline.Overall
	nearP(t, "baseline WAPE", b.WAPE, 1.0)
}

func TestEventDaysAreSplitFromOrdinaryDays(t *testing.T) {
	rep := runSmall(t)
	e, o := rep.Candidate.EventDays, rep.Candidate.OrdinaryDays
	if e.Cells != 48 || o.Cells != 48 || rep.HeldOut.EventDays != 1 {
		t.Fatalf("event %+v ordinary %+v held out %+v", e, o, rep.HeldOut)
	}
	nearP(t, "event WAPE", e.WAPE, 3.0/7)
	near(t, "event RMSE", e.RMSE, math.Sqrt(5.0/48))
	nearP(t, "ordinary WAPE", o.WAPE, 3.0)
}

func TestWeakestLocationsAreOrderedAndKeepTheirNumbers(t *testing.T) {
	rep := runSmall(t)
	w := rep.Weakest
	if w == nil || w.Arm != "stub" || w.N != 2 || len(w.Zones) != 2 || len(w.ZoneHours) != 2 {
		t.Fatalf("weakest %+v", w)
	}
	if w.Zones[0].ZoneID != "z2" || w.Zones[1].ZoneID != "z1" {
		t.Fatalf("zones %+v", w.Zones)
	}
	nearP(t, "z2", w.Zones[0].WAPE, 5.0)
	nearP(t, "z2 baseline", w.Zones[0].BaselineWAPE, 1.0)
	a, b := w.ZoneHours[0], w.ZoneHours[1]
	if a.ZoneID != "z2" || *a.Hour != 8 || b.ZoneID != "z1" || *b.Hour != 9 {
		t.Fatalf("zone-hours %+v %+v", a, b)
	}
	nearP(t, "z2h8", a.WAPE, 5.0)
	nearP(t, "z1h9", b.WAPE, 1.0)
	if a.ActualTotal != 1 || a.Cells != 2 {
		t.Fatalf("numbers %+v", a)
	}
	if w.Unscored != 45 {
		t.Fatalf("unscored %d", w.Unscored)
	}
}

func TestShortHistoryIsNotEnoughAndWarns(t *testing.T) {
	rep := runSmall(t)
	g := rep.Gate
	if g == nil || g.Result != GateNotEnoughHistory {
		t.Fatalf("gate %+v", g)
	}
	nearP(t, "improvement", g.Improvement, 0)
	if g.WorseZones != 1 || g.ComparedZones != 2 {
		t.Fatalf("zones %+v", g)
	}
	text := strings.Join(rep.Warnings, "|")
	if !strings.Contains(text, "under 52 weeks") || !strings.Contains(text, "Not enough history") {
		t.Fatalf("warnings %v", rep.Warnings)
	}
}

func arm(wape float64, zones ...float64) ForecastArm {
	a := ForecastArm{Overall: Metrics{WAPE: &wape}}
	for i, z := range zones {
		z := z
		a.ByZone = append(a.ByZone, ZoneMetrics{ZoneID: string(rune('a' + i)), Metrics: Metrics{WAPE: &z}})
	}
	return a
}

func TestGatePassFailAndNotEnoughHistory(t *testing.T) {
	o := DefaultGate()
	for name, tc := range map[string]struct {
		cand  ForecastArm
		train int
		want  string
	}{
		"pass, one zone in four worse":     {arm(0.4, 0.3, 0.3, 0.3, 0.6), 100, GatePass},
		"pass, exactly 10 percent better":  {arm(0.45, 0.4, 0.4, 0.4, 0.4), 100, GatePass},
		"fail, improvement too small":      {arm(0.46, 0.4, 0.4, 0.4, 0.4), 100, GateFail},
		"fail, worse in two zones of four": {arm(0.3, 0.2, 0.2, 0.6, 0.6), 100, GateFail},
		"fail, not better":                 {arm(0.6, 0.6, 0.6, 0.6, 0.6), 100, GateFail},
		"not enough history":               {arm(0.1, 0.1, 0.1, 0.1, 0.1), 55, GateNotEnoughHistory},
		"eight weeks is enough":            {arm(0.1, 0.1, 0.1, 0.1, 0.1), 56, GatePass},
	} {
		base4 := arm(0.5, 0.5, 0.5, 0.5, 0.5)
		cand := tc.cand
		cand.ByZone = cand.ByZone[:4]
		base4.ByZone = base4.ByZone[:4]
		g := Judge(base4, cand, tc.train, o)
		if g.Result != tc.want {
			t.Fatalf("%s: got %s (%v) want %s", name, g.Result, g.Reasons, tc.want)
		}
		if len(g.Reasons) == 0 {
			t.Fatalf("%s: no reason given", name)
		}
	}
}

func TestGateThresholdsAreOptions(t *testing.T) {
	base, cand := arm(0.5, 0.5, 0.5), arm(0.4, 0.4, 0.4)
	if g := Judge(base, cand, 100, GateOptions{MinImprovement: 0.3, MaxWorseZoneShare: 0}); g.Result != GateFail {
		t.Fatalf("a 20 percent gain does not meet 30 percent: %s", g.Result)
	}
	if g := Judge(base, cand, 100, GateOptions{MinImprovement: 0.15, MaxWorseZoneShare: 0}); g.Result != GatePass {
		t.Fatalf("got %s", g.Result)
	}
}

func TestNoCasesToScoreIsNotEnoughHistory(t *testing.T) {
	zero := ForecastArm{}
	if g := Judge(zero, zero, 100, DefaultGate()); g.Result != GateNotEnoughHistory {
		t.Fatalf("got %s", g.Result)
	}
}

func TestPoissonMedianIsThePointOfLeastAbsoluteError(t *testing.T) {
	for _, c := range []struct{ mean, want float64 }{
		{0, 0}, {0.3, 0}, {0.69, 0}, {0.7, 1}, {1, 1}, {2.5, 2}, {10, 10}, {499.5, 499}, {1000, 1000},
	} {
		if got := poissonMedian(c.mean); got != c.want {
			t.Fatalf("median of Poisson(%v): got %v want %v", c.mean, got, c.want)
		}
	}
}

// sparse forecasts 0.4 at 08h in both zones.
func sparse(_ context.Context, r ForecastRequest) ([]ForecastValue, error) {
	var out []ForecastValue
	for d := 0; d < r.Days; d++ {
		t := addDays(r.Origin, d).Add(8 * time.Hour)
		out = append(out, ForecastValue{ZoneID: "z1", SubZoneID: "s1", Start: t, Expected: 0.4, High: 1},
			ForecastValue{ZoneID: "z2", SubZoneID: "s2", Start: t, Expected: 0.4, High: 1})
	}
	return out, nil
}

func TestGateScoresTheMedianUnlessAskedForTheExpectedValue(t *testing.T) {
	run := func(point string) *ForecastReport {
		rep, err := RunForecast(context.Background(), smallDataset(), ForecastConfig{
			Horizon: 1, MinHistoryDays: 1, HeldOutDays: 2, Candidate: sparse, CandidateName: "sparse", WeakestN: 2, GatePoint: point,
		})
		if err != nil {
			t.Fatal(err)
		}
		return rep
	}
	med, exp := run(""), run(GatePointExpected)
	// 8.2 off over 9 cases; the median of 0.4 is 0
	nearP(t, "expected WAPE", med.Candidate.Overall.WAPE, 8.2/9)
	nearP(t, "median WAPE", med.CandidateMedian.Overall.WAPE, 1.0)
	if g := med.Gate; g.Point != GatePointMedian || *g.CandidateWAPE != *med.CandidateMedian.Overall.WAPE {
		t.Fatalf("median gate %+v", g)
	}
	if med.GateArm() != med.CandidateMedian || med.Weakest.Arm != "sparse (median)" || med.CandidateMedian.MAPE != nil {
		t.Fatalf("median arm %q weakest %q", med.GateArm().Name, med.Weakest.Arm)
	}
	if g := exp.Gate; g.Point != GatePointExpected || *g.CandidateWAPE != *exp.Candidate.Overall.WAPE || exp.GateArm() != exp.Candidate {
		t.Fatalf("expected gate %+v", g)
	}
}
