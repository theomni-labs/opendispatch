// SPDX-License-Identifier: AGPL-3.0-only

// Ports roster-plan.ts: the plan reader, gap
// arithmetic, the placeholder optimizer and the
// scenario simulator. Roster/RosterAssignment are
// Postgres; Scenario is in-memory, like
// Override/Approval/ForecastRun (see rosters.go).
package business

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"math"
	"sort"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/engines"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/fixtures"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/importutil"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/reqctx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
)

// Roster mirrors the contract's Roster.
type Roster struct {
	datactx.BaseRecord
	ZoneID           string  `json:"zone_id"`
	RosterDate       string  `json:"roster_date"`
	Status           string  `json:"status"`
	ForecastRunID    *string `json:"forecast_run_id"`
	PlanningLevel    string  `json:"planning_level"`
	OptimizerStatus  *string `json:"optimizer_status"`
	OptimizerSource  *string `json:"optimizer_source"`
	FallbackReason   *string `json:"fallback_reason"`
	EngineVersion    *string `json:"engine_version"`
	OptimizerModel   *string `json:"optimizer_model,omitempty"`
	SolverStatus     *string `json:"solver_status,omitempty"`
	Illustrative     bool    `json:"illustrative"`
	GapCount         *int    `json:"gap_count"`
	SurplusCount     *int    `json:"surplus_count"`
	ApprovedByUserID *string `json:"approved_by_user_id"`
	ApprovedAt       *string `json:"approved_at"`
	PublishedAt      *string `json:"published_at"`
}

// RosterAssignment mirrors the contract type.
type RosterAssignment struct {
	datactx.BaseRecord
	RosterID       string  `json:"roster_id"`
	AgentID        string  `json:"agent_id"`
	ShiftPatternID *string `json:"shift_pattern_id"`
	ZoneID         *string `json:"zone_id"`
	RosterDate     string  `json:"roster_date"`
	StartAt        string  `json:"start_at"`
	EndAt          string  `json:"end_at"`
	VehicleID      *string `json:"vehicle_id"`
	BreakStartAt   *string `json:"break_start_at"`
	BreakEndAt     *string `json:"break_end_at"`
	StandbyPointID *string `json:"standby_point_id"`
	IsOverride     bool    `json:"is_override"`
}

// LeaveRequest mirrors the contract's LeaveRequest.
type LeaveRequest struct {
	datactx.BaseRecord
	AgentID         string  `json:"agent_id"`
	StartDate       string  `json:"start_date"`
	EndDate         string  `json:"end_date"`
	LeaveType       string  `json:"leave_type"`
	Status          string  `json:"status"`
	RequestedAt     string  `json:"requested_at"`
	DecidedAt       *string `json:"decided_at"`
	DecidedByUserID *string `json:"decided_by_user_id"`
	DecisionNote    *string `json:"decision_note"`
	Note            *string `json:"note"`
}

func nullableTimeToISO(t *time.Time) *string {
	if t == nil {
		return nil
	}
	s := datactx.ToRiyadhISO(*t)
	return &s
}

func allRosters(ctx context.Context, conn *tenancy.Connection, tenantID string) ([]Roster, error) {
	return tenancy.WithTenant(ctx, conn.Pool, tenantID, func(ctx context.Context, tx pgx.Tx) ([]Roster, error) {
		rows, err := tx.Query(ctx, `SELECT id, tenant_id, created_at, updated_at, created_by, data_source, zone_id, roster_date, status, forecast_run_id, planning_level, optimizer_status, optimizer_source, fallback_reason, engine_version, optimizer_model, solver_status, illustrative, gap_count, surplus_count, approved_by_user_id, approved_at, published_at FROM rosters ORDER BY created_at, id`)
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		var out []Roster
		for rows.Next() {
			var r Roster
			var createdAt, updatedAt, rosterDate time.Time
			var approvedAt, publishedAt *time.Time
			if err := rows.Scan(&r.ID, &r.TenantID, &createdAt, &updatedAt, &r.CreatedBy, &r.DataSource, &r.ZoneID, &rosterDate, &r.Status, &r.ForecastRunID, &r.PlanningLevel, &r.OptimizerStatus, &r.OptimizerSource, &r.FallbackReason, &r.EngineVersion, &r.OptimizerModel, &r.SolverStatus, &r.Illustrative, &r.GapCount, &r.SurplusCount, &r.ApprovedByUserID, &approvedAt, &publishedAt); err != nil {
				return nil, err
			}
			r.CreatedAt, r.UpdatedAt = datactx.ToRiyadhISO(createdAt), datactx.ToRiyadhISO(updatedAt)
			r.RosterDate = rosterDate.Format("2006-01-02")
			r.ApprovedAt, r.PublishedAt = nullableTimeToISO(approvedAt), nullableTimeToISO(publishedAt)
			out = append(out, r)
		}
		return out, rows.Err()
	})
}

func oneRoster(ctx context.Context, conn *tenancy.Connection, tenantID, id string) (*Roster, error) {
	rows, err := allRosters(ctx, conn, tenantID)
	if err != nil {
		return nil, err
	}
	for _, r := range rows {
		if r.ID == id {
			return &r, nil
		}
	}
	return nil, nil
}

func allRosterAssignments(ctx context.Context, conn *tenancy.Connection, tenantID string) ([]RosterAssignment, error) {
	return rosterAssignmentsWhere(ctx, conn, tenantID, "")
}

// rosterAssignmentsOnDate: one roster date's lines.
func rosterAssignmentsOnDate(ctx context.Context, conn *tenancy.Connection, tenantID, date string) ([]RosterAssignment, error) {
	return rosterAssignmentsWhere(ctx, conn, tenantID, "WHERE roster_date = $1::date", date)
}

