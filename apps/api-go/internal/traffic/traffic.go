// SPDX-License-Identifier: AGPL-3.0-only

// Package traffic: daily congestion per city.
package traffic

import (
	"context"
	"fmt"
	"hash/fnv"
	"math"
	"math/rand"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/weather"
)

// Environment variables the traffic source reads.
const (
	EnvSource = "OPENDISPATCH_TRAFFIC_SOURCE"
	EnvFile   = "OPENDISPATCH_TRAFFIC_FILE"
	EnvSeed   = "OPENDISPATCH_TRAFFIC_SEED"
)

// HeavyIndex: a heavy day; the engine uses the same.
const HeavyIndex = 1.2

// MaxIndex: the contract's upper bound.
const MaxIndex = 5.0

// SyntheticLabel marks made-up days.
const SyntheticLabel = "SYNTHETIC"

const dateLayout = "2006-01-02"

// Day: a city's congestion against a typical day.
type Day struct {
	CityID          string  `json:"city_id"`
	Date            string  `json:"date"`
	CongestionIndex float64 `json:"congestion_index"`
	Source          string  `json:"source,omitempty"`
}

// Heavy: the day counts as heavy traffic.
func (d Day) Heavy() bool { return d.CongestionIndex >= HeavyIndex }

// Source answers congestion for cities and dates.
type Source interface {
	Name() string
	// Days covers from..to (YYYY-MM-DD, inclusive).
	Days(ctx context.Context, cities []weather.City, from, to string) ([]Day, error)
}

// NoneSource never has traffic.
type NoneSource struct{}

func (NoneSource) Name() string { return "none" }

func (NoneSource) Days(context.Context, []weather.City, string, string) ([]Day, error) {
	return nil, nil
}

// HeavyLift: made-up accident lift on a heavy day.
const HeavyLift = 1.15

// Multiplier: the made-up effect of one day.
func Multiplier(d Day) float64 {
	if d.Heavy() {
		return HeavyLift
	}
	return 1
}

// weekday factors, Sunday first; Friday is quiet.
var weekdayIndex = [7]float64{1.08, 1.06, 1.06, 1.08, 1.10, 0.78, 0.92}

// month factors: summer travel empties cities.
var monthIndex = [12]float64{1.02, 1.03, 1.02, 1.0, 0.98, 0.94, 0.86, 0.88, 1.0, 1.03, 1.04, 1.02}

func normKey(s string) string { return strings.ToLower(strings.TrimSpace(s)) }

// Synthetic: one city-day; same inputs, same day.
func Synthetic(seed int64, city, date string) Day {
	t, err := time.Parse(dateLayout, date)
	if err != nil {
		return Day{Date: date}
	}
	h := fnv.New64a()
	_, _ = h.Write([]byte("traffic|" + normKey(city) + "|" + date))
	r := rand.New(rand.NewSource(seed ^ int64(h.Sum64())))
	v := weekdayIndex[t.Weekday()] * monthIndex[t.Month()-1] * (1 + 0.04*r.NormFloat64())
	// a jam: works, a crash, an event
	if r.Float64() < 0.1 {
		v += 0.2 + 0.25*r.Float64()
	}
	v = math.Round(math.Max(0.3, math.Min(MaxIndex, v))*100) / 100
	return Day{Date: date, CongestionIndex: v, Source: SyntheticLabel}
}

// SyntheticSource: made-up congestion, offline.
type SyntheticSource struct{ Seed int64 }

func (SyntheticSource) Name() string { return "synthetic" }

// Days: every city-day from the generator.
func (s SyntheticSource) Days(_ context.Context, cities []weather.City, from, to string) ([]Day, error) {
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

// maxSpanDays: 5 years of history plus 31 ahead.
const maxSpanDays = 5*366 + 31

func checkRange(from, to string) (time.Time, time.Time, error) {
	f, err1 := time.Parse(dateLayout, from)
	t, err2 := time.Parse(dateLayout, to)
	if err1 != nil || err2 != nil || t.Before(f) || t.Sub(f) > maxSpanDays*24*time.Hour {
		return f, t, fmt.Errorf("traffic: invalid date range %s..%s", from, to)
	}
	return f, t, nil
}

// Sorted orders days by city then date.
func Sorted(days []Day) []Day {
	sort.SliceStable(days, func(i, j int) bool {
		if days[i].CityID != days[j].CityID {
			return days[i].CityID < days[j].CityID
		}
		return days[i].Date < days[j].Date
	})
	return days
}

// Config is read from the environment.
type Config struct {
	Kind string
	File string
	Seed int64
}

// ParseConfig: none unless the source is set.
func ParseConfig(getenv func(string) string) (Config, error) {
	c := Config{Kind: "none", Seed: weather.DemoSeed}
	switch k := normKey(getenv(EnvSource)); k {
	case "", "none":
	case "synthetic", "file":
		c.Kind = k
	default:
		return c, fmt.Errorf("%s must be none, synthetic or file, got %q", EnvSource, k)
	}
	c.File = strings.TrimSpace(getenv(EnvFile))
	if c.Kind == "file" && c.File == "" {
		return c, fmt.Errorf("%s=file needs %s", EnvSource, EnvFile)
	}
	if s := strings.TrimSpace(getenv(EnvSeed)); s != "" {
		n, err := strconv.ParseInt(s, 10, 64)
		if err != nil {
			return c, fmt.Errorf("%s must be a whole number, got %q", EnvSeed, s)
		}
		c.Seed = n
	}
	return c, nil
}

// Build makes the source.
func (c Config) Build() Source {
	switch c.Kind {
	case "synthetic":
		return SyntheticSource{Seed: c.Seed}
	case "file":
		return NewFileSource(c.File)
	}
	return NoneSource{}
}
