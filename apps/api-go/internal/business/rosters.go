// SPDX-License-Identifier: AGPL-3.0-only

// Ports rosters.ts: build/submit/approve/publish a
// roster, plus overrides and the gap-and-surplus
// view. ForecastRun/Override are in-memory, like
// Approval (rules.go) - not api-backed yet, matching TS.
package business

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"
	"sync"

	"github.com/jackc/pgx/v5"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/access"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/auditlog"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/dataerr"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/engines"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/fixtures"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/importutil"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/reqctx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
)

const maxBuildDaysAhead = 60

var rosterStatuses = []string{"building", "draft", "submitted", "approved", "rejected", "published", "superseded"}
var overridable = []string{"draft", "rejected", "submitted", "approved"}
var overrideChanges = []string{"replace_agent", "change_shift", "change_vehicle", "remove_assignment", "add_assignment"}
var overrideReasons = []string{"agent_unavailable", "vehicle_unavailable", "closer_agent_known", "skills_needed", "dispatcher_judgement", "other"}

func getPlanningLevel(ctx context.Context, rc reqctx.RequestContext) string {
	v := readSetting(ctx, rc.CustomerID, "planning_level", "zone")
	if v == "sub_zone" || v == "city" {
		return v
	}
	return "zone"
}

func spaced(s string) string { return strings.ReplaceAll(s, "_", " ") }

func derefAny(p *string) any {
	if p == nil {
		return nil
	}
	return *p
}

// Roster/RosterAssignment writes

func upsertRosterTx(ctx context.Context, tx pgx.Tx, r Roster) error {
	_, err := tx.Exec(ctx, `INSERT INTO rosters (tenant_id, id, data_source, created_at, updated_at, created_by, zone_id, roster_date, status, forecast_run_id, planning_level, optimizer_status, optimizer_source, fallback_reason, engine_version, illustrative, gap_count, surplus_count, approved_by_user_id, approved_at, published_at, optimizer_model, solver_status)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)
		ON CONFLICT (tenant_id, id) DO UPDATE SET updated_at=$5, zone_id=$7, roster_date=$8, status=$9, forecast_run_id=$10, planning_level=$11, optimizer_status=$12, optimizer_source=$13, fallback_reason=$14, engine_version=$15, illustrative=$16, gap_count=$17, surplus_count=$18, approved_by_user_id=$19, approved_at=$20, published_at=$21, optimizer_model=$22, solver_status=$23`,
		r.TenantID, r.ID, r.DataSource, r.CreatedAt, r.UpdatedAt, r.CreatedBy, r.ZoneID, r.RosterDate, r.Status, r.ForecastRunID, r.PlanningLevel, r.OptimizerStatus, r.OptimizerSource, r.FallbackReason, r.EngineVersion, r.Illustrative, r.GapCount, r.SurplusCount, r.ApprovedByUserID, r.ApprovedAt, r.PublishedAt, r.OptimizerModel, r.SolverStatus)
	return err
}

func upsertRoster(ctx context.Context, conn *tenancy.Connection, tenantID string, r Roster) error {
	_, err := tenancy.WithTenant(ctx, conn.Pool, tenantID, func(ctx context.Context, tx pgx.Tx) (struct{}, error) {
		return struct{}{}, upsertRosterTx(ctx, tx, r)
	})
	return err
}

func upsertRosterAssignmentTx(ctx context.Context, tx pgx.Tx, a RosterAssignment) error {
	_, err := tx.Exec(ctx, `INSERT INTO roster_assignments (tenant_id, id, data_source, created_at, updated_at, created_by, roster_id, agent_id, shift_pattern_id, zone_id, roster_date, start_at, end_at, vehicle_id, break_start_at, break_end_at, standby_point_id, is_override)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
		ON CONFLICT (tenant_id, id) DO UPDATE SET updated_at=$5, roster_id=$7, agent_id=$8, shift_pattern_id=$9, zone_id=$10, roster_date=$11, start_at=$12, end_at=$13, vehicle_id=$14, break_start_at=$15, break_end_at=$16, standby_point_id=$17, is_override=$18`,
		a.TenantID, a.ID, a.DataSource, a.CreatedAt, a.UpdatedAt, a.CreatedBy, a.RosterID, a.AgentID, a.ShiftPatternID, a.ZoneID, a.RosterDate, a.StartAt, a.EndAt, a.VehicleID, a.BreakStartAt, a.BreakEndAt, a.StandbyPointID, a.IsOverride)
	return err
}

func upsertRosterAssignments(ctx context.Context, conn *tenancy.Connection, tenantID string, rows []RosterAssignment) error {
	_, err := tenancy.WithTenant(ctx, conn.Pool, tenantID, func(ctx context.Context, tx pgx.Tx) (struct{}, error) {
		for _, a := range rows {
			if err := upsertRosterAssignmentTx(ctx, tx, a); err != nil {
				return struct{}{}, err
			}
		}
		return struct{}{}, nil
	})
	return err
}

func removeRosterAssignment(ctx context.Context, conn *tenancy.Connection, tenantID, id string) error {
	_, err := tenancy.WithTenant(ctx, conn.Pool, tenantID, func(ctx context.Context, tx pgx.Tx) (struct{}, error) {
		_, err := tx.Exec(ctx, `DELETE FROM roster_assignments WHERE tenant_id=$1 AND id=$2`, tenantID, id)
		return struct{}{}, err
	})
	return err
}

func zoneNameOf(ctx context.Context, conn *tenancy.Connection, tenantID, zoneID string) (string, error) {
	zones, err := allZones(ctx, conn, tenantID)
	if err != nil {
		return "", err
	}
	for _, z := range zones {
		if z.ID == zoneID {
			return z.NameEn, nil
		}
	}
	return "the zone", nil
}

// Reading rosters

func withCounts(ctx context.Context, rc reqctx.RequestContext, plan *PlanReader, roster Roster) Roster {
	gaps, surpluses := countCells(currentCells(ctx, rc, plan, roster.ZoneID, roster.RosterDate))
	roster.GapCount, roster.SurplusCount = &gaps, &surpluses
	return roster
}

func requireRoster(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, id string) (Roster, error) {
	if _, err := importutil.RequireID(id, "Roster"); err != nil {
		return Roster{}, err
	}
	rows, err := allRosters(ctx, conn, rc.CustomerID)
	if err != nil {
		return Roster{}, err
	}
	for _, r := range rows {
		if r.ID != id {
			continue
		}
		zid := r.ZoneID
		if reqctx.CanReadZone(rc, &zid) {
			return r, nil
		}
		break
	}
	return Roster{}, dataerr.NotFound("Roster not found.")
}

// RosterQuery mirrors listRosters' query.
type RosterQuery struct {
	Limit  int
	Cursor string
	ZoneID string
	Date   string
	Status string
}