func rosterAssignmentsWhere(ctx context.Context, conn *tenancy.Connection, tenantID, where string, args ...any) ([]RosterAssignment, error) {
	return tenancy.WithTenant(ctx, conn.Pool, tenantID, func(ctx context.Context, tx pgx.Tx) ([]RosterAssignment, error) {
		rows, err := tx.Query(ctx, `SELECT id, tenant_id, created_at, updated_at, created_by, data_source, roster_id, agent_id, shift_pattern_id, zone_id, roster_date, start_at, end_at, vehicle_id, break_start_at, break_end_at, standby_point_id, is_override FROM roster_assignments `+where+` ORDER BY created_at, id`, args...)
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		var out []RosterAssignment
		for rows.Next() {
			var a RosterAssignment
			var createdAt, updatedAt, rosterDate, startAt, endAt time.Time
			var breakStartAt, breakEndAt *time.Time
			if err := rows.Scan(&a.ID, &a.TenantID, &createdAt, &updatedAt, &a.CreatedBy, &a.DataSource, &a.RosterID, &a.AgentID, &a.ShiftPatternID, &a.ZoneID, &rosterDate, &startAt, &endAt, &a.VehicleID, &breakStartAt, &breakEndAt, &a.StandbyPointID, &a.IsOverride); err != nil {
				return nil, err
			}
			a.CreatedAt, a.UpdatedAt = datactx.ToRiyadhISO(createdAt), datactx.ToRiyadhISO(updatedAt)
			a.RosterDate = rosterDate.Format("2006-01-02")
			a.StartAt, a.EndAt = datactx.ToRiyadhISO(startAt), datactx.ToRiyadhISO(endAt)
			a.BreakStartAt, a.BreakEndAt = nullableTimeToISO(breakStartAt), nullableTimeToISO(breakEndAt)
			out = append(out, a)
		}
		return out, rows.Err()
	})
}

func allLeaveRequests(ctx context.Context, conn *tenancy.Connection, tenantID string) ([]LeaveRequest, error) {
	return tenancy.WithTenant(ctx, conn.Pool, tenantID, func(ctx context.Context, tx pgx.Tx) ([]LeaveRequest, error) {
		rows, err := tx.Query(ctx, `SELECT id, tenant_id, created_at, updated_at, created_by, data_source, agent_id, start_date, end_date, leave_type, status, requested_at, decided_at, decided_by_user_id, decision_note, note FROM leave_requests ORDER BY created_at, id`)
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		var out []LeaveRequest
		for rows.Next() {
			var l LeaveRequest
			var createdAt, updatedAt, start, end, requestedAt time.Time
			var decidedAt *time.Time
			if err := rows.Scan(&l.ID, &l.TenantID, &createdAt, &updatedAt, &l.CreatedBy, &l.DataSource, &l.AgentID, &start, &end, &l.LeaveType, &l.Status, &requestedAt, &decidedAt, &l.DecidedByUserID, &l.DecisionNote, &l.Note); err != nil {
				return nil, err
			}
			l.CreatedAt, l.UpdatedAt = datactx.ToRiyadhISO(createdAt), datactx.ToRiyadhISO(updatedAt)
			l.StartDate, l.EndDate = start.Format("2006-01-02"), end.Format("2006-01-02")
			l.RequestedAt = datactx.ToRiyadhISO(requestedAt)
			l.DecidedAt = nullableTimeToISO(decidedAt)
			out = append(out, l)
		}
		return out, rows.Err()
	})
}

// GapCell mirrors OptimizerOutput's gap_cells item.
type GapCell struct {
	ZoneID        string   `json:"zone_id"`
	IntervalStart string   `json:"interval_start"`
	IntervalIndex int      `json:"interval_index"`
	Required      int      `json:"required"`
	Planned       int      `json:"planned"`
	Delta         int      `json:"delta"`
	Kind          string   `json:"kind"`
	Cause         *string  `json:"cause"`
	CauseDetail   *string  `json:"cause_detail,omitempty"`
	ReachShare    *float64 `json:"reach_share,omitempty"`
}

// OptimizerBaseline mirrors OptimizerBaseline.
type OptimizerBaseline struct {
	Date             string
	Required         map[string][]int
	EngineVersion    string
	CasesPerInterval map[string]float64
}

type optimizerOutputDoc struct {
	RosterDate   string `json:"roster_date"`
	ModelVersion string `json:"model_version"`
	Engine       struct {
		Version string `json:"version"`
	} `json:"engine"`
	Status             string               `json:"status"`
	SolverStatus       string               `json:"solver_status,omitempty"`
	CasesPerInterval   map[string]float64   `json:"opendispatch_cases_per_interval,omitempty"`
	RunSeconds         float64              `json:"run_seconds"`
	RosterAssignments  []optimizerLine      `json:"roster_assignments"`
	VehicleAssignments []optimizerVehicle   `json:"vehicle_assignments"`
	Violations         []OptimizerViolation `json:"violations"`
	GapCells           []struct {
		ZoneID        string `json:"zone_id"`
		IntervalIndex int    `json:"interval_index"`
		Required      int    `json:"required"`
		Planned       int    `json:"planned"`
		Kind          string `json:"kind"`
	} `json:"gap_cells"`
}

// readBaseline: the fixture's, for days with no answer.
func readBaseline() (*OptimizerBaseline, error) {
	var doc optimizerOutputDoc
	found, err := fixtures.Object("optimizer.output", &doc)
	if err != nil || !found {
		return nil, err
	}
	b := baselineOf(&doc)
	if b.CasesPerInterval == nil {
		b.CasesPerInterval = map[string]float64{}
		for zoneID := range b.Required {
			b.CasesPerInterval[zoneID] = fixtureCasesPerInterval
		}
	}
	return b, nil
}

// readDatedBaseline: the answer kept for that day.
func readDatedBaseline(ctx context.Context, tenant, date string) (*OptimizerBaseline, error) {
	if engineMode() != engines.ModeEngine {
		return nil, nil
	}
	body, err := readKeptScope(ctx, tenant, engines.Optimizer, date)
	if err != nil || body == nil {
		return nil, err
	}
	var doc optimizerOutputDoc
	if json.Unmarshal(body, &doc) != nil || doc.RosterDate != date {
		return nil, nil
	}
	return baselineOf(&doc), nil
}

func baselineOf(doc *optimizerOutputDoc) *OptimizerBaseline {
	required := map[string][]int{}
	for _, cell := range doc.GapCells {
		series, ok := required[cell.ZoneID]
		if !ok {
			series = make([]int, 96)
		}
		if cell.IntervalIndex >= 0 && cell.IntervalIndex < 96 {
			series[cell.IntervalIndex] = cell.Required
		}
		required[cell.ZoneID] = series
	}
	return &OptimizerBaseline{Date: doc.RosterDate, Required: required, EngineVersion: doc.Engine.Version, CasesPerInterval: doc.CasesPerInterval}
}

// datedBaselines memoizes kept answers per day.
type datedBaselines struct {
	mu    sync.Mutex
	byDay map[string]*OptimizerBaseline
}

