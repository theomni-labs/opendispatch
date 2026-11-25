// SPDX-License-Identifier: AGPL-3.0-only

// Package weather: daily weather per city.
package weather

import (
	"context"
	"errors"
	"fmt"
	"math"
	"sort"
	"strings"
	"time"
)

// Day is one city's weather; nil means unknown.
type Day struct {
	CityID       string   `json:"city_id"`
	Date         string   `json:"date"`
	RainMM       *float64 `json:"rain_mm,omitempty"`
	DustEvent    *bool    `json:"dust_event,omitempty"`
	MaxTempC     *float64 `json:"max_temp_c,omitempty"`
	VisibilityKM *float64 `json:"visibility_km,omitempty"`
	Source       string   `json:"source,omitempty"`
}

// Known reports whether any field is set.
func (d Day) Known() bool {
	return d.RainMM != nil || d.DustEvent != nil || d.MaxTempC != nil || d.VisibilityKM != nil
}

// City is one of our cities, with a point.
type City struct {
	ID       string
	Code     string
	NameEn   string
	Lat, Lon float64
	HasPoint bool
}

// Source answers weather for cities and dates.
type Source interface {
	Name() string
	// Days covers from..to (YYYY-MM-DD, inclusive).
	Days(ctx context.Context, cities []City, from, to string) ([]Day, error)
}

// NoneSource never has weather.
type NoneSource struct{}

func (NoneSource) Name() string { return "none" }

func (NoneSource) Days(context.Context, []City, string, string) ([]Day, error) {
	return nil, nil
}

// Riyadh is the time zone dates are read in.
var Riyadh = time.FixedZone("Asia/Riyadh", 3*3600)

const dateLayout = "2006-01-02"

// MaxSpanDays: 5 years of history plus 30 ahead.
const MaxSpanDays = 5*366 + 31

// ErrRange: bad from..to.
var ErrRange = errors.New("weather: invalid date range")

func checkRange(from, to string) (time.Time, time.Time, error) {
	f, err1 := time.Parse(dateLayout, from)
	t, err2 := time.Parse(dateLayout, to)
	if err1 != nil || err2 != nil || t.Before(f) || t.Sub(f) > MaxSpanDays*24*time.Hour {
		return f, t, ErrRange
	}
	return f, t, nil
}

func ptr[T any](v T) *T { return &v }

// validDay drops out-of-range fields.
func validDay(d Day) Day {
	if d.RainMM != nil && (math.IsNaN(*d.RainMM) || *d.RainMM < 0 || *d.RainMM > 1000) {
		d.RainMM = nil
	}
	if d.MaxTempC != nil && (math.IsNaN(*d.MaxTempC) || *d.MaxTempC < -20 || *d.MaxTempC > 60) {
		d.MaxTempC = nil
	}
	if d.VisibilityKM != nil && (math.IsNaN(*d.VisibilityKM) || *d.VisibilityKM < 0 || *d.VisibilityKM > 1000) {
		d.VisibilityKM = nil
	}
	if len(d.Source) > 64 {
		d.Source = d.Source[:64]
	}
	return d
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

// Fallback fills gaps in Primary from Secondary.
type Fallback struct {
	Primary, Secondary Source
}

func (f Fallback) Name() string { return f.Primary.Name() + "+" + f.Secondary.Name() }

// Days never drops a primary answer it got.
func (f Fallback) Days(ctx context.Context, cities []City, from, to string) ([]Day, error) {
	got, perr := f.Primary.Days(ctx, cities, from, to)
	have := map[string]bool{}
	for _, d := range got {
		have[d.CityID+"|"+d.Date] = true
	}
	more, serr := f.Secondary.Days(ctx, cities, from, to)
	for _, d := range more {
		if !have[d.CityID+"|"+d.Date] {
			got = append(got, d)
		}
	}
	return Sorted(got), errors.Join(perr, serr)
}

func normKey(s string) string { return strings.ToLower(strings.TrimSpace(s)) }

// errf keeps a source's name on its errors.
func errf(src, format string, args ...any) error {
	return fmt.Errorf("weather %s: %s", src, fmt.Sprintf(format, args...))
}