// ListRosters mirrors listRosters.
func ListRosters(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, query RosterQuery) (datactx.PageResult[Roster], error) {
	if err := reqctx.RequireAccess(rc, access.ModuleOpsFieldPlanner, access.AccessView); err != nil {
		return datactx.PageResult[Roster]{}, err
	}
	if query.Status != "" && !containsStr(rosterStatuses, query.Status) {
		return datactx.PageResult[Roster]{}, dataerr.Invalid("status must be one of " + strings.Join(rosterStatuses, ", ") + ".")
	}
	if query.Date != "" {
		if _, err := datactx.Date(datactx.Obj{"date": query.Date}, "date"); err != nil {
			return datactx.PageResult[Roster]{}, err
		}
	}
	allZonesRows, err := allZones(ctx, conn, rc.CustomerID)
	if err != nil {
		return datactx.PageResult[Roster]{}, err
	}
	allRostersRows, err := allRosters(ctx, conn, rc.CustomerID)
	if err != nil {
		return datactx.PageResult[Roster]{}, err
	}
	zoneNames := map[string]string{}
	for _, z := range allZonesRows {
		zoneNames[z.ID] = z.NameEn
	}
	var rows []Roster
	for _, r := range allRostersRows {
		zid := r.ZoneID
		if !reqctx.CanReadZone(rc, &zid) {
			continue
		}
		if query.ZoneID != "" && r.ZoneID != query.ZoneID {
			continue
		}
		if query.Date != "" && r.RosterDate != query.Date {
			continue
		}
		if query.Status != "" && r.Status != query.Status {
			continue
		}
		rows = append(rows, r)
	}
	sort.SliceStable(rows, func(i, j int) bool {
		if rows[i].RosterDate != rows[j].RosterDate {
			return rows[i].RosterDate < rows[j].RosterDate
		}
		if zoneNames[rows[i].ZoneID] != zoneNames[rows[j].ZoneID] {
			return zoneNames[rows[i].ZoneID] < zoneNames[rows[j].ZoneID]
		}
		return rows[i].ID < rows[j].ID
	})
	page, err := datactx.Paginate(rows, datactx.PageQuery{Limit: query.Limit, Cursor: query.Cursor})
	if err != nil {
		return datactx.PageResult[Roster]{}, err
	}
	plan, err := loadPlan(ctx, conn, rc)
	if err != nil {
		return datactx.PageResult[Roster]{}, err
	}
	for i, r := range page.Items {
		page.Items[i] = withCounts(ctx, rc, plan, r)
	}
	return page, nil
}

// GetRoster mirrors getRoster.
func GetRoster(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, id string) (Roster, error) {
	if err := reqctx.RequireAccess(rc, access.ModuleOpsFieldPlanner, access.AccessView); err != nil {
		return Roster{}, err
	}
	plan, err := loadPlan(ctx, conn, rc)
	if err != nil {
		return Roster{}, err
	}
	roster, err := requireRoster(ctx, conn, rc, id)
	if err != nil {
		return Roster{}, err
	}
	return withCounts(ctx, rc, plan, roster), nil
}

// ListRosterAssignments: a roster's lines.
func ListRosterAssignments(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, id string, query datactx.PageQuery) (datactx.PageResult[RosterAssignment], error) {
	if err := reqctx.RequireAccess(rc, access.ModuleOpsFieldPlanner, access.AccessView); err != nil {
		return datactx.PageResult[RosterAssignment]{}, err
	}
	roster, err := requireRoster(ctx, conn, rc, id)
	if err != nil {
		return datactx.PageResult[RosterAssignment]{}, err
	}
	all, err := allRosterAssignments(ctx, conn, rc.CustomerID)
	if err != nil {
		return datactx.PageResult[RosterAssignment]{}, err
	}
	var rows []RosterAssignment
	for _, a := range all {
		if a.RosterID == roster.ID {
			rows = append(rows, a)
		}
	}
	sort.SliceStable(rows, func(i, j int) bool {
		if rows[i].StartAt != rows[j].StartAt {
			return rows[i].StartAt < rows[j].StartAt
		}
		return rows[i].ID < rows[j].ID
	})
	return datactx.Paginate(rows, query)
}

// ListRosterOverrides mirrors listRosterOverrides.
func ListRosterOverrides(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, id string, query datactx.PageQuery) (datactx.PageResult[Override], error) {
	if err := reqctx.RequireAccess(rc, access.ModuleOpsFieldPlanner, access.AccessView); err != nil {
		return datactx.PageResult[Override]{}, err
	}
	roster, err := requireRoster(ctx, conn, rc, id)
	if err != nil {
		return datactx.PageResult[Override]{}, err
	}
	var rows []Override
	allRows, err := loadOverrides(ctx, rc.CustomerID)
	if err != nil {
		return datactx.PageResult[Override]{}, err
	}
	for _, o := range allRows {
		if o.RosterID == roster.ID {
			rows = append(rows, o)
		}
	}
	sort.SliceStable(rows, func(i, j int) bool {
		if rows[i].CreatedAt != rows[j].CreatedAt {
			return rows[i].CreatedAt < rows[j].CreatedAt
		}
		return rows[i].ID < rows[j].ID
	})
	return datactx.Paginate(rows, query)
}

// Building: the placeholder optimizer.

// ForecastRun: in-memory reads (not api-backed yet, matches
// TS), but also written to Postgres (migration 0023)
// so the rosters FK is satisfiable. Write-only
// shadow: nothing reads it back from Postgres yet.
type ForecastRun struct {
	datactx.BaseRecord
	ModelVersion     string   `json:"model_version"`
	EngineVersion    *string  `json:"engine_version"`
	RuleSetVersion   *string  `json:"rule_set_version"`
	Status           string   `json:"status"`
	HorizonStartDate string   `json:"horizon_start_date"`
	HorizonDays      int      `json:"horizon_days"`
	RangeCoverage    float64  `json:"range_coverage"`
	Illustrative     bool     `json:"illustrative"`
	InputDataSources []string `json:"input_data_sources"`
	StartedAt        *string  `json:"started_at"`
	FinishedAt       *string  `json:"finished_at"`
	ErrorMessage     *string  `json:"error_message"`
	// DatasetSnapshotID: the history it was fit on.
	DatasetSnapshotID *string `json:"dataset_snapshot_id,omitempty"`
}

var (
	forecastRunMu    sync.Mutex
	forecastRunStore []ForecastRun
)

// ResetForecastRunsForTest clears the run store.
func ResetForecastRunsForTest() {
	forecastRunMu.Lock()
	forecastRunStore = nil
	forecastRunMu.Unlock()
}

// UpsertForecastRunForTest seeds a forecast run.
func UpsertForecastRunForTest(r ForecastRun) {
	forecastRunMu.Lock()
	defer forecastRunMu.Unlock()
	for i, x := range forecastRunStore {
		if x.ID == r.ID {
			forecastRunStore[i] = r
			return
		}
	}
	forecastRunStore = append(forecastRunStore, r)
}

// allForecastRunRows: NOT seeded from fixtures, unlike
// rulesStore/overrideStore. ForecastRun's fixture row
// isn't in Postgres (no seed path writes it there), and
// rosters.forecast_run_id is a real FK: seeding this
// from fixtures would make buildRoster pick a run id
// Postgres rejects. forecast.go/models.go (not yet cut
// over) own real ForecastRun creation, which does write
// through to Postgres (upsertForecastRunLive); until
// that module is ported, buildRoster's forecast_run_id
// stays null in Go, same as it would for a fresh tenant
// in TS with no forecast run created yet.
func allForecastRunRows() []ForecastRun {
	forecastRunMu.Lock()
	out := append([]ForecastRun(nil), forecastRunStore...)
	forecastRunMu.Unlock()
	return out
}

func oneForecastRunRow(id string) *ForecastRun {
	for _, r := range allForecastRunRows() {
		if r.ID == id {
			row := r
			return &row
		}
	}
	return nil
}

func upsertForecastRunTx(ctx context.Context, tx pgx.Tx, r ForecastRun) error {
	_, err := tx.Exec(ctx, `INSERT INTO forecast_runs (tenant_id, id, data_source, created_at, updated_at, created_by, model_version, engine_version, rule_set_version, status, horizon_start_date, horizon_days, range_coverage, illustrative, input_data_sources, started_at, finished_at, error_message, dataset_snapshot_id)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
		ON CONFLICT (tenant_id, id) DO UPDATE SET updated_at=$5, status=$10, range_coverage=$13, started_at=$16, finished_at=$17, error_message=$18`,
		r.TenantID, r.ID, r.DataSource, r.CreatedAt, r.UpdatedAt, r.CreatedBy, r.ModelVersion, r.EngineVersion, r.RuleSetVersion,
		r.Status, r.HorizonStartDate, r.HorizonDays, r.RangeCoverage, r.Illustrative, r.InputDataSources, r.StartedAt, r.FinishedAt, r.ErrorMessage, r.DatasetSnapshotID)
	return err
}

// upsertForecastRunLive: the Postgres shadow write.
func upsertForecastRunLive(ctx context.Context, conn *tenancy.Connection, tenantID string, r ForecastRun) error {
	_, err := tenancy.WithTenant(ctx, conn.Pool, tenantID, func(ctx context.Context, tx pgx.Tx) (struct{}, error) {
		return struct{}{}, upsertForecastRunTx(ctx, tx, r)
	})
	return err
}

