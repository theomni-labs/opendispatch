// SPDX-License-Identifier: AGPL-3.0-only

// Ports gen/rng.ts: seeded randomness, deterministic
// by construction. No wall clock, no math/rand.
package synthetic

import "math"

// mulberry32: Tommy Ettinger's 32-bit generator.
func mulberry32(seed uint32) func() float64 {
	a := seed
	return func() float64 {
		a += 0x6d2b79f5
		t := a
		t = (t ^ (t >> 15)) * (1 | t)
		t = (t + (t^(t>>7))*(61|t)) ^ t
		return float64(t^(t>>14)) / 4294967296
	}
}

// hashSeed: the xmur3 mixer, a 32-bit hash of text.
func hashSeed(text string) uint32 {
	h := uint32(1779033703) ^ uint32(len(text))
	for i := 0; i < len(text); i++ {
		h ^= uint32(text[i])
		h *= 3432918353
		h = (h << 13) | (h >> 19)
	}
	h ^= h >> 16
	h *= 2246822507
	h ^= h >> 13
	h *= 3266489909
	return h ^ (h >> 16)
}

// hashWords: four 32-bit words from one string.
func hashWords(text string) [4]uint32 {
	return [4]uint32{
		hashSeed(text + "#0"), hashSeed(text + "#1"),
		hashSeed(text + "#2"), hashSeed(text + "#3"),
	}
}

func hex8(n uint32) string {
	const digits = "0123456789abcdef"
	b := make([]byte, 8)
	for i := 7; i >= 0; i-- {
		b[i] = digits[n&0xf]
		n >>= 4
	}
	return string(b)
}

// uuidFor: a stable v4-layout UUID for a record.
func uuidFor(seed, kind, key string) string {
	w := hashWords(seed + "|" + kind + "|" + key)
	h := hex8(w[0]) + hex8(w[1]) + hex8(w[2]) + hex8(w[3])
	variantNibble := hexNibble(h[16])
	variant := hex8((variantNibble & 0x3) | 0x8)[7:8]
	return h[0:8] + "-" + h[8:12] + "-4" + h[13:16] + "-" + variant + h[17:20] + "-" + h[20:32]
}

func hexNibble(c byte) uint32 {
	switch {
	case c >= '0' && c <= '9':
		return uint32(c - '0')
	case c >= 'a' && c <= 'f':
		return uint32(c-'a') + 10
	}
	return 0
}

// Rng: a random stream with the generator's helpers.
type Rng struct {
	label  string
	next01 func() float64
}

// newRng mirrors the Rng constructor.
func newRng(label, seedText string) *Rng {
	return &Rng{label: label, next01: mulberry32(hashSeed(seedText))}
}

// Fork: a new independent stream, named by purpose.
func (r *Rng) Fork(name string) *Rng {
	label := r.label + "/" + name
	return newRng(label, label)
}

// Next: float in [0, 1).
func (r *Rng) Next() float64 { return r.next01() }

// Float: float in [lo, hi).
func (r *Rng) Float(lo, hi float64) float64 {
	return lo + (hi-lo)*r.next01()
}

// Int: integer in [lo, hi], both inclusive.
func (r *Rng) Int(lo, hi int) int {
	return lo + int(math.Floor(r.next01()*float64(hi-lo+1)))
}

// Chance: true with probability p.
func (r *Rng) Chance(p float64) bool {
	return r.next01() < p
}

// Pick: a random element of items.
func Pick[T any](r *Rng, items []T) T {
	return items[int(math.Floor(r.next01()*float64(len(items))))]
}

// Pick: a random element of a string slice.
func (r *Rng) Pick(items []string) string {
	return Pick(r, items)
}

// WeightedIndex: an index chosen by non-negative
// weights.
func (r *Rng) WeightedIndex(weights []float64) int {
	total := 0.0
	for _, w := range weights {
		total += w
	}
	x := r.next01() * total
	for i, w := range weights {
		x -= w
		if x < 0 {
			return i
		}
	}
	return len(weights) - 1
}

// Normal: standard normal by Box-Muller.
func (r *Rng) Normal() float64 {
	u := 1 - r.next01()
	v := r.next01()
	return math.Sqrt(-2*math.Log(u)) * math.Cos(2*math.Pi*v)
}

// Shuffle: in-place Fisher-Yates.
func Shuffle[T any](r *Rng, items []T) []T {
	for i := len(items) - 1; i > 0; i-- {
		j := int(math.Floor(r.next01() * float64(i+1)))
		items[i], items[j] = items[j], items[i]
	}
	return items
}

// MakeRng: the root stream for a seed string.
func MakeRng(seed string) *Rng {
	return MakeRngNamed(seed, "root")
}

// MakeRngNamed mirrors makeRng(seed, name).
func MakeRngNamed(seed, name string) *Rng {
	label := seed + "/" + name
	return newRng(label, label)
}
