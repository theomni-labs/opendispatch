// SPDX-License-Identifier: AGPL-3.0-only

// Schedule adherence: planned against actual on duty.
package business

import (
	"context"
	"math"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/reqctx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
)

const quartersADay = 96

// AdherenceInterval: mean agents on duty.
type AdherenceInterval struct {
	IntervalIndex int      `json:"interval_index"`
	Planned       float64  `json:"planned"`
	Actual        *float64 `json:"actual"`
}

// AdherenceZone: one zone's planned and actual.
type AdherenceZone struct {
	ZoneID        string   `json:"zone_id"`
	PlannedHours  float64  `json:"planned_agent_hours"`
	ActualHours   *float64 `json:"actual_agent_hours"`
	Share         *float64 `json:"share"`
	PlannedShifts int      `json:"planned_shifts"`
	AbsentShifts  *int     `json:"absent_shifts"`
	LateStarts    *int     `json:"late_starts"`
	HasActuals    bool     `json:"has_actuals"`
}

// ScheduleAdherenceReport mirrors the contract.
type ScheduleAdherenceReport struct {
	DateFrom        string              `json:"date_from"`
	DateTo          string              `json:"date_to"`
	IntervalMinutes int                 `json:"interval_minutes"`
	PlannedHours    float64             `json:"planned_agent_hours"`
	ActualHours     *float64            `json:"actual_agent_hours"`
	Share           *float64            `json:"share"`
	Intervals       []AdherenceInterval `json:"intervals"`
	Zones           []AdherenceZone     `json:"zones"`
	Illustrative    bool                `json:"illustrative"`
	DataSource      string              `json:"data_source"`
}

// dutySpan: one span on duty.
type dutySpan struct {
	AgentID    string
	From, To   time.Time
	DataSource string
}

// lineQuarters: quarters from the day's start.
func lineQuarters(dayStart time.Time, from, to time.Time) []int {
	var out []int
	for k := 0; k < 2*quartersADay; k++ {
		at := dayStart.Add(time.Duration(k) * 15 * time.Minute)
		if !at.Before(from) && at.Before(to) {
			out = append(out, k)
		}
	}
	return out
}

func coveredAt(spans []dutySpan, at time.Time) bool {
	for _, s := range spans {
		if !at.Before(s.From) && at.Before(s.To) {
			return true
		}
	}
	return false
}

// adherenceTally: counts for one zone.
type adherenceTally struct {
	planned, actual      [quartersADay]int
	plannedQ, actualQ    int
	shifts, absent, late int
	actualsSeen          bool
}

// tallyLine: a planned line against the spans.
func (a *adherenceTally) tallyLine(dayStart, from, to time.Time, spans []dutySpan) {
	quarters := lineQuarters(dayStart, from, to)
	if len(quarters) == 0 {
		return
	}
	a.shifts++
	first := -1
	for n, k := range quarters {
		i := k % quartersADay
		a.planned[i]++
		a.plannedQ++
		if coveredAt(spans, dayStart.Add(time.Duration(k)*15*time.Minute)) {
			a.actual[i]++
			a.actualQ++
			if first < 0 {
				first = n
			}
		}
	}
	switch {
	case first < 0:
		a.absent++
	case first > 0:
		a.late++
	}
}

func hoursOfQuarters(n int) float64 { return round2(float64(n) / 4) }

// zone: the zone's row; nil actuals when none.
func (a *adherenceTally) zone(zoneID string) AdherenceZone {
	z := AdherenceZone{ZoneID: zoneID, PlannedHours: hoursOfQuarters(a.plannedQ), PlannedShifts: a.shifts, HasActuals: a.actualsSeen}
	if a.actualsSeen {
		actual, absent, late := hoursOfQuarters(a.actualQ), a.absent, a.late
		z.ActualHours, z.AbsentShifts, z.LateStarts = &actual, &absent, &late
		z.Share = shareOf(float64(a.actualQ), float64(a.plannedQ))
	}
	return z
}