func optimizerStatus(gapCount, lines int) string {
	if lines == 0 {
		return "infeasible"
	}
	if gapCount == 0 {
		return "feasible"
	}
	return "partial"
}

func zoneIDHint(body any) *string {
	m, ok := body.(map[string]any)
	if !ok {
		return nil
	}
	zid, ok := m["zone_id"].(string)
	if !ok {
		return nil
	}
	return &zid
}

// BuildRoster mirrors buildRoster.
func BuildRoster(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, body any) (Roster, error) {
	return buildRoster(ctx, conn, rc, body, nil)
}

// buildRoster also asks the optimizer in engine mode; stale is set when it fails.
func buildRoster(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, body any, stale *bool) (Roster, error) {
	return auditlog.WriteWithAudit(ctx, rc, auditlog.Guard{ModuleID: access.ModuleOpsFieldPlanner}, auditlog.WriteMeta{Action: "roster.built", EntityType: "roster", EntityID: zoneIDHint(body)}, func(ctx context.Context) (auditlog.AuditedWrite[Roster], error) {
		input, err := datactx.Object(body, "Roster build", []string{"zone_id", "roster_date", "forecast_run_id"})
		if err != nil {
			return auditlog.AuditedWrite[Roster]{}, err
		}
		zoneID, err := datactx.UUID(input, "zone_id")
		if err != nil {
			return auditlog.AuditedWrite[Roster]{}, err
		}
		date, err := datactx.Date(input, "roster_date")
		if err != nil {
			return auditlog.AuditedWrite[Roster]{}, err
		}
		runID, err := datactx.NullableUUID(input, "forecast_run_id")
		if err != nil {
			return auditlog.AuditedWrite[Roster]{}, err
		}
		if err := reqctx.RequireWriteZone(rc, &zoneID); err != nil {
			return auditlog.AuditedWrite[Roster]{}, err
		}
		zones, err := allZones(ctx, conn, rc.CustomerID)
		if err != nil {
			return auditlog.AuditedWrite[Roster]{}, err
		}
		var zone *Zone
		for i := range zones {
			if zones[i].ID == zoneID {
				zone = &zones[i]
				break
			}
		}
		if zone == nil {
			return auditlog.AuditedWrite[Roster]{}, dataerr.NotFound("Zone not found.")
		}
		today := demoToday(ctx, rc.CustomerID)
		if date < today {
			return auditlog.AuditedWrite[Roster]{}, dataerr.Invalid(fmt.Sprintf("A roster cannot be built for a day that has passed (today is %s).", today))
		}
		if date > shiftDateBy(today, maxBuildDaysAhead) {
			return auditlog.AuditedWrite[Roster]{}, dataerr.Invalid(fmt.Sprintf("A roster can be built up to %d days ahead.", maxBuildDaysAhead))
		}
		var run *ForecastRun
		if runID == nil {
			run, err = loadLatestForecastRun(ctx, rc.CustomerID, false)
		} else {
			run, err = loadForecastRun(ctx, rc.CustomerID, *runID, false)
			if err == nil && run == nil {
				return auditlog.AuditedWrite[Roster]{}, dataerr.NotFound("Forecast run not found.")
			}
		}
		if err != nil {
			return auditlog.AuditedWrite[Roster]{}, err
		}
		plan, err := loadPlan(ctx, conn, rc)
		if err != nil {
			return auditlog.AuditedWrite[Roster]{}, err
		}
		existing := rosterFor(plan, zone.ID, date)
		if existing != nil && existing.Status != "draft" && existing.Status != "rejected" {
			return auditlog.AuditedWrite[Roster]{}, dataerr.Conflict(fmt.Sprintf("The roster for %s on %s is %s; change it with an override.", zone.NameEn, date, existing.Status))
		}
		var answer *optimizerOutputDoc
		var locked []RosterAssignment
		var projected []RosterAssignment
		var source, reason *string
		linedUp := -1
		if engineMode() == engines.ModeEngine {
			locked = lockedLines(plan, existing, zone.ID)
			var askErr error
			if answer, askErr = askOptimizer(ctx, conn, rc, plan, zone.ID, date, locked); askErr == nil {
				plan.forgetDay(date)
				if projected, askErr = linesFromOptimizer(answer, plan, zone.ID, date, locked); askErr != nil {
					auditEngineFailure(rc, engines.Optimizer, askErr)
				} else if projected, linedUp, askErr = lineUpBreaks(ctx, rc, plan, zone.ID, date, projected); askErr != nil {
					return auditlog.AuditedWrite[Roster]{}, askErr
				}
			}
			if askErr == nil {
				source = strPtr("optimizer")
			} else {
				source, reason = strPtr("fallback"), strPtr(fallbackReason(askErr, run, date))
				answer, locked = nil, nil
				if stale != nil {
					*stale = true
				}
			}
		}
		at := datactx.NowISO()
		if answer == nil {
			if projected, err = projectLines(rc, plan, zone.ID, date); err != nil {
				return auditlog.AuditedWrite[Roster]{}, err
			}
		}
		var roster Roster
		if existing != nil {
			roster = *existing
		} else {
			roster = Roster{BaseRecord: datactx.NewRecord(rc, "", at)}
		}
		roster.ZoneID, roster.RosterDate, roster.Status, roster.UpdatedAt = zone.ID, date, "draft", at
		roster.ForecastRunID = nil
		if run != nil {
			rid := run.ID
			roster.ForecastRunID = &rid
		}
		roster.OptimizerSource, roster.FallbackReason = source, reason
		roster.PlanningLevel = getPlanningLevel(ctx, rc)
		ev := "0.1.0"
		if answer != nil {
			ev = answer.Engine.Version
		} else if plan.Baseline != nil {
			ev = plan.Baseline.EngineVersion
		}
		roster.EngineVersion = &ev
		roster.OptimizerModel, roster.SolverStatus = modelOfAnswer(answer)
		roster.Illustrative = true
		roster.ApprovedByUserID, roster.ApprovedAt, roster.PublishedAt = nil, nil, nil

		if err := upsertRoster(ctx, conn, rc.CustomerID, roster); err != nil {
			return auditlog.AuditedWrite[Roster]{}, err
		}
		if existing != nil {
			for _, old := range plan.LinesByRoster[existing.ID] {
				if old.ZoneID != nil && *old.ZoneID == zone.ID {
					if err := removeRosterAssignment(ctx, conn, rc.CustomerID, old.ID); err != nil {
						return auditlog.AuditedWrite[Roster]{}, err
					}
				}
			}
		}
		lines := make([]RosterAssignment, len(projected))
		for i, line := range projected {
			line.BaseRecord = datactx.NewRecord(rc, "", at)
			line.RosterID = roster.ID
			if !line.IsOverride || answer == nil {
				line.IsOverride = false
			}
			lines[i] = line
		}
		if len(lines) > 0 {
			if err := upsertRosterAssignments(ctx, conn, rc.CustomerID, lines); err != nil {
				return auditlog.AuditedWrite[Roster]{}, err
			}
		}
		fresh, err := loadPlan(ctx, conn, rc)
		if err != nil {
			return auditlog.AuditedWrite[Roster]{}, err
		}
		counted := withCounts(ctx, rc, fresh, roster)
		gapCount, surplusCount := 0, 0
		if counted.GapCount != nil {
			gapCount = *counted.GapCount
		}
		if counted.SurplusCount != nil {
			surplusCount = *counted.SurplusCount
		}
		status := optimizerStatus(gapCount, len(lines))
		if answer != nil && len(locked) == 0 {
			status = answer.Status
		}
		counted.OptimizerStatus = &status
		if err := upsertRoster(ctx, conn, rc.CustomerID, counted); err != nil {
			return auditlog.AuditedWrite[Roster]{}, err
		}
		summary := fmt.Sprintf("Roster built for %s on %s: %d agents, %d gap and %d surplus intervals (placeholder optimizer, Illustrative).", zone.NameEn, date, len(lines), gapCount, surplusCount)
		detail := map[string]any{"zone_id": zone.ID, "roster_date": date, "agents": len(lines), "gap_count": gapCount, "surplus_count": surplusCount}
		if answer != nil {
			summary = fmt.Sprintf("Roster built for %s on %s from the optimizer %s: %d agents, %d gap and %d surplus intervals, status %s (Illustrative).%s", zone.NameEn, date, answer.ModelVersion, len(lines), gapCount, surplusCount, status, violationNote(answer))
			detail["optimizer_model"], detail["optimizer_status"], detail["violations"], detail["locked_lines"] = answer.ModelVersion, status, len(answer.Violations), len(locked)
			if answer.SolverStatus != "" {
				detail["solver_status"] = answer.SolverStatus
			}
			detail["optimizer_gap_cells"], detail["optimizer_surplus_cells"] = answerCells(answer, zone.ID)
			if linedUp >= 0 {
				summary += fmt.Sprintf(" Breaks lined up with prayer by the break planner (%d moved).", linedUp)
				detail["breaks_lined_up"] = linedUp
			}
		}
		return auditlog.AuditedWrite[Roster]{
			Result: counted, EntityID: &counted.ID,
			SummaryEn: summary,
			Detail:    detail,
		}, nil
	})
}

