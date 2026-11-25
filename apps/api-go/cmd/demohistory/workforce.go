// SPDX-License-Identifier: AGPL-3.0-only

package main

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"math/rand"
	"sort"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/synthetic"
)

// homeShiftCode mirrors business.homeShiftCode.
var homeShiftCode = map[string]string{"day_a": "DAY-A", "day_b": "DAY-B", "night": "NIGHT"}

// person: one field agent and home shift.
type person struct {
	ID, Zone, Shift string
	DaysOff         map[time.Weekday]bool
}

// shiftHours: minutes from midnight; end > start.
type shiftHours struct{ Start, End int }

// leaveSpan: approved leave, inclusive dates.
type leaveSpan struct{ From, To string }

// WorkforceSummary: what loadWorkforce wrote.
type WorkforceSummary struct {
	SickMonths, Spans, TimedCases int
}

var weekdayNames = map[string]time.Weekday{"Sunday": time.Sunday, "Monday": time.Monday, "Tuesday": time.Tuesday, "Wednesday": time.Wednesday, "Thursday": time.Thursday, "Friday": time.Friday, "Saturday": time.Saturday}

func clockMinutes(t string) (int, bool) {
	at, err := time.Parse("15:04", t)
	if err != nil {
		return 0, false
	}
	return at.Hour()*60 + at.Minute(), true
}

// parseShift: a pattern's normal hours.
func parseShift(raw string) (shiftHours, bool) {
	var n struct {
		Applies   bool   `json:"applies"`
		StartTime string `json:"start_time"`
		EndTime   string `json:"end_time"`
	}
	if json.Unmarshal([]byte(raw), &n) != nil || !n.Applies {
		return shiftHours{}, false
	}
	s, ok1 := clockMinutes(n.StartTime)
	e, ok2 := clockMinutes(n.EndTime)
	if !ok1 || !ok2 {
		return shiftHours{}, false
	}
	if e <= s {
		e += 1440
	}
	return shiftHours{Start: s, End: e}, true
}

// loadPeople: field agents and shift hours.
func loadPeople(ctx context.Context, conn *pgx.Conn) ([]person, map[string]shiftHours, map[string][]leaveSpan, error) {
	shifts := map[string]shiftHours{}
	rows, err := conn.Query(ctx, `SELECT code, normal::text FROM shift_patterns`)
	if err != nil {
		return nil, nil, nil, err
	}
	for rows.Next() {
		var code, raw string
		if err := rows.Scan(&code, &raw); err != nil {
			rows.Close()
			return nil, nil, nil, err
		}
		if h, ok := parseShift(raw); ok {
			shifts[code] = h
		}
	}
	rows.Close()
	var people []person
	rows, err = conn.Query(ctx, `SELECT id::text, home_zone_id::text, coalesce(extra->>'home_shift', ''), coalesce(extra->'days_off', '[]'::jsonb)::text
		FROM agents WHERE kind = 'field' AND is_active AND home_zone_id IS NOT NULL ORDER BY code`)
	if err != nil {
		return nil, nil, nil, err
	}
	for rows.Next() {
		var p person
		var shift, off string
		if err := rows.Scan(&p.ID, &p.Zone, &shift, &off); err != nil {
			rows.Close()
			return nil, nil, nil, err
		}
		p.Shift = homeShiftCode[shift]
		var names []string
		_ = json.Unmarshal([]byte(off), &names)
		p.DaysOff = map[time.Weekday]bool{}
		for _, n := range names {
			if d, ok := weekdayNames[n]; ok {
				p.DaysOff[d] = true
			}
		}
		people = append(people, p)
	}
	rows.Close()
	leave := map[string][]leaveSpan{}
	rows, err = conn.Query(ctx, `SELECT agent_id::text, start_date::text, end_date::text FROM leave_requests WHERE status = 'approved'`)
	if err != nil {
		return nil, nil, nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var id string
		var l leaveSpan
		if err := rows.Scan(&id, &l.From, &l.To); err != nil {
			return nil, nil, nil, err
		}
		leave[id] = append(leave[id], l)
	}
	return people, shifts, leave, rows.Err()
}

// duty: the planned span on a date, if any.
func (p person) duty(date time.Time, shifts map[string]shiftHours, leave map[string][]leaveSpan) (time.Time, time.Time, bool) {
	h, ok := shifts[p.Shift]
	if !ok || p.DaysOff[date.Weekday()] {
		return time.Time{}, time.Time{}, false
	}
	day := date.Format("2006-01-02")
	for _, l := range leave[p.ID] {
		if l.From <= day && day <= l.To {
			return time.Time{}, time.Time{}, false
		}
	}
	return date.Add(time.Duration(h.Start) * time.Minute), date.Add(time.Duration(h.End) * time.Minute), true
}