// BaselineOn: the day's own answer, else nil.
func (p *PlanReader) BaselineOn(date string) (*OptimizerBaseline, error) {
	if p.dated == nil {
		return nil, nil
	}
	p.dated.mu.Lock()
	defer p.dated.mu.Unlock()
	if b, ok := p.dated.byDay[date]; ok {
		return b, nil
	}
	b, err := readDatedBaseline(p.ctx(), p.rc.CustomerID, date)
	if err != nil {
		return nil, err
	}
	p.dated.byDay[date] = b
	return b, nil
}

// forgetDay drops the memo after a new answer.
func (p *PlanReader) forgetDay(date string) {
	if p.dated == nil {
		return
	}
	p.dated.mu.Lock()
	delete(p.dated.byDay, date)
	p.dated.mu.Unlock()
}

// PlanReader mirrors PlanReader: read once per call.
type PlanReader struct {
	Rosters       []Roster
	LinesByRoster map[string][]RosterAssignment
	ApprovedLeave []LeaveRequest
	Factor        func(zoneID, date, referenceDate string) float64
	Baseline      *OptimizerBaseline
	dated         *datedBaselines
	Patterns      []ShiftPattern
	BreakRules    []BreakRule
	Agents        []Agent
	Vehicles      []Vehicle
	Points        []StandbyPoint
	Maintenance   []VehicleMaintenance

	rc    reqctx.RequestContext
	goCtx context.Context
	conn  *tenancy.Connection

	prayerMu    sync.Mutex
	prayerMemo  map[string][]PrayerMinute
	zoneRows    []Zone
	zonesLoaded bool
	ramadanMu   sync.Mutex
	ramadanMemo map[string]bool
	demandMu    sync.Mutex
	demand      *planDemand
}

// PrayerPolicy: the breaks-and-prayer policy.
func (p *PlanReader) PrayerPolicy() PrayerPolicy { return prayerPolicyOf(p.goCtx, p.rc.CustomerID) }

// Prayers memoizes PrayerMinutesFor per zone/date.
func (p *PlanReader) Prayers(zoneID, date string) ([]PrayerMinute, error) {
	key := zoneID + "|" + date
	p.prayerMu.Lock()
	if v, ok := p.prayerMemo[key]; ok {
		p.prayerMu.Unlock()
		return v, nil
	}
	p.prayerMu.Unlock()
	zones, err := p.zones()
	if err != nil {
		return nil, err
	}
	v, err := prayerMinutesIn(zones, zoneID, date)
	if err != nil {
		return nil, err
	}
	p.prayerMu.Lock()
	p.prayerMemo[key] = v
	p.prayerMu.Unlock()
	return v, nil
}

// zones: the tenant's zones, read once per plan.
func (p *PlanReader) zones() ([]Zone, error) {
	p.prayerMu.Lock()
	defer p.prayerMu.Unlock()
	if !p.zonesLoaded {
		rows, err := allZones(p.goCtx, p.conn, p.rc.CustomerID)
		if err != nil {
			return nil, err
		}
		p.zoneRows, p.zonesLoaded = rows, true
	}
	return p.zoneRows, nil
}

// Ramadan memoizes IsRamadan per date.
func (p *PlanReader) Ramadan(date string) (bool, error) {
	p.ramadanMu.Lock()
	if v, ok := p.ramadanMemo[date]; ok {
		p.ramadanMu.Unlock()
		return v, nil
	}
	p.ramadanMu.Unlock()
	v, err := IsRamadan(p.rc, date)
	if err != nil {
		return false, err
	}
	p.ramadanMu.Lock()
	p.ramadanMemo[date] = v
	p.ramadanMu.Unlock()
	return v, nil
}

// BreakRule: a pure lookup on already-loaded data,
// avoiding a Postgres round trip per line (no N+1).
func (p *PlanReader) BreakRule(shiftPatternID string) (breakMinutes int, afterHours float64) {
	for _, pat := range p.Patterns {
		if pat.ID != shiftPatternID {
			continue
		}
		if pat.BreakRuleID == nil {
			return 30, 5
		}
		for _, r := range p.BreakRules {
			if r.ID == *pat.BreakRuleID {
				return r.BreakMinutes, r.AfterConsecutiveHours
			}
		}
		return 30, 5
	}
	return 30, 5
}

// loadPlan mirrors loadPlan.
func loadPlan(goCtx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext) (*PlanReader, error) {
	allRostersRows, err := allRosters(goCtx, conn, rc.CustomerID)
	if err != nil {
		return nil, err
	}
	allLines, err := allRosterAssignments(goCtx, conn, rc.CustomerID)
	if err != nil {
		return nil, err
	}
	allLeave, err := allLeaveRequests(goCtx, conn, rc.CustomerID)
	if err != nil {
		return nil, err
	}
	allPatterns, err := allShiftPatterns(goCtx, conn, rc.CustomerID)
	if err != nil {
		return nil, err
	}
	allRules, err := allBreakRules(goCtx, conn, rc.CustomerID)
	if err != nil {
		return nil, err
	}
	allSurv, err := allAgents(goCtx, conn, rc.CustomerID)
	if err != nil {
		return nil, err
	}
	allVeh, err := allVehicles(goCtx, conn, rc.CustomerID)
	if err != nil {
		return nil, err
	}
	allPts, err := allStandbyPoints(goCtx, conn, rc.CustomerID)
	if err != nil {
		return nil, err
	}
	maintenance, err := allVehicleMaintenance(goCtx, conn, rc.CustomerID)
	if err != nil {
		return nil, err
	}

	var rosters []Roster
	readable := map[string]bool{}
	for _, r := range allRostersRows {
		zid := r.ZoneID
		if reqctx.CanReadZone(rc, &zid) {
			rosters = append(rosters, r)
			readable[r.ID] = true
		}
	}
	linesByRoster := map[string][]RosterAssignment{}
	for _, row := range allLines {
		if !readable[row.RosterID] || !reqctx.CanReadZone(rc, row.ZoneID) {
			continue
		}
		linesByRoster[row.RosterID] = append(linesByRoster[row.RosterID], row)
	}
	var agents []Agent
	readableSurv := map[string]bool{}
	for _, s := range allSurv {
		if reqctx.CanReadZone(rc, s.HomeZoneID) {
			agents = append(agents, s)
			readableSurv[s.ID] = true
		}
	}
	var approvedLeave []LeaveRequest
	for _, l := range allLeave {
		if l.Status == "approved" && readableSurv[l.AgentID] {
			approvedLeave = append(approvedLeave, l)
		}
	}
	var vehicles []Vehicle
	for _, v := range allVeh {
		if reqctx.CanReadZone(rc, v.ZoneID) {
			vehicles = append(vehicles, v)
		}
	}
	var points []StandbyPoint
	for _, pt := range allPts {
		zid := pt.ZoneID
		if reqctx.CanReadZone(rc, &zid) {
			points = append(points, pt)
		}
	}
	baseline, err := readBaseline()
	if err != nil {
		return nil, err
	}
	return &PlanReader{
		Rosters: rosters, LinesByRoster: linesByRoster, ApprovedLeave: approvedLeave,
		Factor: DayFactorOf(rc), Baseline: baseline, Patterns: allPatterns, BreakRules: allRules,
		dated:  &datedBaselines{byDay: map[string]*OptimizerBaseline{}},
		Agents: agents, Vehicles: vehicles, Points: points, Maintenance: maintenance,
		rc: rc, goCtx: goCtx, conn: conn,
		prayerMemo: map[string][]PrayerMinute{}, ramadanMemo: map[string]bool{},
	}, nil
}

