// SPDX-License-Identifier: AGPL-3.0-only

// Ports scenarios.ts in full: the CRUD and
// runScenario, now that simulation.go exists.
package business

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"

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

const maxScenarioZones = 8
const maxHeadcountStep = 50

func removeScenarioRowMemory(id string) {
	scenarioMu.Lock()
	defer scenarioMu.Unlock()
	seedScenariosLocked()
	for i, x := range scenarioStore {
		if x.ID == id {
			scenarioStore = append(scenarioStore[:i], scenarioStore[i+1:]...)
			return
		}
	}
}

func visibleScenarios(ctx context.Context, rc reqctx.RequestContext) ([]Scenario, error) {
	var out []Scenario
	all, err := loadScenarios(ctx, rc.CustomerID)
	if err != nil {
		return nil, err
	}
	for _, s := range all {
		visible := true
		for _, zid := range s.ZoneIDs {
			z := zid
			if !reqctx.CanReadZone(rc, &z) {
				visible = false
				break
			}
		}
		if visible {
			out = append(out, s)
		}
	}
	return out, nil
}

func requireScenarioRow(ctx context.Context, rc reqctx.RequestContext, id string) (Scenario, error) {
	if _, err := importutil.RequireID(id, "Scenario"); err != nil {
		return Scenario{}, err
	}
	s, err := scenarioByID(ctx, rc, id)
	if err != nil {
		return Scenario{}, err
	}
	if s == nil {
		return Scenario{}, dataerr.NotFound("Scenario not found.")
	}
	return *s, nil
}

// ListScenarios mirrors listScenarios.
func ListScenarios(rc reqctx.RequestContext, query datactx.PageQuery) (datactx.PageResult[Scenario], error) {
	if err := reqctx.RequireAccess(rc, access.ModuleOpsScenarioLab, access.AccessView); err != nil {
		return datactx.PageResult[Scenario]{}, err
	}
	rows, err := visibleScenarios(context.Background(), rc)
	if err != nil {
		return datactx.PageResult[Scenario]{}, err
	}
	sort.SliceStable(rows, func(i, j int) bool {
		if rows[i].CreatedAt != rows[j].CreatedAt {
			return rows[i].CreatedAt > rows[j].CreatedAt
		}
		if rows[i].Name != rows[j].Name {
			return rows[i].Name < rows[j].Name
		}
		return rows[i].ID < rows[j].ID
	})
	return datactx.Paginate(rows, query)
}

// GetScenario mirrors getScenario.
func GetScenario(rc reqctx.RequestContext, id string) (Scenario, error) {
	if err := reqctx.RequireAccess(rc, access.ModuleOpsScenarioLab, access.AccessView); err != nil {
		return Scenario{}, err
	}
	return requireScenarioRow(context.Background(), rc, id)
}

func parseHeadcountDelta(raw any, zoneIDs []string) ([]HeadcountDelta, error) {
	list, ok := raw.([]any)
	if !ok {
		return nil, dataerr.Invalid("Adjustments: headcount_delta must be a list.")
	}
	zoneSet := map[string]bool{}
	for _, z := range zoneIDs {
		zoneSet[z] = true
	}
	seen := map[string]bool{}
	out := make([]HeadcountDelta, 0, len(list))
	for _, entry := range list {
		e, err := datactx.Object(entry, "Headcount change", []string{"zone_id", "field_agents", "remote_agents", "vehicles"})
		if err != nil {
			return nil, err
		}
		zoneID, err := datactx.UUID(e, "zone_id")
		if err != nil {
			return nil, err
		}
		if !zoneSet[zoneID] {
			return nil, dataerr.Invalid("Headcount change: the zone is not one of the scenario zones.")
		}
		if seen[zoneID] {
			return nil, dataerr.Invalid("Headcount change: one entry per zone.")
		}
		seen[zoneID] = true
		step := datactx.NumOpts{HasMin: true, Min: -maxHeadcountStep, HasMax: true, Max: maxHeadcountStep}
		field, _, err := datactx.OptInt(e, "field_agents", step)
		if err != nil {
			return nil, err
		}
		remote, _, err := datactx.OptInt(e, "remote_agents", step)
		if err != nil {
			return nil, err
		}
		vehicles, _, err := datactx.OptInt(e, "vehicles", step)
		if err != nil {
			return nil, err
		}
		out = append(out, HeadcountDelta{ZoneID: zoneID, FieldAgents: field, RemoteAgents: remote, Vehicles: vehicles})
	}
	return out, nil
}