// fallbackReason: why no optimizer answer
func fallbackReason(err error, run *ForecastRun, date string) string {
	switch {
	case run == nil || !inForecastHorizon(run, date) || errors.Is(err, ErrEngineInput) && strings.Contains(err.Error(), "no values for"):
		return "no_forecast_for_day"
	case errors.Is(err, ErrEngineAnswer), errors.Is(err, engines.ErrInvalidResponse), errors.Is(err, ErrEngineInput):
		return "no_answer"
	}
	return "engine_unavailable"
}

func inForecastHorizon(run *ForecastRun, date string) bool {
	return date >= run.HorizonStartDate && date < shiftDateBy(run.HorizonStartDate, run.HorizonDays)
}

// Approval flow of a roster

func pendingApprovalFor(ctx context.Context, tenantID, subjectType, subjectID string) (*Approval, error) {
	rows, err := allApprovals(ctx, tenantID)
	if err != nil {
		return nil, err
	}
	for _, a := range rows {
		if a.SubjectType == subjectType && a.SubjectID == subjectID && a.Status == "pending" {
			row := a
			return &row, nil
		}
	}
	return nil, nil
}

func openApproval(ctx context.Context, rc reqctx.RequestContext, subjectType, subjectID, summary, at string) error {
	return saveApproval(ctx, rc.CustomerID, Approval{
		BaseRecord: datactx.NewRecord(rc, "", at), SubjectType: subjectType, SubjectID: subjectID,
		Status: "pending", SummaryEn: truncateStr(summary, 300), RequestedAt: at,
	})
}

func parseRosterDecision(body any) (*string, error) {
	if body == nil {
		body = map[string]any{}
	}
	input, err := datactx.Object(body, "Decision", []string{"note"})
	if err != nil {
		return nil, err
	}
	return datactx.NullableString(input, "note", datactx.StrOpts{HasMax: true, Max: 500})
}

func approverRequesterID(approval *Approval, createdBy *string) string {
	if approval != nil && approval.CreatedBy != nil {
		return *approval.CreatedBy
	}
	if createdBy != nil {
		return *createdBy
	}
	return "system"
}

// SubmitRoster mirrors submitRoster.
func SubmitRoster(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, id string) (Roster, error) {
	return auditlog.WriteWithAudit(ctx, rc, auditlog.Guard{ModuleID: access.ModuleOpsFieldPlanner}, auditlog.WriteMeta{Action: "roster.submitted", EntityType: "roster", EntityID: &id}, func(ctx context.Context) (auditlog.AuditedWrite[Roster], error) {
		if _, err := importutil.RequireID(id, "Roster"); err != nil {
			return auditlog.AuditedWrite[Roster]{}, err
		}
		rows, err := allRosters(ctx, conn, rc.CustomerID)
		if err != nil {
			return auditlog.AuditedWrite[Roster]{}, err
		}
		var current *Roster
		for i := range rows {
			if rows[i].ID == id {
				current = &rows[i]
				break
			}
		}
		if current == nil {
			return auditlog.AuditedWrite[Roster]{}, dataerr.NotFound("Roster not found.")
		}
		if err := reqctx.RequireWriteZone(rc, &current.ZoneID); err != nil {
			return auditlog.AuditedWrite[Roster]{}, err
		}
		if current.Status != "draft" && current.Status != "rejected" {
			return auditlog.AuditedWrite[Roster]{}, dataerr.Conflict(fmt.Sprintf("A %s roster cannot be submitted.", current.Status))
		}
		at := datactx.NowISO()
		next := *current
		next.Status, next.UpdatedAt = "submitted", at
		requested := appNowISO(ctx, rc.CustomerID)
		if err := upsertRoster(ctx, conn, rc.CustomerID, next); err != nil {
			return auditlog.AuditedWrite[Roster]{}, err
		}
		name, err := zoneNameOf(ctx, conn, rc.CustomerID, current.ZoneID)
		if err != nil {
			return auditlog.AuditedWrite[Roster]{}, err
		}
		if err := openApproval(ctx, rc, "roster", current.ID, fmt.Sprintf("Roster for %s on %s", name, current.RosterDate), requested); err != nil {
			return auditlog.AuditedWrite[Roster]{}, err
		}
		plan, err := loadPlan(ctx, conn, rc)
		if err != nil {
			return auditlog.AuditedWrite[Roster]{}, err
		}
		return auditlog.AuditedWrite[Roster]{
			Result: withCounts(ctx, rc, plan, next), EntityID: &current.ID,
			SummaryEn: fmt.Sprintf("Roster for %s on %s submitted for approval.", name, current.RosterDate),
			Detail:    sumDetail(map[string]any{"zone_id": current.ZoneID, "roster_date": current.RosterDate}, map[string]any{"zone": name, "date": current.RosterDate}),
		}, nil
	})
}