// loadDutySpans: attendance overlapping the period.
func loadDutySpans(ctx context.Context, conn *tenancy.Connection, tenant string, from, to time.Time) (map[string][]dutySpan, []string, error) {
	type result struct {
		spans   map[string][]dutySpan
		sources []string
	}
	res, err := tenancy.WithTenant(ctx, conn.Pool, tenant, func(ctx context.Context, tx pgx.Tx) (result, error) {
		out := result{spans: map[string][]dutySpan{}}
		rows, err := tx.Query(ctx, `SELECT agent_id::text, started_at, ended_at, data_source FROM attendance_spans
			WHERE started_at < $2 AND ended_at > $1`, from, to)
		if err != nil {
			return out, err
		}
		defer rows.Close()
		seen := map[string]bool{}
		for rows.Next() {
			var s dutySpan
			if err := rows.Scan(&s.AgentID, &s.From, &s.To, &s.DataSource); err != nil {
				return out, err
			}
			out.spans[s.AgentID] = append(out.spans[s.AgentID], s)
			if !seen[s.DataSource] {
				seen[s.DataSource] = true
				out.sources = append(out.sources, s.DataSource)
			}
		}
		return out, rows.Err()
	})
	return res.spans, res.sources, err
}

// GetScheduleAdherence: planned against actual.
func GetScheduleAdherence(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, q PeriodQuery) (ScheduleAdherenceReport, error) {
	days, err := measurePeriod(rc, q)
	if err != nil {
		return ScheduleAdherenceReport{}, err
	}
	zones, err := measureZones(ctx, conn, rc, q.ZoneID)
	if err != nil {
		return ScheduleAdherenceReport{}, err
	}
	plan, err := loadPlan(ctx, conn, rc)
	if err != nil {
		return ScheduleAdherenceReport{}, err
	}
	start, err := riyadhMidnight(days[0])
	if err != nil {
		return ScheduleAdherenceReport{}, err
	}
	end, err := riyadhMidnight(days[len(days)-1])
	if err != nil {
		return ScheduleAdherenceReport{}, err
	}
	spans, sources, err := loadDutySpans(ctx, conn, rc.CustomerID, start.Add(-12*time.Hour), end.AddDate(0, 0, 1).Add(12*time.Hour))
	if err != nil {
		return ScheduleAdherenceReport{}, err
	}
	out := ScheduleAdherenceReport{DateFrom: q.DateFrom, DateTo: q.DateTo, IntervalMinutes: 15, Intervals: []AdherenceInterval{}, Zones: []AdherenceZone{}, Illustrative: true, DataSource: "SYNTHETIC"}
	if len(sources) > 0 {
		_, out.DataSource = inputProvenance(sources)
	}
	var all adherenceTally
	for _, z := range zones {
		var t adherenceTally
		for _, d := range days {
			dayStart, err := riyadhMidnight(d)
			if err != nil {
				return ScheduleAdherenceReport{}, err
			}
			lines, _, err := linesForDay(rc, plan, z.ID, d)
			if err != nil {
				return ScheduleAdherenceReport{}, err
			}
			for _, l := range lines {
				from, err1 := time.Parse(time.RFC3339, l.StartAt)
				to, err2 := time.Parse(time.RFC3339, l.EndAt)
				if err1 != nil || err2 != nil {
					continue
				}
				if len(spans[l.AgentID]) > 0 {
					t.actualsSeen = true
				}
				t.tallyLine(dayStart, from, to, spans[l.AgentID])
			}
		}
		out.Zones = append(out.Zones, t.zone(z.ID))
		for i := 0; i < quartersADay; i++ {
			all.planned[i] += t.planned[i]
			all.actual[i] += t.actual[i]
		}
		all.plannedQ, all.actualQ = all.plannedQ+t.plannedQ, all.actualQ+t.actualQ
		all.actualsSeen = all.actualsSeen || t.actualsSeen
	}
	n := float64(len(days))
	for i := 0; i < quartersADay; i++ {
		row := AdherenceInterval{IntervalIndex: i, Planned: math.Round(float64(all.planned[i])/n*10) / 10}
		if all.actualsSeen {
			v := math.Round(float64(all.actual[i])/n*10) / 10
			row.Actual = &v
		}
		out.Intervals = append(out.Intervals, row)
	}
	out.PlannedHours = hoursOfQuarters(all.plannedQ)
	if all.actualsSeen {
		actual := hoursOfQuarters(all.actualQ)
		out.ActualHours = &actual
		out.Share = shareOf(float64(all.actualQ), float64(all.plannedQ))
	}
	return out, nil
}