// rosterFor: the newest non-superseded roster.
func rosterFor(plan *PlanReader, zoneID, date string) *Roster {
	var best *Roster
	for i := range plan.Rosters {
		r := plan.Rosters[i]
		if r.ZoneID != zoneID || r.RosterDate != date || r.Status == "superseded" {
			continue
		}
		if best == nil || r.CreatedAt > best.CreatedAt || (r.CreatedAt == best.CreatedAt && r.ID > best.ID) {
			row := r
			best = &row
		}
	}
	return best
}

// onLeave mirrors onLeave.
func onLeave(plan *PlanReader, agentID, date string) bool {
	for _, l := range plan.ApprovedLeave {
		if l.AgentID == agentID && l.StartDate <= date && date <= l.EndDate {
			return true
		}
	}
	return false
}

// dutyLines: today's roster plus the prior night
// shift that runs past midnight.
func dutyLines(plan *PlanReader, zoneID, date string) []RosterAssignment {
	var lines []RosterAssignment
	for _, day := range []string{shiftDateBy(date, -1), date} {
		roster := rosterFor(plan, zoneID, day)
		if roster == nil {
			continue
		}
		for _, line := range plan.LinesByRoster[roster.ID] {
			if line.ZoneID == nil || *line.ZoneID != zoneID || onLeave(plan, line.AgentID, line.RosterDate) {
				continue
			}
			if day != date {
				if endMin, err := MinutesOf(date, line.EndAt); err == nil && endMin <= 0 {
					continue
				}
			}
			lines = append(lines, line)
		}
	}
	return lines
}

// CoverageSeries mirrors CoverageSeries.
type CoverageSeries struct {
	OnDuty      []int
	WithVehicle []int
}

func quarterOf(iso string, base time.Time) int {
	t, err := time.Parse(time.RFC3339, iso)
	if err != nil {
		return 0
	}
	return int(math.Round(t.Sub(base).Minutes() / 15))
}

// coverageSeries mirrors coverageSeries.
func coverageSeries(lines []RosterAssignment, date string) CoverageSeries {
	onDuty := make([]int, 96)
	withVehicle := make([]int, 96)
	base, err := time.Parse(time.RFC3339, date+"T00:00:00+03:00")
	if err != nil {
		return CoverageSeries{OnDuty: onDuty, WithVehicle: withVehicle}
	}
	for _, line := range lines {
		away := map[int]bool{}
		if line.BreakStartAt != nil && line.BreakEndAt != nil {
			for i := quarterOf(*line.BreakStartAt, base); i < quarterOf(*line.BreakEndAt, base); i++ {
				away[i] = true
			}
		}
		start, end := quarterOf(line.StartAt, base), quarterOf(line.EndAt, base)
		if start < 0 {
			start = 0
		}
		if end > 96 {
			end = 96
		}
		for i := start; i < end; i++ {
			if away[i] {
				continue
			}
			onDuty[i]++
			if line.VehicleID != nil {
				withVehicle[i]++
			}
		}
	}
	return CoverageSeries{OnDuty: onDuty, WithVehicle: withVehicle}
}

// GeographyInput mirrors GeographyInput.
type GeographyInput struct {
	Uncovered     int
	SubZones      int
	StaffedPoints int
}

func pluralWord(n int, one, many string) string {
	if n == 1 {
		return fmt.Sprintf("%d %s", n, one)
	}
	return fmt.Sprintf("%d %s", n, many)
}

// gapCells: planned against required, with cause.
func gapCells(zoneID, date string, series CoverageSeries, required []int, geo GeographyInput, share float64) []GapCell {
	cells := make([]GapCell, 0, 96)
	for i := 0; i < 96; i++ {
		planned, onDuty := expectedOnDuty(series.WithVehicle[i], share), expectedOnDuty(series.OnDuty[i], share)
		need := 0
		if i < len(required) {
			need = required[i]
		}
		delta := planned - need
		intervalStart := fmt.Sprintf("%sT%02d:%02d:00+03:00", date, i/4, (i%4)*15)
		cell := GapCell{ZoneID: zoneID, IntervalStart: intervalStart, IntervalIndex: i, Required: need, Planned: planned, Delta: delta}
		switch {
		case delta == 0:
			cell.Kind = "balanced"
		case delta > 0:
			cell.Kind = "surplus"
			cause := "people"
			detail := pluralWord(delta, "more agent", "more agents") + " than needed."
			cell.Cause, cell.CauseDetail = &cause, &detail
		case onDuty >= need:
			cell.Kind = "gap"
			cause := "vehicles"
			detail := pluralWord(-delta, "more vehicle", "more vehicles") + " needed."
			cell.Cause, cell.CauseDetail = &cause, &detail
		case delta == -1 && geo.Uncovered > 0 && geo.StaffedPoints > 0:
			cell.Kind = "gap"
			cause := "geography"
			detail := fmt.Sprintf("Only %s %d of %d sub-zones.", pluralWord(geo.StaffedPoints, "standby point covers", "standby points cover"), geo.SubZones-geo.Uncovered, geo.SubZones)
			cell.Cause, cell.CauseDetail = &cause, &detail
		default:
			cell.Kind = "gap"
			cause := "people"
			detail := pluralWord(-delta, "more agent", "more agents") + " needed."
			cell.Cause, cell.CauseDetail = &cause, &detail
		}
		cells = append(cells, cell)
	}
	return cells
}

