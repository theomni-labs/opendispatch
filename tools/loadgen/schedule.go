// SPDX-License-Identifier: AGPL-3.0-only

package main

import (
	"encoding/json"
	"fmt"
	"math"
	"math/rand/v2"
	"os"
	"sort"
	"time"
)

// Slots is the number of 15-minute slots in a day.
const Slots = 96

const slotLen = 15 * time.Minute

// Shape is each slot's share of a day; sums to 1.
type Shape [Slots]float64

// ShapeFromCalibration: as demand.ts does.
func ShapeFromCalibration(path string) (Shape, error) {
	var c struct {
		Demand struct {
			Hourly    struct{ Value []float64 } `json:"hourly_levels"`
			Overrides struct {
				Value map[string]float64
			} `json:"slot_overrides"`
		} `json:"demand"`
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		return Shape{}, err
	}
	if err := json.Unmarshal(raw, &c); err != nil {
		return Shape{}, fmt.Errorf("%s: %w", path, err)
	}
	return ShapeFromLevels(c.Demand.Hourly.Value, c.Demand.Overrides.Value)
}

// ShapeFromLevels: hourly levels to slots.
func ShapeFromLevels(hourly []float64, overrides map[string]float64) (Shape, error) {
	var s Shape
	if len(hourly) != 24 {
		return s, fmt.Errorf("hourly_levels: want 24 values, got %d", len(hourly))
	}
	sum := 0.0
	for slot := range Slots {
		label := fmt.Sprintf("%02d:%02d", slot/4, (slot%4)*15)
		v, pinned := overrides[label]
		if !pinned {
			// hour h's level sits at h:30
			x := (float64(slot)+0.5)/4 - 0.5
			lo := math.Floor(x)
			frac := x - lo
			a := hourly[(int(lo)+24)%24]
			b := hourly[(int(lo)+25)%24]
			v = a + (b-a)*frac
		}
		if v < 0 {
			return s, fmt.Errorf("slot %s: negative level", label)
		}
		s[slot] = v
		sum += v
	}
	if sum <= 0 {
		return s, fmt.Errorf("hourly_levels sum to zero")
	}
	for i := range s {
		s[i] /= sum
	}
	return s, nil
}

// Peak returns the busiest slot and its share.
func (s Shape) Peak() (int, float64) {
	best := 0
	for i, v := range s {
		if v > s[best] {
			best = i
		}
	}
	return best, s[best]
}

// Plan is one run's arrival schedule settings.
type Plan struct {
	PerDay    float64       // cases a day at 1x
	Burst     float64       // multiplier on the arrival rate
	Mode      string        // "peak" or "day"
	Speed     float64       // day mode: day time per wall time
	StartSlot int           // day mode: first slot of the day
	Duration  time.Duration // wall-clock length of the run
	Seed      uint64
}

// Validate checks a plan before it is used.
func (p Plan) Validate() error {
	switch {
	case p.PerDay <= 0:
		return fmt.Errorf("cases per day must be above 0")
	case p.Burst <= 0:
		return fmt.Errorf("burst must be above 0")
	case p.Duration <= 0:
		return fmt.Errorf("duration must be above 0")
	case p.Mode != "peak" && p.Mode != "day":
		return fmt.Errorf("mode must be peak or day")
	case p.Mode == "day" && p.Speed <= 0:
		return fmt.Errorf("speed must be above 0")
	case p.StartSlot < 0 || p.StartSlot >= Slots:
		return fmt.Errorf("start slot must be 0 to %d", Slots-1)
	}
	return nil
}

// PeakRate is cases per second in the busiest slot.
func (p Plan) PeakRate(s Shape) float64 {
	_, share := s.Peak()
	return p.PerDay * share / slotLen.Seconds() * p.Burst
}

// Arrivals: Poisson wall-clock offsets, sorted.
func Arrivals(s Shape, p Plan) []time.Duration {
	rng := rand.New(rand.NewPCG(p.Seed, p.Seed^0x9e3779b97f4a7c15))
	var out []time.Duration
	if p.Mode == "peak" {
		rate := p.PeakRate(s)
		for t := rng.ExpFloat64() / rate; t < p.Duration.Seconds(); t += rng.ExpFloat64() / rate {
			out = append(out, time.Duration(t*float64(time.Second)))
		}
		return out
	}
	// day mode: piecewise-constant rate per slot
	dayEnd := p.Duration.Seconds() * p.Speed
	for seg := 0.0; seg < dayEnd; {
		slot := (p.StartSlot + int(seg/slotLen.Seconds())) % Slots
		segEnd := math.Min((math.Floor(seg/slotLen.Seconds())+1)*slotLen.Seconds(), dayEnd)
		rate := p.PerDay * s[slot] / slotLen.Seconds() * p.Burst
		if rate > 0 {
			for t := seg + rng.ExpFloat64()/rate; t < segEnd; t += rng.ExpFloat64() / rate {
				out = append(out, time.Duration(t/p.Speed*float64(time.Second)))
			}
		}
		seg = segEnd
	}
	sort.Slice(out, func(i, j int) bool { return out[i] < out[j] })
	return out
}
