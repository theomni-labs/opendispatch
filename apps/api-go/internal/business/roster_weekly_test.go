// SPDX-License-Identifier: AGPL-3.0-only

package business

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/reqctx"
)

func TestWeekStartFollowsTheFirstDay(t *testing.T) {
	for first, want := range map[string]string{"sunday": "2026-09-13", "monday": "2026-09-14", "saturday": "2026-09-12", "": "2026-09-13"} {
		if got := weekStartOf("2026-09-16", first); got != want {
			t.Errorf("%s: got %s, want %s", first, got, want)
		}
	}
	if got := weekStartOf("2026-09-13", "sunday"); got != "2026-09-13" {
		t.Errorf("a Sunday starts its own week, got %s", got)
	}
}

const tDayPat = "11111111-1111-4111-8111-111111111111"

func weeklyPlan(s Agent, workedDays []string) *PlanReader {
	day := ShiftHours{Applies: true, StartTime: sp("06:00"), EndTime: sp("14:00")}
	plan := &PlanReader{
		Patterns:      []ShiftPattern{{BaseRecord: trec(tDayPat, "SYNTHETIC"), Code: "DAY-A", Kind: ShiftKindField, Normal: day, Ramadan: day, BreakRuleID: sp(tRule), Status: ShiftStatusActive}},
		BreakRules:    []BreakRule{{BaseRecord: trec(tRule, "SYNTHETIC"), BreakMinutes: 30, AfterConsecutiveHours: 5}},
		Agents:        []Agent{s},
		LinesByRoster: map[string][]RosterAssignment{},
		rc:            reqctx.RequestContext{CustomerID: "8f3c2a10-5b7e-4d64-9a21-3c6e0d7b1a55"},
	}
	for i, d := range workedDays {
		id := "r" + string(rune('a'+i))
		plan.Rosters = append(plan.Rosters, Roster{BaseRecord: trec(id, "SYNTHETIC"), ZoneID: tZone, RosterDate: d, Status: "approved"})
		plan.LinesByRoster[id] = []RosterAssignment{{AgentID: s.ID, ShiftPatternID: sp(tDayPat), ZoneID: sp(tZone), RosterDate: d,
			StartAt: d + "T06:00:00+03:00", EndAt: d + "T14:00:00+03:00", BreakStartAt: sp(d + "T10:00:00+03:00"), BreakEndAt: sp(d + "T10:30:00+03:00")}}
	}
	return plan
}

func TestWeeklyBlockRestDayDaysAndHours(t *testing.T) {
	s := Agent{BaseRecord: trec(tSurv1, "SYNTHETIC"), Kind: "field", HomeZoneID: sp(tZone), IsActive: true, Extra: map[string]any{"days_off": []any{"Monday"}}}
	week := []string{"2026-09-13", "2026-09-15", "2026-09-16", "2026-09-17", "2026-09-18", "2026-09-19"}
	plan := weeklyPlan(s, week[:5])
	limits := WeeklyLimits{MaxDays: 6, MaxHours: 48}
	if why := weeklyBlock(plan, s, "2026-09-14", weekUsage(plan, "2026-09-14"), limits, false); why != "rest day" {
		t.Fatalf("Monday is a rest day, got %q", why)
	}
	use := weekUsage(plan, "2026-09-19")
	if u := use[s.ID]; u.Days != 5 || u.Minutes != 5*450 {
		t.Fatalf("five days of 7.5 h, got %+v", u)
	}
	if why := weeklyBlock(plan, s, "2026-09-19", use, limits, false); why != "" {
		t.Fatalf("sixth day within 6 days and 48 h, got %q", why)
	}
	if why := weeklyBlock(plan, s, "2026-09-19", use, WeeklyLimits{MaxDays: 5, MaxHours: 48}, false); why != "weekly limit: 5 days" {
		t.Fatalf("day limit, got %q", why)
	}
	if why := weeklyBlock(plan, s, "2026-09-19", use, WeeklyLimits{MaxDays: 7, MaxHours: 40}, false); why != "weekly limit: 40 hours" {
		t.Fatalf("hour limit, got %q", why)
	}
	if u := weekUsage(plan, "2026-09-20")[s.ID]; u.Days != 0 {
		t.Fatalf("the next week starts clean, got %+v", u)
	}
}

