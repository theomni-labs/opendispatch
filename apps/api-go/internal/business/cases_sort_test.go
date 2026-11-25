// SPDX-License-Identifier: AGPL-3.0-only

package business

import (
	"fmt"
	"math/rand"
	"reflect"
	"sort"
	"testing"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"
)

// The order before the keys were parsed once.
func sortCasesNewestReference(out []Case) {
	sort.SliceStable(out, func(i, j int) bool {
		ti, _ := datactx.EpochOf(out[i].RegisteredAt)
		tj, _ := datactx.EpochOf(out[j].RegisteredAt)
		if !ti.Equal(tj) {
			return ti.After(tj)
		}
		return out[i].ID < out[j].ID
	})
}

func TestSortCasesNewestKeepsTheOrderItHad(t *testing.T) {
	r := rand.New(rand.NewSource(7))
	stamps := []string{"2026-09-13T08:00:00+03:00", "2026-09-13T05:00:00Z", "2026-09-12T23:59:59+03:00", "not a time", "2026-09-14T00:00:00+03:00"}
	for round := 0; round < 50; round++ {
		n := r.Intn(200)
		cases := make([]Case, n)
		for i := range cases {
			cases[i] = Case{ID: fmt.Sprintf("c%03d", r.Intn(40)), RegisteredAt: stamps[r.Intn(len(stamps))], CaseNumber: fmt.Sprint(i)}
		}
		want := append([]Case(nil), cases...)
		sortCasesNewestReference(want)
		sortCasesNewest(cases)
		if !reflect.DeepEqual(cases, want) {
			t.Fatalf("round %d: the order changed", round)
		}
	}
}
