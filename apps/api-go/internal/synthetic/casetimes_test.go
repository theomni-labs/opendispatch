// SPDX-License-Identifier: AGPL-3.0-only

package synthetic

import (
	"math/rand"
	"sort"
	"testing"
)

func median(xs []float64) float64 {
	sort.Float64s(xs)
	return xs[len(xs)/2]
}

func TestCaseTimesFollowTheCalibration(t *testing.T) {
	ct, err := NewCaseTimes()
	if err != nil {
		t.Fatal(err)
	}
	r := rand.New(rand.NewSource(7))
	var assigned, travel, closing []float64
	early := 0
	for i := 0; i < 20000; i++ {
		d := ct.Draw(r, true, false)
		if !d.Assigned || d.AssignedBeforeRegistration {
			t.Fatalf("field Customer case: %+v", d)
		}
		if !(d.AssignedMin > 0 && d.ArrivedMin > d.AssignedMin && d.ClosedMin > d.ArrivedMin) {
			t.Fatalf("times out of order: %+v", d)
		}
		assigned = append(assigned, d.AssignedMin)
		travel = append(travel, d.ArrivedMin-d.AssignedMin)
		closing = append(closing, d.ClosedMin-d.ArrivedMin)
		if u := ct.Draw(r, true, true); u.AssignedBeforeRegistration {
			early++
			if u.AssignedMin >= 0 {
				t.Fatalf("early assignment not before registration: %+v", u)
			}
		}
	}
	for name, got := range map[string][2]float64{
		"registered to assigned": {median(assigned), ct.cal.RegisteredToAssignedMedianMin},
		"assigned to arrived":    {median(travel), ct.cal.AssignedToArrivedMedianMin},
		"arrived to closed":      {median(closing), ct.cal.ArrivedToClosedMedianMin},
	} {
		if got[0] < got[1]*0.9 || got[0] > got[1]*1.1 {
			t.Errorf("%s median %.2f, calibration %.2f", name, got[0], got[1])
		}
	}
	if share := float64(early) / 20000; share < 0.04 || share > 0.08 {
		t.Errorf("Unlisted assigned-before-registration share %.3f", share)
	}
	remote := ct.Draw(r, false, false)
	if remote.Assigned || remote.ClosedMin < 16 {
		t.Errorf("remote case: %+v", remote)
	}
}
