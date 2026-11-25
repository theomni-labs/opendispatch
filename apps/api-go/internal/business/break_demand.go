// SPDX-License-Identifier: AGPL-3.0-only

// Breaks in low-demand periods.
package business

import (
	"context"
	"math"
	"sort"
)

const (
	breakShareKey     = "breaks.max_concurrent_share"
	defaultBreakShare = 0.34
	breakCapCost      = 1000.0
	breakDemandCost   = 4.0
)

// getBreakMaxShare: most of a zone on break at once.
func getBreakMaxShare(ctx context.Context, tenant string) float64 {
	v := readSetting(ctx, tenant, breakShareKey, defaultBreakShare)
	if math.IsNaN(v) || v <= 0 || v > 1 {
		return defaultBreakShare
	}
	return v
}

// BreakCoverageCost mirrors the contract type.
type BreakCoverageCost struct {
	ExpectedCases float64 `json:"expected_cases"`
	LostIntervals int     `json:"lost_agent_intervals"`
	MaxConcurrent int     `json:"max_concurrent_breaks"`
	PeakShareAway float64 `json:"peak_share_away"`
	MaxShare      float64 `json:"max_share"`
}

func quarterOfMinute(m int) int {
	return int(math.Floor(float64(m) / breakGrid))
}

// onDutyQuarters: shifts on duty per quarter.
func onDutyQuarters(inputs []BreakInput) map[int]int {
	out := map[int]int{}
	for _, in := range inputs {
		for q := quarterOfMinute(in.StartMin); q*breakGrid < in.EndMin; q++ {
			out[q]++
		}
	}
	return out
}

func breakCap(onDuty int, share float64) int {
	c := int(math.Floor(share*float64(onDuty) + 1e-9))
	if c < 1 {
		return 1
	}
	return c
}

func demandAt(demand []float64, q int) float64 {
	if q < 0 || q >= len(demand) {
		return 0
	}
	return demand[q]
}

// PlaceBreaksForDemand: low demand, staggered, prayer-aware.
func PlaceBreaksForDemand(inputs []BreakInput, prayers []PrayerMinute, demand []float64, share float64, pol PrayerPolicy) []BreakPlacement {
	onDuty := onDutyQuarters(inputs)
	peak := 0.0
	for _, d := range demand {
		peak = math.Max(peak, d)
	}
	load := map[int]int{}
	ordered := append([]BreakInput(nil), inputs...)
	sort.SliceStable(ordered, func(i, j int) bool {
		wi := ordered[i].EndMin - ordered[i].StartMin
		wj := ordered[j].EndMin - ordered[j].StartMin
		if wi != wj {
			return wi < wj
		}
		if ordered[i].StartMin != ordered[j].StartMin {
			return ordered[i].StartMin < ordered[j].StartMin
		}
		return ordered[i].Key < ordered[j].Key
	})
	var out []BreakPlacement
	for _, input := range ordered {
		earliest := ceilToGrid(input.StartMin + int(input.AfterHours*60))
		found, bestStart, bestCost := false, 0, 0.0
		for _, start := range breakStarts(input, prayers, pol) {
			end := start + input.BreakMinutes
			cost := prayerCost(start, end, prayers, pol)
			for slot := start; slot < end; slot += breakGrid {
				q := quarterOfMinute(slot)
				if load[q]+1 > breakCap(onDuty[q], share) {
					cost += breakCapCost
				}
				cost += float64(load[q]) * breakLoadCost
				if peak > 0 {
					cost += demandAt(demand, q) / peak * breakDemandCost
				}
			}
			cost += float64(start-earliest) / breakGrid * 0.01
			if !found || cost < bestCost {
				found, bestStart, bestCost = true, start, cost
			}
		}
		if !found {
			continue
		}
		end := bestStart + input.BreakMinutes
		for slot := bestStart; slot < end; slot += breakGrid {
			load[quarterOfMinute(slot)]++
		}
		out = append(out, BreakPlacement{Key: input.Key, StartMin: bestStart, EndMin: end, PrayerConflict: PrayerConflictOf(bestStart, end, prayers, pol)})
	}
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].StartMin != out[j].StartMin {
			return out[i].StartMin < out[j].StartMin
		}
		return out[i].Key < out[j].Key
	})
	return out
}

// coverageCostOf: field demand left by breaks.
func coverageCostOf(inputs []BreakInput, placed []BreakPlacement, demand []float64, share float64) BreakCoverageCost {
	onDuty := onDutyQuarters(inputs)
	away := map[int]int{}
	cost := BreakCoverageCost{MaxShare: share}
	for _, p := range placed {
		for slot := p.StartMin; slot < p.EndMin; slot += breakGrid {
			q := quarterOfMinute(slot)
			away[q]++
			cost.LostIntervals++
			if n := onDuty[q]; n > 0 {
				cost.ExpectedCases += demandAt(demand, q) / float64(n)
			}
		}
	}
	for q, n := range away {
		cost.MaxConcurrent = max(cost.MaxConcurrent, n)
		if d := onDuty[q]; d > 0 {
			cost.PeakShareAway = math.Max(cost.PeakShareAway, float64(n)/float64(d))
		}
	}
	cost.ExpectedCases = math.Round(cost.ExpectedCases*10) / 10
	cost.PeakShareAway = math.Round(cost.PeakShareAway*100) / 100
	return cost
}

// zoneFieldDemand: field demand per quarter, two days.
func zoneFieldDemand(ctx context.Context, tenant, zoneID, date string) []float64 {
	in := newReachInputs(ctx, tenant)
	out := make([]float64, 2*quartersPerDay)
	for d, day := range []string{date, shiftDateBy(date, 1)} {
		_, quarters := in.demand(zoneID, day)
		for q, bySub := range quarters {
			for _, v := range bySub {
				out[d*quartersPerDay+q] += v
			}
		}
	}
	return out
}