// expectedOnDuty: headcount less expected sick.
func expectedOnDuty(n int, share float64) int {
	if share <= 0 || share >= 1 {
		return n
	}
	return int(math.Round(float64(n) * share))
}

// countCells mirrors countCells.
func countCells(cells []GapCell) (gaps, surpluses int) {
	for _, c := range cells {
		switch c.Kind {
		case "gap":
			gaps++
		case "surplus":
			surpluses++
		}
	}
	return gaps, surpluses
}

// requiredSeries mirrors requiredSeries.
func requiredSeries(plan *PlanReader, zoneID, date string) []int {
	out := make([]int, 96)
	baseline := plan.Baseline
	if own, err := plan.BaselineOn(date); err != nil {
		log.Printf("roster plan: kept answer for %s: %v", date, err)
	} else if own != nil {
		if _, ok := own.Required[zoneID]; ok {
			baseline = own
		}
	}
	if baseline == nil {
		return out
	}
	base, ok := baseline.Required[zoneID]
	if !ok {
		return out
	}
	factor := plan.Factor(zoneID, date, baseline.Date) * plan.requiredRatio(baseline, zoneID)
	for i, n := range base {
		v := int(math.Round(float64(n) * factor))
		if v < 0 {
			v = 0
		}
		out[i] = v
	}
	return out
}

func peakStaffByPointFromLines(lines []RosterAssignment) map[string]int {
	converted := make([]standbyAssignment, 0, len(lines))
	for _, l := range lines {
		converted = append(converted, standbyAssignment{
			StartAt: l.StartAt, EndAt: l.EndAt, BreakStartAt: l.BreakStartAt, BreakEndAt: l.BreakEndAt,
			StandbyPointID: l.StandbyPointID, RosterDate: l.RosterDate,
		})
	}
	return peakStaffByPoint(converted)
}

// cellsForLines mirrors cellsForLines.
func cellsForLines(ctx context.Context, rc reqctx.RequestContext, plan *PlanReader, zoneID, date string, lines []RosterAssignment, required []int) []GapCell {
	var todaysLines []RosterAssignment
	for _, l := range lines {
		if l.RosterDate == date {
			todaysLines = append(todaysLines, l)
		}
	}
	staff := peakStaffByPointFromLines(todaysLines)
	coverage := coverageOf(ctx, rc, zoneID, staff)
	if required == nil {
		required = requiredSeries(plan, zoneID, date)
	}
	return gapCells(zoneID, date, coverageSeriesAvail(lines, date, plan.Maintenance), required, GeographyInput{
		Uncovered: len(coverage.Uncovered), SubZones: coverage.SubZoneCount, StaffedPoints: coverage.StaffedPoints,
	}, plan.Demand().availableShare(zoneID, date))
}

// currentCells: the gap cells as the roster stands
// now (no roster: nobody on duty).
func currentCells(ctx context.Context, rc reqctx.RequestContext, plan *PlanReader, zoneID, date string) []GapCell {
	return cellsForLines(ctx, rc, plan, zoneID, date, dutyLines(plan, zoneID, date), nil)
}

// currentCellsWithReach adds reach_share per interval.
func currentCellsWithReach(ctx context.Context, rc reqctx.RequestContext, plan *PlanReader, in *reachInputs, zoneID, date string) []GapCell {
	lines := dutyLines(plan, zoneID, date)
	return addReach(ctx, in, cellsForLines(ctx, rc, plan, zoneID, date, lines, nil), zoneID, date, lines)
}

// patternHours mirrors patternHours.
func patternHours(pattern ShiftPattern, ramadan bool) (startMin, endMin int, ok bool) {
	hours := pattern.Normal
	if ramadan && pattern.Ramadan.Applies {
		hours = pattern.Ramadan
	}
	if !hours.Applies || hours.StartTime == nil || hours.EndTime == nil {
		return 0, 0, false
	}
	clock := func(t string) int {
		h := int(t[0]-'0')*10 + int(t[1]-'0')
		m := int(t[3]-'0')*10 + int(t[4]-'0')
		return h*60 + m
	}
	startMin = clock(*hours.StartTime)
	endMin = clock(*hours.EndTime)
	if endMin <= startMin {
		endMin += 1440
	}
	return startMin, endMin, true
}

var homeShiftCode = map[string]string{"day_a": "DAY-A", "day_b": "DAY-B", "night": "NIGHT"}

// fallbackPattern: home shift if eligible, else first.
func fallbackPattern(s Agent, byCode map[string]ShiftPattern) (ShiftPattern, bool) {
	homeShift, _ := s.Extra["home_shift"].(string)
	home, ok := byCode[homeShiftCode[homeShift]]
	if s.EligibleShiftPatternIDs == nil {
		return home, ok
	}
	if ok && containsStr(s.EligibleShiftPatternIDs, home.ID) {
		return home, true
	}
	var all []ShiftPattern
	for _, p := range byCode {
		all = append(all, p)
	}
	if el := eligiblePatterns(all, s); len(el) > 0 {
		return el[0], true
	}
	return ShiftPattern{}, false
}

