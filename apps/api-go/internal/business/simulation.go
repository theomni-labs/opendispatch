// SPDX-License-Identifier: AGPL-3.0-only

// Ports simulation.ts (ops.service_level_simulator)
// and internal/simulation-core.ts: replay one day's
// cases against a roster (or, from scenarios.go, a
// scenario) and read the placeholder service level.
package business

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"sort"
	"sync"

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

var simPolicies = []string{"nearest", "scorer", "replay_actual"}

const (
	simReferenceCoverage = 0.9
	simShareExponent     = 0.8
	simTimeExponent      = 0.5
	simMaxShare          = 0.98
)

// scorer engine not built: same as nearest
var simPolicyLift = map[string]float64{"nearest": 1, "scorer": 1, "replay_actual": 1}

// Reading mirrors ServiceLevelReading.
type Reading struct {
	WithinCount int      `json:"within_count"`
	CaseCount   int      `json:"case_count"`
	Share       *float64 `json:"share"`
}

func simReading(within, cases int) Reading {
	if cases == 0 {
		return Reading{WithinCount: within, CaseCount: cases}
	}
	s := float64(within) / float64(cases)
	return Reading{WithinCount: within, CaseCount: cases, Share: &s}
}

// coverageRatio: share of required staffing a roster
// plans, 0 to 1 (1 when nothing is required).
func coverageRatio(cells []GapCell) float64 {
	var required, covered float64
	for _, c := range cells {
		required += float64(c.Required)
		covered += math.Min(float64(c.Planned), float64(c.Required))
	}
	if required == 0 {
		return 1
	}
	return math.Min(1, covered/required)
}

// ZoneServiceLevel: one zone's result before it is
// stored or put in the engine output.
type ZoneServiceLevel struct {
	ZoneID                        string
	CaseCount                     int
	FieldCaseCount                int
	RemoteCaseCount               int
	FromRegistration              Reading
	FromAssignment                Reading
	MedianAssignedToArrivedSecond *int
	P90AssignedToArrivedSeconds   *int
	UnservedCases                 int
}

type simBaseline struct {
	ShareAssignment   float64
	ShareRegistration float64
	Median            float64
	P90               float64
}

type simulatorOutputDoc struct {
	Engine struct {
		Version string `json:"version"`
	} `json:"engine"`
	Zones []struct {
		ZoneID       string `json:"zone_id"`
		ServiceLevel struct {
			FromAssignment struct {
				Share *float64 `json:"share"`
			} `json:"from_assignment"`
			FromRegistration struct {
				Share *float64 `json:"share"`
			} `json:"from_registration"`
			AssignedToArrived *struct {
				MedianSeconds *float64 `json:"median_seconds"`
				P90Seconds    *float64 `json:"p90_seconds"`
			} `json:"assigned_to_arrived"`
		} `json:"service_level"`
	} `json:"zones"`
}

// simulatorFixture: the fixture, then runDate's answer.
func simulatorFixture(ctx context.Context, tenant, runDate string) (*simulatorOutputDoc, error) {
	var doc simulatorOutputDoc
	found, err := fixtures.Object("simulator.output", &doc)
	if err != nil || !found {
		return nil, err
	}
	if engineMode() != engines.ModeEngine {
		return &doc, nil
	}
	body, err := readKeptScope(ctx, tenant, engines.Simulator, runDate)
	if err != nil || body == nil {
		return &doc, err
	}
	var own simulatorOutputDoc
	if json.Unmarshal(body, &own) != nil {
		return &doc, nil
	}
	doc.Zones = append(doc.Zones, own.Zones...)
	return &doc, nil
}

