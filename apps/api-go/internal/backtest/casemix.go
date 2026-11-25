// SPDX-License-Identifier: AGPL-3.0-only

package backtest

import (
	"fmt"
	"math/rand"
)

// Case type names, as in the fixtures.
const (
	TypeCustomer = "Standard case"
	TypePolice   = "Police attended"
	TypeUnlisted = "Unlisted"
)

// typeMix: share and field share (calibration.json).
var typeMix = []struct {
	name         string
	share, field float64
}{{TypeCustomer, 0.853, 0.51}, {TypePolice, 0.047, 0.85}, {TypeUnlisted, 0.1, 1}}

// partiesCum: calibration.json parties_distribution.
var partiesCum = []struct {
	n   int
	cum float64
}{{0, 0.001}, {1, 0.006}, {2, 0.943}, {3, 0.988}, {4, 0.996}, {5, 0.999}, {6, 1}}

// CaseMix picks a SYNTHETIC type and parties.
type CaseMix struct {
	field, remote []weighted
}

type weighted struct {
	id  string
	cum float64
}

// NewCaseMix: P(type | handling) by Bayes.
func NewCaseMix(ids map[string]string) (*CaseMix, error) {
	var fieldW, remoteW []float64
	var names []string
	for _, t := range typeMix {
		if ids[t.name] == "" {
			return nil, fmt.Errorf("case type %q not found: load the fixtures first", t.name)
		}
		names = append(names, t.name)
		fieldW = append(fieldW, t.share*t.field)
		remoteW = append(remoteW, t.share*(1-t.field))
	}
	return &CaseMix{field: cumulative(names, fieldW, ids), remote: cumulative(names, remoteW, ids)}, nil
}

func cumulative(names []string, w []float64, ids map[string]string) []weighted {
	total := 0.0
	for _, x := range w {
		total += x
	}
	var out []weighted
	acc := 0.0
	for i, x := range w {
		if x <= 0 {
			continue
		}
		acc += x / total
		out = append(out, weighted{id: ids[names[i]], cum: acc})
	}
	out[len(out)-1].cum = 1
	return out
}

// Type draws a type given the handling.
func (c *CaseMix) Type(field bool, r *rand.Rand) string {
	ws := c.remote
	if field {
		ws = c.field
	}
	x := r.Float64()
	for _, w := range ws {
		if x < w.cum {
			return w.id
		}
	}
	return ws[len(ws)-1].id
}

// Parties draws the number of parties.
func Parties(r *rand.Rand) int {
	x := r.Float64()
	for _, p := range partiesCum {
		if x < p.cum {
			return p.n
		}
	}
	return 2
}
