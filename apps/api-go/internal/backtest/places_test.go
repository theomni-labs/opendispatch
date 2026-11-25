// SPDX-License-Identifier: AGPL-3.0-only

package backtest

import (
	"math/rand"
	"testing"
	"time"
)

func nearShare(p *Places, sub string, k spotKind, at time.Time, n int) float64 {
	r := rand.New(rand.NewSource(5))
	var s spot
	for _, x := range p.spots[sub] {
		if x.kind == k {
			s = x
		}
	}
	hit := 0
	for i := 0; i < n; i++ {
		lat, lon, _ := p.Point(sub, at, r)
		if distanceKm(s.lat, s.lon, lat, lon) < 0.25 {
			hit++
		}
	}
	return float64(hit) / float64(n)
}

func TestPlacesStayInsideTheSubZoneAndMoveByHour(t *testing.T) {
	c := [2]float64{24.71, 46.68}
	p := NewPlaces(map[string][2]float64{"s1": c})
	r := rand.New(rand.NewSource(1))
	start := time.Date(2026, 9, 13, 0, 0, 0, 0, loc)
	for i := 0; i < 5000; i++ {
		lat, lon, ok := p.Point("s1", start.Add(time.Duration(i)*7*time.Minute), r)
		if !ok || distanceKm(c[0], c[1], lat, lon) > PlaceRadiusKm+1e-3 {
			t.Fatalf("point %v,%v is outside the sub-zone", lat, lon)
		}
	}
	sunday8 := time.Date(2026, 9, 13, 8, 0, 0, 0, loc)
	sunday3 := time.Date(2026, 9, 13, 3, 0, 0, 0, loc)
	friday20 := time.Date(2026, 9, 18, 20, 0, 0, 0, loc)
	if j8, j3 := nearShare(p, "s1", spotJunction, sunday8, 4000), nearShare(p, "s1", spotJunction, sunday3, 4000); j8 < 2*j3 {
		t.Fatalf("the junction must be busier at 08:00 on a weekday: %.3f vs %.3f", j8, j3)
	}
	if mf, m8 := nearShare(p, "s1", spotMarket, friday20, 4000), nearShare(p, "s1", spotMarket, sunday8, 4000); mf < 2*m8 {
		t.Fatalf("the market must be busier on a Friday evening: %.3f vs %.3f", mf, m8)
	}
	if _, _, ok := p.Point("unknown", sunday8, r); ok {
		t.Fatal("an unknown sub-zone has no position")
	}
	q := NewPlaces(map[string][2]float64{"s1": c})
	if q.spots["s1"][0] != p.spots["s1"][0] {
		t.Fatal("the spots must be fixed by the sub-zone id")
	}
}
