// SPDX-License-Identifier: AGPL-3.0-only

// Ports gen/demand.ts: the shape of a day in
// 15-minute slots and day-of-week multipliers. Only
// casesForDate/slotCountsForDay are needed at
// runtime (ramadanSlotWeights is check.ts-only).
package synthetic

import (
	"fmt"
	"math"
)

// baseSlotLevels: relative level of each of the 96
// slots (not normalised).
func baseSlotLevels() ([]float64, error) {
	hourly, err := calFloatArray("demand", "hourly_levels", "value")
	if err != nil {
		return nil, err
	}
	overrides, err := calFloatMap("demand", "slot_overrides", "value")
	if err != nil {
		return nil, err
	}
	out := make([]float64, SlotsPerDay)
	for slot := 0; slot < SlotsPerDay; slot++ {
		label := fmt.Sprintf("%02d:%02d", slot/4, (slot%4)*15)
		if pinned, ok := overrides[label]; ok {
			out[slot] = pinned
			continue
		}
		x := (float64(slot)+0.5)/4 - 0.5
		lo := math.Floor(x)
		frac := x - lo
		loIdx := int(math.Mod(math.Mod(lo, 24)+24, 24))
		hiIdx := int(math.Mod(math.Mod(lo+1, 24)+24, 24))
		a := hourly[loIdx]
		b := hourly[hiIdx]
		out[slot] = a + (b-a)*frac
	}
	return out, nil
}

// slotWeights: slot shares of a day, summing to 1.
func slotWeights() ([]float64, error) {
	levels, err := baseSlotLevels()
	if err != nil {
		return nil, err
	}
	sum := 0.0
	for _, l := range levels {
		sum += l
	}
	out := make([]float64, len(levels))
	for i, l := range levels {
		out[i] = l / sum
	}
	return out, nil
}

// dayMultiplier: day-of-week multiplier (mean 1.0).
func dayMultiplier(date string) (float64, error) {
	weekday, err := weekdayOf(date)
	if err != nil {
		return 0, err
	}
	table, err := calFloatMap("demand", "day_of_week_multiplier", "value")
	if err != nil {
		return 0, err
	}
	return table[weekday], nil
}

// casesForDate: total cases for a date.
func casesForDate(date string) (int, error) {
	perDay, err := calFloat("structure", "cases_per_day", "value")
	if err != nil {
		return 0, err
	}
	mult, err := dayMultiplier(date)
	if err != nil {
		return 0, err
	}
	return int(math.Round(perDay * mult)), nil
}

// slotCountsForDay: case count per slot for one day.
func slotCountsForDay(rng *Rng, total int) ([]int, error) {
	sigma, err := calFloat("demand", "slot_count_noise_sigma", "value")
	if err != nil {
		return nil, err
	}
	weights, err := slotWeights()
	if err != nil {
		return nil, err
	}
	scaled := make([]float64, len(weights))
	for i, w := range weights {
		scaled[i] = w * math.Exp(sigma*rng.Normal())
	}
	return apportion(total, scaled)
}