func decideRoster(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, id string, body any, decision string) (Roster, error) {
	action := "roster.approved"
	verb := "approve"
	if decision != "approved" {
		action, verb = "roster.rejected", "reject"
	}
	return auditlog.WriteWithAudit(ctx, rc, auditlog.Guard{ModuleID: access.ModuleOpsFieldPlanner}, auditlog.WriteMeta{Action: action, EntityType: "roster", EntityID: &id}, func(ctx context.Context) (auditlog.AuditedWrite[Roster], error) {
		if _, err := importutil.RequireID(id, "Roster"); err != nil {
			return auditlog.AuditedWrite[Roster]{}, err
		}
		note, err := parseRosterDecision(body)
		if err != nil {
			return auditlog.AuditedWrite[Roster]{}, err
		}
		rows, err := allRosters(ctx, conn, rc.CustomerID)
		if err != nil {
			return auditlog.AuditedWrite[Roster]{}, err
		}
		var current *Roster
		for i := range rows {
			if rows[i].ID == id {
				current = &rows[i]
				break
			}
		}
		if current == nil {
			return auditlog.AuditedWrite[Roster]{}, dataerr.NotFound("Roster not found.")
		}
		if err := reqctx.RequireWriteZone(rc, &current.ZoneID); err != nil {
			return auditlog.AuditedWrite[Roster]{}, err
		}
		approval, err := pendingApprovalFor(ctx, rc.CustomerID, "roster", current.ID)
		if err != nil {
			return auditlog.AuditedWrite[Roster]{}, err
		}
		check := access.CheckApproval(access.ApprovalRequest{
			Role: rc.Role, RequesterUserID: approverRequesterID(approval, current.CreatedBy), ApproverUserID: rc.UserID,
			Kind: access.ApprovalRosterOverride, InstallMode: rc.InstallMode, HasInstallMode: true,
		})
		if !check.Allowed {
			return auditlog.AuditedWrite[Roster]{}, dataerr.Forbidden(fmt.Sprintf("%s may not %s this roster (%s).", rc.Role, verb, check.Reason))
		}
		if current.Status != "submitted" {
			return auditlog.AuditedWrite[Roster]{}, dataerr.Conflict(fmt.Sprintf("The roster is %s, not submitted.", current.Status))
		}
		at := datactx.NowISO()
		userID := rc.UserID
		if approval != nil {
			a := *approval
			a.DecidedAt, a.DecidedByUserID, a.DecisionNote, a.Status, a.UpdatedAt = &at, &userID, note, decision, at
			if err := saveApproval(ctx, rc.CustomerID, a); err != nil {
				return auditlog.AuditedWrite[Roster]{}, err
			}
		}
		next := *current
		next.UpdatedAt = at
		if decision == "approved" {
			approvedAt := appNowISO(ctx, rc.CustomerID)
			next.Status, next.ApprovedByUserID, next.ApprovedAt = "approved", &userID, &approvedAt
		} else {
			next.Status = "rejected"
		}
		if err := upsertRoster(ctx, conn, rc.CustomerID, next); err != nil {
			return auditlog.AuditedWrite[Roster]{}, err
		}
		name, err := zoneNameOf(ctx, conn, rc.CustomerID, current.ZoneID)
		if err != nil {
			return auditlog.AuditedWrite[Roster]{}, err
		}
		plan, err := loadPlan(ctx, conn, rc)
		if err != nil {
			return auditlog.AuditedWrite[Roster]{}, err
		}
		return auditlog.AuditedWrite[Roster]{
			Result: withCounts(ctx, rc, plan, next), EntityID: &current.ID,
			SummaryEn: fmt.Sprintf("Roster for %s on %s %s.", name, current.RosterDate, decision),
			Detail:    map[string]any{"zone_id": current.ZoneID, "roster_date": current.RosterDate, "note": derefAny(note)},
		}, nil
	})
}

// ApproveRoster mirrors approveRoster.
func ApproveRoster(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, id string, body any) (Roster, error) {
	return decideRoster(ctx, conn, rc, id, body, "approved")
}

// RejectRoster mirrors rejectRoster.
func RejectRoster(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, id string, body any) (Roster, error) {
	return decideRoster(ctx, conn, rc, id, body, "rejected")
}

// PublishResult: the contract type. LABELLED STUB.
type PublishResult struct {
	RosterID  string `json:"roster_id"`
	Stub      bool   `json:"stub"`
	Published bool   `json:"published"`
	Message   string `json:"message"`
}

// PublishRoster: LABELLED STUB. Nothing is sent to
// The customer (needs the customer's interfaces).
func PublishRoster(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, id string) (PublishResult, error) {
	return auditlog.WriteWithAudit(ctx, rc, auditlog.Guard{ModuleID: access.ModuleOpsFieldPlanner}, auditlog.WriteMeta{Action: "roster.publish_stub", EntityType: "roster", EntityID: &id}, func(ctx context.Context) (auditlog.AuditedWrite[PublishResult], error) {
		if _, err := importutil.RequireID(id, "Roster"); err != nil {
			return auditlog.AuditedWrite[PublishResult]{}, err
		}
		current, err := oneRoster(ctx, conn, rc.CustomerID, id)
		if err != nil {
			return auditlog.AuditedWrite[PublishResult]{}, err
		}
		if current == nil {
			return auditlog.AuditedWrite[PublishResult]{}, dataerr.NotFound("Roster not found.")
		}
		if err := reqctx.RequireWriteZone(rc, &current.ZoneID); err != nil {
			return auditlog.AuditedWrite[PublishResult]{}, err
		}
		if current.Status != "approved" {
			return auditlog.AuditedWrite[PublishResult]{}, dataerr.Conflict("Only an approved roster can be published.")
		}
		name, err := zoneNameOf(ctx, conn, rc.CustomerID, current.ZoneID)
		if err != nil {
			return auditlog.AuditedWrite[PublishResult]{}, err
		}
		result := PublishResult{RosterID: current.ID, Stub: true, Published: false, Message: fmt.Sprintf("STUB: nothing was sent to the %[1]s systems. Publishing needs an interface to them.", customerEn())}
		return auditlog.AuditedWrite[PublishResult]{
			Result: result, EntityID: &current.ID,
			SummaryEn: fmt.Sprintf("Publish of the roster for %s on %s requested. This is a labelled stub: nothing was sent to the %s systems.", name, current.RosterDate, customerEn()),
			Detail:    map[string]any{"stub": true, "published": false},
		}, nil
	})
}

// Overrides (in-memory, like Approval/ForecastRun)

// Override mirrors the contract type.
type Override struct {
	datactx.BaseRecord
	RosterID           string         `json:"roster_id"`
	RosterAssignmentID *string        `json:"roster_assignment_id"`
	ChangeType         string         `json:"change_type"`
	ReasonCode         string         `json:"reason_code"`
	Note               *string        `json:"note"`
	Before             map[string]any `json:"before"`
	After              map[string]any `json:"after"`
	Status             string         `json:"status"`
	DecidedByUserID    *string        `json:"decided_by_user_id"`
	DecidedAt          *string        `json:"decided_at"`
	DecisionNote       *string        `json:"decision_note"`
}

var (
	overrideMu     sync.Mutex
	overrideStore  []Override
	overrideSeeded bool
)

// ResetOverridesForTest clears the override store.
func ResetOverridesForTest() {
	overrideMu.Lock()
	overrideStore = nil
	overrideSeeded = false
	overrideMu.Unlock()
}

// ensureOverridesSeeded: lazy, from fixtures, once
// (mirrors ensureRulesSeeded). Override has a committed
// fixture that TS's demo store loads as its baseline.
func ensureOverridesSeeded() {
	overrideMu.Lock()
	seeded := overrideSeeded
	overrideMu.Unlock()
	if seeded {
		return
	}
	rows, err := fixtures.Records[Override]("Override")
	overrideMu.Lock()
	if !overrideSeeded {
		if err == nil {
			overrideStore = rows
		}
		overrideSeeded = true
	}
	overrideMu.Unlock()
}

func upsertOverrideRowMemory(o Override) Override {
	ensureOverridesSeeded()
	overrideMu.Lock()
	defer overrideMu.Unlock()
	for i, x := range overrideStore {
		if x.ID == o.ID {
			overrideStore[i] = o
			return o
		}
	}
	overrideStore = append(overrideStore, o)
	return o
}

func allOverrideRowsMemory() []Override {
	ensureOverridesSeeded()
	overrideMu.Lock()
	out := append([]Override(nil), overrideStore...)
	overrideMu.Unlock()
	return out
}

// patternByRef: against already-loaded patterns.
func patternByRef(plan *PlanReader, ref any) *ShiftPattern {
	s, ok := ref.(string)
	if !ok {
		return nil
	}
	for i := range plan.Patterns {
		if plan.Patterns[i].ID == s {
			return &plan.Patterns[i]
		}
	}
	for i := range plan.Patterns {
		if plan.Patterns[i].NameEn == s || plan.Patterns[i].Code == s {
			return &plan.Patterns[i]
		}
	}
	return nil
}

type overrideInput struct {
	ChangeType         string
	ReasonCode         string
	Note               *string
	RosterAssignmentID *string
	AgentID            *string
	ShiftPatternID     *string
	VehicleID          *string
}

