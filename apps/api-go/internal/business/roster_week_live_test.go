// SPDX-License-Identifier: AGPL-3.0-only

// Week build, eligibility, net availability.
package business

import (
	"context"
	"math"
	"testing"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/access"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/dataerr"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/settingsstore"
)

const weekOf = "2026-09-13"

func TestAgentEligibilityAndAnnualLeave(t *testing.T) {
	conn := openConn(t)
	rc, _ := adminCtx(t)
	ctx := context.Background()
	resetRosterDeps()
	fx := seedRosterFixture(t, ctx, conn, rc)
	remote, err := CreateShiftPattern(ctx, conn, rc, map[string]any{
		"code": "REMOTE-1", "name_en": "Remote 1", "kind": "remote", "break_rule_id": fx.ruleID, "status": "active",
		"normal": map[string]any{"applies": true, "start_time": "08:00", "end_time": "16:00"}, "ramadan": map[string]any{"applies": false},
	})
	check(t, err)
	base := map[string]any{"code": "SUR-1", "name_en": "Agent One", "kind": "field", "home_zone_id": fx.zoneID}
	with := func(extra map[string]any) map[string]any {
		out := map[string]any{}
		for k, v := range base {
			out[k] = v
		}
		for k, v := range extra {
			out[k] = v
		}
		return out
	}
	s, err := UpdateAgent(ctx, conn, rc, fx.agent1, with(map[string]any{"eligible_shift_pattern_ids": []any{fx.patternID}, "annual_leave_days": 30.0}))
	check(t, err)
	if len(s.EligibleShiftPatternIDs) != 1 || s.EligibleShiftPatternIDs[0] != fx.patternID || s.AnnualLeaveDays == nil || *s.AnnualLeaveDays != 30 {
		t.Fatalf("got %+v", s)
	}
	kept, err := UpdateAgent(ctx, conn, rc, fx.agent1, with(map[string]any{"name_en": "Renamed"}))
	check(t, err)
	if len(kept.EligibleShiftPatternIDs) != 1 || kept.AnnualLeaveDays == nil {
		t.Fatalf("an update without the fields must keep them: %+v", kept)
	}
	read, err := GetAgent(ctx, conn, rc, fx.agent1)
	check(t, err)
	if len(read.EligibleShiftPatternIDs) != 1 || *read.AnnualLeaveDays != 30 {
		t.Fatalf("stored: %+v", read)
	}
	if _, err := UpdateAgent(ctx, conn, rc, fx.agent1, with(map[string]any{"eligible_shift_pattern_ids": []any{remote.ID}})); errCode(err) != dataerr.CodeInvalid {
		t.Fatalf("a remote pattern for a field agent: got %v, want Invalid", err)
	}
	if _, err := UpdateAgent(ctx, conn, rc, fx.agent1, with(map[string]any{"eligible_shift_pattern_ids": []any{datactx.NewID()}})); errCode(err) != dataerr.CodeNotFound {
		t.Fatalf("an unknown pattern: got %v, want NotFound", err)
	}
	if _, err := UpdateAgent(ctx, conn, rc, fx.agent1, with(map[string]any{"eligible_shift_pattern_ids": []any{}})); errCode(err) != dataerr.CodeInvalid {
		t.Fatalf("an empty list: got %v, want Invalid", err)
	}
	if _, err := UpdateAgent(ctx, conn, rc, fx.agent1, with(map[string]any{"annual_leave_days": 400.0})); errCode(err) != dataerr.CodeInvalid {
		t.Fatalf("400 days: got %v, want Invalid", err)
	}
	cleared, err := UpdateAgent(ctx, conn, rc, fx.agent1, with(map[string]any{"eligible_shift_pattern_ids": nil, "annual_leave_days": nil}))
	check(t, err)
	if cleared.EligibleShiftPatternIDs != nil || cleared.AnnualLeaveDays != nil {
		t.Fatalf("null clears both: %+v", cleared)
	}

	zones, err := allZones(ctx, conn, rc.CustomerID)
	check(t, err)
	coded, err := CreateZone(ctx, conn, rc, map[string]any{"city_id": zones[0].CityID, "name_en": "Coded", "extra": map[string]any{"code": "PZ-1"}})
	check(t, err)
	code, _ := codeOfExtra(coded.Extra)
	csv := "code,name_en,kind,home_zone_code,shift_pattern_codes,annual_leave_days\nSUR-9,Imported,field," + code + ",DAY-A,25\n"
	if _, err := ImportAgents(ctx, conn, rc, map[string]any{"file": csv}); err != nil {
		t.Fatalf("import: %v", err)
	}
	all, err := allAgents(ctx, conn, rc.CustomerID)
	check(t, err)
	for _, sv := range all {
		if sv.Code == "SUR-9" && (len(sv.EligibleShiftPatternIDs) != 1 || sv.EligibleShiftPatternIDs[0] != fx.patternID || sv.AnnualLeaveDays == nil || *sv.AnnualLeaveDays != 25) {
			t.Fatalf("imported: %+v", sv)
		}
	}
	bad := "code,name_en,kind,home_zone_code,shift_pattern_codes\nSUR-8,Bad,field," + code + ",REMOTE-1\n"
	if _, err := ImportAgents(ctx, conn, rc, map[string]any{"file": bad}); errCode(err) != dataerr.CodeInvalid {
		t.Fatalf("a remote pattern on a field row: got %v, want Invalid", err)
	}
}

