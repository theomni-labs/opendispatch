// SPDX-License-Identifier: AGPL-3.0-only

package main

import (
	"math"
	"path/filepath"
	"slices"
	"testing"
	"time"
)

func calibration(t *testing.T) Shape {
	t.Helper()
	s, err := ShapeFromCalibration(filepath.Join("..", "..", "scripts", "synthetic", "calibration.json"))
	if err != nil {
		t.Fatal(err)
	}
	return s
}

func within(t *testing.T, name string, got int, want float64) {
	t.Helper()
	// four standard deviations of a Poisson count
	if tol := 4 * math.Sqrt(want); math.Abs(float64(got)-want) > tol {
		t.Errorf("%s: got %d, want %.0f ± %.0f", name, got, want, tol)
	}
}

func TestShapeSumsToOneAndKeepsPinnedRatios(t *testing.T) {
	s := calibration(t)
	sum := 0.0
	for _, v := range s {
		if v <= 0 {
			t.Fatalf("a slot share is %v", v)
		}
		sum += v
	}
	if math.Abs(sum-1) > 1e-9 {
		t.Fatalf("shares sum to %v", sum)
	}
	// calibration pins 07:00 at 3.2x the 06:00 slot
	if r := s[28] / s[24]; math.Abs(r-3.2) > 1e-9 {
		t.Errorf("07:00 / 06:00 = %v, want 3.2", r)
	}
	slot, _ := s.Peak()
	if slot < 13*4 || slot >= 17*4 {
		t.Errorf("peak slot %d is outside 13:00 to 17:00", slot)
	}
}

func TestShapeRejectsBadLevels(t *testing.T) {
	if _, err := ShapeFromLevels(make([]float64, 23), nil); err == nil {
		t.Error("23 hourly levels accepted")
	}
	if _, err := ShapeFromLevels(make([]float64, 24), nil); err == nil {
		t.Error("all-zero levels accepted")
	}
}

func TestFullDayMatchesDailyVolume(t *testing.T) {
	s := calibration(t)
	p := Plan{PerDay: 11000, Burst: 1, Mode: "day", Speed: 1440, Duration: time.Minute, Seed: 7}
	got := Arrivals(s, p)
	within(t, "cases in one day", len(got), 11000)
	byHour := make([]int, 24)
	for _, a := range got {
		if a < 0 || a >= p.Duration {
			t.Fatalf("arrival %v outside the run", a)
		}
		byHour[int(a.Seconds()*p.Speed/3600)]++
	}
	if byHour[15] <= 3*byHour[3] {
		t.Errorf("15:00 hour %d not well above 03:00 hour %d", byHour[15], byHour[3])
	}
}

func TestDayModeFollowsTheSlotShares(t *testing.T) {
	s := calibration(t)
	p := Plan{PerDay: 11000, Burst: 1, Mode: "day", Speed: 1, StartSlot: 24, Duration: 2 * time.Hour, Seed: 3}
	got := Arrivals(s, p)
	want := 0.0
	for slot := 24; slot < 32; slot++ {
		want += 11000 * s[slot]
	}
	within(t, "06:00 to 08:00", len(got), want)
}

func TestPeakModeRateAndBurst(t *testing.T) {
	s := calibration(t)
	_, share := s.Peak()
	for _, burst := range []float64{1, 3} {
		p := Plan{PerDay: 11000, Burst: burst, Mode: "peak", Duration: 6 * time.Hour, Seed: 11}
		want := 11000 * share / 900 * burst * p.Duration.Seconds()
		if r := p.PeakRate(s) * p.Duration.Seconds(); math.Abs(r-want) > 1e-6 {
			t.Fatalf("PeakRate gives %v cases, want %v", r, want)
		}
		within(t, "peak cases", len(Arrivals(s, p)), want)
	}
}

func TestArrivalsAreDeterministicAndSorted(t *testing.T) {
	s := calibration(t)
	p := Plan{PerDay: 11000, Burst: 3, Mode: "day", Speed: 60, StartSlot: 50, Duration: 10 * time.Minute, Seed: 42}
	a, b := Arrivals(s, p), Arrivals(s, p)
	if !slices.Equal(a, b) {
		t.Fatal("same seed, different schedule")
	}
	if !slices.IsSorted(a) {
		t.Fatal("arrivals not sorted")
	}
	p.Seed = 43
	if slices.Equal(a, Arrivals(s, p)) {
		t.Fatal("different seed, same schedule")
	}
}

func TestPlanValidate(t *testing.T) {
	ok := Plan{PerDay: 1, Burst: 1, Mode: "peak", Duration: time.Second}
	if err := ok.Validate(); err != nil {
		t.Fatal(err)
	}
	for name, p := range map[string]Plan{
		"per day": {PerDay: 0, Burst: 1, Mode: "peak", Duration: time.Second},
		"burst":   {PerDay: 1, Burst: 0, Mode: "peak", Duration: time.Second},
		"mode":    {PerDay: 1, Burst: 1, Mode: "x", Duration: time.Second},
		"speed":   {PerDay: 1, Burst: 1, Mode: "day", Duration: time.Second},
		"slot":    {PerDay: 1, Burst: 1, Mode: "peak", Duration: time.Second, StartSlot: 96},
	} {
		if p.Validate() == nil {
			t.Errorf("%s: bad plan accepted", name)
		}
	}
}