func baselineFor(ctx context.Context, tenant, runDate, policy string) (map[string]simBaseline, error) {
	out := map[string]simBaseline{}
	if policy == "replay_actual" {
		var replayRunID string
		runs, err := loadSimulationRuns(ctx, tenant)
		if err != nil {
			return nil, err
		}
		for _, r := range runs {
			if r.AssignmentPolicy == "replay_actual" {
				replayRunID = r.ID
				break
			}
		}
		if replayRunID != "" {
			results, err := loadSimulationResults(ctx, tenant, replayRunID)
			if err != nil {
				return nil, err
			}
			for _, row := range results {
				if row.IntervalStart != nil {
					continue
				}
				b := simBaseline{Median: 600, P90: 1100}
				if row.FromAssignment.Share != nil {
					b.ShareAssignment = *row.FromAssignment.Share
				}
				if row.FromRegistration.Share != nil {
					b.ShareRegistration = *row.FromRegistration.Share
				}
				if row.MedianAssignedToArrivedSecond != nil {
					b.Median = float64(*row.MedianAssignedToArrivedSecond)
				}
				if row.P90AssignedToArrivedSeconds != nil {
					b.P90 = float64(*row.P90AssignedToArrivedSeconds)
				}
				out[row.ZoneID] = b
			}
		}
		if len(out) > 0 {
			return out, nil
		}
	}
	doc, err := simulatorFixture(ctx, tenant, runDate)
	if err != nil {
		return nil, err
	}
	if doc == nil {
		return out, nil
	}
	for _, zone := range doc.Zones {
		b := simBaseline{Median: 460, P90: 900}
		if zone.ServiceLevel.FromAssignment.Share != nil {
			b.ShareAssignment = *zone.ServiceLevel.FromAssignment.Share
		}
		if zone.ServiceLevel.FromRegistration.Share != nil {
			b.ShareRegistration = *zone.ServiceLevel.FromRegistration.Share
		}
		if zone.ServiceLevel.AssignedToArrived != nil {
			if zone.ServiceLevel.AssignedToArrived.MedianSeconds != nil {
				b.Median = *zone.ServiceLevel.AssignedToArrived.MedianSeconds
			}
			if zone.ServiceLevel.AssignedToArrived.P90Seconds != nil {
				b.P90 = *zone.ServiceLevel.AssignedToArrived.P90Seconds
			}
		}
		out[zone.ZoneID] = b
	}
	return out, nil
}

type simCaseCounts struct{ All, Field int }

func casesByZone(date string) map[string]simCaseCounts {
	out := map[string]simCaseCounts{}
	for _, c := range allCasesSnapshot() {
		if dateOnly(c.RegisteredAt) != date {
			continue
		}
		b := out[c.ZoneID]
		b.All++
		if c.Handling == "field" {
			b.Field++
		}
		out[c.ZoneID] = b
	}
	return out
}

// HistoryDateRange: days the committed case history
// covers (a run replays one of them).
type HistoryDateRange struct {
	First string `json:"first"`
	Last  string `json:"last"`
}

func historyDates() *HistoryDateRange {
	var first, last string
	for _, c := range allCasesSnapshot() {
		d := dateOnly(c.RegisteredAt)
		if first == "" || d < first {
			first = d
		}
		if last == "" || d > last {
			last = d
		}
	}
	if first == "" || last == "" {
		return nil
	}
	return &HistoryDateRange{First: first, Last: last}
}

// simZoneRow: another stale-snapshot copy, like
// field_share.go's demoZoneRow (TS reads Zone from
// the demo store here too, not store-api), extended
// with the name resultsOf sorts by.
type simZoneRow struct {
	ID     string `json:"id"`
	NameEn string `json:"name_en"`
}

var (
	simZoneMu     sync.Mutex
	simZoneRows   []simZoneRow
	simZoneSeeded bool
)

// ResetSimZonesForTest empties the zone snapshot.
func ResetSimZonesForTest() {
	simZoneMu.Lock()
	simZoneRows, simZoneSeeded = nil, true
	simZoneMu.Unlock()
}

// ReloadSimZonesForTest: back to the fixtures.
func ReloadSimZonesForTest() {
	simZoneMu.Lock()
	simZoneRows, simZoneSeeded = nil, false
	simZoneMu.Unlock()
}

// SeedSimZonesForTest sets the zone snapshot.
func SeedSimZonesForTest(rows []simZoneRow) {
	simZoneMu.Lock()
	simZoneRows, simZoneSeeded = append([]simZoneRow(nil), rows...), true
	simZoneMu.Unlock()
}

func allSimZoneRows() []simZoneRow {
	simZoneMu.Lock()
	defer simZoneMu.Unlock()
	if !simZoneSeeded {
		simZoneSeeded = true
		zones, _ := fixtures.Records[simZoneRow]("Zone")
		simZoneRows = append(simZoneRows, zones...)
	}
	return append([]simZoneRow(nil), simZoneRows...)
}

func simZoneExists(id string) bool {
	for _, z := range allSimZoneRows() {
		if z.ID == id {
			return true
		}
	}
	return false
}

func simZoneNameOf(id string) string {
	for _, z := range allSimZoneRows() {
		if z.ID == id {
			return z.NameEn
		}
	}
	return ""
}

// ZoneCoverage: one zone's coverage ratio. A slice,
// not a map -- simulateZones's output zone order
// follows this order, and TS's Map preserves the
// insertion order its own caller built it in.
type ZoneCoverage struct {
	ZoneID string
	Ratio  float64
}

