// SPDX-License-Identifier: AGPL-3.0-only

// Utilization per zone and shift.
package business

import (
	"context"
	"fmt"
	"math"
	"sort"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/reqctx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
)

// UtilizationShift: one shift pattern's hours.
type UtilizationShift struct {
	ShiftPatternID     string   `json:"shift_pattern_id"`
	Code               string   `json:"code"`
	WorkedHours        float64  `json:"worked_hours"`
	AvailableHours     float64  `json:"available_hours"`
	Share              *float64 `json:"share"`
	Cases              int      `json:"cases"`
	AgentShifts        int      `json:"agent_shifts"`
	CasesPerAgentShift *float64 `json:"cases_per_agent_shift"`
	BaselineShare      *float64 `json:"baseline_share"`
	ChangePoints       *float64 `json:"change_points"`
}

// UtilizationZone: one zone's hours and shifts.
type UtilizationZone struct {
	ZoneID             string             `json:"zone_id"`
	WorkedHours        float64            `json:"worked_hours"`
	AvailableHours     float64            `json:"available_hours"`
	Share              *float64           `json:"share"`
	RosteredDays       int                `json:"rostered_days"`
	ProjectedDays      int                `json:"projected_days"`
	Cases              int                `json:"cases"`
	AgentShifts        int                `json:"agent_shifts"`
	CasesPerAgentShift *float64           `json:"cases_per_agent_shift"`
	BaselineShare      *float64           `json:"baseline_share"`
	ChangePoints       *float64           `json:"change_points"`
	Shifts             []UtilizationShift `json:"shifts"`
}

// UtilizationBaseline: what the change is against.
type UtilizationBaseline struct {
	Method       string   `json:"method"`
	DateFrom     *string  `json:"date_from"`
	DateTo       *string  `json:"date_to"`
	Share        *float64 `json:"share"`
	TargetPoints float64  `json:"target_points"`
	FromSetting  bool     `json:"from_setting"`
}

// UtilizationReport mirrors the contract.
type UtilizationReport struct {
	DateFrom       string              `json:"date_from"`
	DateTo         string              `json:"date_to"`
	WorkedHours    float64             `json:"worked_hours"`
	AvailableHours float64             `json:"available_hours"`
	Share          *float64            `json:"share"`
	ChangePoints   *float64            `json:"change_points"`
	Baseline       UtilizationBaseline `json:"baseline"`
	Zones          []UtilizationZone   `json:"zones"`
	Illustrative   bool                `json:"illustrative"`
	DataSource     string              `json:"data_source"`
}

// Baseline settings.
const (
	utilBaselineKey     = "kpi.utilization_baseline"
	utilTargetKey       = "kpi.utilization_target_points"
	defaultTargetPoints = 10.0
	baselineDays        = 28
	baselinePeriod      = "period"
	baselineValue       = "value"
	baselineNone        = "none"
)

// baselineSetting: the stored baseline.
type baselineSetting struct {
	Method   string   `json:"method"`
	DateFrom string   `json:"date_from"`
	DateTo   string   `json:"date_to"`
	Share    *float64 `json:"share"`
}

// workedCase: one field case's worked span.
type workedCase struct {
	ZoneID, AgentID string
	From, To        time.Time
	DataSource      string
}

// utilLine: a line's span, break taken out.
type utilLine struct {
	AgentID, PatternID string
	From, To           time.Time
	Hours              float64
}

func shareOf(worked, available float64) *float64 {
	if available <= 0 {
		return nil
	}
	v := math.Round(worked/available*1e4) / 1e4
	return &v
}

func perShift(cases, shifts int) *float64 {
	if shifts <= 0 {
		return nil
	}
	v := math.Round(float64(cases)/float64(shifts)*100) / 100
	return &v
}

// pointsBetween: share change in points.
func pointsBetween(now, base *float64) *float64 {
	if now == nil || base == nil {
		return nil
	}
	v := math.Round((*now-*base)*1000) / 10
	return &v
}

func hoursBetween(a, b string) float64 {
	from, err1 := time.Parse(time.RFC3339, a)
	to, err2 := time.Parse(time.RFC3339, b)
	if err1 != nil || err2 != nil || !to.After(from) {
		return 0
	}
	return to.Sub(from).Hours()
}

