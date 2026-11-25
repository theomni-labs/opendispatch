// SPDX-License-Identifier: AGPL-3.0-only

// Ports gen/dist.ts: distributions and small
// numeric helpers. Pure math.
package synthetic

import (
	"fmt"
	"math"
	"sort"
)

// normalQuantile: inverse standard normal CDF
// (Acklam's rational approximation).
func normalQuantile(p float64) (float64, error) {
	if p <= 0 || p >= 1 {
		return 0, fmt.Errorf("normalQuantile: p must be in (0, 1), got %v", p)
	}
	a := [6]float64{-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239}
	b := [5]float64{-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1}
	c := [6]float64{-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783}
	d := [4]float64{7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416}
	const low = 0.02425
	if p < low {
		q := math.Sqrt(-2 * math.Log(p))
		return (((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q + c[5]) / ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q + 1), nil
	}
	if p > 1-low {
		q := math.Sqrt(-2 * math.Log(1-p))
		return -(((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q + c[5]) / ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q + 1), nil
	}
	q := p - 0.5
	r := q * q
	return ((((((a[0]*r+a[1])*r+a[2])*r+a[3])*r+a[4])*r + a[5]) * q) / (((((b[0]*r+b[1])*r+b[2])*r+b[3])*r+b[4])*r + 1), nil
}

// z90: the 90th-percentile z of a standard normal.
const z90 = 1.2815515655446004

// Lognormal mirrors Lognormal.
type Lognormal struct {
	Mu, Sigma float64
}

// lognormalFromMedianP90: the lognormal whose median
// and 90th percentile are the given values.
func lognormalFromMedianP90(median, p90 float64) (Lognormal, error) {
	if median <= 0 || p90 <= median {
		return Lognormal{}, fmt.Errorf("lognormalFromMedianP90: need 0 < median < p90")
	}
	return Lognormal{Mu: math.Log(median), Sigma: math.Log(p90/median) / z90}, nil
}

// lognormalQuantile: value of a lognormal at u.
func lognormalQuantile(u float64, dist Lognormal) (float64, error) {
	q, err := normalQuantile(u)
	if err != nil {
		return 0, err
	}
	return math.Exp(dist.Mu + dist.Sigma*q), nil
}

// stratifiedUniforms: n uniforms in (0,1), one from
// each of n equal strata, in random order.
func stratifiedUniforms(rng *Rng, n int) []float64 {
	out := make([]float64, n)
	for i := 0; i < n; i++ {
		out[i] = (float64(i) + rng.Next()) / float64(n)
	}
	return Shuffle(rng, out)
}

// apportion: splits total into integers in
// proportion to weights (largest remainder).
func apportion(total int, weights []float64) ([]int, error) {
	sum := 0.0
	for _, w := range weights {
		sum += w
	}
	if sum <= 0 {
		return nil, fmt.Errorf("apportion: weights must have a positive sum")
	}
	exact := make([]float64, len(weights))
	parts := make([]int, len(weights))
	partsSum := 0
	for i, w := range weights {
		exact[i] = (w / sum) * float64(total)
		parts[i] = int(math.Floor(exact[i]))
		partsSum += parts[i]
	}
	left := total - partsSum
	type frac struct {
		i int
		f float64
	}
	order := make([]frac, len(weights))
	for i, x := range exact {
		order[i] = frac{i: i, f: x - math.Floor(x)}
	}
	sort.SliceStable(order, func(p, q int) bool {
		if order[p].f != order[q].f {
			return order[p].f > order[q].f
		}
		return order[p].i < order[q].i
	})
	for _, o := range order {
		if left <= 0 {
			break
		}
		parts[o.i]++
		left--
	}
	return parts, nil
}

// clamp mirrors clamp.
func clamp(x, lo, hi float64) float64 {
	return math.Min(hi, math.Max(lo, x))
}

const earthRadiusKm = 6371.0088

// LatLng mirrors LatLng.
type LatLng struct {
	Lat, Lng float64
}

// haversineKm: great-circle distance in kilometres.
func haversineKm(a, b LatLng) float64 {
	rad := math.Pi / 180
	dLat := (b.Lat - a.Lat) * rad
	dLng := (b.Lng - a.Lng) * rad
	s := math.Pow(math.Sin(dLat/2), 2) + math.Cos(a.Lat*rad)*math.Cos(b.Lat*rad)*math.Pow(math.Sin(dLng/2), 2)
	return 2 * earthRadiusKm * math.Asin(math.Min(1, math.Sqrt(s)))
}

// offsetKm: a point dxKm east, dyKm north of origin.
func offsetKm(origin LatLng, dxKm, dyKm float64) LatLng {
	kmPerDegLat := 111.32
	kmPerDegLng := 111.32 * math.Cos((origin.Lat*math.Pi)/180)
	return LatLng{Lat: origin.Lat + dyKm/kmPerDegLat, Lng: origin.Lng + dxKm/kmPerDegLng}
}

// lerpLatLng: move from a towards b by fraction f.
func lerpLatLng(a, b LatLng, f float64) LatLng {
	return LatLng{Lat: a.Lat + (b.Lat-a.Lat)*f, Lng: a.Lng + (b.Lng-a.Lng)*f}
}
