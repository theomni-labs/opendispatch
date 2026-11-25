// SPDX-License-Identifier: AGPL-3.0-only

// Verifies AgentStateAt/AllAgentStatesAt
// against a recorded dump, at six
// moments across the demo day (2026-09-13): before
// shift, on-shift waiting, mid-morning (en_route/
// on_scene/returning mixed), afternoon, evening,
// late night. testdata/positions_ts.json holds the
// dump, captured from this package for the seed in
// scripts/synthetic/calibration.json (positions.ts
// lacks the dayplan travel-time coupling step).
package synthetic

import (
	"encoding/json"
	"os"
	"testing"
)

type tsAgentState struct {
	AgentID       string   `json:"agent_id"`
	Status        string   `json:"status"`
	Phase         string   `json:"phase"`
	Latitude      float64  `json:"latitude"`
	Longitude     float64  `json:"longitude"`
	PositionAt    string   `json:"position_at"`
	ZoneID        string   `json:"zone_id"`
	VehicleID     *string  `json:"vehicle_id"`
	CurrentCaseID *string  `json:"current_case_id"`
	SpeedKmh      float64  `json:"speed_kmh"`
	HeadingDeg    *float64 `json:"heading_deg"`
}

func loadPositionsFixture(t *testing.T) map[string][]tsAgentState {
	t.Helper()
	body, err := os.ReadFile("testdata/positions_ts.json")
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}
	var out map[string][]tsAgentState
	if err := json.Unmarshal(body, &out); err != nil {
		t.Fatalf("unmarshal fixture: %v", err)
	}
	return out
}

func strPtrEq(a *string, b *string) bool {
	if (a == nil) != (b == nil) {
		return false
	}
	return a == nil || *a == *b
}

func intPtrEq(a *int, b *int) bool {
	if (a == nil) != (b == nil) {
		return false
	}
	return a == nil || *a == *b
}

func agentStateEqual(a, b AgentState) bool {
	return a.AgentID == b.AgentID && a.Status == b.Status && a.Phase == b.Phase &&
		a.Latitude == b.Latitude && a.Longitude == b.Longitude && a.PositionAt == b.PositionAt &&
		a.ZoneID == b.ZoneID && strPtrEq(a.VehicleID, b.VehicleID) && strPtrEq(a.CurrentCaseID, b.CurrentCaseID) &&
		a.SpeedKmh == b.SpeedKmh && intPtrEq(a.HeadingDeg, b.HeadingDeg)
}

func TestAllAgentStatesAt_MatchesTS(t *testing.T) {
	fixture := loadPositionsFixture(t)
	moments := []string{
		"2026-09-13T02:00:00+03:00",
		"2026-09-13T06:05:00+03:00",
		"2026-09-13T09:10:00+03:00",
		"2026-09-13T13:45:00+03:00",
		"2026-09-13T18:00:00+03:00",
		"2026-09-13T23:30:00+03:00",
	}
	for _, m := range moments {
		want, ok := fixture[m]
		if !ok {
			t.Fatalf("no fixture data for %s", m)
		}
		got, err := AllAgentStatesAt(realSeed, m)
		if err != nil {
			t.Fatalf("%s: AllAgentStatesAt: %v", m, err)
		}
		if len(got) != len(want) {
			t.Fatalf("%s: count got %d want %d", m, len(got), len(want))
		}
		mismatches := 0
		for i, g := range got {
			w := want[i]
			ok := g.AgentID == w.AgentID && g.Status == w.Status && g.Phase == w.Phase &&
				g.Latitude == w.Latitude && g.Longitude == w.Longitude && g.PositionAt == w.PositionAt &&
				g.ZoneID == w.ZoneID && strPtrEq(g.VehicleID, w.VehicleID) && strPtrEq(g.CurrentCaseID, w.CurrentCaseID) &&
				g.SpeedKmh == w.SpeedKmh
			gHeading := (*float64)(nil)
			if g.HeadingDeg != nil {
				hf := float64(*g.HeadingDeg)
				gHeading = &hf
			}
			if (gHeading == nil) != (w.HeadingDeg == nil) || (gHeading != nil && w.HeadingDeg != nil && *gHeading != *w.HeadingDeg) {
				ok = false
			}
			if !ok {
				mismatches++
				if mismatches <= 5 {
					t.Errorf("%s case %d (%s): got %+v want %+v", m, i, g.AgentID, g, w)
				}
			}
		}
		if mismatches > 0 {
			t.Fatalf("%s: %d/%d agent states mismatched", m, mismatches, len(got))
		}
	}
}

func TestAgentStateAt_MatchesAllAgentStatesAt(t *testing.T) {
	// The single-agent and all-agents paths
	// must agree (both call stateFor).
	w, err := buildWorld(realSeed)
	if err != nil {
		t.Fatalf("buildWorld: %v", err)
	}
	moment := "2026-09-13T09:10:00+03:00"
	all, err := AllAgentStatesAt(realSeed, moment)
	if err != nil {
		t.Fatalf("AllAgentStatesAt: %v", err)
	}
	for i := 0; i < 10; i++ {
		s := w.Agents[i*30%len(w.Agents)]
		single, err := AgentStateAt(realSeed, s.ID, moment)
		if err != nil {
			t.Fatalf("AgentStateAt(%s): %v", s.ID, err)
		}
		var fromAll *AgentState
		for j := range all {
			if all[j].AgentID == s.ID {
				fromAll = &all[j]
				break
			}
		}
		if fromAll == nil {
			t.Fatalf("agent %s not found in AllAgentStatesAt", s.ID)
		}
		if !agentStateEqual(single, *fromAll) {
			t.Fatalf("mismatch for %s: single=%+v all=%+v", s.ID, single, *fromAll)
		}
	}
}