// parseAdjustments mirrors parseAdjustments.
func parseAdjustments(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, body any, zoneIDs []string) (ScenarioAdjustments, error) {
	if body == nil {
		body = map[string]any{}
	}
	input, err := datactx.Object(body, "Adjustments", []string{"headcount_delta", "shift_pattern_ids", "remote_share"})
	if err != nil {
		return ScenarioAdjustments{}, err
	}
	var out ScenarioAdjustments
	if raw, ok := input["headcount_delta"]; ok {
		delta, err := parseHeadcountDelta(raw, zoneIDs)
		if err != nil {
			return ScenarioAdjustments{}, err
		}
		out.HeadcountDelta = delta
	}
	if datactx.Has(input, "shift_pattern_ids") {
		ids, err := datactx.UUIDList(input, "shift_pattern_ids", false)
		if err != nil {
			return ScenarioAdjustments{}, err
		}
		patterns, err := allShiftPatterns(ctx, conn, rc.CustomerID)
		if err != nil {
			return ScenarioAdjustments{}, err
		}
		known := map[string]bool{}
		for _, p := range patterns {
			known[p.ID] = true
		}
		for _, id := range ids {
			if !known[id] {
				return ScenarioAdjustments{}, dataerr.Invalid("Adjustments: an unknown shift pattern.")
			}
		}
		out.ShiftPatternIDs = ids
	}
	if v, ok := input["remote_share"]; ok {
		if v == nil {
			out.RemoteShare = nil
		} else {
			share, err := datactx.Number(input, "remote_share", datactx.NumOpts{HasMin: true, Min: 0, HasMax: true, Max: 1})
			if err != nil {
				return ScenarioAdjustments{}, err
			}
			out.RemoteShare = &share
		}
	}
	return out, nil
}

// parseScenarioInput mirrors parseScenario. Zones
// are checked against the simulator's zone snapshot.
func parseScenarioInput(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, body any) (Scenario, error) {
	input, err := datactx.Object(body, "Scenario", []string{"name", "base_date", "zone_ids", "adjustments"})
	if err != nil {
		return Scenario{}, err
	}
	zoneIDs, err := datactx.UUIDList(input, "zone_ids", false)
	if err != nil {
		return Scenario{}, err
	}
	if len(zoneIDs) < 1 {
		return Scenario{}, dataerr.Invalid("Scenario: choose at least one zone.")
	}
	if len(zoneIDs) > maxScenarioZones {
		return Scenario{}, dataerr.Invalid(fmt.Sprintf("Scenario: at most %d zones.", maxScenarioZones))
	}
	for _, zid := range zoneIDs {
		z := zid
		if err := reqctx.RequireWriteZone(rc, &z); err != nil {
			return Scenario{}, err
		}
		if !simZoneExists(zid) {
			return Scenario{}, dataerr.Invalid("Scenario: an unknown zone.")
		}
	}
	name, err := datactx.String(input, "name", datactx.StrOpts{HasMin: true, Min: 1, HasMax: true, Max: 120})
	if err != nil {
		return Scenario{}, err
	}
	baseDate, err := datactx.Date(input, "base_date")
	if err != nil {
		return Scenario{}, err
	}
	adjustments, err := parseAdjustments(ctx, conn, rc, input["adjustments"], zoneIDs)
	if err != nil {
		return Scenario{}, err
	}
	return Scenario{Name: name, BaseDate: baseDate, ZoneIDs: zoneIDs, Adjustments: adjustments}, nil
}

