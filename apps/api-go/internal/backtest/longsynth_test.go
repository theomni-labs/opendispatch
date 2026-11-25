// SPDX-License-Identifier: AGPL-3.0-only

package backtest

import (
	"context"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/forecastcal"
)

func timeHours(h int) time.Duration { return time.Duration(h) * time.Hour }

func longBase() *Dataset {
	var cs []Case
	for d := 1; d <= 7; d++ {
		day := "2026-09-0" + string(rune('0'+d))
		for h := 0; h < 24; h++ {
			for k := 0; k < 100; k++ {
				c := Case{ID: day + string(rune('a'+h)) + string(rune('a'+k%26)) + string(rune('a'+k/26)), DataSource: SourceSynthetic,
					ZoneID: "z1", SubZoneID: "s1", Handling: "field", RegisteredAt: ts(day, "00:00").Add(timeHours(h))}
				if k%2 == 0 {
					c.SubZoneID = "s2"
				}
				cs = append(cs, c)
			}
		}
	}
	return dsOf(cs...)
}

func dayTotals(ds *Dataset) map[string]int {
	m := map[string]int{}
	for _, h := range ds.Intervals {
		m[h.Start.In(loc).Format("2006-01-02")] += h.Total
	}
	return m
}

func flat() *Effects {
	e := DefaultEffects()
	e.TrendPerYear = 0
	return &e
}

func TestGenerateLongIsDeterministicBySeed(t *testing.T) {
	o := LongOptions{Weeks: 3, Seed: 7, End: "2026-09-30", Volume: 0.1}
	a, err := GenerateLong(longBase(), o)
	if err != nil {
		t.Fatal(err)
	}
	b, _ := GenerateLong(longBase(), o)
	if !reflect.DeepEqual(a.Dataset.Intervals, b.Dataset.Intervals) || len(a.Dataset.Intervals) == 0 {
		t.Fatal("same seed must give the same history")
	}
	o.Seed = 8
	c, _ := GenerateLong(longBase(), o)
	if reflect.DeepEqual(a.Dataset.Intervals, c.Dataset.Intervals) {
		t.Fatal("another seed must differ")
	}
}

func TestGenerateLongLabelsAndShape(t *testing.T) {
	r, err := GenerateLong(longBase(), LongOptions{Weeks: 4, Seed: 1, End: "2026-09-30", Volume: 0.2})
	if err != nil {
		t.Fatal(err)
	}
	ds := r.Dataset
	if ds.DataSource != SourceSynthetic || !ds.Illustrative() || ds.SendSource() != SourceSynthetic {
		t.Fatalf("labels: %s", ds.DataSource)
	}
	if !strings.Contains(LongNotice, "not accuracy on real cases") {
		t.Fatal("the notice must say it is not accuracy")
	}
	if len(dayTotals(ds)) != 28 || r.First != "2026-09-03" || r.Last != "2026-09-30" {
		t.Fatalf("days %d, %s to %s", len(dayTotals(ds)), r.First, r.Last)
	}
	if len(ds.ZoneSubs["z1"]) != 2 || r.Calendar.PaydayDay != 27 {
		t.Fatalf("zones %v payday %d", ds.ZoneSubs, r.Calendar.PaydayDay)
	}
	rep := NewReport(ds)
	if !rep.Illustrative || rep.CasesInData == 0 {
		t.Fatalf("report %+v", rep)
	}
	for _, h := range ds.Intervals {
		if h.Field > h.Total || h.Total < 1 {
			t.Fatalf("bad record %+v", h)
		}
	}
}