// parseOverride mirrors parseOverride.
func parseOverride(body any) (overrideInput, error) {
	input, err := datactx.Object(body, "Override", []string{"roster_assignment_id", "change_type", "reason_code", "note", "agent_id", "shift_pattern_id", "vehicle_id"})
	if err != nil {
		return overrideInput{}, err
	}
	if raw, ok := input["reason_code"]; !ok || raw == nil || raw == "" {
		return overrideInput{}, dataerr.Invalid("Override: a reason code is required (REASON_REQUIRED).")
	}
	reason, err := datactx.EnumOf(input, "reason_code", overrideReasons)
	if err != nil {
		return overrideInput{}, err
	}
	note, err := datactx.NullableString(input, "note", datactx.StrOpts{HasMax: true, Max: 500})
	if err != nil {
		return overrideInput{}, err
	}
	if reason == "other" && (note == nil || strings.TrimSpace(*note) == "") {
		return overrideInput{}, dataerr.Invalid("Override: a note is required when the reason is other (REASON_REQUIRED).")
	}
	changeType, err := datactx.EnumOf(input, "change_type", overrideChanges)
	if err != nil {
		return overrideInput{}, err
	}
	rosterAssignmentID, err := datactx.NullableUUID(input, "roster_assignment_id")
	if err != nil {
		return overrideInput{}, err
	}
	agentID, err := datactx.NullableUUID(input, "agent_id")
	if err != nil {
		return overrideInput{}, err
	}
	shiftPatternID, err := datactx.NullableUUID(input, "shift_pattern_id")
	if err != nil {
		return overrideInput{}, err
	}
	vehicleID, err := datactx.NullableUUID(input, "vehicle_id")
	if err != nil {
		return overrideInput{}, err
	}
	return overrideInput{ChangeType: changeType, ReasonCode: reason, Note: note, RosterAssignmentID: rosterAssignmentID, AgentID: agentID, ShiftPatternID: shiftPatternID, VehicleID: vehicleID}, nil
}

// CreateOverride mirrors createOverride.
func CreateOverride(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, rosterID string, body any) (Override, error) {
	return auditlog.WriteWithAudit(ctx, rc, auditlog.Guard{ModuleID: access.ModuleOpsFieldPlanner}, auditlog.WriteMeta{Action: "override.created", EntityType: "roster", EntityID: &rosterID}, func(ctx context.Context) (auditlog.AuditedWrite[Override], error) {
		if _, err := importutil.RequireID(rosterID, "Roster"); err != nil {
			return auditlog.AuditedWrite[Override]{}, err
		}
		input, err := parseOverride(body)
		if err != nil {
			return auditlog.AuditedWrite[Override]{}, err
		}
		roster, err := oneRoster(ctx, conn, rc.CustomerID, rosterID)
		if err != nil {
			return auditlog.AuditedWrite[Override]{}, err
		}
		if roster == nil {
			return auditlog.AuditedWrite[Override]{}, dataerr.NotFound("Roster not found.")
		}
		if err := reqctx.RequireWriteZone(rc, &roster.ZoneID); err != nil {
			return auditlog.AuditedWrite[Override]{}, err
		}
		if !containsStr(overridable, roster.Status) {
			return auditlog.AuditedWrite[Override]{}, dataerr.Conflict(fmt.Sprintf("A %s roster cannot be overridden.", roster.Status))
		}
		allLines, err := allRosterAssignments(ctx, conn, rc.CustomerID)
		if err != nil {
			return auditlog.AuditedWrite[Override]{}, err
		}
		var lines []RosterAssignment
		for _, l := range allLines {
			if l.RosterID == roster.ID {
				lines = append(lines, l)
			}
		}
		var target *RosterAssignment
		if input.RosterAssignmentID != nil {
			for i := range lines {
				if lines[i].ID == *input.RosterAssignmentID {
					target = &lines[i]
					break
				}
			}
		}
		needsLine := input.ChangeType != "add_assignment"
		if needsLine && target == nil {
			return auditlog.AuditedWrite[Override]{}, dataerr.Invalid("Override: choose the roster assignment to change (roster_assignment_id).")
		}
		if target != nil && (target.ZoneID == nil || *target.ZoneID != roster.ZoneID) {
			return auditlog.AuditedWrite[Override]{}, dataerr.Invalid("Override: the assignment belongs to another zone.")
		}
		plan, err := loadPlan(ctx, conn, rc)
		if err != nil {
			return auditlog.AuditedWrite[Override]{}, err
		}
		agentOK := func(id *string) (*Agent, error) {
			if id == nil {
				return nil, dataerr.NotFound("Agent not found.")
			}
			var s *Agent
			for i := range plan.Agents {
				if plan.Agents[i].ID == *id {
					s = &plan.Agents[i]
					break
				}
			}
			if s == nil {
				return nil, dataerr.NotFound("Agent not found.")
			}
			if !s.IsActive || s.Kind != "field" {
				return nil, dataerr.Invalid("Override: the agent must be an active field agent.")
			}
			for _, l := range lines {
				if l.AgentID == s.ID && (target == nil || l.ID != target.ID) {
					return nil, dataerr.Conflict("That agent is already on this roster.")
				}
			}
			if onLeave(plan, s.ID, roster.RosterDate) {
				return nil, dataerr.Conflict("That agent is on approved leave that day.")
			}
			return s, nil
		}
		var before, after map[string]any
		switch input.ChangeType {
		case "replace_agent":
			s, err := agentOK(input.AgentID)
			if err != nil {
				return auditlog.AuditedWrite[Override]{}, err
			}
			var prev *string
			if target != nil {
				sid := target.AgentID
				prev = &sid
			}
			before = map[string]any{"agent_id": derefAny(prev)}
			after = map[string]any{"agent_id": s.ID}
		case "change_shift":
			pattern := patternByRef(plan, derefAny(input.ShiftPatternID))
			if pattern == nil {
				return auditlog.AuditedWrite[Override]{}, dataerr.NotFound("Shift pattern not found.")
			}
			before = map[string]any{"shift_pattern_id": nil}
			if target != nil {
				before = map[string]any{"shift_pattern_id": derefAny(target.ShiftPatternID)}
			}
			after = map[string]any{"shift_pattern_id": pattern.ID}
		case "change_vehicle":
			if input.VehicleID == nil {
				return auditlog.AuditedWrite[Override]{}, dataerr.NotFound("Vehicle not found.")
			}
			var vehicle *Vehicle
			for i := range plan.Vehicles {
				if plan.Vehicles[i].ID == *input.VehicleID {
					vehicle = &plan.Vehicles[i]
					break
				}
			}
			if vehicle == nil {
				return auditlog.AuditedWrite[Override]{}, dataerr.NotFound("Vehicle not found.")
			}
			if !vehicle.IsActive {
				return auditlog.AuditedWrite[Override]{}, dataerr.Invalid("Override: the vehicle is not active.")
			}
			before = map[string]any{"vehicle_id": nil}
			if target != nil {
				before = map[string]any{"vehicle_id": derefAny(target.VehicleID)}
			}
			after = map[string]any{"vehicle_id": vehicle.ID}
		case "remove_assignment":
			var prev *string
			if target != nil {
				sid := target.AgentID
				prev = &sid
			}
			before = map[string]any{"agent_id": derefAny(prev)}
			after = nil
		case "add_assignment":
			s, err := agentOK(input.AgentID)
			if err != nil {
				return auditlog.AuditedWrite[Override]{}, err
			}
			pattern := patternByRef(plan, derefAny(input.ShiftPatternID))
			if pattern == nil {
				return auditlog.AuditedWrite[Override]{}, dataerr.NotFound("Shift pattern not found.")
			}
			before = nil
			after = map[string]any{"agent_id": s.ID, "shift_pattern_id": pattern.ID, "vehicle_id": derefAny(input.VehicleID)}
		}
		at := datactx.NowISO()
		var targetID *string
		if target != nil {
			targetID = &target.ID
		}
		created := Override{
			BaseRecord: datactx.NewRecord(rc, "", at), RosterID: roster.ID, RosterAssignmentID: targetID,
			ChangeType: input.ChangeType, ReasonCode: input.ReasonCode, Note: input.Note,
			Before: before, After: after, Status: "pending",
		}
		if err := saveOverride(ctx, rc.CustomerID, created); err != nil {
			return auditlog.AuditedWrite[Override]{}, err
		}
		name, err := zoneNameOf(ctx, conn, rc.CustomerID, roster.ZoneID)
		if err != nil {
			return auditlog.AuditedWrite[Override]{}, err
		}
		if err := openApproval(ctx, rc, "override", created.ID, fmt.Sprintf("Override on %s roster of %s: %s (%s)", name, roster.RosterDate, spaced(input.ChangeType), spaced(input.ReasonCode)), at); err != nil {
			return auditlog.AuditedWrite[Override]{}, err
		}
		return auditlog.AuditedWrite[Override]{
			Result: created, EntityID: &created.ID,
			SummaryEn: fmt.Sprintf("Override proposed on the %s roster of %s: %s, reason %s.", name, roster.RosterDate, spaced(input.ChangeType), spaced(input.ReasonCode)),
			Detail:    map[string]any{"roster_id": roster.ID, "change_type": input.ChangeType, "reason_code": input.ReasonCode},
		}, nil
	})
}