// CreateScenario mirrors createScenario.
func CreateScenario(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, body any) (Scenario, error) {
	return auditlog.WriteWithAudit(ctx, rc, auditlog.Guard{ModuleID: access.ModuleOpsScenarioLab}, auditlog.WriteMeta{Action: "scenario.created", EntityType: "scenario"}, func(ctx context.Context) (auditlog.AuditedWrite[Scenario], error) {
		input, err := parseScenarioInput(ctx, conn, rc, body)
		if err != nil {
			return auditlog.AuditedWrite[Scenario]{}, err
		}
		at := datactx.NowISO()
		created := input
		created.BaseRecord = datactx.NewRecord(rc, "", at)
		created.Status = "draft"
		if err := saveScenario(ctx, rc.CustomerID, created); err != nil {
			return auditlog.AuditedWrite[Scenario]{}, err
		}
		id := created.ID
		return auditlog.AuditedWrite[Scenario]{
			Result: created, EntityID: &id,
			SummaryEn: fmt.Sprintf("Scenario %q created for %d zone(s) on %s.", created.Name, len(created.ZoneIDs), created.BaseDate),
			Detail:    map[string]any{"zone_ids": created.ZoneIDs, "base_date": created.BaseDate},
		}, nil
	})
}

// UpdateScenario mirrors updateScenario.
func UpdateScenario(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, id string, body any) (Scenario, error) {
	return auditlog.WriteWithAudit(ctx, rc, auditlog.Guard{ModuleID: access.ModuleOpsScenarioLab}, auditlog.WriteMeta{Action: "scenario.updated", EntityType: "scenario", EntityID: &id}, func(ctx context.Context) (auditlog.AuditedWrite[Scenario], error) {
		current, err := requireScenarioRow(ctx, rc, id)
		if err != nil {
			return auditlog.AuditedWrite[Scenario]{}, err
		}
		input, err := parseScenarioInput(ctx, conn, rc, body)
		if err != nil {
			return auditlog.AuditedWrite[Scenario]{}, err
		}
		next := current
		next.Name, next.BaseDate, next.ZoneIDs, next.Adjustments = input.Name, input.BaseDate, input.ZoneIDs, input.Adjustments
		next.Status, next.UpdatedAt = "draft", datactx.NowISO()
		if err := saveScenario(ctx, rc.CustomerID, next); err != nil {
			return auditlog.AuditedWrite[Scenario]{}, err
		}
		return auditlog.AuditedWrite[Scenario]{
			Result: next, EntityID: &id,
			SummaryEn: fmt.Sprintf("Scenario %q changed; run it again to see the new gap view.", next.Name),
			Detail:    map[string]any{"zone_ids": next.ZoneIDs, "base_date": next.BaseDate},
		}, nil
	})
}

// DeleteScenario mirrors deleteScenario.
func DeleteScenario(rc reqctx.RequestContext, id string) error {
	_, err := auditlog.WriteWithAudit(context.Background(), rc, auditlog.Guard{ModuleID: access.ModuleOpsScenarioLab}, auditlog.WriteMeta{Action: "scenario.deleted", EntityType: "scenario", EntityID: &id}, func(ctx context.Context) (auditlog.AuditedWrite[struct{}], error) {
		current, err := requireScenarioRow(ctx, rc, id)
		if err != nil {
			return auditlog.AuditedWrite[struct{}]{}, err
		}
		for _, zid := range current.ZoneIDs {
			z := zid
			if err := reqctx.RequireWriteZone(rc, &z); err != nil {
				return auditlog.AuditedWrite[struct{}]{}, err
			}
		}
		if err := deleteScenario(ctx, rc.CustomerID, id); err != nil {
			return auditlog.AuditedWrite[struct{}]{}, err
		}
		return auditlog.AuditedWrite[struct{}]{SummaryEn: fmt.Sprintf("Scenario %q deleted.", current.Name)}, nil
	})
	return err
}

// -------------------------------------------------
// Running (runScenario)
// -------------------------------------------------

