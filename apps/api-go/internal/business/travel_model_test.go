// SPDX-License-Identifier: AGPL-3.0-only

package business

import (
	"context"
	"math"
	"testing"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/settingsstore"
)

func TestTravelModelDefaultsAndValidation(t *testing.T) {
	settingsstore.ResetForTest()
	t.Cleanup(settingsstore.ReloadForTest)
	const tenant = "t"
	if got := getTravelModel(context.Background(), tenant); got != (travelModel{40, 1.3}) {
		t.Fatalf("default: got %+v", got)
	}
	cases := []struct {
		speed, detour any
		want          travelModel
	}{
		{35, 1.2, travelModel{35, 1.2}},
		{200, 3, travelModel{200, 3}},
		{0, 0.9, travelModel{40, 1.3}},
		{-5, 3.5, travelModel{40, 1.3}},
		{201, "x", travelModel{40, 1.3}},
		{"fast", 1, travelModel{40, 1}},
	}
	for _, c := range cases {
		if err := settingsstore.Put(context.Background(), tenant, travelSpeedKey, c.speed); err != nil {
			t.Fatal(err)
		}
		if err := settingsstore.Put(context.Background(), tenant, travelDetourKey, c.detour); err != nil {
			t.Fatal(err)
		}
		if got := getTravelModel(context.Background(), tenant); got != c.want {
			t.Errorf("%v/%v: got %+v, want %+v", c.speed, c.detour, got, c.want)
		}
	}
}

func TestTravelModelReachAndMinutes(t *testing.T) {
	m := travelModel{40, 1.3}
	r := m.reachMetres(600)
	if math.Abs(r-5128.205) > 0.01 {
		t.Fatalf("reach: got %v", r)
	}
	if got := m.minutesFor(r); math.Abs(got-10) > 1e-9 {
		t.Fatalf("minutes: got %v", got)
	}
	if got := m.minutesFor(4500); math.Abs(got-8.775) > 1e-9 {
		t.Fatalf("4500 m: got %v", got)
	}
}
