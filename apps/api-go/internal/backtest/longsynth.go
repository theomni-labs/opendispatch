// SPDX-License-Identifier: AGPL-3.0-only

package backtest

import (
	"errors"
	"fmt"
	"math"
	"math/rand"
	"sort"
	"strings"
	"time"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/forecastcal"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/weather"
)

// LongNotice labels every long synthetic run.
const LongNotice = "Long synthetic history with known, made-up effects: it measures the mechanics of the models, not accuracy on real cases."

// Effects are the known multipliers.
type Effects struct {
	TrendPerYear    float64
	PaydayBump      float64
	SchoolBreakDip  float64
	RamadanDay      float64
	RamadanIftar    float64
	RamadanNight    float64
	EidDip          float64
	HajjDip         float64
	NationalDayBump float64
	FoundingDayBump float64
	// SalaryWindowBump applies only on days with a salary window.
	SalaryWindowBump float64
}

// DefaultEffects are illustrative, not measured.
func DefaultEffects() Effects {
	return Effects{TrendPerYear: 0.10, PaydayBump: 0.15, SchoolBreakDip: 0.15, RamadanDay: 0.6, RamadanIftar: 0.7,
		RamadanNight: 1.5, EidDip: 0.55, HajjDip: 0.8, NationalDayBump: 1.4, FoundingDayBump: 1.25,
		SalaryWindowBump: 0.08}
}

// LongOptions: a long synthetic history.
type LongOptions struct {
	Weeks int
	Seed  int64
	// End is the last day (YYYY-MM-DD).
	End string
	// Volume scales every base rate (0: 1).
	Volume  float64
	Effects *Effects
	// SchoolBreaks: made-up ranges
	SchoolBreaks []forecastcal.Range
	PaydayDay    int
	// Weather: synthetic weather lifts or lowers days.
	Weather        bool
	WeatherEffects *weather.Effects
	// Traffic: heavy synthetic traffic lifts days.
	Traffic bool
}

// DefaultSchoolBreaks are made up.
func DefaultSchoolBreaks() []forecastcal.Range {
	return []forecastcal.Range{
		{Start: "2023-06-22", End: "2023-08-26", Name: "illustrative summer break"},
		{Start: "2023-12-21", End: "2024-01-06", Name: "illustrative winter break"},
		{Start: "2024-06-20", End: "2024-08-24", Name: "illustrative summer break"},
		{Start: "2024-12-19", End: "2025-01-04", Name: "illustrative winter break"},
		{Start: "2025-06-19", End: "2025-08-23", Name: "illustrative summer break"},
		{Start: "2025-12-18", End: "2026-01-04", Name: "illustrative winter break"},
		{Start: "2026-06-18", End: "2026-08-22", Name: "illustrative summer break"},
		{Start: "2026-12-17", End: "2027-01-03", Name: "illustrative winter break"},
	}
}

// LongResult: the dataset and its calendar.
type LongResult struct {
	Dataset  *Dataset
	Calendar forecastcal.Config
	Effects  Effects
	First    string
	Last     string
}

type calib struct {
	zones    []string
	daily    map[string]float64
	hour     map[string][24]float64
	dow      map[string][7]float64
	field    map[string]float64
	subs     map[string][]string
	subShare map[string][]float64
}

