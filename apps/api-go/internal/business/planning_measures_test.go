// SPDX-License-Identifier: AGPL-3.0-only

package business

import (
	"fmt"
	"math"
	"testing"
	"time"
)

func cellsOf(date string, deltas ...int) []GapCell {
	out := make([]GapCell, len(deltas))
	for i, d := range deltas {
		kind := "balanced"
		if d > 0 {
			kind = "surplus"
		} else if d < 0 {
			kind = "gap"
		}
		out[i] = GapCell{IntervalStart: fmt.Sprintf("%sT%02d:%02d:00+03:00", date, (92+i)/4%24, (92+i)%4*15), Delta: d, Kind: kind}
	}
	return out
}

func TestSurplusWindows_RunsJoinAcrossMidnight(t *testing.T) {
	day1 := cellsOf("2026-09-14", 0, 2, 1, 3)
	day2 := []GapCell{
		{IntervalStart: "2026-09-15T00:00:00+03:00", Delta: 1, Kind: "surplus"},
		{IntervalStart: "2026-09-15T00:15:00+03:00", Delta: -1, Kind: "gap"},
		{IntervalStart: "2026-09-15T00:30:00+03:00", Delta: 4, Kind: "surplus"},
	}
	got := surplusWindows(append(day1, day2...))
	if len(got) != 2 {
		t.Fatalf("windows %+v", got)
	}
	w := got[0]
	if w.StartAt != "2026-09-14T23:15:00+03:00" || w.EndAt != "2026-09-15T00:15:00+03:00" || w.Minutes != 60 || w.PeakSurplus != 3 || w.SurplusAgentHours != 1.75 {
		t.Fatalf("first %+v", w)
	}
	if got[1].Minutes != 15 || got[1].SurplusAgentHours != 1 {
		t.Fatalf("second %+v", got[1])
	}
	z := OverCapacityZone{Windows: got}
	z.summarise()
	if z.WindowCount != 2 || z.LongestMinutes != 60 || z.PeakSurplus != 4 || z.SurplusAgentHours != 2.75 {
		t.Fatalf("zone %+v", z)
	}
}

func TestSurplusWindows_GapInDaysBreaksTheRun(t *testing.T) {
	cells := []GapCell{
		{IntervalStart: "2026-09-14T23:45:00+03:00", Delta: 1, Kind: "surplus"},
		{IntervalStart: "2026-09-16T00:00:00+03:00", Delta: 1, Kind: "surplus"},
	}
	if got := surplusWindows(cells); len(got) != 2 {
		t.Fatalf("a missing day joined two runs: %+v", got)
	}
	if got := surplusWindows(nil); got == nil || len(got) != 0 {
		t.Fatal("want an empty list, not nil")
	}
}

func TestZoneUtilization_ByShiftAndZone(t *testing.T) {
	bs, be := "2026-09-12T10:00:00+03:00", "2026-09-12T10:30:00+03:00"
	day := RosterAssignment{AgentID: "s1", ShiftPatternID: sp("day"), StartAt: "2026-09-12T06:00:00+03:00", EndAt: "2026-09-12T14:00:00+03:00", BreakStartAt: &bs, BreakEndAt: &be}
	night := RosterAssignment{AgentID: "s2", ShiftPatternID: sp("night"), StartAt: "2026-09-11T22:00:00+03:00", EndAt: "2026-09-12T06:00:00+03:00"}
	lines := []utilLine{toUtilLine(day), toUtilLine(night)}
	if lines[0].Hours != 7.5 || lines[1].Hours != 8 {
		t.Fatalf("hours %v %v", lines[0].Hours, lines[1].Hours)
	}
	at := func(s string) time.Time { v, _ := time.Parse(time.RFC3339, s); return v }
	cases := []workedCase{
		{AgentID: "s1", From: at("2026-09-12T07:00:00+03:00"), To: at("2026-09-12T08:00:00+03:00")},
		{AgentID: "s2", From: at("2026-09-12T01:00:00+03:00"), To: at("2026-09-12T01:30:00+03:00")},
		{AgentID: "s9", From: at("2026-09-12T09:00:00+03:00"), To: at("2026-09-12T10:00:00+03:00")},
	}
	z := zoneUtilization("z1", lines, cases, map[string]string{"day": "DAY-A", "night": "NIGHT"})
	if z.WorkedHours != 2.5 || z.AvailableHours != 15.5 || z.Share == nil || *z.Share != math.Round(2.5/15.5*1e4)/1e4 {
		t.Fatalf("zone %+v", z)
	}
	if len(z.Shifts) != 2 || z.Shifts[0].Code != "DAY-A" || z.Shifts[0].WorkedHours != 1 || z.Shifts[1].WorkedHours != 0.5 || *z.Shifts[1].Share != 0.0625 {
		t.Fatalf("shifts %+v", z.Shifts)
	}
	if empty := zoneUtilization("z2", nil, nil, nil); empty.Share != nil || empty.Shifts == nil {
		t.Fatalf("empty %+v", empty)
	}
}

func TestOverrideCounts_DistinctLinesAddsAndRemovals(t *testing.T) {
	a, b := "line-a", "line-b"
	lines := []RosterAssignment{{}, {}, {}, {}}
	got := []Override{
		{ChangeType: "replace_agent", RosterAssignmentID: &a},
		{ChangeType: "change_vehicle", RosterAssignmentID: &a},
		{ChangeType: "remove_assignment", RosterAssignmentID: &b},
		{ChangeType: "add_assignment"},
	}
	n, o := overrideCounts(lines, got)
	if n != 5 || o != 3 {
		t.Fatalf("assignments %d overridden %d, want 5 and 3", n, o)
	}
	r := OverrideRateRow{Assignments: n, Overridden: o}
	r.setShare()
	if r.Share == nil || *r.Share != 0.6 {
		t.Fatalf("share %v", r.Share)
	}
	empty := OverrideRateRow{}
	empty.setShare()
	if empty.Share != nil {
		t.Fatal("no assignments must give a null share")
	}
}