// toUtilLine: hours on duty, less the break.
func toUtilLine(l RosterAssignment) utilLine {
	from, _ := time.Parse(time.RFC3339, l.StartAt)
	to, _ := time.Parse(time.RFC3339, l.EndAt)
	h := hoursBetween(l.StartAt, l.EndAt)
	if l.BreakStartAt != nil && l.BreakEndAt != nil {
		h -= hoursBetween(*l.BreakStartAt, *l.BreakEndAt)
	}
	return utilLine{AgentID: l.AgentID, PatternID: patternIDOf(l), From: from, To: to, Hours: math.Max(0, h)}
}

// zoneUtilization: one zone's lines and cases.
func zoneUtilization(zoneID string, lines []utilLine, cases []workedCase, codes map[string]string) UtilizationZone {
	z := UtilizationZone{ZoneID: zoneID, Shifts: []UtilizationShift{}}
	byPattern := map[string]*UtilizationShift{}
	shift := func(id string) *UtilizationShift {
		s, ok := byPattern[id]
		if !ok {
			s = &UtilizationShift{ShiftPatternID: id, Code: codes[id]}
			byPattern[id] = s
		}
		return s
	}
	for _, l := range lines {
		z.AvailableHours += l.Hours
		z.AgentShifts++
		if l.PatternID != "" {
			s := shift(l.PatternID)
			s.AvailableHours += l.Hours
			s.AgentShifts++
		}
	}
	for _, c := range cases {
		h := c.To.Sub(c.From).Hours()
		z.WorkedHours += h
		z.Cases++
		for _, l := range lines {
			if l.AgentID == c.AgentID && l.PatternID != "" && !c.From.Before(l.From) && c.From.Before(l.To) {
				s := shift(l.PatternID)
				s.WorkedHours += h
				s.Cases++
				break
			}
		}
	}
	for _, s := range byPattern {
		s.WorkedHours, s.AvailableHours = round2(s.WorkedHours), round2(s.AvailableHours)
		s.Share = shareOf(s.WorkedHours, s.AvailableHours)
		s.CasesPerAgentShift = perShift(s.Cases, s.AgentShifts)
		z.Shifts = append(z.Shifts, *s)
	}
	sort.Slice(z.Shifts, func(i, j int) bool { return z.Shifts[i].Code < z.Shifts[j].Code })
	z.WorkedHours, z.AvailableHours = round2(z.WorkedHours), round2(z.AvailableHours)
	z.Share = shareOf(z.WorkedHours, z.AvailableHours)
	z.CasesPerAgentShift = perShift(z.Cases, z.AgentShifts)
	return z
}

// withBaseline: change in points, zone and shift.
func (z *UtilizationZone) withBaseline(base *UtilizationZone, value *float64) {
	if value != nil {
		z.BaselineShare = value
	} else if base != nil {
		z.BaselineShare = base.Share
	}
	z.ChangePoints = pointsBetween(z.Share, z.BaselineShare)
	for i := range z.Shifts {
		s := &z.Shifts[i]
		if value != nil {
			s.BaselineShare = value
		} else if base != nil {
			for _, b := range base.Shifts {
				if b.ShiftPatternID == s.ShiftPatternID {
					s.BaselineShare = b.Share
				}
			}
		}
		s.ChangePoints = pointsBetween(s.Share, s.BaselineShare)
	}
}

// loadWorkedCases: field cases with a worked span.
func loadWorkedCases(ctx context.Context, conn *tenancy.Connection, tenant, from, to string) ([]workedCase, error) {
	start, err := riyadhMidnight(from)
	if err != nil {
		return nil, err
	}
	end, err := riyadhMidnight(to)
	if err != nil {
		return nil, err
	}
	return tenancy.WithTenant(ctx, conn.Pool, tenant, func(ctx context.Context, tx pgx.Tx) ([]workedCase, error) {
		rows, err := tx.Query(ctx, `SELECT zone_id::text, coalesce(agent_id::text, ''), assigned_at, on_scene_completed_at, data_source
			FROM cases WHERE handling = 'field' AND zone_id IS NOT NULL AND registered_at >= $1 AND registered_at < $2
				AND assigned_at IS NOT NULL AND on_scene_completed_at > assigned_at`, start, end.AddDate(0, 0, 1))
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		var out []workedCase
		for rows.Next() {
			var c workedCase
			if err := rows.Scan(&c.ZoneID, &c.AgentID, &c.From, &c.To, &c.DataSource); err != nil {
				return nil, err
			}
			out = append(out, c)
		}
		return out, rows.Err()
	})
}