// calibrate keeps summary numbers only.
func calibrate(base *Dataset) (*calib, error) {
	if len(base.Cases) == 0 {
		return nil, errors.New("long synthetic: the base data has no cases to calibrate from")
	}
	type zacc struct {
		hour  [24]float64
		dow   [7]float64
		dowN  [7]map[string]bool
		n     float64
		field float64
	}
	days := map[string]bool{}
	za := map[string]*zacc{}
	subN := map[string]map[string]float64{}
	var gh [24]float64
	for _, c := range base.Cases {
		t := c.RegisteredAt.In(loc)
		d := t.Format("2006-01-02")
		days[d] = true
		z := za[c.ZoneID]
		if z == nil {
			z = &zacc{}
			for i := range z.dowN {
				z.dowN[i] = map[string]bool{}
			}
			za[c.ZoneID] = z
		}
		z.hour[t.Hour()]++
		z.dow[t.Weekday()]++
		z.dowN[t.Weekday()][d] = true
		z.n++
		if c.Handling == "field" {
			z.field++
		}
		gh[t.Hour()]++
		if subN[c.ZoneID] == nil {
			subN[c.ZoneID] = map[string]float64{}
		}
		subN[c.ZoneID][c.subZone()]++
	}
	cb := &calib{daily: map[string]float64{}, hour: map[string][24]float64{}, dow: map[string][7]float64{},
		field: map[string]float64{}, subs: map[string][]string{}, subShare: map[string][]float64{}}
	var gsum float64
	for _, v := range gh {
		gsum += v
	}
	for z := range za {
		cb.zones = append(cb.zones, z)
	}
	sort.Strings(cb.zones)
	for _, id := range cb.zones {
		z := za[id]
		cb.daily[id] = z.n / float64(len(days))
		cb.field[id] = z.field / z.n
		var h [24]float64
		for i := range h {
			h[i] = 0.5*z.hour[i]/z.n + 0.5*gh[i]/gsum
		}
		cb.hour[id] = h
		var w [7]float64
		for i := range w {
			w[i] = 1
			if k := len(z.dowN[i]); k > 0 {
				w[i] = 0.5 + 0.5*(z.dow[i]/float64(k))/cb.daily[id]
			}
		}
		cb.dow[id] = w
		subs := append([]string(nil), base.ZoneSubs[id]...)
		if len(subs) == 0 {
			for s := range subN[id] {
				subs = append(subs, s)
			}
		}
		sort.Strings(subs)
		var tot float64
		sh := make([]float64, len(subs))
		for i, s := range subs {
			sh[i] = subN[id][s] + 1
			tot += sh[i]
		}
		for i := range sh {
			sh[i] /= tot
		}
		cb.subs[id], cb.subShare[id] = subs, sh
	}
	return cb, nil
}

// termsAround: the terms between breaks.
func termsAround(first, last string, breaks []forecastcal.Range) []forecastcal.Range {
	bs := forecastcal.Valid(breaks)
	var out []forecastcal.Range
	cur := first
	next := func(d string) string {
		t, _ := time.Parse("2006-01-02", d)
		return t.AddDate(0, 0, 1).Format("2006-01-02")
	}
	prev := func(d string) string {
		t, _ := time.Parse("2006-01-02", d)
		return t.AddDate(0, 0, -1).Format("2006-01-02")
	}
	for _, b := range bs {
		if b.End < first || b.Start > last {
			continue
		}
		if b.Start > cur {
			out = append(out, forecastcal.Range{Start: cur, End: min(prev(b.Start), last), Name: "illustrative term"})
		}
		cur = max(cur, next(b.End))
	}
	if cur <= last {
		out = append(out, forecastcal.Range{Start: cur, End: last, Name: "illustrative term"})
	}
	return out
}

func poisson(r *rand.Rand, lambda float64) int {
	if lambda <= 0 {
		return 0
	}
	if lambda > 30 {
		return max(0, int(math.Round(lambda+math.Sqrt(lambda)*r.NormFloat64())))
	}
	l, p, k := math.Exp(-lambda), 1.0, 0
	for {
		p *= r.Float64()
		if p <= l {
			return k
		}
		k++
	}
}

func ramadanHour(e Effects, h int) float64 {
	switch {
	case h >= 8 && h <= 16:
		return e.RamadanDay
	case h >= 17 && h <= 19:
		return e.RamadanIftar
	case h >= 20 || h <= 2:
		return e.RamadanNight
	}
	return 1
}

// dayFactor: the all-day multiplier.
func dayFactor(e Effects, f forecastcal.Features, inBreak bool, idx int) float64 {
	m := 1 + e.TrendPerYear*float64(idx)/364
	if f.IsPayday != nil && *f.IsPayday {
		m *= 1 + e.PaydayBump
	}
	if f.SalaryWindow != nil && *f.SalaryWindow {
		m *= 1 + e.SalaryWindowBump
	}
	if inBreak {
		m *= 1 - e.SchoolBreakDip
	}
	eid, hajj := false, false
	for _, ev := range f.Events {
		if len(ev.Cities) > 0 {
			continue
		}
		switch ev.Type {
		case "eid":
			eid = true
		case "hajj":
			hajj = true
		case "national_day":
			if ev.Name == "Founding Day" {
				m *= e.FoundingDayBump
			} else {
				m *= e.NationalDayBump
			}
		}
	}
	if eid {
		m *= e.EidDip
	} else if hajj {
		m *= e.HajjDip
	}
	return m
}