// applyOverride: the change an approved override
// makes to the roster lines.
func applyOverride(rc reqctx.RequestContext, plan *PlanReader, roster Roster, override Override, at string) ([]RosterAssignment, []string, error) {
	var lines []RosterAssignment
	for _, l := range plan.LinesByRoster[roster.ID] {
		lines = append(lines, l)
	}
	var target *RosterAssignment
	if override.RosterAssignmentID != nil {
		for i := range lines {
			if lines[i].ID == *override.RosterAssignmentID {
				target = &lines[i]
				break
			}
		}
	}
	after := override.After
	date := roster.RosterDate
	ramadan, err := plan.Ramadan(date)
	if err != nil {
		return nil, nil, err
	}
	rehour := func(line RosterAssignment, pattern ShiftPattern) (RosterAssignment, error) {
		startMin, endMin, ok := patternHours(pattern, ramadan)
		if !ok {
			return RosterAssignment{}, dataerr.Invalid(fmt.Sprintf("%s has no hours on %s.", pattern.NameEn, date))
		}
		bm, ah := plan.BreakRule(pattern.ID)
		prayers, err := plan.Prayers(roster.ZoneID, date)
		if err != nil {
			return RosterAssignment{}, err
		}
		placements := PlaceBreaks([]BreakInput{{Key: "one", StartMin: startMin, EndMin: endMin, BreakMinutes: bm, AfterHours: ah}}, prayers, plan.PrayerPolicy())
		pid := pattern.ID
		startAt, err := IsoAtMinute(date, startMin)
		if err != nil {
			return RosterAssignment{}, err
		}
		endAt, err := IsoAtMinute(date, endMin)
		if err != nil {
			return RosterAssignment{}, err
		}
		next := line
		next.ShiftPatternID = &pid
		next.StartAt, next.EndAt = startAt, endAt
		next.BreakStartAt, next.BreakEndAt = nil, nil
		if len(placements) > 0 {
			bs, err := IsoAtMinute(date, placements[0].StartMin)
			if err != nil {
				return RosterAssignment{}, err
			}
			be, err := IsoAtMinute(date, placements[0].EndMin)
			if err != nil {
				return RosterAssignment{}, err
			}
			next.BreakStartAt, next.BreakEndAt = &bs, &be
		}
		return next, nil
	}
	switch override.ChangeType {
	case "replace_agent":
		sid, ok := after["agent_id"].(string)
		if target == nil || !ok {
			return nil, nil, nil
		}
		next := *target
		next.AgentID, next.IsOverride, next.UpdatedAt = sid, true, at
		return []RosterAssignment{next}, nil, nil
	case "change_vehicle":
		vid, ok := after["vehicle_id"].(string)
		if target == nil || !ok {
			return nil, nil, nil
		}
		next := *target
		next.VehicleID, next.IsOverride, next.UpdatedAt = &vid, true, at
		return []RosterAssignment{next}, nil, nil
	case "change_shift":
		ref := after["shift_pattern_id"]
		if ref == nil {
			ref = after["shift"]
		}
		pattern := patternByRef(plan, ref)
		if target == nil || pattern == nil {
			return nil, nil, nil
		}
		next, err := rehour(*target, *pattern)
		if err != nil {
			return nil, nil, err
		}
		next.IsOverride, next.UpdatedAt = true, at
		return []RosterAssignment{next}, nil, nil
	case "remove_assignment":
		if target == nil {
			return nil, nil, nil
		}
		return nil, []string{target.ID}, nil
	case "add_assignment":
		ref := after["shift_pattern_id"]
		if ref == nil {
			ref = after["shift"]
		}
		pattern := patternByRef(plan, ref)
		agentID, ok := after["agent_id"].(string)
		if pattern == nil || !ok {
			return nil, nil, nil
		}
		homePointID := ""
		for i := range plan.Agents {
			if plan.Agents[i].ID == agentID {
				if hp, ok := plan.Agents[i].Extra["standby_point_id"].(string); ok {
					homePointID = hp
				}
				break
			}
		}
		var points []StandbyPoint
		for _, p := range plan.Points {
			if p.ZoneID == roster.ZoneID && p.IsActive {
				points = append(points, p)
			}
		}
		var standbyPointID *string
		for _, p := range points {
			if p.ID == homePointID {
				id := p.ID
				standbyPointID = &id
				break
			}
		}
		if standbyPointID == nil && len(points) > 0 {
			id := points[0].ID
			standbyPointID = &id
		}
		var vehicleID *string
		if vid, ok := after["vehicle_id"].(string); ok {
			vehicleID = &vid
		}
		zid := roster.ZoneID
		base := RosterAssignment{
			BaseRecord: datactx.NewRecord(rc, "", at), RosterID: roster.ID, AgentID: agentID,
			ZoneID: &zid, RosterDate: date, VehicleID: vehicleID, StandbyPointID: standbyPointID, IsOverride: true,
		}
		next, err := rehour(base, *pattern)
		if err != nil {
			return nil, nil, err
		}
		return []RosterAssignment{next}, nil, nil
	}
	return nil, nil, nil
}