// simulateZones: simulated service level per zone --
// the zone's baseline for the policy, moved by the
// coverage of its roster (or scenario), on runDate's
// cases. Caller checks access and zone scope.
func simulateZones(ctx context.Context, rc reqctx.RequestContext, runDate, policy string, coverage []ZoneCoverage) ([]ZoneServiceLevel, error) {
	history := historyDates()
	if history == nil || runDate < history.First || runDate > history.Last {
		first, last := "none", "none"
		if history != nil {
			first, last = history.First, history.Last
		}
		return nil, dataerr.Invalid(fmt.Sprintf("run_date must be a day with cases (%s to %s).", first, last))
	}
	base, err := baselineFor(ctx, rc.CustomerID, runDate, policy)
	if err != nil {
		return nil, err
	}
	cases := casesByZone(runDate)
	var out []ZoneServiceLevel
	for _, entry := range coverage {
		zoneID, ratio := entry.ZoneID, entry.Ratio
		zid := zoneID
		if !reqctx.CanReadZone(rc, &zid) || !simZoneExists(zoneID) {
			continue
		}
		b, ok := base[zoneID]
		if !ok {
			b = simBaseline{ShareAssignment: 0.5, Median: 600, P90: 1100}
			if policy == "replay_actual" {
				b.ShareRegistration = 0.25
			} else {
				b.ShareRegistration = 0.5
			}
		}
		counts := cases[zoneID]
		f := math.Min(1.3, math.Max(0.5, ratio/simReferenceCoverage))
		shareA := math.Min(simMaxShare, b.ShareAssignment*math.Pow(f, simShareExponent)*simPolicyLift[policy])
		shareR := shareA
		if b.ShareAssignment != 0 {
			shareR = math.Min(shareA, shareA*(b.ShareRegistration/b.ShareAssignment))
		} else {
			shareR = 0
		}
		withinA := int(math.Round(shareA * float64(counts.Field)))
		withinRRaw := int(math.Round(shareR * float64(counts.Field)))
		withinR := withinA
		if withinRRaw < withinR {
			withinR = withinRRaw
		}
		row := ZoneServiceLevel{
			ZoneID: zoneID, CaseCount: counts.All, FieldCaseCount: counts.Field, RemoteCaseCount: counts.All - counts.Field,
			FromRegistration: simReading(withinR, counts.Field), FromAssignment: simReading(withinA, counts.Field),
			UnservedCases: int(math.Round(float64(counts.Field) * math.Max(0, 1-ratio) * 0.15)),
		}
		if counts.Field != 0 {
			median := int(math.Round(b.Median / math.Pow(f, simTimeExponent)))
			p90 := int(math.Round(b.P90 / math.Pow(f, simTimeExponent)))
			row.MedianAssignedToArrivedSecond, row.P90AssignedToArrivedSeconds = &median, &p90
		}
		out = append(out, row)
	}
	return out, nil
}

func simSum(rows []ZoneServiceLevel, pick func(ZoneServiceLevel) int) int {
	total := 0
	for _, r := range rows {
		total += pick(r)
	}
	return total
}

func simWeighted(rows []ZoneServiceLevel, pick func(ZoneServiceLevel) *int) *int {
	var weight, total int
	for _, r := range rows {
		v := pick(r)
		if v == nil || r.FieldCaseCount == 0 {
			continue
		}
		weight += r.FieldCaseCount
		total += *v * r.FieldCaseCount
	}
	if weight == 0 {
		return nil
	}
	out := int(math.Round(float64(total) / float64(weight)))
	return &out
}

// SimulatedPercentiles mirrors SimulatedPercentiles.
type SimulatedPercentiles struct {
	MedianSeconds *int `json:"median_seconds"`
	P90Seconds    *int `json:"p90_seconds"`
}

// SimulatedServiceLevel mirrors the engine type.
type SimulatedServiceLevel struct {
	CaseCount         int                  `json:"case_count"`
	FieldCaseCount    int                  `json:"field_case_count"`
	RemoteCaseCount   int                  `json:"remote_case_count"`
	FromRegistration  Reading              `json:"from_registration"`
	FromAssignment    Reading              `json:"from_assignment"`
	AssignedToArrived SimulatedPercentiles `json:"assigned_to_arrived"`
}

func serviceLevelOf(rows []ZoneServiceLevel) SimulatedServiceLevel {
	median := simWeighted(rows, func(r ZoneServiceLevel) *int { return r.MedianAssignedToArrivedSecond })
	p90 := simWeighted(rows, func(r ZoneServiceLevel) *int { return r.P90AssignedToArrivedSeconds })
	return SimulatedServiceLevel{
		CaseCount:         simSum(rows, func(r ZoneServiceLevel) int { return r.CaseCount }),
		FieldCaseCount:    simSum(rows, func(r ZoneServiceLevel) int { return r.FieldCaseCount }),
		RemoteCaseCount:   simSum(rows, func(r ZoneServiceLevel) int { return r.RemoteCaseCount }),
		FromRegistration:  simReading(simSum(rows, func(r ZoneServiceLevel) int { return r.FromRegistration.WithinCount }), simSum(rows, func(r ZoneServiceLevel) int { return r.FromRegistration.CaseCount })),
		FromAssignment:    simReading(simSum(rows, func(r ZoneServiceLevel) int { return r.FromAssignment.WithinCount }), simSum(rows, func(r ZoneServiceLevel) int { return r.FromAssignment.CaseCount })),
		AssignedToArrived: SimulatedPercentiles{MedianSeconds: median, P90Seconds: p90},
	}
}

