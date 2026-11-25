// SPDX-License-Identifier: AGPL-3.0-only

package geocell

import "testing"

func TestEncodeKnownGeohashes(t *testing.T) {
	cases := []struct {
		lat, lon float64
		p        int
		want     string
	}{
		{57.64911, 10.40744, 8, "u4pruydq"},
		{42.6, -5.6, 5, "ezs42"},
		{-25.382708, -49.265506, 8, "6gkzwgjz"},
		{0, 0, 5, "s0000"},
		{-90, -180, 5, "00000"},
		{90, 180, 5, "zzzzz"},
	}
	for _, c := range cases {
		if got := Encode(c.lat, c.lon, c.p); got != c.want {
			t.Errorf("Encode(%v, %v, %d) = %q, want %q", c.lat, c.lon, c.p, got, c.want)
		}
	}
}

func TestDecodeContainsThePointAndRoundTrips(t *testing.T) {
	for p := MinPrecision; p <= MaxPrecision; p++ {
		for _, pt := range [][2]float64{{24.7136, 46.6753}, {21.4858, 39.1925}, {26.4207, 50.0888}} {
			cell := Encode(pt[0], pt[1], p)
			b, err := Decode(cell)
			if err != nil {
				t.Fatal(err)
			}
			if pt[0] < b.South || pt[0] >= b.North || pt[1] < b.West || pt[1] >= b.East {
				t.Fatalf("%s at %d: box %+v misses %v", cell, p, b, pt)
			}
			if again := Encode((b.South+b.North)/2, (b.West+b.East)/2, p); again != cell {
				t.Fatalf("centre of %s encodes to %s", cell, again)
			}
		}
	}
	if _, err := Decode("abc"); err == nil {
		t.Fatal("a is not in the geohash alphabet")
	}
}

func TestCellSizes(t *testing.T) {
	b6, _ := Decode(Encode(24.7, 46.7, 6))
	b7, _ := Decode(Encode(24.7, 46.7, 7))
	if h := (b6.North - b6.South) * 111; h < 0.5 || h > 0.7 {
		t.Fatalf("precision 6 is %.2f km tall, want about 0.6", h)
	}
	if w := (b7.East - b7.West) * 101; w < 0.1 || w > 0.2 {
		t.Fatalf("precision 7 is %.2f km wide, want about 0.14", w)
	}
}
