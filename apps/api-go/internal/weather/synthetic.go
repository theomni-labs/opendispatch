// SPDX-License-Identifier: AGPL-3.0-only

package weather

import (
	"context"
	"hash/fnv"
	"math"
	"math/rand"
	"time"
)

// Flag thresholds; the engine uses the same.
const (
	RainFlagMM     = 1.0
	LowVisFlagKM   = 2.0
	HeatFlagC      = 45.0
	WarmFlagC      = 40.0
	SyntheticLabel = "SYNTHETIC"
)

// Flags are the day-level weather states.
type Flags struct {
	Rain, Dust, LowVis, Heat bool
}

// FlagsOf reads a day; unknown fields are false.
func FlagsOf(d Day) Flags {
	var f Flags
	if d.RainMM != nil {
		f.Rain = *d.RainMM >= RainFlagMM
	}
	if d.DustEvent != nil {
		f.Dust = *d.DustEvent
	}
	if d.VisibilityKM != nil {
		f.LowVis = *d.VisibilityKM < LowVisFlagKM
	}
	if d.MaxTempC != nil {
		f.Heat = *d.MaxTempC >= HeatFlagC
	}
	return f
}

// Effects are made-up multipliers, not measured.
type Effects struct {
	Rain, Dust, LowVis, Heat float64
}

// DefaultEffects are illustrative.
func DefaultEffects() Effects {
	return Effects{Rain: 1.30, Dust: 1.15, LowVis: 1.10, Heat: 0.95}
}

// Multiplier is the day's known accident effect.
func (e Effects) Multiplier(d Day) float64 {
	f, m := FlagsOf(d), 1.0
	if f.Rain {
		m *= e.Rain
	}
	if f.Dust {
		m *= e.Dust
	}
	if f.LowVis {
		m *= e.LowVis
	}
	if f.Heat {
		m *= e.Heat
	}
	return m
}

type climate struct {
	rain, dust, fog [12]float64
	tmax            [12]float64
}

// made-up climates, shaped like each city's
var climates = map[string]climate{
	"riyadh": {
		rain: [12]float64{.10, .08, .12, .12, .04, 0, 0, 0, 0, .01, .06, .08},
		dust: [12]float64{.02, .04, .10, .12, .12, .10, .06, .03, .02, .02, .02, .02},
		fog:  [12]float64{.02, .01, 0, 0, 0, 0, 0, 0, 0, 0, .01, .02},
		tmax: [12]float64{20, 23, 28, 33, 40, 43, 44, 44, 41, 35, 27, 22},
	},
	"jeddah": {
		rain: [12]float64{.05, .02, .02, .01, 0, 0, 0, 0, 0, .01, .06, .06},
		dust: [12]float64{.01, .03, .06, .07, .06, .04, .03, .02, .01, .01, .01, .01},
		fog:  [12]float64{.01, .01, 0, 0, 0, 0, 0, 0, 0, 0, 0, .01},
		tmax: [12]float64{29, 30, 32, 35, 37, 38, 39, 39, 37, 36, 33, 30},
	},
	"dammam": {
		rain: [12]float64{.08, .06, .05, .03, 0, 0, 0, 0, 0, .01, .04, .07},
		dust: [12]float64{.02, .03, .06, .08, .10, .14, .08, .03, .02, .02, .02, .02},
		fog:  [12]float64{.05, .04, .02, 0, 0, 0, 0, 0, 0, .01, .03, .05},
		tmax: [12]float64{21, 23, 27, 33, 40, 44, 45, 45, 42, 37, 29, 23},
	},
}

func round1(x float64) float64 { return math.Round(x*10) / 10 }

// Synthetic is one city-day; same inputs, same day.
func Synthetic(seed int64, city, date string) Day {
	cl, ok := climates[normKey(city)]
	if !ok {
		cl = climates["riyadh"]
	}
	t, err := time.Parse(dateLayout, date)
	if err != nil {
		return Day{Date: date}
	}
	h := fnv.New64a()
	_, _ = h.Write([]byte(normKey(city) + "|" + date))
	r := rand.New(rand.NewSource(seed ^ int64(h.Sum64())))
	m := int(t.Month()) - 1
	rain, vis := 0.0, 10+5*r.Float64()
	if u := r.Float64(); u < cl.rain[m] {
		rain = 1 + r.ExpFloat64()*6
		vis = 3 + 5*r.Float64()
	} else if u < cl.rain[m]+0.05 {
		rain = 0.1 + 0.8*r.Float64()
	}
	dust := r.Float64() < cl.dust[m]
	if dust {
		u := r.Float64()
		vis = 0.5 + 3.5*u*u
	} else if r.Float64() < cl.fog[m] {
		vis = 0.3 + 1.6*r.Float64()
	}
	tmax := cl.tmax[m] + 2.5*r.NormFloat64()
	if rain >= RainFlagMM {
		tmax -= 3
	}
	tmax = math.Max(-20, math.Min(60, tmax))
	return Day{Date: date, RainMM: ptr(round1(rain)), DustEvent: ptr(dust), MaxTempC: ptr(round1(tmax)),
		VisibilityKM: ptr(round1(vis)), Source: SyntheticLabel}
}

// DemoSeed is the demo history's seed.
const DemoSeed int64 = 20260905

// SyntheticSource: made-up weather, offline.
type SyntheticSource struct{ Seed int64 }

func (SyntheticSource) Name() string { return "synthetic" }

// Days: every city-day, the shared generator.
func (s SyntheticSource) Days(_ context.Context, cities []City, from, to string) ([]Day, error) {
	f, t, err := checkRange(from, to)
	if err != nil {
		return nil, err
	}
	var out []Day
	for _, c := range cities {
		for d := f; !d.After(t); d = d.AddDate(0, 0, 1) {
			day := Synthetic(s.Seed, c.NameEn, d.Format(dateLayout))
			day.CityID = c.ID
			out = append(out, day)
		}
	}
	return Sorted(out), nil
}
