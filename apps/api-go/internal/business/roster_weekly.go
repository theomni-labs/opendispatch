// SPDX-License-Identifier: AGPL-3.0-only

// Weekly limits, rest days, eligibility.
package business

import (
	"fmt"
	"math"
	"sort"
	"time"
)

const (
	maxDaysPerWeekKey  = "planning.max_days_per_week"
	maxHoursPerWeekKey = "planning.max_hours_per_week"
	defaultMaxDays     = 6
	defaultMaxHours    = 48.0
)

// WeeklyLimits: contract WeeklyLimits.
type WeeklyLimits struct {
	MaxDays  int     `json:"max_days_per_week"`
	MaxHours float64 `json:"max_hours_per_week"`
}

// weeklyLimits: the settings, else defaults.
func (p *PlanReader) weeklyLimits() WeeklyLimits {
	l := WeeklyLimits{MaxDays: defaultMaxDays, MaxHours: defaultMaxHours}
	tenant := p.rc.CustomerID
	if v := readSetting(p.ctx(), tenant, maxDaysPerWeekKey, float64(defaultMaxDays)); v >= 1 && v <= 7 && v == math.Trunc(v) {
		l.MaxDays = int(v)
	}
	if v := readSetting(p.ctx(), tenant, maxHoursPerWeekKey, defaultMaxHours); v >= 1 && v <= 168 {
		l.MaxHours = v
	}
	return l
}

// validWeeklySetting checks a raw write.
func validWeeklySetting(key string, value any) error {
	n, ok := value.(float64)
	if i, isInt := value.(int); isInt {
		n, ok = float64(i), true
	}
	switch key {
	case maxDaysPerWeekKey:
		if !ok || n < 1 || n > 7 || n != math.Trunc(n) {
			return fmt.Errorf("%s must be a whole number from 1 to 7", key)
		}
	case maxHoursPerWeekKey:
		if !ok || math.IsNaN(n) || n < 1 || n > 168 {
			return fmt.Errorf("%s must be a number from 1 to 168", key)
		}
	}
	return nil
}

var weekdayIndex = map[string]int{"sunday": 0, "monday": 1, "saturday": 6}

// weekStartOf: the first day of date's week.
func weekStartOf(date, firstDay string) string {
	first, ok := weekdayIndex[firstDay]
	if !ok {
		first = 0
	}
	delta := (int(weekdayOfDate(date)) - first + 7) % 7
	return shiftDateBy(date, -delta)
}

// weekStart: by the localization setting.
func (p *PlanReader) weekStart(date string) string {
	return weekStartOf(date, getLocalization(p.ctx(), p.rc.CustomerID).FirstDayOfWeek)
}

// workedMinutes: shift less its break.
func workedMinutes(l RosterAssignment) int {
	span := func(a, b string) int {
		ta, ea := time.Parse(time.RFC3339, a)
		tb, eb := time.Parse(time.RFC3339, b)
		if ea != nil || eb != nil || !tb.After(ta) {
			return 0
		}
		return int(tb.Sub(ta).Minutes())
	}
	m := span(l.StartAt, l.EndAt)
	if l.BreakStartAt != nil && l.BreakEndAt != nil {
		m -= span(*l.BreakStartAt, *l.BreakEndAt)
	}
	return max(0, m)
}

// weekUse: days and minutes worked.
type weekUse struct {
	Days    int
	Minutes int
}

// currentLines: the current rosters' lines of a day.
func currentLines(plan *PlanReader, date string) []RosterAssignment {
	var out []RosterAssignment
	seen := map[string]bool{}
	for _, r := range plan.Rosters {
		if r.RosterDate != date || seen[r.ZoneID] {
			continue
		}
		seen[r.ZoneID] = true
		if cur := rosterFor(plan, r.ZoneID, date); cur != nil {
			out = append(out, plan.LinesByRoster[cur.ID]...)
		}
	}
	return out
}

// weekUsage: other days of date's week.
func weekUsage(plan *PlanReader, date string) map[string]weekUse {
	ws := plan.weekStart(date)
	out := map[string]weekUse{}
	for i := 0; i < 7; i++ {
		d := shiftDateBy(ws, i)
		if d == date {
			continue
		}
		counted := map[string]bool{}
		for _, l := range currentLines(plan, d) {
			if counted[l.AgentID] || onLeave(plan, l.AgentID, d) {
				continue
			}
			counted[l.AgentID] = true
			u := out[l.AgentID]
			u.Days++
			u.Minutes += workedMinutes(l)
			out[l.AgentID] = u
		}
	}
	return out
}

// restDay: extra.days_off holds the weekday.
func restDay(s Agent, date string) bool {
	days, _ := s.Extra["days_off"].([]any)
	name := weekdayOfDate(date).String()
	for _, d := range days {
		if v, ok := d.(string); ok && v == name {
			return true
		}
	}
	return false
}

// eligiblePatterns: active, of the kind, eligible.
func eligiblePatterns(patterns []ShiftPattern, s Agent) []ShiftPattern {
	allowed := map[string]bool{}
	for _, id := range s.EligibleShiftPatternIDs {
		allowed[id] = true
	}
	var out []ShiftPattern
	for _, p := range patterns {
		if p.Status == ShiftStatusActive && string(p.Kind) == s.Kind && (s.EligibleShiftPatternIDs == nil || allowed[p.ID]) {
			out = append(out, p)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Code < out[j].Code })
	return out
}

// netShiftMinutes: length less break, 0 unusable.
func netShiftMinutes(plan *PlanReader, p ShiftPattern, ramadan bool) (length, brk int) {
	start, end, ok := patternHours(p, ramadan)
	if !ok {
		return 0, 0
	}
	length = end - start
	bm, after := plan.BreakRule(p.ID)
	if float64(length) > after*60 {
		brk = bm
	}
	return length, brk
}

// weeklyBlock: why the week rules keep s off date.
func weeklyBlock(plan *PlanReader, s Agent, date string, use map[string]weekUse, limits WeeklyLimits, ramadan bool) string {
	if restDay(s, date) {
		return "rest day"
	}
	u := use[s.ID]
	if u.Days >= limits.MaxDays {
		return fmt.Sprintf("weekly limit: %d days", limits.MaxDays)
	}
	shortest := -1
	for _, p := range eligiblePatterns(plan.Patterns, s) {
		if l, b := netShiftMinutes(plan, p, ramadan); l > 0 && (shortest < 0 || l-b < shortest) {
			shortest = l - b
		}
	}
	if shortest >= 0 && float64(u.Minutes+shortest) > limits.MaxHours*60+1e-9 {
		return fmt.Sprintf("weekly limit: %s hours", trimHours(limits.MaxHours))
	}
	return ""
}

func trimHours(h float64) string {
	if h == math.Trunc(h) {
		return fmt.Sprintf("%d", int(h))
	}
	return fmt.Sprintf("%.1f", h)
}

// weeklyBlocks: reasons by agent for date.
func weeklyBlocks(plan *PlanReader, date string, ramadan bool, exempt map[string]bool) map[string]string {
	use := weekUsage(plan, date)
	limits := plan.weeklyLimits()
	out := map[string]string{}
	for _, s := range plan.Agents {
		if !s.IsActive || exempt[s.ID] || onLeave(plan, s.ID, date) {
			continue
		}
		if why := weeklyBlock(plan, s, date, use, limits, ramadan); why != "" {
			out[s.ID] = why
		}
	}
	return out
}