// breakOf: a school vacation by the day's school period when known.
func breakOf(f forecastcal.Features, ranges bool) bool {
	p := f.SchoolPeriod
	if p == "" {
		return ranges
	}
	return strings.HasPrefix(p, "vacation_")
}

// GenerateLong builds the history in memory.
func GenerateLong(base *Dataset, o LongOptions) (*LongResult, error) {
	if o.Weeks < 1 {
		return nil, errors.New("long synthetic: weeks must be at least 1")
	}
	end, err := time.ParseInLocation("2006-01-02", o.End, loc)
	if err != nil {
		return nil, fmt.Errorf("long synthetic: end %q: %w", o.End, err)
	}
	cb, err := calibrate(base)
	if err != nil {
		return nil, err
	}
	eff := DefaultEffects()
	if o.Effects != nil {
		eff = *o.Effects
	}
	if o.Volume <= 0 {
		o.Volume = 1
	}
	if o.SchoolBreaks == nil {
		o.SchoolBreaks = DefaultSchoolBreaks()
	}
	if o.PaydayDay == 0 {
		o.PaydayDay = forecastcal.DefaultPaydayDay
	}
	total := o.Weeks * 7
	start := addDays(end, -(total - 1))
	first, last := start.Format("2006-01-02"), end.Format("2006-01-02")
	cal := forecastcal.Config{PaydayDay: o.PaydayDay, SchoolTerms: termsAround(first, last, o.SchoolBreaks)}
	breaks := forecastcal.Valid(o.SchoolBreaks)
	r := rand.New(rand.NewSource(o.Seed))
	ds := &Dataset{Agents: map[string]Agent{}, Standby: map[string]Point{}, ZoneSubs: map[string][]string{}, ZoneCity: base.ZoneCity, DataSource: SourceSynthetic}
	for z, s := range cb.subs {
		ds.ZoneSubs[z] = s
	}
	for d := 0; d < total; d++ {
		day := addDays(start, d)
		date := day.Format("2006-01-02")
		f := cal.For(date)
		inBreak := false
		for _, b := range breaks {
			inBreak = inBreak || (date >= b.Start && date <= b.End)
		}
		dm := dayFactor(eff, f, breakOf(f, inBreak), d)
		for _, z := range cb.zones {
			zm := cb.daily[z] * o.Volume * dm * cb.dow[z][day.Weekday()]
			zm *= longWeather(o, base.ZoneCity[z], date)
			zm *= longTraffic(o, base.ZoneCity[z], date)
			for i, sub := range cb.subs[z] {
				share := cb.subShare[z][i]
				for q := 0; q < intervalsPerDay; q++ {
					h := q / 4
					hm := cb.hour[z][h]
					if f.IsRamadan {
						hm *= ramadanHour(eff, h)
					}
					n := poisson(r, zm*share*hm/4)
					if n == 0 {
						continue
					}
					fld := 0
					for k := 0; k < n; k++ {
						if r.Float64() < cb.field[z] {
							fld++
						}
					}
					ds.Intervals = append(ds.Intervals, HistoryRecord{SubZoneID: sub, Start: day.Add(time.Duration(q) * 15 * time.Minute), Total: n, Field: fld})
				}
			}
		}
	}
	sort.SliceStable(ds.Intervals, func(i, j int) bool {
		a, b := ds.Intervals[i], ds.Intervals[j]
		if !a.Start.Equal(b.Start) {
			return a.Start.Before(b.Start)
		}
		return a.SubZoneID < b.SubZoneID
	})
	return &LongResult{Dataset: ds, Calendar: cal, Effects: eff, First: first, Last: last}, nil
}

// SchoolTerms are the terms between the breaks.
func SchoolTerms(first, last string, breaks []forecastcal.Range) []forecastcal.Range {
	return termsAround(first, last, breaks)
}