func decideOverride(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, id string, body any, decision string) (Override, error) {
	action := "override.approved"
	verb := "approve"
	if decision != "approved" {
		action, verb = "override.rejected", "reject"
	}
	return auditlog.WriteWithAudit(ctx, rc, auditlog.Guard{ModuleID: access.ModuleOpsFieldPlanner}, auditlog.WriteMeta{Action: action, EntityType: "override", EntityID: &id}, func(ctx context.Context) (auditlog.AuditedWrite[Override], error) {
		if _, err := importutil.RequireID(id, "Override"); err != nil {
			return auditlog.AuditedWrite[Override]{}, err
		}
		note, err := parseRosterDecision(body)
		if err != nil {
			return auditlog.AuditedWrite[Override]{}, err
		}
		override, err := loadOverride(ctx, rc.CustomerID, id)
		if err != nil {
			return auditlog.AuditedWrite[Override]{}, err
		}
		if override == nil {
			return auditlog.AuditedWrite[Override]{}, dataerr.NotFound("Override not found.")
		}
		roster, err := oneRoster(ctx, conn, rc.CustomerID, override.RosterID)
		if err != nil {
			return auditlog.AuditedWrite[Override]{}, err
		}
		if roster == nil {
			return auditlog.AuditedWrite[Override]{}, dataerr.NotFound("Roster not found.")
		}
		if err := reqctx.RequireWriteZone(rc, &roster.ZoneID); err != nil {
			return auditlog.AuditedWrite[Override]{}, err
		}
		approval, err := pendingApprovalFor(ctx, rc.CustomerID, "override", override.ID)
		if err != nil {
			return auditlog.AuditedWrite[Override]{}, err
		}
		check := access.CheckApproval(access.ApprovalRequest{
			Role: rc.Role, RequesterUserID: approverRequesterID(approval, override.CreatedBy), ApproverUserID: rc.UserID,
			Kind: access.ApprovalRosterOverride, InstallMode: rc.InstallMode, HasInstallMode: true,
		})
		if !check.Allowed {
			return auditlog.AuditedWrite[Override]{}, dataerr.Forbidden(fmt.Sprintf("%s may not %s this override (%s).", rc.Role, verb, check.Reason))
		}
		if override.Status != "pending" {
			return auditlog.AuditedWrite[Override]{}, dataerr.Conflict(fmt.Sprintf("The override is already %s.", override.Status))
		}
		at := datactx.NowISO()
		if decision == "approved" {
			plan, err := loadPlan(ctx, conn, rc)
			if err != nil {
				return auditlog.AuditedWrite[Override]{}, err
			}
			upserts, removals, err := applyOverride(rc, plan, *roster, *override, at)
			if err != nil {
				return auditlog.AuditedWrite[Override]{}, err
			}
			if len(upserts) == 0 && len(removals) == 0 {
				return auditlog.AuditedWrite[Override]{}, dataerr.Conflict("The override no longer applies to the roster.")
			}
			if len(upserts) > 0 {
				if err := upsertRosterAssignments(ctx, conn, rc.CustomerID, upserts); err != nil {
					return auditlog.AuditedWrite[Override]{}, err
				}
			}
			for _, rid := range removals {
				if err := removeRosterAssignment(ctx, conn, rc.CustomerID, rid); err != nil {
					return auditlog.AuditedWrite[Override]{}, err
				}
			}
			next := *roster
			next.UpdatedAt = at
			if err := upsertRoster(ctx, conn, rc.CustomerID, next); err != nil {
				return auditlog.AuditedWrite[Override]{}, err
			}
		}
		userID := rc.UserID
		next := *override
		next.DecidedAt, next.DecidedByUserID, next.DecisionNote, next.Status, next.UpdatedAt = &at, &userID, note, decision, at
		if err := saveOverride(ctx, rc.CustomerID, next); err != nil {
			return auditlog.AuditedWrite[Override]{}, err
		}
		if approval != nil {
			a := *approval
			a.DecidedAt, a.DecidedByUserID, a.DecisionNote, a.Status, a.UpdatedAt = &at, &userID, note, decision, at
			if err := saveApproval(ctx, rc.CustomerID, a); err != nil {
				return auditlog.AuditedWrite[Override]{}, err
			}
		}
		name, err := zoneNameOf(ctx, conn, rc.CustomerID, roster.ZoneID)
		if err != nil {
			return auditlog.AuditedWrite[Override]{}, err
		}
		return auditlog.AuditedWrite[Override]{
			Result: next, EntityID: &override.ID,
			SummaryEn: fmt.Sprintf("Override on the %s roster of %s %s.", name, roster.RosterDate, decision),
			Detail:    map[string]any{"roster_id": roster.ID, "change_type": override.ChangeType, "note": derefAny(note)},
		}, nil
	})
}

// ApproveOverride mirrors approveOverride.
func ApproveOverride(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, id string, body any) (Override, error) {
	return decideOverride(ctx, conn, rc, id, body, "approved")
}

// RejectOverride mirrors rejectOverride.
func RejectOverride(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, id string, body any) (Override, error) {
	return decideOverride(ctx, conn, rc, id, body, "rejected")
}

// Gap and Surplus

// GapQuery mirrors GapQuery.
type GapQuery struct {
	RosterID   string
	ScenarioID string
	ZoneID     string
	Date       string
}

// GapSurplusView mirrors the contract type.
type GapSurplusView struct {
	RosterID      *string   `json:"roster_id"`
	ScenarioID    *string   `json:"scenario_id"`
	RosterDate    string    `json:"roster_date"`
	PlanningLevel string    `json:"planning_level"`
	Cells         []GapCell `json:"cells"`
	Illustrative  bool      `json:"illustrative"`
	DataSource    string    `json:"data_source"`
	// Basis: how required and planned were counted
	Basis *DemandBasis `json:"required_staffing,omitempty"`
}

// GetGapSurplus mirrors getGapSurplus.
func GetGapSurplus(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, query GapQuery) (GapSurplusView, error) {
	if err := reqctx.RequireAccess(rc, access.ModuleOpsGapSurplus, access.AccessView); err != nil {
		return GapSurplusView{}, err
	}
	if query.RosterID != "" && query.ScenarioID != "" {
		return GapSurplusView{}, dataerr.Invalid("Ask for a roster or a scenario, not both.")
	}
	if query.Date != "" {
		if _, err := datactx.Date(datactx.Obj{"date": query.Date}, "date"); err != nil {
			return GapSurplusView{}, err
		}
	}
	for _, f := range [][2]string{{"Zone", query.ZoneID}, {"Roster", query.RosterID}, {"Scenario", query.ScenarioID}} {
		if f[1] == "" {
			continue
		}
		if _, err := importutil.RequireID(f[1], f[0]); err != nil {
			return GapSurplusView{}, err
		}
	}
	plan, err := loadPlan(ctx, conn, rc)
	if err != nil {
		return GapSurplusView{}, err
	}
	allZonesRows, err := allZones(ctx, conn, rc.CustomerID)
	if err != nil {
		return GapSurplusView{}, err
	}
	planningLevel := getPlanningLevel(ctx, rc)
	var zones []Zone
	for _, z := range allZonesRows {
		zid := z.ID
		if !reqctx.CanReadZone(rc, &zid) {
			continue
		}
		if query.ZoneID != "" && z.ID != query.ZoneID {
			continue
		}
		zones = append(zones, z)
	}
	if query.ZoneID != "" && len(zones) == 0 {
		return GapSurplusView{}, dataerr.NotFound("Zone not found.")
	}

	if query.ScenarioID != "" {
		if err := reqctx.RequireAccess(rc, access.ModuleOpsScenarioLab, access.AccessView); err != nil {
			return GapSurplusView{}, err
		}
		scenario, err := scenarioByID(ctx, rc, query.ScenarioID)
		if err != nil {
			return GapSurplusView{}, err
		}
		if scenario == nil {
			return GapSurplusView{}, dataerr.NotFound("Scenario not found.")
		}
		plans, err := scenarioZonePlans(ctx, rc, plan, scenario, query.ZoneID)
		if err != nil {
			return GapSurplusView{}, err
		}
		cells := []GapCell{}
		for _, p := range plans {
			cells = append(cells, p.Cells...)
		}
		sid := scenario.ID
		var ids []string
		for _, p := range plans {
			ids = append(ids, p.ZoneID)
		}
		return GapSurplusView{ScenarioID: &sid, RosterDate: scenario.BaseDate, PlanningLevel: planningLevel, Cells: cells, Illustrative: true, DataSource: "SYNTHETIC", Basis: plan.basis(ids, scenario.BaseDate)}, nil
	}
	if query.RosterID != "" {
		roster, err := requireRoster(ctx, conn, rc, query.RosterID)
		if err != nil {
			return GapSurplusView{}, err
		}
		rid := roster.ID
		return GapSurplusView{RosterID: &rid, RosterDate: roster.RosterDate, PlanningLevel: roster.PlanningLevel, Cells: currentCellsWithReach(ctx, rc, plan, newReachInputs(ctx, rc.CustomerID), roster.ZoneID, roster.RosterDate), Illustrative: true, DataSource: "SYNTHETIC",
			Basis: plan.basis([]string{roster.ZoneID}, roster.RosterDate)}, nil
	}
	date := query.Date
	if date == "" {
		date = shiftDateBy(demoToday(ctx, rc.CustomerID), 1)
	}
	cells := []GapCell{}
	reachIn := newReachInputs(ctx, rc.CustomerID)
	for _, z := range zones {
		cells = append(cells, currentCellsWithReach(ctx, rc, plan, reachIn, z.ID, date)...)
	}
	var rosterID *string
	if query.ZoneID != "" {
		if single := rosterFor(plan, query.ZoneID, date); single != nil {
			rid := single.ID
			rosterID = &rid
		}
	}
	ids := make([]string, 0, len(zones))
	for _, z := range zones {
		ids = append(ids, z.ID)
	}
	return GapSurplusView{RosterID: rosterID, RosterDate: date, PlanningLevel: planningLevel, Cells: cells, Illustrative: true, DataSource: "SYNTHETIC", Basis: plan.basis(ids, date)}, nil
}
