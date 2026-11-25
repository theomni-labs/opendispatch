// SPDX-License-Identifier: AGPL-3.0-only

package business

import (
	"fmt"
	"testing"
)

func dayCases(zone string, field, remote int) []simDayCase {
	var out []simDayCase
	for i := 0; i < field+remote; i++ {
		h := "field"
		if i >= field {
			h = "remote_inferred"
		}
		out = append(out, simDayCase{ID: fmt.Sprintf("%s-%03d", zone, i), ZoneID: zone, Handling: h})
	}
	return out
}

func countHandling(cases []simDayCase, zone, handling string) int {
	n := 0
	for _, c := range cases {
		if c.ZoneID == zone && c.Handling == handling {
			n++
		}
	}
	return n
}

func TestUnsupportedAdjustmentsAreNamed(t *testing.T) {
	s := Scenario{Adjustments: ScenarioAdjustments{HeadcountDelta: []HeadcountDelta{
		{ZoneID: "z1", FieldAgents: 3}, {ZoneID: "z2", RemoteAgents: 2, Vehicles: -1}}}}
	got := unsupportedAdjustments(s)
	if len(got) != 2 || got[0].Code != "unsupported_adjustment" || *got[0].ZoneID != "z2" || *got[1].ZoneID != "z2" {
		t.Fatalf("got %+v, want remote and vehicle changes of z2 only", got)
	}
	if len(unsupportedAdjustments(Scenario{})) != 0 {
		t.Fatal("an empty scenario has nothing unsupported")
	}
}

func TestRemoteShareMovesTheSplitDeterministically(t *testing.T) {
	cases := append(dayCases("a", 8, 2), dayCases("b", 5, 5)...)
	out, flipped := applyRemoteShare(cases, 0.5)
	if countHandling(out, "a", "field") != 5 || countHandling(out, "b", "field") != 5 || flipped != 3 {
		t.Fatalf("got a=%d b=%d flipped=%d, want 5, 5 and 3", countHandling(out, "a", "field"), countHandling(out, "b", "field"), flipped)
	}
	if countHandling(cases, "a", "field") != 8 {
		t.Fatal("the input was changed")
	}
	again, _ := applyRemoteShare(cases, 0.5)
	for i := range out {
		if out[i] != again[i] {
			t.Fatal("the same input gave a different split")
		}
	}
	more, _ := applyRemoteShare(cases, 0)
	if countHandling(more, "a", "field") != 10 {
		t.Fatalf("got %d field cases, want all 10 when nothing is remote", countHandling(more, "a", "field"))
	}
}

func TestThinCasesKeepsOrderAndIsStable(t *testing.T) {
	cases := dayCases("a", 30, 0)
	got := thinCases(cases, 10)
	if len(got) != 10 {
		t.Fatalf("got %d cases, want 10", len(got))
	}
	for i := 1; i < len(got); i++ {
		if got[i-1].ID >= got[i].ID {
			t.Fatal("order was not kept")
		}
	}
	again := thinCases(cases, 10)
	for i := range got {
		if got[i].ID != again[i].ID {
			t.Fatal("thinning is not deterministic")
		}
	}
	if len(thinCases(cases, 50)) != 30 {
		t.Fatal("a small day must not be thinned")
	}
}
