// SPDX-License-Identifier: AGPL-3.0-only

package business

import (
	"context"
	"testing"
	"time"
)

func TestZoneUtilization_CasesPerAgentShiftAndBaseline(t *testing.T) {
	day := RosterAssignment{AgentID: "s1", ShiftPatternID: sp("day"), StartAt: "2026-09-12T06:00:00+03:00", EndAt: "2026-09-12T14:00:00+03:00"}
	day2 := RosterAssignment{AgentID: "s3", ShiftPatternID: sp("day"), StartAt: "2026-09-12T06:00:00+03:00", EndAt: "2026-09-12T14:00:00+03:00"}
	night := RosterAssignment{AgentID: "s2", ShiftPatternID: sp("night"), StartAt: "2026-09-11T22:00:00+03:00", EndAt: "2026-09-12T06:00:00+03:00"}
	lines := []utilLine{toUtilLine(day), toUtilLine(day2), toUtilLine(night)}
	at := func(s string) time.Time { v, _ := time.Parse(time.RFC3339, s); return v }
	cases := []workedCase{
		{AgentID: "s1", From: at("2026-09-12T07:00:00+03:00"), To: at("2026-09-12T09:00:00+03:00")},
		{AgentID: "s1", From: at("2026-09-12T10:00:00+03:00"), To: at("2026-09-12T11:00:00+03:00")},
		{AgentID: "s3", From: at("2026-09-12T12:00:00+03:00"), To: at("2026-09-12T13:00:00+03:00")},
		{AgentID: "s2", From: at("2026-09-12T01:00:00+03:00"), To: at("2026-09-12T02:00:00+03:00")},
	}
	codes := map[string]string{"day": "DAY-A", "night": "NIGHT"}
	z := zoneUtilization("z1", lines, cases, codes)
	if z.Cases != 4 || z.AgentShifts != 3 || *z.CasesPerAgentShift != 1.33 {
		t.Fatalf("zone cases %d shifts %d per %v", z.Cases, z.AgentShifts, *z.CasesPerAgentShift)
	}
	if s := z.Shifts[0]; s.Code != "DAY-A" || s.Cases != 3 || s.AgentShifts != 2 || *s.CasesPerAgentShift != 1.5 {
		t.Fatalf("day shift %+v", s)
	}
	base := zoneUtilization("z1", lines, cases[:2], codes)
	z.withBaseline(&base, nil)
	// 5 h of 24 now, 3 h of 24 then
	if *z.BaselineShare != 0.125 || *z.ChangePoints != 8.3 {
		t.Fatalf("zone baseline %v change %v", *z.BaselineShare, *z.ChangePoints)
	}
	if s := z.Shifts[1]; s.Code != "NIGHT" || *s.BaselineShare != 0 || *s.ChangePoints != 12.5 {
		t.Fatalf("night against nothing worked: %+v", s)
	}
	v := 0.2
	z.withBaseline(nil, &v)
	if *z.ChangePoints != 0.8 || *z.Shifts[0].ChangePoints != 5 {
		t.Fatalf("against an imported share: zone %v day %v", *z.ChangePoints, *z.Shifts[0].ChangePoints)
	}
	if pointsBetween(nil, &v) != nil || perShift(3, 0) != nil {
		t.Fatal("no share, no change; no shifts, no rate")
	}
}

func TestKPISettings_Validated(t *testing.T) {
	ok := []map[string]any{
		{"method": "value", "share": 0.31},
		{"method": "period", "date_from": "2026-07-12", "date_to": "2026-08-08"},
	}
	for _, v := range ok {
		if err := validKPISetting(utilBaselineKey, v); err != nil {
			t.Fatalf("%v: %v", v, err)
		}
	}
	bad := []any{"last month", map[string]any{"method": "value"}, map[string]any{"method": "value", "share": 1.5},
		map[string]any{"method": "period", "date_from": "2026-07-01", "date_to": "2026-08-31"},
		map[string]any{"method": "period", "date_from": "2026-08-08", "date_to": "2026-07-12"}, map[string]any{"method": "guess"}}
	for _, v := range bad {
		if validKPISetting(utilBaselineKey, v) == nil {
			t.Fatalf("%v accepted", v)
		}
	}
	if validKPISetting(utilTargetKey, 10.0) != nil || validKPISetting(utilTargetKey, 0.0) == nil {
		t.Fatal("target points: above 0, at most 100")
	}
}

func TestUtilizationBaseline_SettingWins(t *testing.T) {
	resetSettings(t)
	putSetting(t, utilBaselineKey, map[string]any{"method": "value", "share": 0.25})
	putSetting(t, utilTargetKey, 12.0)
	b, err := utilizationBaseline(context.Background(), nil, "")
	if err != nil || b.Method != baselineValue || *b.Share != 0.25 || b.TargetPoints != 12 || !b.FromSetting {
		t.Fatalf("baseline %+v %v", b, err)
	}
	putSetting(t, utilBaselineKey, map[string]any{"method": "period", "date_from": "2026-07-12", "date_to": "2026-08-08"})
	b, err = utilizationBaseline(context.Background(), nil, "")
	if err != nil || b.Method != baselinePeriod || *b.DateFrom != "2026-07-12" || *b.DateTo != "2026-08-08" || b.Share != nil {
		t.Fatalf("period %+v %v", b, err)
	}
}