// historyDayFor: the history date on the same
// weekday as date.
func historyDayFor(date string) string {
	days := map[string]bool{}
	for _, c := range allCasesSnapshot() {
		days[dateOnly(c.RegisteredAt)] = true
	}
	var sorted []string
	for d := range days {
		sorted = append(sorted, d)
	}
	sort.Strings(sorted)
	if len(sorted) == 0 {
		return ""
	}
	first := sorted[0]
	want := weekdayOfDate(date)
	for i := 0; i < 7; i++ {
		candidate := shiftDateBy(first, i)
		if days[candidate] && weekdayOfDate(candidate) == want {
			return candidate
		}
	}
	return ""
}

// OptimizerRosterAssignment mirrors the engine type.
type OptimizerRosterAssignment struct {
	AgentID        string  `json:"agent_id"`
	ShiftPatternID *string `json:"shift_pattern_id"`
	ZoneID         *string `json:"zone_id"`
	RosterDate     string  `json:"roster_date"`
	StartAt        string  `json:"start_at"`
	EndAt          string  `json:"end_at"`
	BreakStartAt   *string `json:"break_start_at"`
	BreakEndAt     *string `json:"break_end_at"`
	StandbyPointID *string `json:"standby_point_id"`
}

// OptimizerVehicleAssignment mirrors the engine.
type OptimizerVehicleAssignment struct {
	VehicleID      string  `json:"vehicle_id"`
	AgentID        string  `json:"agent_id"`
	ZoneID         string  `json:"zone_id"`
	RosterDate     string  `json:"roster_date"`
	ShiftPatternID *string `json:"shift_pattern_id"`
}

// OptimizerViolation mirrors the engine type.
type OptimizerViolation struct {
	Code    string  `json:"code"`
	Message string  `json:"message"`
	ZoneID  *string `json:"zone_id,omitempty"`
	AgentID *string `json:"agent_id,omitempty"`
}

// engineRef is the contract's engine {name, version}.
type engineRef struct {
	Name    string `json:"name"`
	Version string `json:"version"`
}

// OptimizerEngineOutput mirrors the engine contract.
type OptimizerEngineOutput struct {
	SchemaVersion      string                       `json:"schema_version"`
	RequestID          string                       `json:"request_id"`
	EngineName         string                       `json:"-"`
	EngineVersion      string                       `json:"-"`
	ModelVersion       string                       `json:"model_version"`
	GeneratedAt        string                       `json:"generated_at"`
	DataSource         string                       `json:"data_source"`
	InputDataSources   []string                     `json:"input_data_sources"`
	Illustrative       bool                         `json:"illustrative"`
	RosterDate         string                       `json:"roster_date"`
	Status             string                       `json:"status"`
	RosterAssignments  []OptimizerRosterAssignment  `json:"roster_assignments"`
	VehicleAssignments []OptimizerVehicleAssignment `json:"vehicle_assignments"`
	GapCells           []GapCell                    `json:"gap_cells"`
	Violations         []OptimizerViolation         `json:"violations"`
}

// MarshalJSON nests the engine and never emits null lists.
func (o OptimizerEngineOutput) MarshalJSON() ([]byte, error) {
	if o.InputDataSources == nil {
		o.InputDataSources = []string{}
	}
	if o.RosterAssignments == nil {
		o.RosterAssignments = []OptimizerRosterAssignment{}
	}
	if o.VehicleAssignments == nil {
		o.VehicleAssignments = []OptimizerVehicleAssignment{}
	}
	if o.GapCells == nil {
		o.GapCells = []GapCell{}
	}
	if o.Violations == nil {
		o.Violations = []OptimizerViolation{}
	}
	type plain OptimizerEngineOutput
	return json.Marshal(struct {
		plain
		Engine engineRef `json:"engine"`
	}{plain(o), engineRef{Name: o.EngineName, Version: o.EngineVersion}})
}

func readOptimizerDoc() (*optimizerOutputDoc, error) {
	var doc optimizerOutputDoc
	found, err := fixtures.Object("optimizer.output", &doc)
	if err != nil || !found {
		return nil, err
	}
	return &doc, nil
}

