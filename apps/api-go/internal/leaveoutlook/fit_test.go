// SPDX-License-Identifier: AGPL-3.0-only

package leaveoutlook

import (
	"math"
	"math/rand"
	"testing"
	"time"
)

var truth = map[string]float64{"ramadan": 0.8, "eid_fitr": 0.55, "national_day": 1.4, "payday": 1.15, "school_break": 0.85}

var weekdayTruth = [7]float64{1.0, 1.05, 1.0, 0.95, 1.15, 0.8, 1.05}

// testTags: a made-up calendar.
func testTags(date string) []string {
	t := parse(date)
	var out []string
	md := t.Format("01-02")
	if md == "09-23" {
		out = append(out, "national_day")
	}
	if t.Day() == 27 {
		out = append(out, "payday")
	}
	if t.Month() == time.July || t.Month() == time.August {
		out = append(out, "school_break")
	}
	// Ramadan-like: moves 11 days a year.
	y := t.Year() - 2023
	rs := time.Date(2023, 3, 23, 0, 0, 0, 0, time.UTC).AddDate(y, 0, -11*y)
	if !t.Before(rs) && t.Before(rs.AddDate(0, 0, 29)) {
		out = append(out, "ramadan")
	}
	es := rs.AddDate(0, 0, 29)
	if !t.Before(es) && t.Before(es.AddDate(0, 0, 3)) {
		out = append(out, "eid_fitr")
	}
	return out
}

func synthHistory(first, last string, base, growth float64) map[string]float64 {
	r := rand.New(rand.NewSource(7))
	a, b := parse(first), parse(last)
	out := map[string]float64{}
	for t := a; !t.After(b); t = t.AddDate(0, 0, 1) {
		ds := t.Format("2006-01-02")
		mu := base * math.Pow(1+growth, t.Sub(a).Hours()/24/364) * weekdayTruth[int(t.Weekday())]
		for _, tg := range testTags(ds) {
			mu *= truth[tg]
		}
		out[ds] = math.Max(0, math.Round(mu+r.NormFloat64()*math.Sqrt(mu)))
	}
	return out
}

func TestFitRecoversKnownEffects(t *testing.T) {
	counts := synthHistory("2023-09-13", "2026-09-12", 300, 0.10)
	f, ok := FitZone(counts, "2023-09-13", "2026-09-12", testTags)
	if !ok {
		t.Fatal("fit refused three years")
	}
	for tg, want := range truth {
		if got := f.Effects[tg]; math.Abs(got-want) > 0.06 {
			t.Errorf("%s: got %.3f, want %.2f", tg, got, want)
		}
	}
	for i, want := range weekdayTruth {
		if got := f.Weekday[i]; math.Abs(got-want/1.0) > 0.05 {
			t.Errorf("weekday %d: got %.3f, want about %.2f", i, got, want)
		}
	}
	year := f.Level("2026-09-13") / f.Level("2025-09-13")
	if math.Abs(year-1.10) > 0.04 {
		t.Errorf("growth: got %.3f a year, want about 1.10", year)
	}
}

func TestWeekNamesTheDriver(t *testing.T) {
	counts := synthHistory("2023-09-13", "2026-09-12", 60, 0)
	f, _ := FitZone(counts, "2023-09-13", "2026-09-12", testTags)
	w := f.Week("2026-09-20", 7, testTags)
	if w.Change < 0.03 || w.Change > 0.09 {
		t.Fatalf("national day week change %.3f, want about +0.06", w.Change)
	}
	if len(w.Drivers) == 0 || w.Drivers[0].Code != "national_day" {
		t.Fatalf("drivers %+v, want national_day first", w.Drivers)
	}
	quiet := f.Week("2026-10-04", 7, testTags)
	grown := synthHistory("2023-09-13", "2026-09-12", 300, 0.10)
	g, _ := FitZone(grown, "2023-09-13", "2026-09-12", testTags)
	if late := g.Week("2027-10-03", 7, testTags); math.Abs(late.Change) > 0.03 {
		t.Fatalf("a plain week a year on: change %.3f, want about 0 (trend is in normal)", late.Change)
	}
	if math.Abs(quiet.Change) > 0.03 || len(quiet.Drivers) != 0 {
		t.Fatalf("plain week %+v, want no driver and about 0", quiet)
	}
}

func TestFitRefusesShortHistory(t *testing.T) {
	if _, ok := FitZone(map[string]float64{}, "2026-08-01", "2026-09-12", testTags); ok {
		t.Fatal("six weeks should be too short")
	}
}

func TestClassify(t *testing.T) {
	th := Thresholds{GrantBelow: 0.05, RestrictAbove: 0.10}
	base := Capacity{Agents: 40, Share: 0.15, Days: 7}
	cases := []struct {
		name   string
		change float64
		cap    Capacity
		want   string
		full   bool
	}{
		{"busy", 0.12, base, "restrict", false},
		{"quiet", -0.08, base, "grant", false},
		{"normal", 0.02, base, "normal", false},
		{"blackout", -0.08, Capacity{Agents: 40, Share: 0.15, Days: 7, Blackout: true}, "restrict", false},
		{"leave full", -0.08, Capacity{Agents: 40, Share: 0.15, Days: 7, ApprovedDays: 42}, "restrict", true},
		{"no people", -0.08, Capacity{Share: 0.15, Days: 7}, "grant", false},
	}
	for _, c := range cases {
		v := Classify(c.change, c.cap, th)
		if v.Status != c.want || v.LeaveFull != c.full {
			t.Errorf("%s: got %+v, want %s (full %v)", c.name, v, c.want, c.full)
		}
	}
	if v := Classify(0, base, th); v.Limit != 6 || v.Room != 6 {
		t.Errorf("normal week room: got %+v, want limit 6 room 6", v)
	}
	sick := base
	sick.Sick = 1.4
	if v := Classify(0, sick, th); v.Limit != 6 || v.Room != 4 {
		t.Errorf("1.4 off sick a day: got %+v, want limit 6 room 4", v)
	}
	sick.Sick = 9
	if v := Classify(-0.08, sick, th); v.Room != 0 || v.Status != "normal" {
		t.Errorf("sickness fills the room, no grant: got %+v", v)
	}
}
