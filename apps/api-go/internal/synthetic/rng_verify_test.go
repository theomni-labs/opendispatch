// SPDX-License-Identifier: AGPL-3.0-only

// Verifies rng.go against real scripts/synthetic
// (gen/rng.ts) output, captured via tsx.
package synthetic

import (
	"math"
	"testing"
)

func almostEqual(a, b float64) bool {
	return math.Abs(a-b) < 1e-9
}

func TestHashSeed_MatchesTS(t *testing.T) {
	if got := hashSeed("hello"); got != 3588693721 {
		t.Fatalf("got %d, want 3588693721", got)
	}
	if got := hashSeed("opendispatch-synthetic-2026-09-v1/root"); got != 720409615 {
		t.Fatalf("got %d, want 720409615", got)
	}
}

func TestMulberry32_MatchesTS(t *testing.T) {
	want := []float64{0.7656168749090284, 0.4610842331312597, 0.5773812546394765, 0.5755103880073875}
	f := mulberry32(hashSeed("test"))
	for i, w := range want {
		if got := f(); !almostEqual(got, w) {
			t.Fatalf("draw %d: got %v, want %v", i, got, w)
		}
	}
}

func TestUuidFor_MatchesTS(t *testing.T) {
	want := "f3969d56-61e8-47f2-b6cb-b4cf5ab84c43"
	if got := uuidFor("opendispatch-synthetic-2026-09-v1", "case", "RD-260906-00001"); got != want {
		t.Fatalf("got %s, want %s", got, want)
	}
}

func TestRng_MatchesTS(t *testing.T) {
	r := MakeRngNamed("opendispatch-synthetic-2026-09-v1", "x")
	if got := r.Int(0, 9); got != 6 {
		t.Fatalf("int1: got %d, want 6", got)
	}
	if got := r.Int(0, 9); got != 5 {
		t.Fatalf("int2: got %d, want 5", got)
	}
	if got := r.Float(0, 1); !almostEqual(got, 0.45188910979777575) {
		t.Fatalf("float: got %v, want 0.45188910979777575", got)
	}
	if got := r.Normal(); !almostEqual(got, -0.24027927877330776) {
		t.Fatalf("normal: got %v, want -0.24027927877330776", got)
	}
}