// optimizerDocument mirrors optimizerDocument.
func optimizerDocument(ctx context.Context, scenario Scenario, plans []ScenarioZonePlan) (OptimizerEngineOutput, error) {
	date := scenario.BaseDate
	var today []RosterAssignment
	var gapCells []GapCell
	for _, plan := range plans {
		for _, l := range plan.Lines {
			if l.RosterDate == date && l.ZoneID != nil {
				today = append(today, l)
			}
		}
		gapCells = append(gapCells, plan.Cells...)
	}
	status := "infeasible"
	if len(today) > 0 {
		status = "feasible"
		for _, c := range gapCells {
			if c.Kind == "gap" {
				status = "partial"
				break
			}
		}
	}
	engineVersion := "0.1.0"
	if doc, err := readOptimizerDoc(); err == nil && doc != nil && doc.Engine.Version != "" {
		engineVersion = doc.Engine.Version
	}
	modelVersion, err := activeForecastModel(ctx, scenario.TenantID)
	if err != nil {
		return OptimizerEngineOutput{}, err
	}
	rosterAssignments := make([]OptimizerRosterAssignment, len(today))
	for i, l := range today {
		rosterAssignments[i] = OptimizerRosterAssignment{
			AgentID: l.AgentID, ShiftPatternID: l.ShiftPatternID, ZoneID: l.ZoneID, RosterDate: l.RosterDate,
			StartAt: l.StartAt, EndAt: l.EndAt, BreakStartAt: l.BreakStartAt, BreakEndAt: l.BreakEndAt, StandbyPointID: l.StandbyPointID,
		}
	}
	var vehicleAssignments []OptimizerVehicleAssignment
	for _, l := range today {
		if l.VehicleID != nil && l.ZoneID != nil {
			vehicleAssignments = append(vehicleAssignments, OptimizerVehicleAssignment{
				VehicleID: *l.VehicleID, AgentID: l.AgentID, ZoneID: *l.ZoneID, RosterDate: l.RosterDate, ShiftPatternID: l.ShiftPatternID,
			})
		}
	}
	return OptimizerEngineOutput{
		SchemaVersion: "1.0", RequestID: datactx.DeterministicUUID(fmt.Sprintf("optimizer:scenario:%s:%s", scenario.ID, scenario.UpdatedAt)),
		EngineName: "optimizer", EngineVersion: engineVersion, ModelVersion: modelVersion,
		GeneratedAt: datactx.NowISO(), DataSource: "SYNTHETIC", InputDataSources: []string{"SYNTHETIC"},
		Illustrative: true, RosterDate: date, Status: status,
		RosterAssignments: rosterAssignments, VehicleAssignments: vehicleAssignments, GapCells: gapCells, Violations: nil,
	}, nil
}

// ScenarioRunResult mirrors the contract type.
type ScenarioRunResult struct {
	ScenarioID   string                 `json:"scenario_id"`
	GeneratedAt  string                 `json:"generated_at"`
	Optimizer    OptimizerEngineOutput  `json:"optimizer"`
	Simulation   *SimulatorEngineOutput `json:"simulation"`
	Illustrative bool                   `json:"illustrative"`
	DataSource   string                 `json:"data_source"`
}