// OutputMeta mirrors OutputMeta.
type OutputMeta struct {
	Tenant           string
	RequestKey       string
	RosterRef        string
	Policy           string
	ClockStart       string
	ThresholdSeconds int
	ModelVersion     string
}

// SimulatorEngineOutputZone: one zone's level.
type SimulatorEngineOutputZone struct {
	ZoneID       string                `json:"zone_id"`
	ServiceLevel SimulatedServiceLevel `json:"service_level"`
}

// SimulatorEngineOutput mirrors the engine contract.
type SimulatorEngineOutput struct {
	SchemaVersion     string                      `json:"schema_version"`
	RequestID         string                      `json:"request_id"`
	EngineName        string                      `json:"-"`
	EngineVersion     string                      `json:"-"`
	ModelVersion      string                      `json:"model_version"`
	GeneratedAt       string                      `json:"generated_at"`
	DataSource        string                      `json:"data_source"`
	InputDataSources  []string                    `json:"input_data_sources"`
	Illustrative      bool                        `json:"illustrative"`
	RosterRef         string                      `json:"roster_ref"`
	AssignmentPolicy  string                      `json:"assignment_policy"`
	PrimaryClockStart string                      `json:"primary_clock_start"`
	ThresholdSeconds  int                         `json:"threshold_seconds"`
	Overall           SimulatedServiceLevel       `json:"overall"`
	Zones             []SimulatorEngineOutputZone `json:"zones"`
	UnservedCases     int                         `json:"unserved_cases"`
}

// MarshalJSON nests the engine and never emits null lists.
func (o SimulatorEngineOutput) MarshalJSON() ([]byte, error) {
	if o.InputDataSources == nil {
		o.InputDataSources = []string{}
	}
	if o.Zones == nil {
		o.Zones = []SimulatorEngineOutputZone{}
	}
	type plain SimulatorEngineOutput
	return json.Marshal(struct {
		plain
		Engine engineRef `json:"engine"`
	}{plain(o), engineRef{Name: o.EngineName, Version: o.EngineVersion}})
}

// simulatorOutput: the engine output document of a
// set of zone results.
func simulatorOutput(ctx context.Context, meta OutputMeta, rows []ZoneServiceLevel) (SimulatorEngineOutput, error) {
	engineVersion := "0.1.0"
	var doc simulatorOutputDoc
	if found, err := readSimulatorDocument(ctx, meta.Tenant, &doc); err == nil && found && doc.Engine.Version != "" {
		engineVersion = doc.Engine.Version
	}
	zones := make([]SimulatorEngineOutputZone, len(rows))
	for i, r := range rows {
		zones[i] = SimulatorEngineOutputZone{ZoneID: r.ZoneID, ServiceLevel: serviceLevelOf([]ZoneServiceLevel{r})}
	}
	rosterRef := meta.RosterRef
	if len(rosterRef) > 64 {
		rosterRef = rosterRef[:64]
	}
	return SimulatorEngineOutput{
		SchemaVersion: "1.0", RequestID: datactx.DeterministicUUID("simulator:" + meta.RequestKey),
		EngineName: "simulator", EngineVersion: engineVersion, ModelVersion: meta.ModelVersion,
		GeneratedAt: datactx.NowISO(), DataSource: "SYNTHETIC", InputDataSources: []string{"SYNTHETIC"},
		Illustrative: true, RosterRef: rosterRef, AssignmentPolicy: meta.Policy, PrimaryClockStart: meta.ClockStart,
		ThresholdSeconds: meta.ThresholdSeconds, Overall: serviceLevelOf(rows), Zones: zones,
		UnservedCases: simSum(rows, func(r ZoneServiceLevel) int { return r.UnservedCases }),
	}, nil
}

// SimulationRun mirrors the contract type.
type SimulationRun struct {
	datactx.BaseRecord
	RosterID          *string `json:"roster_id"`
	ScenarioID        *string `json:"scenario_id"`
	RunDate           string  `json:"run_date"`
	AssignmentPolicy  string  `json:"assignment_policy"`
	PrimaryClockStart string  `json:"primary_clock_start"`
	ThresholdSeconds  int     `json:"threshold_seconds"`
	Status            string  `json:"status"`
	Illustrative      bool    `json:"illustrative"`
	EngineVersion     *string `json:"engine_version"`
	FinishedAt        *string `json:"finished_at"`
}