// projectLines: the lines a zone's field agents
// would work on a date. Deterministic.
func projectLines(rc reqctx.RequestContext, plan *PlanReader, zoneID, date string) ([]RosterAssignment, error) {
	ramadan, err := plan.Ramadan(date)
	if err != nil {
		return nil, err
	}
	patternsByCode := map[string]ShiftPattern{}
	for _, p := range plan.Patterns {
		patternsByCode[p.Code] = p
	}
	var points []StandbyPoint
	for _, p := range plan.Points {
		if p.ZoneID == zoneID && p.IsActive {
			points = append(points, p)
		}
	}
	sort.Slice(points, func(i, j int) bool {
		if points[i].NameEn != points[j].NameEn {
			return points[i].NameEn < points[j].NameEn
		}
		return points[i].ID < points[j].ID
	})
	var vehicles []Vehicle
	down := vehiclesDownOn(plan.Maintenance, date)
	for _, v := range plan.Vehicles {
		if v.ZoneID != nil && *v.ZoneID == zoneID && v.IsActive && !down[v.ID] {
			vehicles = append(vehicles, v)
		}
	}
	sort.Slice(vehicles, func(i, j int) bool { return vehicles[i].Code < vehicles[j].Code })
	blocked := weeklyBlocks(plan, date, ramadan, nil)
	var agents []Agent
	for _, s := range plan.Agents {
		if s.Kind != "field" || !s.IsActive || s.HomeZoneID == nil || *s.HomeZoneID != zoneID {
			continue
		}
		if blocked[s.ID] != "" || onLeave(plan, s.ID, date) {
			continue
		}
		agents = append(agents, s)
	}
	sort.Slice(agents, func(i, j int) bool { return agents[i].Code < agents[j].Code })

	type stagedLine struct {
		line             RosterAssignment
		startMin, endMin int
		pattern          ShiftPattern
	}
	used := map[string]int{}
	var staged []stagedLine
	robin := 0
	for _, s := range agents {
		pattern, ok := fallbackPattern(s, patternsByCode)
		if !ok {
			continue
		}
		startMin, endMin, ok := patternHours(pattern, ramadan)
		if !ok {
			continue
		}
		taken := used[pattern.ID]
		used[pattern.ID] = taken + 1
		homePointID, _ := s.Extra["standby_point_id"].(string)
		var point *StandbyPoint
		for i := range points {
			if points[i].ID == homePointID {
				point = &points[i]
				break
			}
		}
		if point == nil && len(points) > 0 {
			point = &points[robin%len(points)]
			robin++
		}
		startAt, err := IsoAtMinute(date, startMin)
		if err != nil {
			return nil, err
		}
		endAt, err := IsoAtMinute(date, endMin)
		if err != nil {
			return nil, err
		}
		var vehicleID *string
		if taken < len(vehicles) {
			id := vehicles[taken].ID
			vehicleID = &id
		}
		var standbyPointID *string
		if point != nil {
			id := point.ID
			standbyPointID = &id
		}
		agentID, patternID, zid := s.ID, pattern.ID, zoneID
		line := RosterAssignment{
			AgentID: agentID, ShiftPatternID: &patternID, ZoneID: &zid, RosterDate: date,
			StartAt: startAt, EndAt: endAt, VehicleID: vehicleID, StandbyPointID: standbyPointID,
		}
		staged = append(staged, stagedLine{line: line, startMin: startMin, endMin: endMin, pattern: pattern})
	}

	inputs := make([]BreakInput, len(staged))
	for i, row := range staged {
		bm, ah := plan.BreakRule(row.pattern.ID)
		inputs[i] = BreakInput{Key: fmt.Sprintf("%04d", i), StartMin: row.startMin, EndMin: row.endMin, BreakMinutes: bm, AfterHours: ah}
	}
	prayers, err := plan.Prayers(zoneID, date)
	if err != nil {
		return nil, err
	}
	placedByKey := map[string]BreakPlacement{}
	for _, placement := range PlaceBreaks(inputs, prayers, plan.PrayerPolicy()) {
		placedByKey[placement.Key] = placement
	}
	out := make([]RosterAssignment, len(staged))
	for i, row := range staged {
		line := row.line
		if placed, ok := placedByKey[fmt.Sprintf("%04d", i)]; ok {
			bs, err := IsoAtMinute(date, placed.StartMin)
			if err != nil {
				return nil, err
			}
			be, err := IsoAtMinute(date, placed.EndMin)
			if err != nil {
				return nil, err
			}
			line.BreakStartAt, line.BreakEndAt = &bs, &be
		}
		out[i] = line
	}
	return out, nil
}

// HeadcountDelta: one headcount_delta entry.
type HeadcountDelta struct {
	ZoneID       string `json:"zone_id"`
	FieldAgents  int    `json:"field_agents"`
	RemoteAgents int    `json:"remote_agents"` // stored, not applied (as TS)
	Vehicles     int    `json:"vehicles"`
}

// ScenarioAdjustments mirrors ScenarioAdjustments.
type ScenarioAdjustments struct {
	HeadcountDelta  []HeadcountDelta `json:"headcount_delta"`
	ShiftPatternIDs []string         `json:"shift_pattern_ids"`
	RemoteShare     *float64         `json:"remote_share"`
}

// MarshalJSON keeps a list's key only when it is set.
func (a ScenarioAdjustments) MarshalJSON() ([]byte, error) {
	out := map[string]any{"remote_share": a.RemoteShare}
	if a.HeadcountDelta != nil {
		out["headcount_delta"] = a.HeadcountDelta
	}
	if a.ShiftPatternIDs != nil {
		out["shift_pattern_ids"] = a.ShiftPatternIDs
	}
	return json.Marshal(out)
}

// Scenario mirrors the contract type. In-memory.
type Scenario struct {
	datactx.BaseRecord
	Name        string              `json:"name"`
	BaseDate    string              `json:"base_date"`
	ZoneIDs     []string            `json:"zone_ids"`
	Adjustments ScenarioAdjustments `json:"adjustments"`
	Status      string              `json:"status"`
	LastRunAt   *string             `json:"last_run_at"`
}

var (
	scenarioMu     sync.Mutex
	scenarioStore  []Scenario
	scenarioSeeded bool
)

// ResetScenariosForTest empties the store (no fixtures).
func ResetScenariosForTest() {
	scenarioMu.Lock()
	scenarioStore, scenarioSeeded = nil, true
	scenarioMu.Unlock()
}

// ReloadScenariosForTest restores the fixture scenarios.
func ReloadScenariosForTest() {
	scenarioMu.Lock()
	scenarioStore, scenarioSeeded = nil, false
	scenarioMu.Unlock()
}

// seedScenariosLocked loads the fixtures once.
func seedScenariosLocked() {
	if scenarioSeeded {
		return
	}
	scenarioSeeded = true
	if rows, err := fixtures.Records[Scenario]("Scenario"); err == nil {
		scenarioStore = rows
	}
}

func upsertScenarioRowMemory(s Scenario) Scenario {
	scenarioMu.Lock()
	defer scenarioMu.Unlock()
	seedScenariosLocked()
	for i, x := range scenarioStore {
		if x.ID == s.ID {
			scenarioStore[i] = s
			return s
		}
	}
	scenarioStore = append(scenarioStore, s)
	return s
}

func allScenarioRowsMemory() []Scenario {
	scenarioMu.Lock()
	seedScenariosLocked()
	out := append([]Scenario(nil), scenarioStore...)
	scenarioMu.Unlock()
	return out
}

