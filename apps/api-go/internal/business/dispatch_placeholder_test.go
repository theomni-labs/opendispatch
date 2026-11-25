// SPDX-License-Identifier: AGPL-3.0-only

// Placeholder ranking: same as the full sort.
package business

import (
	"fmt"
	"math/rand"
	"reflect"
	"sort"
	"testing"
	"time"
)

// placeholderOrderBefore: the old full sort.
func placeholderOrderBefore(c Case, states []liveAgent, n int) []string {
	type cand struct {
		s  liveAgent
		km float64
	}
	var cands []cand
	for _, s := range states {
		if s.Kind != "field" || s.Status != "available" || s.Lat == nil || s.Lon == nil {
			continue
		}
		cands = append(cands, cand{s, haversineKm(c.Latitude, c.Longitude, *s.Lat, *s.Lon)})
	}
	sort.SliceStable(cands, func(i, j int) bool {
		if cands[i].km != cands[j].km {
			return cands[i].km < cands[j].km
		}
		return cands[i].s.Code < cands[j].s.Code
	})
	if len(cands) > n {
		cands = cands[:n]
	}
	out := []string{}
	for _, k := range cands {
		out = append(out, k.s.ID)
	}
	return out
}

func randomStates(r *rand.Rand, count int) []liveAgent {
	kinds := []string{"field", "field", "field", "remote"}
	statuses := []string{"available", "available", "en_route", "on_scene"}
	var out []liveAgent
	for i := 0; i < count; i++ {
		// Coarse grid and repeated codes: many ties.
		lat, lon := 24.6+float64(r.Intn(6))*0.01, 46.6+float64(r.Intn(6))*0.01
		s := liveAgent{ID: fmt.Sprintf("s%03d", i), Code: fmt.Sprintf("C%02d", r.Intn(count/2+1)), Kind: kinds[r.Intn(len(kinds))], Status: statuses[r.Intn(len(statuses))], At: time.Unix(0, 0)}
		if r.Intn(10) > 0 {
			s.Lat, s.Lon = &lat, &lon
		}
		out = append(out, s)
	}
	return out
}

func TestPlaceholderRanking_SameOrderAsTheFullSort(t *testing.T) {
	r := rand.New(rand.NewSource(7))
	for round := 0; round < 400; round++ {
		states := randomStates(r, r.Intn(60))
		c := Case{ID: fmt.Sprintf("c%d", round), ZoneID: "z1", Latitude: 24.6 + r.Float64()*0.05, Longitude: 46.6 + r.Float64()*0.05, DataSource: "SYNTHETIC"}
		if round%9 == 0 {
			c.Latitude, c.Longitude = 24.62, 46.62
		}
		for _, n := range []int{1, placeholderMaxRanked, 100} {
			got := []string{}
			for _, k := range nearestAvailable(c, states, n) {
				got = append(got, k.s.ID)
			}
			if want := placeholderOrderBefore(c, states, n); !reflect.DeepEqual(got, want) {
				t.Fatalf("round %d n %d: got %v, want %v", round, n, got, want)
			}
		}
		out := placeholderRanking(c, states, 1_000_000)
		want := placeholderOrderBefore(c, states, placeholderMaxRanked)
		if len(out.Ranking) != len(want) {
			t.Fatalf("round %d: %d ranked, want %d", round, len(out.Ranking), len(want))
		}
		for i, rk := range out.Ranking {
			if rk.AgentID != want[i] || rk.Rank != i+1 {
				t.Fatalf("round %d rank %d: got %s, want %s", round, i, rk.AgentID, want[i])
			}
		}
	}
}