// SimulationResult mirrors the contract type.
type SimulationResult struct {
	datactx.BaseRecord
	SimulationRunID               string  `json:"simulation_run_id"`
	ZoneID                        string  `json:"zone_id"`
	IntervalStart                 *string `json:"interval_start"`
	CaseCount                     int     `json:"case_count"`
	FieldCaseCount                int     `json:"field_case_count"`
	FromRegistration              Reading `json:"from_registration"`
	FromAssignment                Reading `json:"from_assignment"`
	MedianAssignedToArrivedSecond *int    `json:"median_assigned_to_arrived_seconds"`
	P90AssignedToArrivedSeconds   *int    `json:"p90_assigned_to_arrived_seconds"`
}

var (
	simRunMu     sync.Mutex
	simRunStore  []SimulationRun
	simRunSeeded bool
	simResultMu  sync.Mutex
	simResultRow []SimulationResult
	simResSeeded bool
)

// ResetSimulationsForTest empties both stores.
func ResetSimulationsForTest() {
	simRunMu.Lock()
	simRunStore, simRunSeeded = nil, true
	simRunMu.Unlock()
	simResultMu.Lock()
	simResultRow, simResSeeded = nil, true
	simResultMu.Unlock()
}

// ReloadSimulationsForTest: back to the fixtures.
func ReloadSimulationsForTest() {
	simRunMu.Lock()
	simRunStore, simRunSeeded = nil, false
	simRunMu.Unlock()
	simResultMu.Lock()
	simResultRow, simResSeeded = nil, false
	simResultMu.Unlock()
}

func seedSimRunsLocked() {
	if simRunSeeded {
		return
	}
	simRunSeeded = true
	if rows, err := fixtures.Records[SimulationRun]("SimulationRun"); err == nil {
		simRunStore = rows
	}
}

func seedSimResultsLocked() {
	if simResSeeded {
		return
	}
	simResSeeded = true
	if rows, err := fixtures.Records[SimulationResult]("SimulationResult"); err == nil {
		simResultRow = rows
	}
}

func upsertSimulationRunMemory(r SimulationRun) {
	simRunMu.Lock()
	defer simRunMu.Unlock()
	seedSimRunsLocked()
	for i, x := range simRunStore {
		if x.ID == r.ID {
			simRunStore[i] = r
			return
		}
	}
	simRunStore = append(simRunStore, r)
}

func allSimulationRunsMemory() []SimulationRun {
	simRunMu.Lock()
	defer simRunMu.Unlock()
	seedSimRunsLocked()
	return append([]SimulationRun(nil), simRunStore...)
}

func upsertSimulationResultsMemory(rows []SimulationResult) {
	simResultMu.Lock()
	defer simResultMu.Unlock()
	seedSimResultsLocked()
	for _, r := range rows {
		found := false
		for i, x := range simResultRow {
			if x.ID == r.ID {
				simResultRow[i] = r
				found = true
				break
			}
		}
		if !found {
			simResultRow = append(simResultRow, r)
		}
	}
}

func allSimulationResultsMemory() []SimulationResult {
	simResultMu.Lock()
	defer simResultMu.Unlock()
	seedSimResultsLocked()
	return append([]SimulationResult(nil), simResultRow...)
}

// toSimResult: labelled like its run.
func toSimResult(run SimulationRun, row ZoneServiceLevel, at, id string) SimulationResult {
	runID := run.ID
	return SimulationResult{
		BaseRecord:      datactx.BaseRecord{ID: id, DataSource: run.DataSource, CreatedAt: at, UpdatedAt: at},
		SimulationRunID: runID, ZoneID: row.ZoneID, CaseCount: row.CaseCount, FieldCaseCount: row.FieldCaseCount,
		FromRegistration: row.FromRegistration, FromAssignment: row.FromAssignment,
		MedianAssignedToArrivedSecond: row.MedianAssignedToArrivedSecond, P90AssignedToArrivedSeconds: row.P90AssignedToArrivedSeconds,
	}
}

// SimulationRunInput: storeSimulation's run param
// (mirrors Omit<SimulationRun, keyof BaseRecord>).
type SimulationRunInput struct {
	ID                string
	RosterID          *string
	ScenarioID        *string
	RunDate           string
	AssignmentPolicy  string
	PrimaryClockStart string
	ThresholdSeconds  int
	Status            string
	Illustrative      bool
	EngineVersion     *string
	FinishedAt        *string
	CompleteScenario  *Scenario
}