// poisson: a count with this mean.
func poisson(r *rand.Rand, mean float64) int {
	if mean <= 0 {
		return 0
	}
	if mean > 60 {
		return int(math.Max(0, math.Round(mean+math.Sqrt(mean)*r.NormFloat64())))
	}
	limit, k, p := math.Exp(-mean), 0, 1.0
	for {
		p *= r.Float64()
		if p <= limit {
			return k
		}
		k++
	}
}

func zonesOf(people []person) []string {
	seen := map[string]bool{}
	var out []string
	for _, p := range people {
		if !seen[p.Zone] {
			seen[p.Zone] = true
			out = append(out, p.Zone)
		}
	}
	sort.Strings(out)
	return out
}

// zoneFactors: one sick factor per zone.
func zoneFactors(zones []string, w synthetic.WorkforceCal, r *rand.Rand) map[string]float64 {
	out := map[string]float64{}
	for _, z := range zones {
		out[z] = w.SickZoneMin + r.Float64()*(w.SickZoneMax-w.SickZoneMin)
	}
	return out
}

// sickShare: a day's chance of being off sick.
func sickShare(w synthetic.WorkforceCal, month time.Month, zoneFactor float64) float64 {
	return w.SickDaysPerYear / w.WorkingDays * w.SickMonthFactor[int(month)-1] * zoneFactor
}

// sickMonths: monthly sick days per zone.
func sickMonths(tenant string, people []person, factors map[string]float64, w synthetic.WorkforceCal, from, to time.Time, r *rand.Rand) [][]any {
	count := map[string]int{}
	for _, p := range people {
		count[p.Zone]++
	}
	var rows [][]any
	for m := time.Date(from.Year(), from.Month(), 1, 0, 0, 0, 0, time.UTC); m.Before(to); m = m.AddDate(0, 1, 0) {
		for _, z := range zonesOf(people) {
			mean := float64(count[z]) * w.SickDaysPerYear / 12 * w.SickMonthFactor[int(m.Month())-1] * factors[z]
			rows = append(rows, []any{tenant, "SYNTHETIC", z, m, count[z], float64(poisson(r, mean)), marker})
		}
	}
	return rows
}

// attendanceSpans: who came, when, before today.
func attendanceSpans(tenant string, people []person, shifts map[string]shiftHours, leave map[string][]leaveSpan, factors map[string]float64, w synthetic.WorkforceCal, today time.Time, r *rand.Rand) [][]any {
	var rows [][]any
	for back := w.AttendanceDays; back >= 1; back-- {
		date := today.AddDate(0, 0, -back)
		for _, p := range people {
			from, to, ok := p.duty(date, shifts, leave)
			if !ok {
				continue
			}
			if r.Float64() < sickShare(w, date.Month(), factors[p.Zone]) {
				continue
			}
			if r.Float64() < w.LateShare {
				from = from.Add(time.Duration(w.LateMin+r.Float64()*(w.LateMax-w.LateMin)) * time.Minute)
			}
			if r.Float64() < w.EarlyShare {
				to = to.Add(-time.Duration(w.EarlyMin+r.Float64()*(w.EarlyMax-w.EarlyMin)) * time.Minute)
			}
			rows = append(rows, []any{tenant, "SYNTHETIC", p.ID, date.Format("2006-01-02"), from, to, marker})
		}
	}
	return rows
}

// historyCase: a history field case to time.
type historyCase struct {
	ID, Zone   string
	Registered time.Time
}

// timeCases: an agent on duty and case times.
func timeCases(cases []historyCase, people []person, shifts map[string]shiftHours, leave map[string][]leaveSpan, w synthetic.WorkforceCal, times *synthetic.CaseTimes, r *rand.Rand) [][]any {
	byZone := map[string][]person{}
	for _, p := range people {
		byZone[p.Zone] = append(byZone[p.Zone], p)
	}
	var rows [][]any
	for _, c := range cases {
		d := times.Draw(r, true, false)
		assigned := c.Registered.Add(time.Duration(d.AssignedMin * float64(time.Minute)))
		var onDuty []string
		for _, p := range byZone[c.Zone] {
			for _, back := range []int{0, -1} {
				day := time.Date(assigned.In(riyadh).Year(), assigned.In(riyadh).Month(), assigned.In(riyadh).Day()+back, 0, 0, 0, 0, riyadh)
				if from, to, ok := p.duty(day, shifts, leave); ok && !assigned.Before(from) && assigned.Before(to) {
					onDuty = append(onDuty, p.ID)
					break
				}
			}
		}
		if len(onDuty) == 0 {
			continue
		}
		arrived := c.Registered.Add(time.Duration(d.ArrivedMin * float64(time.Minute)))
		closed := c.Registered.Add(time.Duration(d.ClosedMin * float64(time.Minute)))
		frac := w.OnSceneFracMin + r.Float64()*(w.OnSceneFracMax-w.OnSceneFracMin)
		done := arrived.Add(time.Duration(frac * float64(closed.Sub(arrived))))
		rows = append(rows, []any{c.ID, onDuty[r.Intn(len(onDuty))], assigned.Truncate(time.Second), arrived.Truncate(time.Second), done.Truncate(time.Second), closed.Truncate(time.Second)})
	}
	return rows
}