// scenarioByID: a scenario the caller may read.
func scenarioByID(ctx context.Context, rc reqctx.RequestContext, id string) (*Scenario, error) {
	if _, err := importutil.RequireID(id, "Scenario"); err != nil {
		return nil, err
	}
	s, err := loadScenario(ctx, rc.CustomerID, id)
	if err != nil || s == nil {
		return nil, err
	}
	for _, zid := range s.ZoneIDs {
		z := zid
		if !reqctx.CanReadZone(rc, &z) {
			return nil, nil
		}
	}
	return s, nil
}

// ScenarioZonePlan mirrors ScenarioZonePlan.
type ScenarioZonePlan struct {
	ZoneID string
	Lines  []RosterAssignment
	Cells  []GapCell
}

func patternIDOf(l RosterAssignment) string {
	if l.ShiftPatternID == nil {
		return ""
	}
	return *l.ShiftPatternID
}

// scenarioZonePlans: the optimizer's kept lines
// when the run is current, else the re-plan.
func scenarioZonePlans(ctx context.Context, rc reqctx.RequestContext, plan *PlanReader, scenario *Scenario, onlyZoneID string) ([]ScenarioZonePlan, error) {
	kept, err := keptScenarioLines(ctx, rc.CustomerID, scenario)
	if err != nil {
		return nil, err
	}
	return planScenarioZones(ctx, rc, plan, scenario, onlyZoneID, kept)
}

// planScenarioZones: adjustments per zone, cells
// recomputed; engine lines replace the re-plan.
func planScenarioZones(ctx context.Context, rc reqctx.RequestContext, plan *PlanReader, scenario *Scenario, onlyZoneID string, engine map[string][]RosterAssignment) ([]ScenarioZonePlan, error) {
	date := scenario.BaseDate
	ramadan, err := plan.Ramadan(date)
	if err != nil {
		return nil, err
	}
	adjustments := scenario.Adjustments
	allPatterns := plan.Patterns

	var chosen []ShiftPattern
	for _, id := range adjustments.ShiftPatternIDs {
		for _, p := range allPatterns {
			if p.ID != id {
				continue
			}
			if p.Kind != "field" {
				break
			}
			if _, _, ok := patternHours(p, ramadan); !ok {
				break
			}
			chosen = append(chosen, p)
			break
		}
	}
	sort.SliceStable(chosen, func(i, j int) bool {
		si, _, _ := patternHours(chosen[i], ramadan)
		sj, _, _ := patternHours(chosen[j], ramadan)
		if si != sj {
			return si < sj
		}
		return chosen[i].Code < chosen[j].Code
	})

	var out []ScenarioZonePlan
	for _, zoneID := range scenario.ZoneIDs {
		if onlyZoneID != "" && zoneID != onlyZoneID {
			continue
		}
		roster := rosterFor(plan, zoneID, date)
		var carry []RosterAssignment
		for _, l := range dutyLines(plan, zoneID, date) {
			if l.RosterDate != date {
				carry = append(carry, l)
			}
		}
		var today []RosterAssignment
		if roster == nil {
			projected, err := projectLines(rc, plan, zoneID, date)
			if err != nil {
				return nil, err
			}
			for i, line := range projected {
				line.ID = datactx.DeterministicUUID(fmt.Sprintf("scenario:%s:%s:base:%d", scenario.ID, zoneID, i))
				line.RosterID = ""
				today = append(today, line)
			}
		} else {
			for _, l := range dutyLines(plan, zoneID, date) {
				if l.RosterDate == date {
					today = append(today, l)
				}
			}
		}
		sort.SliceStable(today, func(i, j int) bool {
			if today[i].StartAt != today[j].StartAt {
				return today[i].StartAt < today[j].StartAt
			}
			return today[i].AgentID < today[j].AgentID
		})

		var delta *HeadcountDelta
		for i := range adjustments.HeadcountDelta {
			if adjustments.HeadcountDelta[i].ZoneID == zoneID {
				delta = &adjustments.HeadcountDelta[i]
				break
			}
		}
		fieldDelta, vehicleDelta := 0, 0
		if delta != nil {
			fieldDelta, vehicleDelta = delta.FieldAgents, delta.Vehicles
		}
		touched := len(chosen) > 0 || fieldDelta != 0 || vehicleDelta != 0

		var points []StandbyPoint
		for _, p := range plan.Points {
			if p.ZoneID == zoneID && p.IsActive {
				points = append(points, p)
			}
		}
		sort.Slice(points, func(i, j int) bool {
			if points[i].NameEn != points[j].NameEn {
				return points[i].NameEn < points[j].NameEn
			}
			return points[i].ID < points[j].ID
		})

		if lines, ok := engine[zoneID]; ok {
			today = lines
		} else if touched {
			adjusted, err := adjustScenarioLines(plan, scenario, zoneID, date, today, chosen, fieldDelta, vehicleDelta, ramadan, points)
			if err != nil {
				return nil, err
			}
			today = adjusted
		}

		required := requiredSeries(plan, zoneID, date)
		if adjustments.RemoteShare != nil {
			share, err := runFieldShare(ctx, rc, zoneID, date)
			if err != nil {
				return nil, err
			}
			factor := 1.0
			if share != 0 {
				factor = (1 - *adjustments.RemoteShare) / share
				if factor < 0 {
					factor = 0
				}
				if factor > 2 {
					factor = 2
				}
			}
			for i, n := range required {
				required[i] = int(math.Round(float64(n) * factor))
			}
		}
		lines := append(append([]RosterAssignment(nil), carry...), today...)
		cells := cellsForLines(ctx, rc, plan, zoneID, date, lines, required)
		out = append(out, ScenarioZonePlan{ZoneID: zoneID, Lines: lines, Cells: cells})
	}
	return out, nil
}

// sameShiftSet: lines use exactly the chosen patterns.
func sameShiftSet(lines []RosterAssignment, chosen []ShiftPattern) bool {
	inUse, want := map[string]bool{}, map[string]bool{}
	for _, l := range lines {
		inUse[patternIDOf(l)] = true
	}
	for _, p := range chosen {
		want[p.ID] = true
	}
	if len(inUse) != len(want) {
		return false
	}
	for id := range inUse {
		if !want[id] {
			return false
		}
	}
	return true
}