// storeSimulation: a run + a result row per zone.
// Caller needs edit on the simulator and the zones.
func storeSimulation(ctx context.Context, rc reqctx.RequestContext, run SimulationRunInput, rows []ZoneServiceLevel) (SimulationRun, error) {
	if err := reqctx.RequireAccess(rc, access.ModuleOpsServiceLevelSimulator, access.AccessEdit); err != nil {
		return SimulationRun{}, err
	}
	for _, row := range rows {
		zid := row.ZoneID
		if err := reqctx.RequireWriteZone(rc, &zid); err != nil {
			return SimulationRun{}, err
		}
	}
	at := datactx.NowISO()
	id := run.ID
	if id == "" {
		id = datactx.NewID()
	}
	record := SimulationRun{
		BaseRecord: datactx.NewRecord(rc, id, at),
		RosterID:   run.RosterID, ScenarioID: run.ScenarioID, RunDate: run.RunDate,
		AssignmentPolicy: run.AssignmentPolicy, PrimaryClockStart: run.PrimaryClockStart, ThresholdSeconds: run.ThresholdSeconds,
		Status: run.Status, Illustrative: run.Illustrative, EngineVersion: run.EngineVersion, FinishedAt: run.FinishedAt,
	}
	var results []SimulationResult
	for _, row := range rows {
		results = append(results, toSimResult(record, row, at, datactx.DeterministicUUID(fmt.Sprintf("simulation-result:%s:%s", record.ID, row.ZoneID))))
	}
	if err := simStoreBackend.save(ctx, rc.CustomerID, record, results, run.CompleteScenario); err != nil {
		return SimulationRun{}, err
	}
	return record, nil
}

// getTenMinuteThresholdSeconds: 60 s to 1 h, else 600.
func getTenMinuteThresholdSeconds(ctx context.Context, tenant string) int {
	v := readSetting(ctx, tenant, tenMinuteThresholdKey, defaultTenMinuteThresholdS)
	if validTenMinuteThreshold(v) {
		return v
	}
	return defaultTenMinuteThresholdS
}

// Reading runs.

func modelVersionOfSim(ctx context.Context, tenant string) (string, error) {
	return activeForecastModel(ctx, tenant)
}

func runZones(rc reqctx.RequestContext, ctx context.Context, conn *tenancy.Connection, run SimulationRun) ([]string, error) {
	if run.RosterID != nil {
		rows, err := allRosters(ctx, conn, rc.CustomerID)
		if err != nil {
			return nil, err
		}
		for _, r := range rows {
			if r.ID == *run.RosterID {
				return []string{r.ZoneID}, nil
			}
		}
		return []string{}, nil
	}
	if run.ScenarioID != nil {
		s, err := loadScenario(ctx, rc.CustomerID, *run.ScenarioID)
		if err != nil {
			return nil, err
		}
		if s == nil {
			return []string{}, nil
		}
		return s.ZoneIDs, nil
	}
	return nil, nil
}

func simVisible(rc reqctx.RequestContext, ctx context.Context, conn *tenancy.Connection, run SimulationRun) (bool, error) {
	zones, err := runZones(rc, ctx, conn, run)
	if err != nil {
		return false, err
	}
	if zones == nil {
		return true, nil
	}
	if len(zones) == 0 {
		return false, nil
	}
	for _, id := range zones {
		zid := id
		if !reqctx.CanReadZone(rc, &zid) {
			return false, nil
		}
	}
	return true, nil
}

func requireSimulationRun(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, id string) (SimulationRun, error) {
	if _, err := importutil.RequireID(id, "Simulation run"); err != nil {
		return SimulationRun{}, err
	}
	all, err := loadSimulationRuns(ctx, rc.CustomerID)
	if err != nil {
		return SimulationRun{}, err
	}
	for _, r := range all {
		if r.ID != id {
			continue
		}
		ok, err := simVisible(rc, ctx, conn, r)
		if err != nil {
			return SimulationRun{}, err
		}
		if ok {
			return r, nil
		}
	}
	return SimulationRun{}, dataerr.NotFound("Simulation run not found.")
}

func simResultsOf(ctx context.Context, rc reqctx.RequestContext, runID string) ([]SimulationResult, error) {
	var out []SimulationResult
	all, err := loadSimulationResults(ctx, rc.CustomerID, runID)
	if err != nil {
		return nil, err
	}
	for _, r := range all {
		zid := r.ZoneID
		if r.SimulationRunID == runID && reqctx.CanReadZone(rc, &zid) {
			out = append(out, r)
		}
	}
	sort.SliceStable(out, func(i, j int) bool {
		ni, nj := simZoneNameOf(out[i].ZoneID), simZoneNameOf(out[j].ZoneID)
		if ni != nj {
			return ni < nj
		}
		return out[i].ID < out[j].ID
	})
	return out, nil
}

// GetSimulationHistoryRange mirrors the (not in the
// contract) getSimulationHistoryRange.
func GetSimulationHistoryRange(rc reqctx.RequestContext) (*HistoryDateRange, error) {
	if err := reqctx.RequireAccess(rc, access.ModuleOpsServiceLevelSimulator, access.AccessView); err != nil {
		return nil, err
	}
	return historyDates(), nil
}