func TestBuildRosterWeek_LimitsRestDaysEligibilitySubmitPublish(t *testing.T) {
	conn := openConn(t)
	rc, _ := adminCtx(t)
	ctx := context.Background()
	resetRosterDeps()
	fx := seedRosterFixture(t, ctx, conn, rc)
	dayB, err := CreateShiftPattern(ctx, conn, rc, map[string]any{
		"code": "DAY-B", "name_en": "Day B", "kind": "field", "break_rule_id": fx.ruleID, "status": "active",
		"normal": map[string]any{"applies": true, "start_time": "14:00", "end_time": "22:00"}, "ramadan": map[string]any{"applies": false},
	})
	check(t, err)
	_, err = UpdateAgent(ctx, conn, rc, fx.agent1, map[string]any{"code": "SUR-1", "name_en": "Agent One", "kind": "field", "home_zone_id": fx.zoneID,
		"extra": map[string]any{"home_shift": "day_a", "standby_point_id": fx.pointID, "days_off": []any{"Tuesday"}}})
	check(t, err)
	_, err = UpdateAgent(ctx, conn, rc, fx.agent2, map[string]any{"code": "SUR-2", "name_en": "Agent Two", "kind": "field", "home_zone_id": fx.zoneID,
		"extra": map[string]any{"home_shift": "day_a", "standby_point_id": fx.pointID}, "eligible_shift_pattern_ids": []any{dayB.ID}})
	check(t, err)
	check(t, settingsstore.Put(ctx, rc.CustomerID, maxDaysPerWeekKey, 5.0))
	planner := roleCtx(rc.CustomerID, "00000000-0000-4000-8000-000000000101", access.RolePlanner)

	res, err := BuildRosterWeek(ctx, conn, planner, map[string]any{"week_start": weekOf})
	check(t, err)
	if len(res.Done)+len(res.Skipped) != 7 || len(res.Done) == 0 {
		t.Fatalf("one zone, seven days: got %d built, %d skipped %+v", len(res.Done), len(res.Skipped), res.Skipped)
	}
	plan, err := loadPlan(ctx, conn, rc)
	check(t, err)
	days := map[string]int{}
	for _, d := range weekDays(weekOf) {
		for _, l := range currentLines(plan, d) {
			days[l.AgentID]++
			if l.AgentID == fx.agent1 && d == "2026-09-15" {
				t.Fatalf("Tuesday is agent one's rest day: %+v", l)
			}
			if l.AgentID == fx.agent2 && *l.ShiftPatternID != dayB.ID {
				t.Fatalf("agent two may work Day B only: %+v", l)
			}
		}
	}
	if days[fx.agent1] > 5 || days[fx.agent2] > 5 || days[fx.agent1] == 0 || days[fx.agent2] == 0 {
		t.Fatalf("at most 5 days each: %v", days)
	}

	week, err := GetRosterWeek(ctx, conn, rc, "2026-09-16")
	check(t, err)
	if week.WeekStart != weekOf || week.Days[6] != "2026-09-19" {
		t.Fatalf("a Wednesday names its Sunday-first week: %s %v", week.WeekStart, week.Days)
	}
	if len(week.Zones) != 1 || len(week.Zones[0].Cells) != 7 || week.Limits.MaxDays != 5 || week.Limits.MaxHours != 48 {
		t.Fatalf("week: %+v", week)
	}
	total := 0
	for _, c := range week.Zones[0].Cells {
		if c.Roster == nil || c.State != "buildable" {
			t.Fatalf("every day built as a draft: %+v", c)
		}
		total += c.Agents
	}
	if total != days[fx.agent1]+days[fx.agent2] {
		t.Fatalf("cells count %d lines, want %d", total, days[fx.agent1]+days[fx.agent2])
	}

	sub, err := SubmitRosterWeek(ctx, conn, planner, map[string]any{"week_start": weekOf})
	check(t, err)
	if len(sub.Done) != 7 {
		t.Fatalf("submit week: %+v", sub)
	}
	supervisor := roleCtx(rc.CustomerID, "00000000-0000-4000-8000-000000000102", access.RoleDispatchSupervisor)
	seedUserRow(t, ctx, conn, rc.CustomerID, supervisor.UserID)
	_, err = ApproveRoster(ctx, conn, supervisor, sub.Done[0].ID, nil)
	check(t, err)
	pub, err := PublishRosterWeek(ctx, conn, supervisor, map[string]any{"week_start": weekOf})
	check(t, err)
	if len(pub.Done) != 1 || len(pub.Skipped) != 6 || pub.Stub == nil || !*pub.Stub || pub.Skipped[0].Reason != "not_approved" {
		t.Fatalf("publish week (stub): %+v", pub)
	}
	again, err := BuildRosterWeek(ctx, conn, planner, map[string]any{"week_start": weekOf})
	check(t, err)
	if len(again.Done) != 0 || len(again.Skipped) != 7 || again.Skipped[0].Reason != "kept" {
		t.Fatalf("submitted and approved rosters are kept: %+v", again)
	}

	viewer := roleCtx(rc.CustomerID, "00000000-0000-4000-8000-000000000103", access.RoleViewerAuditor)
	if _, err := BuildRosterWeek(ctx, conn, viewer, map[string]any{"week_start": weekOf}); errCode(err) != dataerr.CodeForbidden {
		t.Fatalf("a viewer may not build: got %v", err)
	}
	if _, err := BuildRosterWeek(ctx, conn, planner, map[string]any{"week_start": "13-09-2026"}); errCode(err) != dataerr.CodeInvalid {
		t.Fatalf("a bad date: got %v", err)
	}
}