// adjustScenarioLines: lines kept, then changes.
func adjustScenarioLines(plan *PlanReader, scenario *Scenario, zoneID, date string, today []RosterAssignment, chosen []ShiftPattern, fieldDelta, vehicleDelta int, ramadan bool, points []StandbyPoint) ([]RosterAssignment, error) {
	byID := map[string]ShiftPattern{}
	for _, p := range plan.Patterns {
		byID[p.ID] = p
	}
	withHours := func(l *RosterAssignment, pattern ShiftPattern) {
		startMin, endMin, _ := patternHours(pattern, ramadan)
		l.StartAt, _ = IsoAtMinute(date, startMin)
		l.EndAt, _ = IsoAtMinute(date, endMin)
		pid := pattern.ID
		l.ShiftPatternID = &pid
	}
	working := append([]RosterAssignment(nil), today...)
	needBreak := map[string]bool{}
	if len(chosen) > 0 && !sameShiftSet(working, chosen) {
		for i := range working {
			pattern := chosen[i%len(chosen)]
			if patternIDOf(working[i]) == pattern.ID {
				continue
			}
			withHours(&working[i], pattern)
			needBreak[working[i].ID] = true
		}
	}
	inUse := func() []ShiftPattern {
		if len(chosen) > 0 {
			return chosen
		}
		seen := map[string]bool{}
		var pats []ShiftPattern
		for _, l := range working {
			id := patternIDOf(l)
			if id == "" || seen[id] {
				continue
			}
			seen[id] = true
			if p, ok := byID[id]; ok {
				pats = append(pats, p)
			}
		}
		return pats
	}
	var added []string
	for n := 0; n < fieldDelta; n++ {
		patterns := inUse()
		if len(patterns) == 0 {
			break
		}
		counts := make([]int, len(patterns))
		for i, p := range patterns {
			for _, l := range working {
				if patternIDOf(l) == p.ID {
					counts[i]++
				}
			}
		}
		best := 0
		for i := 1; i < len(patterns); i++ {
			si, _, _ := patternHours(patterns[i], ramadan)
			sb, _, _ := patternHours(patterns[best], ramadan)
			if counts[i] < counts[best] || (counts[i] == counts[best] && si < sb) {
				best = i
			}
		}
		newID := datactx.DeterministicUUID(fmt.Sprintf("scenario:%s:%s:extra:%d", scenario.ID, zoneID, n))
		line := RosterAssignment{
			BaseRecord: datactx.BaseRecord{ID: newID}, AgentID: datactx.DeterministicUUID(fmt.Sprintf("scenario:%s:%s:agent:%d", scenario.ID, zoneID, n)),
			RosterDate: date,
		}
		zid := zoneID
		line.ZoneID = &zid
		withHours(&line, patterns[best])
		if len(points) > 0 {
			id := points[n%len(points)].ID
			line.StandbyPointID = &id
		}
		working = append(working, line)
		needBreak[newID] = true
		added = append(added, newID)
	}
	for n := 0; n < -fieldDelta && len(working) > 0; n++ {
		counts := map[string]int{}
		for _, l := range working {
			if id := patternIDOf(l); id != "" {
				counts[id]++
			}
		}
		biggest, biggestN := "", -1
		for id, cnt := range counts {
			if cnt > biggestN || (cnt == biggestN && id < biggest) {
				biggest, biggestN = id, cnt
			}
		}
		for i := len(working) - 1; i >= 0; i-- {
			if patternIDOf(working[i]) == biggest {
				working = append(working[:i], working[i+1:]...)
				break
			}
		}
	}
	var spare []string
	used := map[string]bool{}
	for _, l := range working {
		if l.VehicleID != nil {
			used[*l.VehicleID] = true
		}
	}
	var pool []Vehicle
	for _, v := range plan.Vehicles {
		if v.ZoneID != nil && *v.ZoneID == zoneID && v.IsActive && !used[v.ID] {
			pool = append(pool, v)
		}
	}
	sort.Slice(pool, func(i, j int) bool { return pool[i].Code < pool[j].Code })
	for _, v := range pool {
		spare = append(spare, v.ID)
	}
	for n := 0; n < vehicleDelta; n++ {
		spare = append(spare, datactx.DeterministicUUID(fmt.Sprintf("scenario:%s:%s:vehicle:%d", scenario.ID, zoneID, n)))
	}
	give := func(i int) {
		if len(spare) > 0 && working[i].VehicleID == nil {
			vid := spare[0]
			spare = spare[1:]
			working[i].VehicleID = &vid
		}
	}
	isAdded := map[string]bool{}
	for _, id := range added {
		isAdded[id] = true
	}
	for i := range working {
		if isAdded[working[i].ID] {
			give(i)
		}
	}
	if vehicleDelta > 0 {
		for i := range working {
			give(i)
		}
	}
	for i, n := len(working)-1, 0; i >= 0 && n < -vehicleDelta; i-- {
		if working[i].VehicleID != nil {
			working[i].VehicleID = nil
			n++
		}
	}
	var inputs []BreakInput
	for _, l := range working {
		if !needBreak[l.ID] {
			continue
		}
		s, _ := MinutesOf(date, l.StartAt)
		e, _ := MinutesOf(date, l.EndAt)
		bm, ah := plan.BreakRule(patternIDOf(l))
		inputs = append(inputs, BreakInput{Key: l.ID, StartMin: s, EndMin: e, BreakMinutes: bm, AfterHours: ah})
	}
	if len(inputs) == 0 {
		return working, nil
	}
	prayers, err := plan.Prayers(zoneID, date)
	if err != nil {
		return nil, err
	}
	placedByID := map[string]BreakPlacement{}
	for _, placement := range PlaceBreaks(inputs, prayers, plan.PrayerPolicy()) {
		placedByID[placement.Key] = placement
	}
	for i := range working {
		if !needBreak[working[i].ID] {
			continue
		}
		if placed, ok := placedByID[working[i].ID]; ok {
			bs, _ := IsoAtMinute(date, placed.StartMin)
			be, _ := IsoAtMinute(date, placed.EndMin)
			working[i].BreakStartAt, working[i].BreakEndAt = &bs, &be
		} else {
			working[i].BreakStartAt, working[i].BreakEndAt = nil, nil
		}
	}
	return working, nil
}

// ctx: the reader's request context, or Background.
func (p *PlanReader) ctx() context.Context {
	if p.goCtx == nil {
		return context.Background()
	}
	return p.goCtx
}