// SimulationRunQuery mirrors listSimulationRuns.
type SimulationRunQuery struct {
	Limit  int
	Cursor string
	Date   string
}

// ListSimulationRuns mirrors listSimulationRuns.
func ListSimulationRuns(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, query SimulationRunQuery) (datactx.PageResult[SimulationRun], error) {
	if err := reqctx.RequireAccess(rc, access.ModuleOpsServiceLevelSimulator, access.AccessView); err != nil {
		return datactx.PageResult[SimulationRun]{}, err
	}
	if query.Date != "" {
		if _, err := datactx.Date(datactx.Obj{"date": query.Date}, "date"); err != nil {
			return datactx.PageResult[SimulationRun]{}, err
		}
	}
	rows, err := loadSimulationRuns(ctx, rc.CustomerID)
	if err != nil {
		return datactx.PageResult[SimulationRun]{}, err
	}
	var out []SimulationRun
	for _, r := range rows {
		ok, err := simVisible(rc, ctx, conn, r)
		if err != nil {
			return datactx.PageResult[SimulationRun]{}, err
		}
		if ok && (query.Date == "" || r.RunDate == query.Date) {
			out = append(out, r)
		}
	}
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].CreatedAt != out[j].CreatedAt {
			return out[i].CreatedAt > out[j].CreatedAt
		}
		return out[i].ID > out[j].ID
	})
	return datactx.Paginate(out, datactx.PageQuery{Limit: query.Limit, Cursor: query.Cursor})
}

// SimulationRunDetail mirrors the contract type.
type SimulationRunDetail struct {
	Run    SimulationRun          `json:"run"`
	Output *SimulatorEngineOutput `json:"output"`
}

// GetSimulationRun mirrors getSimulationRun.
func GetSimulationRun(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, id string) (SimulationRunDetail, error) {
	if err := reqctx.RequireAccess(rc, access.ModuleOpsServiceLevelSimulator, access.AccessView); err != nil {
		return SimulationRunDetail{}, err
	}
	run, err := requireSimulationRun(ctx, conn, rc, id)
	if err != nil {
		return SimulationRunDetail{}, err
	}
	var rows []ZoneServiceLevel
	stored, err := simResultsOf(ctx, rc, run.ID)
	if err != nil {
		return SimulationRunDetail{}, err
	}
	for _, r := range stored {
		if r.IntervalStart != nil {
			continue
		}
		rows = append(rows, ZoneServiceLevel{
			ZoneID: r.ZoneID, CaseCount: r.CaseCount, FieldCaseCount: r.FieldCaseCount, RemoteCaseCount: r.CaseCount - r.FieldCaseCount,
			FromRegistration: r.FromRegistration, FromAssignment: r.FromAssignment,
			MedianAssignedToArrivedSecond: r.MedianAssignedToArrivedSecond, P90AssignedToArrivedSeconds: r.P90AssignedToArrivedSeconds,
		})
	}
	if run.Status != "succeeded" || len(rows) == 0 {
		return SimulationRunDetail{Run: run, Output: nil}, nil
	}
	rosterRef := run.RunDate
	if run.RosterID != nil {
		rosterRef = *run.RosterID
	} else if run.ScenarioID != nil {
		rosterRef = *run.ScenarioID
	} else {
		rosterRef = "actual-" + run.RunDate
	}
	modelVersion, err := modelVersionOfSim(ctx, run.TenantID)
	if err != nil {
		return SimulationRunDetail{}, err
	}
	output, err := simulatorOutput(ctx, OutputMeta{Tenant: run.TenantID, RequestKey: run.ID, RosterRef: rosterRef, Policy: run.AssignmentPolicy, ClockStart: run.PrimaryClockStart, ThresholdSeconds: run.ThresholdSeconds, ModelVersion: modelVersion}, rows)
	if err != nil {
		return SimulationRunDetail{}, err
	}
	if run.FinishedAt != nil {
		output.GeneratedAt = *run.FinishedAt
	} else {
		output.GeneratedAt = run.UpdatedAt
	}
	return SimulationRunDetail{Run: run, Output: &output}, nil
}

// SimulationResultQuery: the list-results query.
type SimulationResultQuery struct {
	Limit  int
	Cursor string
	ZoneID string
}