func TestGenerateLongBuildsKnownEffects(t *testing.T) {
	breaks := []forecastcal.Range{{Start: "2026-09-07", End: "2026-09-12", Name: "break"}}
	r, err := GenerateLong(longBase(), LongOptions{Weeks: 8, Seed: 3, End: "2026-09-30", Volume: 4, Effects: flat(), SchoolBreaks: breaks})
	if err != nil {
		t.Fatal(err)
	}
	tot := dayTotals(r.Dataset)
	around := func(a, b string) float64 { return float64(tot[a]+tot[b]) / 2 }
	if x := float64(tot["2026-09-27"]) / around("2026-09-26", "2026-09-28"); x < 1.08 || x > 1.25 {
		t.Fatalf("payday ratio %.2f", x)
	}
	if x := float64(tot["2026-09-23"]) / around("2026-09-22", "2026-09-24"); x < 1.2 {
		t.Fatalf("National Day ratio %.2f", x)
	}
	if x := float64(tot["2026-09-09"]) / around("2026-09-14", "2026-09-15"); x > 0.95 {
		t.Fatalf("school break ratio %.2f", x)
	}
	if st := r.Calendar.For("2026-09-09").SchoolInSession; st == nil || *st {
		t.Fatal("the break must reach the engine as school not in session")
	}
	if st := r.Calendar.For("2026-09-15").SchoolInSession; st == nil || !*st {
		t.Fatal("a term day must reach the engine as in session")
	}
}

func TestGenerateLongHijriEffects(t *testing.T) {
	r, err := GenerateLong(longBase(), LongOptions{Weeks: 8, Seed: 5, End: "2026-03-31", Volume: 4, Effects: flat()})
	if err != nil {
		t.Fatal(err)
	}
	tot := dayTotals(r.Dataset)
	var eid, ram, plain []float64
	for d, n := range tot {
		f := r.Calendar.For(d)
		switch {
		case len(f.Events) > 0 && f.Events[0].Type == "eid":
			eid = append(eid, float64(n))
		case f.IsRamadan && f.IsPayday != nil && !*f.IsPayday && len(f.Events) == 0:
			ram = append(ram, float64(n))
		case !f.IsRamadan && len(f.Events) == 0 && !*f.IsPayday:
			plain = append(plain, float64(n))
		}
	}
	mean := func(v []float64) float64 {
		s := 0.0
		for _, x := range v {
			s += x
		}
		return s / float64(len(v))
	}
	if len(eid) == 0 || len(ram) == 0 || len(plain) == 0 {
		t.Fatalf("eid %d ramadan %d plain %d", len(eid), len(ram), len(plain))
	}
	if x := mean(eid) / mean(plain); x > 0.7 {
		t.Fatalf("Eid ratio %.2f", x)
	}
	var night, day, nightN, dayN float64
	for _, h := range r.Dataset.Intervals {
		t0 := h.Start.In(loc)
		if !r.Calendar.For(t0.Format("2006-01-02")).IsRamadan {
			continue
		}
		if t0.Hour() >= 20 {
			night += float64(h.Total)
			nightN++
		} else if t0.Hour() >= 8 && t0.Hour() <= 16 {
			day += float64(h.Total)
			dayN++
		}
	}
	if night/nightN < 1.5*day/dayN*0.99 {
		t.Fatalf("Ramadan night %.2f against day %.2f per record", night/nightN, day/dayN)
	}
}

func TestGenerateLongRefusesBadInput(t *testing.T) {
	if _, err := GenerateLong(longBase(), LongOptions{Weeks: 0, End: "2026-09-30"}); err == nil {
		t.Fatal("weeks 0")
	}
	if _, err := GenerateLong(longBase(), LongOptions{Weeks: 2, End: "soon"}); err == nil {
		t.Fatal("bad end")
	}
	if _, err := GenerateLong(dsOf(), LongOptions{Weeks: 2, End: "2026-09-30"}); err == nil {
		t.Fatal("no base cases")
	}
}

func TestLongHistoryRunsThroughTheBacktest(t *testing.T) {
	r, err := GenerateLong(longBase(), LongOptions{Weeks: 12, Seed: 2, End: "2026-09-30", Volume: 1})
	if err != nil {
		t.Fatal(err)
	}
	cfg := ForecastConfig{Horizon: 7, OriginStepDays: 7, MinHistoryDays: MinTrainingDays, HeldOutDays: 28, Calendar: r.Calendar,
		Candidate: SeasonalMean, CandidateName: "mean"}
	rep, err := RunForecast(context.Background(), r.Dataset, cfg)
	if err != nil {
		t.Fatal(err)
	}
	if rep.Origins != 4 || rep.HeldOut.Days != 28 || rep.Gate.Result == GateNotEnoughHistory {
		t.Fatalf("origins %d days %d gate %s", rep.Origins, rep.HeldOut.Days, rep.Gate.Result)
	}
}