// firstWorkedDate: the first day with a worked case.
func firstWorkedDate(ctx context.Context, conn *tenancy.Connection, tenant string) (string, error) {
	return tenancy.WithTenant(ctx, conn.Pool, tenant, func(ctx context.Context, tx pgx.Tx) (string, error) {
		var at *time.Time
		err := tx.QueryRow(ctx, `SELECT min(registered_at) FROM cases WHERE handling = 'field' AND zone_id IS NOT NULL
			AND assigned_at IS NOT NULL AND on_scene_completed_at > assigned_at`).Scan(&at)
		if err != nil || at == nil {
			return "", err
		}
		return at.In(riyadhZone).Format("2006-01-02"), nil
	})
}

// linesForDay: the roster in force, else home shifts.
func linesForDay(rc reqctx.RequestContext, plan *PlanReader, zoneID, date string) ([]RosterAssignment, bool, error) {
	if r := rosterFor(plan, zoneID, date); r != nil {
		var out []RosterAssignment
		for _, l := range plan.LinesByRoster[r.ID] {
			if l.ZoneID != nil && *l.ZoneID == zoneID && !onLeave(plan, l.AgentID, date) {
				out = append(out, l)
			}
		}
		return out, true, nil
	}
	lines, err := projectLines(rc, plan, zoneID, date)
	return lines, false, err
}

// utilizationOf: every zone over the days.
func utilizationOf(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, plan *PlanReader, zones []Zone, days []string) ([]UtilizationZone, []string, error) {
	if len(days) == 0 {
		return nil, nil, nil
	}
	cases, err := loadWorkedCases(ctx, conn, rc.CustomerID, days[0], days[len(days)-1])
	if err != nil {
		return nil, nil, err
	}
	codes := map[string]string{}
	for _, p := range plan.Patterns {
		codes[p.ID] = p.Code
	}
	byZone := map[string][]workedCase{}
	var sources []string
	for _, c := range cases {
		byZone[c.ZoneID] = append(byZone[c.ZoneID], c)
		sources = append(sources, c.DataSource)
	}
	var out []UtilizationZone
	for _, z := range zones {
		var lines []utilLine
		rostered, projected := 0, 0
		for _, d := range days {
			day, fromRoster, err := linesForDay(rc, plan, z.ID, d)
			if err != nil {
				return nil, nil, err
			}
			if fromRoster {
				rostered++
			} else {
				projected++
			}
			for _, l := range day {
				lines = append(lines, toUtilLine(l))
			}
		}
		row := zoneUtilization(z.ID, lines, byZone[z.ID], codes)
		row.RosteredDays, row.ProjectedDays = rostered, projected
		out = append(out, row)
	}
	return out, sources, nil
}

// datesBetween: inclusive local dates.
func datesBetween(from, to string) ([]string, error) {
	a, err := time.Parse("2006-01-02", from)
	if err != nil {
		return nil, err
	}
	b, err := time.Parse("2006-01-02", to)
	if err != nil {
		return nil, err
	}
	var out []string
	for d := a; !d.After(b); d = d.AddDate(0, 0, 1) {
		out = append(out, d.Format("2006-01-02"))
	}
	return out, nil
}

// utilizationBaseline: the setting, else the default.
func utilizationBaseline(ctx context.Context, conn *tenancy.Connection, tenant string) (UtilizationBaseline, error) {
	target := readSetting(ctx, tenant, utilTargetKey, defaultTargetPoints)
	if !(target > 0 && target <= 100) {
		target = defaultTargetPoints
	}
	out := UtilizationBaseline{Method: baselineNone, TargetPoints: target}
	set := readSetting(ctx, tenant, utilBaselineKey, baselineSetting{})
	if validBaseline(set) == nil {
		out.FromSetting = true
		switch set.Method {
		case baselineValue:
			v := *set.Share
			out.Method, out.Share = baselineValue, &v
		case baselinePeriod:
			from, to := set.DateFrom, set.DateTo
			out.Method, out.DateFrom, out.DateTo = baselinePeriod, &from, &to
		}
		return out, nil
	}
	first, err := firstWorkedDate(ctx, conn, tenant)
	if err != nil || first == "" {
		return out, err
	}
	to := shiftDateBy(first, baselineDays-1)
	out.Method, out.DateFrom, out.DateTo = baselinePeriod, &first, &to
	return out, nil
}

