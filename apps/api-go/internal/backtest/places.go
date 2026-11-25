// SPDX-License-Identifier: AGPL-3.0-only

package backtest

import (
	"hash/fnv"
	"math"
	"math/rand"
	"time"
)

// PlacesNotice labels the made-up case positions.
const PlacesNotice = "SYNTHETIC case positions: made-up hot spots (a junction, a highway stretch, a market) around each sub-zone's centre; no real place is copied or derived."

// PlaceRadiusKm: the made-up sub-zone radius.
const PlaceRadiusKm = 1.2

const kmPerDegLat = 111.32

// spotKind is a made-up kind of place.
type spotKind int

const (
	spotJunction spotKind = iota
	spotHighway
	spotMarket
)

type spot struct {
	kind     spotKind
	lat, lon float64
	// heading of the highway, radians
	heading float64
}

// Places: made-up spots per sub-zone.
type Places struct {
	centre map[string][2]float64
	spots  map[string][]spot
}

// NewPlaces: spots fixed by each sub-zone's id.
func NewPlaces(centres map[string][2]float64) *Places {
	p := &Places{centre: map[string][2]float64{}, spots: map[string][]spot{}}
	for id, c := range centres {
		h := fnv.New64a()
		_, _ = h.Write([]byte(id))
		r := rand.New(rand.NewSource(int64(h.Sum64())))
		p.centre[id] = c
		for _, k := range []spotKind{spotJunction, spotHighway, spotMarket} {
			lat, lon := offset(c[0], c[1], 0.3+0.6*r.Float64(), 2*math.Pi*r.Float64())
			p.spots[id] = append(p.spots[id], spot{kind: k, lat: lat, lon: lon, heading: math.Pi * r.Float64()})
		}
	}
	return p
}

// offset moves a point by km along a bearing.
func offset(lat, lon, km, bearing float64) (float64, float64) {
	dLat := km * math.Cos(bearing) / kmPerDegLat
	dLon := km * math.Sin(bearing) / (kmPerDegLat * math.Cos(lat*math.Pi/180))
	return lat + dLat, lon + dLon
}

func distanceKm(lat1, lon1, lat2, lon2 float64) float64 {
	dy := (lat2 - lat1) * kmPerDegLat
	dx := (lon2 - lon1) * kmPerDegLat * math.Cos(lat1*math.Pi/180)
	return math.Hypot(dx, dy)
}

// dayGroupOf: the Saudi day group.
func dayGroupOf(t time.Time) string {
	switch t.Weekday() {
	case time.Thursday:
		return "thursday"
	case time.Friday:
		return "friday"
	case time.Saturday:
		return "saturday"
	}
	return "weekday"
}

// spotWeight: busyness by hour and day group.
func spotWeight(k spotKind, hour int, group string) float64 {
	workday := group == "weekday" || group == "thursday"
	switch k {
	case spotJunction:
		if workday && ((hour >= 6 && hour <= 9) || (hour >= 15 && hour <= 18)) {
			return 1.6
		}
		return 0.3
	case spotHighway:
		if hour >= 22 || hour <= 3 || (group == "thursday" && hour >= 18) {
			return 1.4
		}
		return 0.6
	default:
		w := 0.15
		if hour >= 17 && hour <= 23 {
			w = 1.0
		}
		if group == "friday" || group == "saturday" {
			w *= 1.6
		}
		return w
	}
}

// Point: a made-up position for a case at a time.
func (p *Places) Point(subZoneID string, at time.Time, r *rand.Rand) (float64, float64, bool) {
	c, ok := p.centre[subZoneID]
	if !ok {
		return 0, 0, false
	}
	local := at.In(loc)
	hour, group := local.Hour(), dayGroupOf(local)
	spots := p.spots[subZoneID]
	weights := []float64{1}
	total := 1.0
	for _, s := range spots {
		w := spotWeight(s.kind, hour, group)
		weights = append(weights, w)
		total += w
	}
	pick, x := 0, r.Float64()*total
	for i, w := range weights {
		if x < w {
			pick = i
			break
		}
		x -= w
	}
	for try := 0; try < 8; try++ {
		lat, lon := p.draw(c, spots, pick, r)
		if distanceKm(c[0], c[1], lat, lon) <= PlaceRadiusKm {
			return round6(lat), round6(lon), true
		}
	}
	return round6(c[0]), round6(c[1]), true
}

func (p *Places) draw(c [2]float64, spots []spot, pick int, r *rand.Rand) (float64, float64) {
	if pick == 0 {
		return offset(c[0], c[1], PlaceRadiusKm*math.Sqrt(r.Float64()), 2*math.Pi*r.Float64())
	}
	s := spots[pick-1]
	switch s.kind {
	case spotHighway:
		lat, lon := offset(s.lat, s.lon, 0.7*(2*r.Float64()-1), s.heading)
		return offset(lat, lon, 0.04*r.NormFloat64(), s.heading+math.Pi/2)
	case spotJunction:
		return offset(s.lat, s.lon, math.Abs(0.08*r.NormFloat64()), 2*math.Pi*r.Float64())
	default:
		return offset(s.lat, s.lon, math.Abs(0.12*r.NormFloat64()), 2*math.Pi*r.Float64())
	}
}

func round6(v float64) float64 { return math.Round(v*1e6) / 1e6 }