// RunScenario mirrors runScenario.
func RunScenario(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, id string) (ScenarioRunResult, error) {
	return auditlog.WriteWithAudit(ctx, rc, auditlog.Guard{ModuleID: access.ModuleOpsScenarioLab}, auditlog.WriteMeta{Action: "scenario.run", EntityType: "scenario", EntityID: &id}, func(ctx context.Context) (auditlog.AuditedWrite[ScenarioRunResult], error) {
		scenario, err := requireScenarioRow(ctx, rc, id)
		if err != nil {
			return auditlog.AuditedWrite[ScenarioRunResult]{}, err
		}
		for _, zoneID := range scenario.ZoneIDs {
			zid := zoneID
			if err := reqctx.RequireWriteZone(rc, &zid); err != nil {
				return auditlog.AuditedWrite[ScenarioRunResult]{}, err
			}
		}
		plan, err := loadPlan(ctx, conn, rc)
		if err != nil {
			return auditlog.AuditedWrite[ScenarioRunResult]{}, err
		}
		if engineMode() == engines.ModeEngine {
			return runEngineScenario(ctx, conn, rc, plan, scenario)
		}
		plans, err := planScenarioZones(ctx, rc, plan, &scenario, "", nil)
		if err != nil {
			return auditlog.AuditedWrite[ScenarioRunResult]{}, err
		}
		optimizer, err := optimizerDocument(ctx, scenario, plans)
		if err != nil {
			return auditlog.AuditedWrite[ScenarioRunResult]{}, err
		}
		var coverage []ZoneCoverage
		for _, p := range plans {
			coverage = append(coverage, ZoneCoverage{ZoneID: p.ZoneID, Ratio: coverageRatio(p.Cells)})
		}

		var simulation *SimulatorEngineOutput
		runDate := historyDayFor(scenario.BaseDate)
		if runDate != "" {
			rows, err := simulateZones(ctx, rc, runDate, "nearest", coverage)
			if err != nil {
				return auditlog.AuditedWrite[ScenarioRunResult]{}, err
			}
			at := datactx.NowISO()
			clockStart, threshold := getClockStart(ctx, rc.CustomerID), getTenMinuteThresholdSeconds(ctx, rc.CustomerID)
			out, err := simulatorOutput(ctx, OutputMeta{Tenant: rc.CustomerID,
				RequestKey: fmt.Sprintf("scenario:%s:%s", scenario.ID, scenario.UpdatedAt), RosterRef: "scenario:" + scenario.ID,
				Policy: "nearest", ClockStart: clockStart, ThresholdSeconds: threshold, ModelVersion: optimizer.ModelVersion,
			}, rows)
			if err != nil {
				return auditlog.AuditedWrite[ScenarioRunResult]{}, err
			}
			completed := scenario
			completed.Status, completed.LastRunAt, completed.UpdatedAt = "completed", &at, at
			if _, err := storeSimulation(ctx, rc, SimulationRunInput{
				ID:         datactx.DeterministicUUID("scenario-simulation:" + scenario.ID),
				ScenarioID: &scenario.ID, RunDate: runDate, AssignmentPolicy: "nearest",
				PrimaryClockStart: clockStart, ThresholdSeconds: threshold,
				Status: "succeeded", Illustrative: true, EngineVersion: &optimizer.EngineVersion, FinishedAt: &at,
				CompleteScenario: &completed,
			}, rows); err != nil {
				return auditlog.AuditedWrite[ScenarioRunResult]{}, err
			}
			simulation = &out
		}
		at := datactx.NowISO()
		if simulation == nil {
			completed := scenario
			completed.Status, completed.LastRunAt, completed.UpdatedAt = "completed", &at, at
			if err := saveScenario(ctx, rc.CustomerID, completed); err != nil {
				return auditlog.AuditedWrite[ScenarioRunResult]{}, err
			}
		}

		result := ScenarioRunResult{ScenarioID: scenario.ID, GeneratedAt: at, Optimizer: optimizer, Simulation: simulation, Illustrative: true, DataSource: "SYNTHETIC"}
		gaps, surpluses := 0, 0
		for _, c := range optimizer.GapCells {
			if c.Kind == "gap" {
				gaps++
			} else if c.Kind == "surplus" {
				surpluses++
			}
		}
		return auditlog.AuditedWrite[ScenarioRunResult]{
			Result: result, EntityID: &id,
			SummaryEn: fmt.Sprintf("Scenario %q run: %d gap and %d surplus intervals (placeholder optimizer and simulator, Illustrative).", scenario.Name, gaps, surpluses),
			Detail:    map[string]any{"zone_ids": scenario.ZoneIDs, "base_date": scenario.BaseDate, "gap_intervals": gaps, "surplus_intervals": surpluses},
		}, nil
	})
}
