// SPDX-License-Identifier: AGPL-3.0-only

// Package leaveoutlook: the long leave outlook.
package leaveoutlook

import (
	"math"
	"sort"
	"time"
)

// Tuning; fixed, not settings.
const (
	blockDays   = 364
	minDays     = 56
	minTagDays  = 3
	iterations  = 8
	minEffect   = 0.3
	maxEffect   = 3.0
	maxYearMove = 0.3
)

// Fit: level, trend, weekday and calendar effects.
type Fit struct {
	First, Last string
	Days        int
	level       float64
	mid         time.Time
	growth      float64
	Weekday     [7]float64
	Effects     map[string]float64
}

// Tags gives a day's calendar drivers.
type Tags func(date string) []string

func parse(date string) time.Time {
	t, err := time.Parse("2006-01-02", date)
	if err != nil {
		return time.Time{}
	}
	return t
}

type day struct {
	y     float64
	wd    int
	block int
	tags  []string
}

// FitZone fits counts by date; false if too short.
func FitZone(counts map[string]float64, first, last string, tags Tags) (Fit, bool) {
	a, b := parse(first), parse(last)
	if a.IsZero() || b.IsZero() || b.Before(a) {
		return Fit{}, false
	}
	n := int(b.Sub(a).Hours()/24) + 1
	if n < minDays {
		return Fit{}, false
	}
	days := make([]day, n)
	blocks := 0
	for i := 0; i < n; i++ {
		t := a.AddDate(0, 0, i)
		ds := t.Format("2006-01-02")
		blk := (n - 1 - i) / blockDays
		days[i] = day{y: counts[ds], wd: int(t.Weekday()), block: blk, tags: tags(ds)}
		blocks = max(blocks, blk+1)
	}
	// A short oldest block joins the next one.
	if blocks > 1 && n-(blocks-1)*blockDays < blockDays/2 {
		for i := range days {
			if days[i].block == blocks-1 {
				days[i].block = blocks - 2
			}
		}
		blocks--
	}
	level := make([]float64, blocks)
	for i := range level {
		level[i] = 1
	}
	var wd [7]float64
	for i := range wd {
		wd[i] = 1
	}
	eff := map[string]float64{}
	tagDays := map[string]int{}
	for _, d := range days {
		for _, tg := range d.tags {
			tagDays[tg]++
		}
	}
	for tg, c := range tagDays {
		if c >= minTagDays {
			eff[tg] = 1
		}
	}
	tagMul := func(d day, skip string) float64 {
		m := 1.0
		for _, tg := range d.tags {
			if tg == skip {
				continue
			}
			if e, ok := eff[tg]; ok {
				m *= e
			}
		}
		return m
	}
	for it := 0; it < iterations; it++ {
		num, den := make([]float64, blocks), make([]float64, blocks)
		for _, d := range days {
			num[d.block] += d.y
			den[d.block] += wd[d.wd] * tagMul(d, "")
		}
		for i := range level {
			level[i] = ratio(num[i], den[i], level[i])
		}
		var wn, wdn [7]float64
		for _, d := range days {
			wn[d.wd] += d.y
			wdn[d.wd] += level[d.block] * tagMul(d, "")
		}
		mean := 0.0
		for i := range wd {
			wd[i] = ratio(wn[i], wdn[i], wd[i])
			mean += wd[i] / 7
		}
		if mean > 0 {
			for i := range wd {
				wd[i] /= mean
			}
		}
		for _, tg := range sortedKeys(eff) {
			tn, td := 0.0, 0.0
			for _, d := range days {
				if !has(d.tags, tg) {
					continue
				}
				tn += d.y
				td += level[d.block] * wd[d.wd] * tagMul(d, tg)
			}
			eff[tg] = clamp(ratio(tn, td, 1), minEffect, maxEffect)
		}
	}
	growth := 1.0
	if blocks > 1 && level[1] > 0 && level[0] > 0 {
		year := clamp(level[0]/level[1], 1-maxYearMove, 1+maxYearMove)
		growth = math.Pow(year, 1.0/blockDays)
	}
	block0 := min(n, blockDays)
	return Fit{
		First: first, Last: last, Days: n, level: level[0],
		mid: b.AddDate(0, 0, -(block0-1)/2), growth: growth, Weekday: wd, Effects: eff,
	}, true
}

// Level: the zone's daily level at a date.
func (f Fit) Level(date string) float64 {
	t := parse(date)
	if t.IsZero() {
		return f.level
	}
	return f.level * math.Pow(f.growth, t.Sub(f.mid).Hours()/24)
}

// Day: expected count, skipping one driver.
func (f Fit) Day(date string, tags []string, skip string) float64 {
	t := parse(date)
	if t.IsZero() {
		return 0
	}
	v := f.Level(date) * f.Weekday[int(t.Weekday())]
	for _, tg := range tags {
		if tg == skip {
			continue
		}
		if e, ok := f.Effects[tg]; ok {
			v *= e
		}
	}
	return v
}

func ratio(num, den, fallback float64) float64 {
	if den <= 0 {
		return fallback
	}
	return num / den
}

func clamp(v, lo, hi float64) float64 { return math.Min(hi, math.Max(lo, v)) }

func has(list []string, v string) bool {
	for _, x := range list {
		if x == v {
			return true
		}
	}
	return false
}

func sortedKeys(m map[string]float64) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}