func TestOptimizerRequestSendsEligibilityAndWeeklyBlocks(t *testing.T) {
	other := "22222222-2222-4222-8222-222222222222"
	cases := []struct {
		name      string
		edit      func(*optimizerSource)
		available bool
		reason    string
		eligible  []string
	}{
		{"any", func(*optimizerSource) {}, true, "", []string{tPat}},
		{"eligible", func(s *optimizerSource) { s.Agents[0].EligibleShiftPatternIDs = []string{tPat, other} }, true, "", []string{tPat}},
		{"none usable", func(s *optimizerSource) { s.Agents[0].EligibleShiftPatternIDs = []string{other} }, false, "no eligible shift pattern", nil},
		{"rest day", func(s *optimizerSource) { s.Unavail = map[string]string{tSurv1: "rest day"} }, false, "rest day", []string{tPat}},
		{"locked wins", func(s *optimizerSource) {
			s.Unavail = map[string]string{tSurv1: "rest day"}
			s.Fixed = []RosterAssignment{{AgentID: tSurv1, ShiftPatternID: sp(tPat)}}
		}, true, "", []string{tPat}},
	}
	for _, c := range cases {
		src := testOptimizerSource()
		c.edit(&src)
		raw, err := buildOptimizerRequest(src)
		if err != nil {
			t.Fatalf("%s: %v", c.name, err)
		}
		checkRequest(t, "optimizer", raw)
		var doc struct {
			Agents []struct {
				ID        string   `json:"agent_id"`
				Available bool     `json:"available"`
				Reason    string   `json:"unavailable_reason"`
				Eligible  []string `json:"eligible_shift_pattern_ids"`
			} `json:"agents"`
		}
		if err := json.Unmarshal(raw, &doc); err != nil {
			t.Fatal(err)
		}
		got := doc.Agents[0]
		if got.ID != tSurv1 || got.Available != c.available || got.Reason != c.reason || strings.Join(got.Eligible, ",") != strings.Join(c.eligible, ",") {
			t.Errorf("%s: got %+v", c.name, got)
		}
	}
}

func TestValidWeeklySetting(t *testing.T) {
	for _, ok := range []struct {
		key string
		v   any
	}{{maxDaysPerWeekKey, 6.0}, {maxDaysPerWeekKey, 7}, {maxHoursPerWeekKey, 48.0}, {"other.key", "x"}} {
		if err := validWeeklySetting(ok.key, ok.v); err != nil {
			t.Errorf("%s=%v refused: %v", ok.key, ok.v, err)
		}
	}
	for _, bad := range []struct {
		key string
		v   any
	}{{maxDaysPerWeekKey, 0.0}, {maxDaysPerWeekKey, 6.5}, {maxDaysPerWeekKey, "6"}, {maxHoursPerWeekKey, 0.5}, {maxHoursPerWeekKey, 200.0}} {
		if err := validWeeklySetting(bad.key, bad.v); err == nil {
			t.Errorf("%s=%v accepted", bad.key, bad.v)
		}
	}
}

func TestPrayerOverlap(t *testing.T) {
	prayers := []PrayerMinute{{Minute: 4*60 + 20}, {Minute: 11*60 + 50}, {Minute: 13*60 + 50}, {Minute: 28*60 + 20}}
	total, n := prayerOverlap(prayers, 6*60, 14*60, 30)
	if total != 40 || n != 2 {
		t.Fatalf("Dhuhr whole, Asr 10 min: got %d over %d", total, n)
	}
	if total, n := prayerOverlap(prayers, 22*60, 30*60, 30); total != 30 || n != 1 {
		t.Fatalf("next morning's Fajr in the night shift: got %d over %d", total, n)
	}
}