// loadWorkforce writes the Phase 4 demo history.
func loadWorkforce(ctx context.Context, conn *pgx.Conn, tenant string, today, historyStart, caseWeek time.Time, seed int64) (WorkforceSummary, error) {
	var out WorkforceSummary
	w, err := synthetic.Workforce()
	if err != nil {
		return out, err
	}
	people, shifts, leave, err := loadPeople(ctx, conn)
	if err != nil || len(people) == 0 {
		return out, err
	}
	r := rand.New(rand.NewSource(seed + 37))
	factors := zoneFactors(zonesOf(people), w, r)
	for _, table := range []string{"sick_leave_history", "attendance_spans"} {
		if _, err := conn.Exec(ctx, `DELETE FROM `+table+` WHERE extra @> $1::jsonb`, marker); err != nil {
			return out, err
		}
	}
	months := sickMonths(tenant, people, factors, w, historyStart, time.Date(today.Year(), today.Month(), 1, 0, 0, 0, 0, time.UTC), r)
	if _, err := conn.CopyFrom(ctx, pgx.Identifier{"sick_leave_history"}, []string{"tenant_id", "data_source", "zone_id", "month", "agents", "sick_days", "extra"}, pgx.CopyFromRows(months)); err != nil {
		return out, fmt.Errorf("sick leave history: %w", err)
	}
	spans := attendanceSpans(tenant, people, shifts, leave, factors, w, today, r)
	if _, err := conn.CopyFrom(ctx, pgx.Identifier{"attendance_spans"}, []string{"tenant_id", "data_source", "agent_id", "work_date", "started_at", "ended_at", "extra"}, pgx.CopyFromRows(spans)); err != nil {
		return out, fmt.Errorf("attendance: %w", err)
	}
	out.SickMonths, out.Spans = len(months), len(spans)
	if w.TimedWeeks <= 0 {
		return out, nil
	}
	times, err := synthetic.NewCaseTimes()
	if err != nil {
		return out, err
	}
	rows, err := conn.Query(ctx, `SELECT id::text, zone_id::text, registered_at FROM cases
		WHERE extra @> $1::jsonb AND handling = 'field' AND registered_at >= $2 AND registered_at < $3 ORDER BY registered_at, id`,
		marker, caseWeek.AddDate(0, 0, -7*w.TimedWeeks), caseWeek)
	if err != nil {
		return out, err
	}
	var cases []historyCase
	for rows.Next() {
		var c historyCase
		if err := rows.Scan(&c.ID, &c.Zone, &c.Registered); err != nil {
			rows.Close()
			return out, err
		}
		cases = append(cases, c)
	}
	rows.Close()
	timed := timeCases(cases, people, shifts, leave, w, times, r)
	if _, err := conn.Exec(ctx, `CREATE TEMP TABLE IF NOT EXISTS demo_case_times (id uuid, agent_id uuid, assigned_at timestamptz, arrived_at timestamptz, on_scene_completed_at timestamptz, closed_at timestamptz)`); err != nil {
		return out, err
	}
	if _, err := conn.Exec(ctx, `TRUNCATE demo_case_times`); err != nil {
		return out, err
	}
	if _, err := conn.CopyFrom(ctx, pgx.Identifier{"demo_case_times"}, []string{"id", "agent_id", "assigned_at", "arrived_at", "on_scene_completed_at", "closed_at"}, pgx.CopyFromRows(timed)); err != nil {
		return out, err
	}
	tag, err := conn.Exec(ctx, `UPDATE cases c SET agent_id = t.agent_id, assigned_at = t.assigned_at, arrived_at = t.arrived_at,
		on_scene_completed_at = t.on_scene_completed_at, closed_at = t.closed_at FROM demo_case_times t WHERE c.id = t.id AND c.tenant_id = $1::uuid`, tenant)
	if err != nil {
		return out, err
	}
	out.TimedCases = int(tag.RowsAffected())
	return out, nil
}