// ListSimulationResults mirrors the TS function.
func ListSimulationResults(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, id string, query SimulationResultQuery) (datactx.PageResult[SimulationResult], error) {
	if err := reqctx.RequireAccess(rc, access.ModuleOpsServiceLevelSimulator, access.AccessView); err != nil {
		return datactx.PageResult[SimulationResult]{}, err
	}
	run, err := requireSimulationRun(ctx, conn, rc, id)
	if err != nil {
		return datactx.PageResult[SimulationResult]{}, err
	}
	var out []SimulationResult
	stored, err := simResultsOf(ctx, rc, run.ID)
	if err != nil {
		return datactx.PageResult[SimulationResult]{}, err
	}
	for _, r := range stored {
		if query.ZoneID == "" || r.ZoneID == query.ZoneID {
			out = append(out, r)
		}
	}
	return datactx.Paginate(out, datactx.PageQuery{Limit: query.Limit, Cursor: query.Cursor})
}

// Running.

// RunSimulation mirrors runSimulation.
func RunSimulation(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, body any) (SimulationRun, error) {
	return auditlog.WriteWithAudit(ctx, rc, auditlog.Guard{ModuleID: access.ModuleOpsServiceLevelSimulator}, auditlog.WriteMeta{Action: "simulation.run", EntityType: "simulation_run"}, func(ctx context.Context) (auditlog.AuditedWrite[SimulationRun], error) {
		o, err := datactx.Object(body, "Simulation", []string{"roster_id", "run_date", "assignment_policy"})
		if err != nil {
			return auditlog.AuditedWrite[SimulationRun]{}, err
		}
		rosterID, err := datactx.UUID(o, "roster_id")
		if err != nil {
			return auditlog.AuditedWrite[SimulationRun]{}, err
		}
		runDate, err := datactx.Date(o, "run_date")
		if err != nil {
			return auditlog.AuditedWrite[SimulationRun]{}, err
		}
		policy := "nearest"
		if datactx.Has(o, "assignment_policy") && o["assignment_policy"] != nil {
			policy, err = datactx.EnumOf(o, "assignment_policy", simPolicies)
			if err != nil {
				return auditlog.AuditedWrite[SimulationRun]{}, err
			}
		}
		rosters, err := allRosters(ctx, conn, rc.CustomerID)
		if err != nil {
			return auditlog.AuditedWrite[SimulationRun]{}, err
		}
		var roster *Roster
		for i := range rosters {
			if rosters[i].ID == rosterID {
				roster = &rosters[i]
				break
			}
		}
		roster, err = datactx.RequireFound(roster, "Roster")
		if err != nil {
			return auditlog.AuditedWrite[SimulationRun]{}, err
		}
		if err := reqctx.RequireWriteZone(rc, &roster.ZoneID); err != nil {
			return auditlog.AuditedWrite[SimulationRun]{}, err
		}
		plan, err := loadPlan(ctx, conn, rc)
		if err != nil {
			return auditlog.AuditedWrite[SimulationRun]{}, err
		}
		if engineMode() == engines.ModeEngine {
			return runEngineSimulation(ctx, conn, rc, plan, roster, runDate, policy)
		}
		cells := currentCells(ctx, rc, plan, roster.ZoneID, roster.RosterDate)
		ratio := coverageRatio(cells)
		rows, err := simulateZones(ctx, rc, runDate, policy, []ZoneCoverage{{ZoneID: roster.ZoneID, Ratio: ratio}})
		if err != nil {
			return auditlog.AuditedWrite[SimulationRun]{}, err
		}
		at := datactx.NowISO()
		engineVersion := "0.1.0"
		if doc, err := simulatorFixture(ctx, rc.CustomerID, runDate); err == nil && doc != nil && doc.Engine.Version != "" {
			engineVersion = doc.Engine.Version
		}
		run, err := storeSimulation(ctx, rc, SimulationRunInput{
			RosterID: &roster.ID, RunDate: runDate, AssignmentPolicy: policy,
			PrimaryClockStart: getClockStart(ctx, rc.CustomerID), ThresholdSeconds: getTenMinuteThresholdSeconds(ctx, rc.CustomerID),
			Status: "succeeded", Illustrative: true, EngineVersion: &engineVersion, FinishedAt: &at,
		}, rows)
		if err != nil {
			return auditlog.AuditedWrite[SimulationRun]{}, err
		}
		detail := map[string]any{"roster_id": roster.ID, "run_date": runDate, "policy": policy}
		if len(rows) > 0 {
			if rows[0].FromAssignment.Share != nil {
				detail["from_assignment_share"] = *rows[0].FromAssignment.Share
			}
			if rows[0].FromRegistration.Share != nil {
				detail["from_registration_share"] = *rows[0].FromRegistration.Share
			}
		}
		runID := run.ID
		return auditlog.AuditedWrite[SimulationRun]{
			Result: run, EntityID: &runID,
			SummaryEn: fmt.Sprintf("Cases of %s replayed against the roster of %s (%s); coverage %d percent of the required staffing (placeholder simulator, Illustrative).", runDate, roster.RosterDate, policy, int(math.Round(ratio*100))),
			Detail:    detail,
		}, nil
	})
}
