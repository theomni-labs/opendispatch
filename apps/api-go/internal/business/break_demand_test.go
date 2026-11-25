// SPDX-License-Identifier: AGPL-3.0-only

package business

import (
	"context"
	"testing"
)

func flatDemand(n int, v float64) []float64 {
	out := make([]float64, n)
	for i := range out {
		out[i] = v
	}
	return out
}

func TestPlaceBreaksForDemand_PicksTheQuietestAllowedSlot(t *testing.T) {
	demand := flatDemand(192, 3)
	demand[50], demand[51] = 0.2, 0.2
	inputs := []BreakInput{{Key: "a", StartMin: 360, EndMin: 900, BreakMinutes: 30, AfterHours: 5}}
	placed := PlaceBreaksForDemand(inputs, nil, demand, 0.34, clearPol)
	if len(placed) != 1 || placed[0].StartMin != 750 {
		t.Fatalf("got %+v, want the break at 12:30 (quarters 50-51)", placed)
	}
}

func TestPlaceBreaksForDemand_StaysInsideTheAllowedWindow(t *testing.T) {
	demand := flatDemand(192, 3)
	demand[30] = 0
	inputs := []BreakInput{{Key: "a", StartMin: 360, EndMin: 900, BreakMinutes: 30, AfterHours: 5}}
	placed := PlaceBreaksForDemand(inputs, nil, demand, 0.34, clearPol)
	if len(placed) != 1 || placed[0].StartMin < 660 || placed[0].EndMin > 900 {
		t.Fatalf("got %+v, want a break within [11:00, 15:00]", placed)
	}
}

func TestPlaceBreaksForDemand_StaggersByTheShare(t *testing.T) {
	demand := flatDemand(192, 2)
	demand[48], demand[49] = 0, 0
	var inputs []BreakInput
	for _, k := range []string{"a", "b", "c", "d", "e", "f"} {
		inputs = append(inputs, BreakInput{Key: k, StartMin: 360, EndMin: 900, BreakMinutes: 30, AfterHours: 5})
	}
	placed := PlaceBreaksForDemand(inputs, nil, demand, 0.34, clearPol)
	if len(placed) != 6 {
		t.Fatalf("got %d placements, want 6", len(placed))
	}
	away := map[int]int{}
	for _, p := range placed {
		for m := p.StartMin; m < p.EndMin; m += 15 {
			away[m]++
		}
	}
	for m, n := range away {
		if n > 2 {
			t.Fatalf("%d agents away at minute %d, want at most 2 of 6 (34%%)", n, m)
		}
	}
	if away[720] != 2 {
		t.Fatalf("got %d away at 12:00, want the quiet slot filled to the cap", away[720])
	}
}

func TestPlaceBreaksForDemand_LinedUpBeatsTheQuietSlot(t *testing.T) {
	demand := flatDemand(192, 1)
	demand[48] = 0
	prayers := []PrayerMinute{dhuhr(780)}
	inputs := []BreakInput{{Key: "a", StartMin: 360, EndMin: 900, BreakMinutes: 30, AfterHours: 5}}
	placed := PlaceBreaksForDemand(inputs, prayers, demand, 0.34, linedUpPol)
	if len(placed) != 1 || placed[0].StartMin != 780 || placed[0].PrayerConflict != nil {
		t.Fatalf("got %+v, want the break on the prayer window", placed)
	}
}

func TestPlaceBreaksForDemand_StillAvoidsCuttingAPrayer(t *testing.T) {
	demand := flatDemand(192, 1)
	demand[48] = 0
	prayers := []PrayerMinute{dhuhr(725)}
	inputs := []BreakInput{{Key: "a", StartMin: 360, EndMin: 900, BreakMinutes: 30, AfterHours: 5}}
	placed := PlaceBreaksForDemand(inputs, prayers, demand, 0.34, clearPol)
	if len(placed) != 1 || placed[0].PrayerConflict != nil {
		t.Fatalf("got %+v, want no prayer cut", placed)
	}
}

func TestPlaceBreaksForDemand_NoDemandStillSpreads(t *testing.T) {
	inputs := []BreakInput{
		{Key: "a", StartMin: 0, EndMin: 480, BreakMinutes: 30, AfterHours: 5},
		{Key: "b", StartMin: 0, EndMin: 480, BreakMinutes: 30, AfterHours: 5},
		{Key: "c", StartMin: 0, EndMin: 480, BreakMinutes: 30, AfterHours: 5},
	}
	placed := PlaceBreaksForDemand(inputs, nil, nil, 0.34, clearPol)
	starts := map[int]bool{}
	for _, p := range placed {
		starts[p.StartMin] = true
	}
	if len(placed) != 3 || len(starts) != 3 {
		t.Fatalf("got %+v, want 3 distinct slots", placed)
	}
}

func TestCoverageCostOf_CountsDemandPerAgentAway(t *testing.T) {
	demand := flatDemand(192, 0)
	demand[48], demand[49] = 2, 4
	inputs := []BreakInput{{Key: "a", StartMin: 360, EndMin: 900}, {Key: "b", StartMin: 360, EndMin: 900}}
	placed := []BreakPlacement{{Key: "a", StartMin: 720, EndMin: 750}}
	got := coverageCostOf(inputs, placed, demand, 0.34)
	if got.ExpectedCases != 3 || got.PeakShareAway != 0.5 || got.MaxShare != 0.34 || got.LostIntervals != 2 || got.MaxConcurrent != 1 {
		t.Fatalf("got %+v, want 3 cases, half away, share 0.34", got)
	}
}

func TestBreakMaxShare_DefaultAndBounds(t *testing.T) {
	if got := getBreakMaxShare(context.Background(), ""); got != defaultBreakShare {
		t.Fatalf("got %v, want the default %v", got, defaultBreakShare)
	}
	if breakCap(2, 0.34) != 1 || breakCap(6, 0.34) != 2 || breakCap(0, 0.34) != 1 {
		t.Fatal("break cap: at least 1, else floor of the share")
	}
}