// validBaseline checks a stored baseline.
func validBaseline(b baselineSetting) error {
	switch b.Method {
	case baselineValue:
		if b.Share == nil || math.IsNaN(*b.Share) || *b.Share < 0 || *b.Share > 1 {
			return fmt.Errorf("%s: share must be from 0 to 1", utilBaselineKey)
		}
		return nil
	case baselinePeriod:
		days, err := datesBetween(b.DateFrom, b.DateTo)
		if err != nil || len(days) == 0 || len(days) > maxMeasureDays {
			return fmt.Errorf("%s: date_from and date_to must be dates, at most %d days apart", utilBaselineKey, maxMeasureDays)
		}
		return nil
	}
	return fmt.Errorf("%s: method must be %s or %s", utilBaselineKey, baselinePeriod, baselineValue)
}

// validKPISetting checks the kpi.* settings.
func validKPISetting(key string, value any) error {
	switch key {
	case utilTargetKey:
		if n, ok := toFloat(value); !ok || !(n > 0 && n <= 100) {
			return fmt.Errorf("%s must be a number above 0, at most 100", key)
		}
	case utilBaselineKey:
		b, ok := baselineFrom(value)
		if !ok {
			return fmt.Errorf("%s must be an object with a method", key)
		}
		return validBaseline(b)
	}
	return nil
}

func baselineFrom(value any) (baselineSetting, bool) {
	m, ok := value.(map[string]any)
	if !ok {
		return baselineSetting{}, false
	}
	var b baselineSetting
	b.Method, _ = m["method"].(string)
	b.DateFrom, _ = m["date_from"].(string)
	b.DateTo, _ = m["date_to"].(string)
	if v, ok := toFloat(m["share"]); ok {
		b.Share = &v
	}
	return b, true
}

// GetUtilization: worked over available hours.
func GetUtilization(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, q PeriodQuery) (UtilizationReport, error) {
	days, err := measurePeriod(rc, q)
	if err != nil {
		return UtilizationReport{}, err
	}
	zones, err := measureZones(ctx, conn, rc, q.ZoneID)
	if err != nil {
		return UtilizationReport{}, err
	}
	plan, err := loadPlan(ctx, conn, rc)
	if err != nil {
		return UtilizationReport{}, err
	}
	rows, sources, err := utilizationOf(ctx, conn, rc, plan, zones, days)
	if err != nil {
		return UtilizationReport{}, err
	}
	baseline, err := utilizationBaseline(ctx, conn, rc.CustomerID)
	if err != nil {
		return UtilizationReport{}, err
	}
	baseByZone := map[string]*UtilizationZone{}
	if baseline.Method == baselinePeriod {
		baseDays, err := datesBetween(*baseline.DateFrom, *baseline.DateTo)
		if err != nil {
			return UtilizationReport{}, err
		}
		baseRows, baseSources, err := utilizationOf(ctx, conn, rc, plan, zones, baseDays)
		if err != nil {
			return UtilizationReport{}, err
		}
		sources = append(sources, baseSources...)
		var worked, available float64
		for i := range baseRows {
			baseByZone[baseRows[i].ZoneID] = &baseRows[i]
			worked, available = worked+baseRows[i].WorkedHours, available+baseRows[i].AvailableHours
		}
		baseline.Share = shareOf(worked, available)
	}
	_, source := inputProvenance(sources)
	if len(sources) == 0 {
		source = "SYNTHETIC"
	}
	out := UtilizationReport{DateFrom: q.DateFrom, DateTo: q.DateTo, Baseline: baseline, Zones: []UtilizationZone{}, Illustrative: true, DataSource: source}
	for _, row := range rows {
		if baseline.Method == baselineValue {
			row.withBaseline(nil, baseline.Share)
		} else {
			row.withBaseline(baseByZone[row.ZoneID], nil)
		}
		out.WorkedHours += row.WorkedHours
		out.AvailableHours += row.AvailableHours
		out.Zones = append(out.Zones, row)
	}
	out.WorkedHours, out.AvailableHours = round2(out.WorkedHours), round2(out.AvailableHours)
	out.Share = shareOf(out.WorkedHours, out.AvailableHours)
	out.ChangePoints = pointsBetween(out.Share, baseline.Share)
	return out, nil
}