func TestNetAvailability_AddsUpByZoneAndShift(t *testing.T) {
	conn := openConn(t)
	rc, _ := adminCtx(t)
	ctx := context.Background()
	resetRosterDeps()
	fx := seedRosterFixture(t, ctx, conn, rc)
	_, err := UpdateAgent(ctx, conn, rc, fx.agent1, map[string]any{"code": "SUR-1", "name_en": "Agent One", "kind": "field", "home_zone_id": fx.zoneID,
		"extra": map[string]any{"home_shift": "day_a", "days_off": []any{"Friday", "Saturday"}}})
	check(t, err)
	av, err := GetNetAvailability(ctx, conn, rc, weekOf, "")
	check(t, err)
	if len(av.Rows) != 1 || av.Days != 7 || !av.Illustrative {
		t.Fatalf("one zone and shift: %+v", av)
	}
	r := av.Rows[0]
	if r.ZoneID != fx.zoneID || r.ShiftPatternID != fx.patternID || r.Agents != 2 || r.ShiftHours != 112 || r.RestHours != 16 || r.BreakHours != 6 {
		t.Fatalf("2 agents x 7 days x 8 h, 2 rest days, 12 breaks of 30 min: %+v", r)
	}
	sum := r.LeaveHours + r.RestHours + r.BreakHours + r.PrayerHours + r.SickHours + r.NetHours
	if math.Abs(sum-r.ShiftHours) > 0.3 || r.SickHours <= 0 || r.NetHours >= 90 {
		t.Fatalf("the parts add up to the shift hours: %+v (sum %.1f)", r, sum)
	}
	other, err := GetNetAvailability(ctx, conn, rc, weekOf, datactx.NewID())
	check(t, err)
	if len(other.Rows) != 0 {
		t.Fatalf("another zone has no rows: %+v", other.Rows)
	}
}
