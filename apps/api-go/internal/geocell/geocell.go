// SPDX-License-Identifier: AGPL-3.0-only

// Package geocell: geohash micro-cells.
package geocell

import (
	"fmt"
	"math"
)

const alphabet = "0123456789bcdefghjkmnpqrstuvwxyz"

// Precision range the contract allows.
const (
	MinPrecision = 5
	MaxPrecision = 8
)

// Bits: latitude and longitude bits.
func Bits(precision int) (latBits, lonBits int) {
	total := 5 * precision
	return total / 2, total - total/2
}

// Index: the cell row and column of a point.
func Index(lat, lon float64, precision int) (int64, int64) {
	lb, ob := Bits(precision)
	return scaled(lat, -90, 180, lb), scaled(lon, -180, 360, ob)
}

func scaled(v, lo, span float64, bits int) int64 {
	n := int64(1) << bits
	i := int64(math.Floor((v - lo) / span * float64(n)))
	return min(max(i, 0), n-1)
}

// FromIndex: the geohash of a row and column.
func FromIndex(latIdx, lonIdx int64, precision int) string {
	lb, ob := Bits(precision)
	out := make([]byte, precision)
	li, oi := lb, ob
	for c := 0; c < precision; c++ {
		v := 0
		for b := 0; b < 5; b++ {
			bit := int64(0)
			if (c*5+b)%2 == 0 {
				oi--
				bit = (lonIdx >> oi) & 1
			} else {
				li--
				bit = (latIdx >> li) & 1
			}
			v = v<<1 | int(bit)
		}
		out[c] = alphabet[v]
	}
	return string(out)
}

// Encode: the geohash of a point.
func Encode(lat, lon float64, precision int) string {
	la, lo := Index(lat, lon, precision)
	return FromIndex(la, lo, precision)
}

// Box: a cell's corners.
type Box struct {
	South, West, North, East float64
}

// Decode: the bounds of a geohash cell.
func Decode(cell string) (Box, error) {
	var latIdx, lonIdx int64
	var lb, ob int
	for c := 0; c < len(cell); c++ {
		v := -1
		for i := 0; i < len(alphabet); i++ {
			if alphabet[i] == cell[c] {
				v = i
				break
			}
		}
		if v < 0 {
			return Box{}, fmt.Errorf("geocell: %q is not a geohash", cell)
		}
		for b := 4; b >= 0; b-- {
			bit := int64(v>>b) & 1
			if (c*5+4-b)%2 == 0 {
				lonIdx, ob = lonIdx<<1|bit, ob+1
			} else {
				latIdx, lb = latIdx<<1|bit, lb+1
			}
		}
	}
	dLat, dLon := 180/float64(int64(1)<<lb), 360/float64(int64(1)<<ob)
	s, w := -90+float64(latIdx)*dLat, -180+float64(lonIdx)*dLon
	return Box{South: s, West: w, North: s + dLat, East: w + dLon}, nil
}
