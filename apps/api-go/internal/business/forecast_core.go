// SPDX-License-Identifier: AGPL-3.0-only

// Ports forecast-core.ts's DayFactorOf, plus the
// Case/CaseType snapshot it and field_share.go need
// (no Go Case CRUD yet; in-memory, matching TS).
package business

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"sync"
	"time"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/dataerr"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/fixtures"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/importutil"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/reqctx"
)

// Case mirrors the contract type in full (cases.go
// reads it live; forecast-core.go/field_share.go
// read a stale in-memory copy, matching TS's own
// readAll from the old store). Flat fields, not an
// embedded BaseRecord: existing literals depend on
// ID/DataSource staying direct fields.
type Case struct {
	ID                 string         `json:"id"`
	TenantID           string         `json:"tenant_id"`
	CreatedAt          string         `json:"created_at"`
	UpdatedAt          string         `json:"updated_at"`
	CreatedBy          *string        `json:"created_by"`
	DataSource         string         `json:"data_source"`
	ExternalID         string         `json:"external_id"`
	CaseNumber         string         `json:"case_number"`
	RegisteredAt       string         `json:"registered_at"`
	CityID             string         `json:"city_id"`
	ZoneID             string         `json:"zone_id"`
	SubZoneID          string         `json:"sub_zone_id"`
	Latitude           float64        `json:"latitude"`
	Longitude          float64        `json:"longitude"`
	CaseTypeID         string         `json:"case_type_id"`
	PartiesInvolved    int            `json:"parties_involved"`
	AssignedAt         *string        `json:"assigned_at"`
	ArrivedAt          *string        `json:"arrived_at"`
	ClosedAt           *string        `json:"closed_at"`
	Handling           string         `json:"handling"`
	AgentID            *string        `json:"agent_id"`
	VehicleID          *string        `json:"vehicle_id"`
	Severity           *string        `json:"severity"`
	InjuryPresent      *bool          `json:"injury_present"`
	EstimatedDamageSar *float64       `json:"estimated_damage_sar"`
	OnSceneCompletedAt *string        `json:"on_scene_completed_at"`
	RemoteReviewAt     *string        `json:"remote_review_at"`
	Channel            *string        `json:"channel"`
	SyntheticFields    []string       `json:"synthetic_fields,omitempty"`
	Extra              map[string]any `json:"extra"`
}

// CaseType mirrors the contract type in full. Flat
// fields for the same reason as Case above.
type CaseType struct {
	ID         string         `json:"id"`
	TenantID   string         `json:"tenant_id"`
	CreatedAt  string         `json:"created_at"`
	UpdatedAt  string         `json:"updated_at"`
	CreatedBy  *string        `json:"created_by"`
	DataSource string         `json:"data_source"`
	ExternalID *string        `json:"external_id"`
	NameEn     string         `json:"name_en"`
	NameAr     *string        `json:"name_ar"`
	IsActive   bool           `json:"is_active"`
	Extra      map[string]any `json:"extra"`
}

var (
	forecastMu     sync.Mutex
	caseRows       []Case
	caseTypeRows   []CaseType
	forecastSeeded bool
)

// ResetForecastCoreForTest clears the case snapshot.
func ResetForecastCoreForTest() {
	forecastMu.Lock()
	caseRows, caseTypeRows = nil, nil
	forecastSeeded = false
	forecastMu.Unlock()
}

// SeedCasesForTest sets the case snapshot.
func SeedCasesForTest(rows []Case) {
	forecastMu.Lock()
	caseRows = append([]Case(nil), rows...)
	forecastSeeded = true
	forecastMu.Unlock()
}

// SeedCaseTypesForTest sets the case-type snapshot.
func SeedCaseTypesForTest(rows []CaseType) {
	forecastMu.Lock()
	caseTypeRows = append([]CaseType(nil), rows...)
	forecastSeeded = true
	forecastMu.Unlock()
}

// ensureForecastCoreSeeded: lazy, from fixtures, once
// (mirrors ensureRulesSeeded). Case/CaseType have
// committed fixtures that TS's own readAll falls back
// to; without this, dayFactorOf always saw empty case
// history and every required series used factor 1.
func ensureForecastCoreSeeded() {
	forecastMu.Lock()
	seeded := forecastSeeded
	forecastMu.Unlock()
	if seeded {
		return
	}
	cases, casesErr := fixtures.Records[Case]("Case")
	caseTypes, caseTypesErr := fixtures.Records[CaseType]("CaseType")
	forecastMu.Lock()
	if !forecastSeeded {
		if casesErr == nil {
			caseRows = cases
		}
		if caseTypesErr == nil {
			caseTypeRows = caseTypes
		}
		forecastSeeded = true
	}
	forecastMu.Unlock()
}

func allCasesSnapshot() []Case {
	ensureForecastCoreSeeded()
	forecastMu.Lock()
	out := append([]Case(nil), caseRows...)
	forecastMu.Unlock()
	return out
}

func allCaseTypesSnapshot() []CaseType {
	ensureForecastCoreSeeded()
	forecastMu.Lock()
	out := append([]CaseType(nil), caseTypeRows...)
	forecastMu.Unlock()
	return out
}

func weekdayOfDate(date string) time.Weekday {
	t, err := time.Parse("2006-01-02", date)
	if err != nil {
		return time.Sunday
	}
	return t.UTC().Weekday()
}

// shiftDateBy mirrors shiftDate/addDays.
func shiftDateBy(date string, days int) string {
	t, err := time.Parse("2006-01-02", date)
	if err != nil {
		return date
	}
	return t.AddDate(0, 0, days).Format("2006-01-02")
}

// caseDayCounts mirrors buildCaseDayCounts.
func caseDayCounts() (counts map[string]int, first, last string) {
	counts = map[string]int{}
	for _, c := range allCasesSnapshot() {
		date := c.RegisteredAt
		if len(date) >= 10 {
			date = date[:10]
		}
		counts[c.ZoneID+"|"+date]++
		if first == "" || date < first {
			first = date
		}
		if last == "" || date > last {
			last = date
		}
	}
	return counts, first, last
}

// historyDateFor mirrors historyDateFor.
func historyDateFor(date, first, last string) (string, bool) {
	if first == "" || last == "" {
		return "", false
	}
	want := weekdayOfDate(date)
	for offset := 0; offset < 7; offset++ {
		candidate := shiftDateBy(first, offset)
		if candidate > last {
			break
		}
		if weekdayOfDate(candidate) == want {
			return candidate, true
		}
	}
	return "", false
}

// DayFactorOf mirrors dayFactorOf.
func DayFactorOf(rc reqctx.RequestContext) func(zoneID, date, referenceDate string) float64 {
	counts, first, last := caseDayCounts()
	return func(zoneID, date, referenceDate string) float64 {
		if !reqctx.CanReadZone(rc, &zoneID) {
			return 1
		}
		a, aok := historyDateFor(date, first, last)
		b, bok := historyDateFor(referenceDate, first, last)
		if !aok || !bok {
			return 1
		}
		base := counts[zoneID+"|"+b]
		if base == 0 {
			return 1
		}
		return float64(counts[zoneID+"|"+a]) / float64(base)
	}
}

// dayFactorSingle: dayFactor, one zone/date pair.
func dayFactorSingle(rc reqctx.RequestContext, zoneID, date, referenceDate string) float64 {
	zid := zoneID
	if !reqctx.CanReadZone(rc, &zid) {
		return 1
	}
	counts, first, last := caseDayCounts()
	a, aok := historyDateFor(date, first, last)
	b, bok := historyDateFor(referenceDate, first, last)
	if !aok || !bok {
		return 1
	}
	base := counts[zoneID+"|"+b]
	if base == 0 {
		return 1
	}
	return float64(counts[zoneID+"|"+a]) / float64(base)
}

// -------------------------------------------------
// Runs and stored values (used by zoneDemand).
// -------------------------------------------------

// Intervals: 15-minute slots per day.
const Intervals = 96

// DemandInterval mirrors DemandInterval.
type DemandInterval struct {
	IntervalIndex          int
	IntervalStart          string
	Low                    float64
	Expected               float64
	High                   float64
	FieldExpected          float64
	RemoteInferredExpected float64
}

func round3(x float64) float64 {
	return math.Round(x*1000) / 1000
}

// intervalStartOf: the local start of a 15-min slot.
func intervalStartOf(date string, index int) string {
	hh := index / 4
	mm := (index % 4) * 15
	return fmt.Sprintf("%sT%02d:%02d:00+03:00", date, hh, mm)
}

// ForecastValue mirrors the contract type.
type ForecastValue struct {
	datactx.BaseRecord
	ForecastRunID          string  `json:"forecast_run_id"`
	ZoneID                 string  `json:"zone_id"`
	SubZoneID              string  `json:"sub_zone_id"`
	IntervalStart          string  `json:"interval_start"`
	IntervalIndex          int     `json:"interval_index"`
	Low                    float64 `json:"low"`
	Expected               float64 `json:"expected"`
	High                   float64 `json:"high"`
	FieldExpected          float64 `json:"field_expected"`
	RemoteInferredExpected float64 `json:"remote_inferred_expected"`
}

var (
	forecastValueMu     sync.Mutex
	forecastValueStore  []ForecastValue
	forecastValueSeeded bool
)

// ResetForecastValuesForTest empties the value store.
func ResetForecastValuesForTest() {
	forecastValueMu.Lock()
	forecastValueStore, forecastValueSeeded = nil, true
	forecastValueMu.Unlock()
	setFixtureRunsOn(false)
}

// SeedForecastValuesForTest sets the value store.
func SeedForecastValuesForTest(rows []ForecastValue) {
	forecastValueMu.Lock()
	forecastValueStore, forecastValueSeeded = append([]ForecastValue(nil), rows...), true
	forecastValueMu.Unlock()
}

// ReloadForecastValuesForTest restores the fixtures.
func ReloadForecastValuesForTest() {
	forecastValueMu.Lock()
	forecastValueStore, forecastValueSeeded = nil, false
	forecastValueMu.Unlock()
}

// Lazy, from the fixtures, once (like TS's readAll).
func allForecastValueRows() []ForecastValue {
	forecastValueMu.Lock()
	defer forecastValueMu.Unlock()
	if !forecastValueSeeded {
		forecastValueSeeded = true
		if rows, err := fixtures.Records[ForecastValue]("ForecastValue"); err == nil {
			forecastValueStore = rows
		}
	}
	return append([]ForecastValue(nil), forecastValueStore...)
}

// Fixture runs are read-only here: rosters.go leaves
// its store unseeded (the roster FK), so the Explorer
// reads the fixture run through this overlay.
var (
	fixtureRunMu  sync.Mutex
	fixtureRunOff bool
)

func setFixtureRunsOn(on bool) {
	fixtureRunMu.Lock()
	fixtureRunOff = !on
	fixtureRunMu.Unlock()
}

// ReloadForecastFixturesForTest: every fixture back.
func ReloadForecastFixturesForTest() {
	setFixtureRunsOn(true)
	ReloadForecastValuesForTest()
	ReloadModelVersionsForTest()
	ReloadForecastSubZonesForTest()
}

func forecastRunRows() []ForecastRun {
	rows := allForecastRunRows()
	fixtureRunMu.Lock()
	off := fixtureRunOff
	fixtureRunMu.Unlock()
	if off {
		return rows
	}
	seen := map[string]bool{}
	for _, r := range rows {
		seen[r.ID] = true
	}
	if extra, err := fixtures.Records[ForecastRun]("ForecastRun"); err == nil {
		for _, r := range extra {
			if !seen[r.ID] {
				rows = append(rows, r)
			}
		}
	}
	return rows
}

// StoredIndex reads stored values per run, zone and day.
type StoredIndex struct {
	ctx    context.Context // request scoped, may be a unit
	reader valueReader
	cache  map[string][]ForecastValue
	dated  map[string][]string
}

func indexStored(ctx context.Context, tenant string) (*StoredIndex, error) {
	reader, err := forecastValueBackendInUse.open(tenant)
	if err != nil {
		return nil, err
	}
	return &StoredIndex{ctx: ctx, reader: reader, cache: map[string][]ForecastValue{}}, nil
}

// Rows: the stored values of one run, zone and day.
func (x *StoredIndex) Rows(runID, zoneID, date string) ([]ForecastValue, error) {
	key := runID + "|" + zoneID + "|" + date
	if rows, ok := x.cache[key]; ok {
		return rows, nil
	}
	rows, err := x.reader.rows(x.ctx, runID, zoneID, date)
	if err != nil {
		return nil, err
	}
	x.cache[key] = rows
	return rows, nil
}

func (x *StoredIndex) datesByRun() (map[string][]string, error) {
	if x.dated == nil {
		d, err := x.reader.dates(x.ctx)
		if err != nil {
			return nil, err
		}
		x.dated = d
	}
	return x.dated, nil
}

type forecastReference struct {
	RunID string
	Date  string
}

// referenceOf: newest valued run made before self.
func referenceOf(ctx context.Context, tenant string, index *StoredIndex, self *ForecastRun) (forecastReference, bool, error) {
	runs, err := loadForecastRuns(ctx, tenant, true)
	if err != nil {
		return forecastReference{}, false, err
	}
	byRun, err := index.datesByRun()
	if err != nil {
		return forecastReference{}, false, err
	}
	var newest *forecastReference
	for _, run := range runs {
		dates := byRun[run.ID]
		if len(dates) == 0 {
			continue
		}
		ref := forecastReference{RunID: run.ID, Date: dates[0]}
		if self == nil || run.ID == self.ID || isoAfter(self.CreatedAt, run.CreatedAt) {
			return ref, true, nil
		}
		if newest == nil {
			newest = &ref
		}
	}
	if newest != nil {
		return *newest, true, nil
	}
	return forecastReference{}, false, nil
}

// requireRun: "" is the latest succeeded run.
func requireRun(ctx context.Context, tenant, runID string) (ForecastRun, error) {
	if runID == "" {
		row, err := loadLatestForecastRun(ctx, tenant, true)
		if err != nil {
			return ForecastRun{}, err
		}
		if row == nil {
			return ForecastRun{}, dataerr.NotFound("A succeeded forecast run not found.")
		}
		return *row, nil
	}
	if _, err := importutil.RequireID(runID, "Forecast run"); err != nil {
		return ForecastRun{}, err
	}
	row, err := loadForecastRun(ctx, tenant, runID, true)
	if err != nil {
		return ForecastRun{}, err
	}
	if row == nil {
		return ForecastRun{}, dataerr.NotFound("Forecast run not found.")
	}
	return *row, nil
}

type rawRow struct {
	Row    ForecastValue
	Factor float64
}

// rawRows: stored rows, or the reference day scaled.
func rawRows(ctx context.Context, rc reqctx.RequestContext, index *StoredIndex, run ForecastRun, zoneID, date string) ([]rawRow, error) {
	stored, err := index.Rows(run.ID, zoneID, date)
	if err != nil {
		return nil, err
	}
	if len(stored) > 0 {
		out := make([]rawRow, len(stored))
		for i, row := range stored {
			out[i] = rawRow{Row: row, Factor: 1}
		}
		return out, nil
	}
	reference, ok, err := referenceOf(ctx, rc.CustomerID, index, &run)
	if err != nil || !ok {
		return nil, err
	}
	base, err := index.Rows(reference.RunID, zoneID, reference.Date)
	if err != nil {
		return nil, err
	}
	factor := dayFactorSingle(rc, zoneID, date, reference.Date)
	out := make([]rawRow, len(base))
	for i, row := range base {
		out[i] = rawRow{Row: row, Factor: factor}
	}
	return out, nil
}

// EngineValue: one ForecasterEngineOutput value.
type EngineValue struct {
	ZoneID                 string  `json:"zone_id"`
	SubZoneID              string  `json:"sub_zone_id"`
	IntervalStart          string  `json:"interval_start"`
	IntervalIndex          int     `json:"interval_index"`
	Low                    float64 `json:"low"`
	Expected               float64 `json:"expected"`
	High                   float64 `json:"high"`
	FieldExpected          float64 `json:"field_expected"`
	RemoteInferredExpected float64 `json:"remote_inferred_expected"`
}

// ForecasterEngineOutput: the engine contract.
type ForecasterEngineOutput struct {
	SchemaVersion string `json:"schema_version"`
	Engine        struct {
		Name    string `json:"name"`
		Version string `json:"version"`
	} `json:"engine"`
	ModelVersion   string `json:"model_version"`
	GeneratedAt    string `json:"generated_at"`
	DataSource     string `json:"data_source"`
	Illustrative   bool   `json:"illustrative"`
	RuleSetVersion string `json:"rule_set_version"`
	Horizon        struct {
		StartDate string `json:"start_date"`
		Days      int    `json:"days"`
	} `json:"horizon"`
	IntervalMinutes int             `json:"interval_minutes"`
	IntervalsPerDay int             `json:"intervals_per_day"`
	RangeCoverage   float64         `json:"range_coverage"`
	Values          []EngineValue   `json:"values"`
	Warnings        []EngineWarning `json:"warnings,omitempty"`
	ModelInfo       json.RawMessage `json:"model_info,omitempty"`
	// Optional; kept apart (forecast_locations.go).
	LocationDistributions []EngineLocationDistribution `json:"location_distributions,omitempty"`
	// Optional; read by forecast_explanation.go.
	Explanations []EngineExplanation `json:"explanations,omitempty"`
	// SnapshotID: ours, never the engine's.
	SnapshotID string `json:"-"`
}

// EngineWarning: one note from the engine.
type EngineWarning struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

// readForecasterOutput: the forecaster's output.
func readForecasterOutput(ctx context.Context, tenant string) (*ForecasterEngineOutput, error) {
	var doc ForecasterEngineOutput
	found, err := readForecasterDocument(ctx, tenant, &doc)
	if err != nil || !found {
		return nil, err
	}
	return &doc, nil
}

// isOutputOf: true when doc is the output of run.
func isOutputOf(doc *ForecasterEngineOutput, run ForecastRun) bool {
	engineVersion := ""
	if run.EngineVersion != nil {
		engineVersion = *run.EngineVersion
	}
	finishedAt := ""
	if run.FinishedAt != nil {
		finishedAt = *run.FinishedAt
	}
	return doc.ModelVersion == run.ModelVersion && doc.Engine.Version == engineVersion && doc.GeneratedAt == finishedAt
}

// engineIndex: engine values by zone and date.
func engineIndex(doc *ForecasterEngineOutput) map[string][]EngineValue {
	out := map[string][]EngineValue{}
	for _, v := range doc.Values {
		date := v.IntervalStart
		if len(date) >= 10 {
			date = date[:10]
		}
		key := v.ZoneID + "|" + date
		out[key] = append(out[key], v)
	}
	return out
}

// engineRowsFor: the output's values for a zone/day,
// when the output is run's own and covers it.
func engineRowsFor(ctx context.Context, tenant string, run ForecastRun, zoneID, date string) ([]EngineValue, error) {
	out, err := cachedForecasterOutput(ctx, tenant)
	if err != nil || out.doc == nil || !answerOf(out.doc, run) {
		return nil, err
	}
	return out.index[zoneID+"|"+date], nil
}

// zoneDemand: the run's stored split, or preview.
func zoneDemand(ctx context.Context, rc reqctx.RequestContext, zoneID, date string, preview map[string]float64, runID string) ([]DemandInterval, error) {
	zid := zoneID
	if !reqctx.CanReadZone(rc, &zid) {
		return nil, nil
	}
	run, err := requireRun(ctx, rc.CustomerID, runID)
	if err != nil {
		return nil, err
	}
	type sum struct{ low, expected, high, field, remote float64 }
	sums := map[int]*sum{}
	addRow := func(interval int, low, expected, high, field, remote, factor float64) {
		s, ok := sums[interval]
		if !ok {
			s = &sum{}
			sums[interval] = s
		}
		s.low += low * factor
		s.expected += expected * factor
		s.high += high * factor
		s.field += field * factor
		s.remote += remote * factor
	}
	fromEngine, err := engineRowsFor(ctx, rc.CustomerID, run, zoneID, date)
	if err != nil {
		return nil, err
	}
	if fromEngine != nil {
		for _, row := range fromEngine {
			addRow(row.IntervalIndex, row.Low, row.Expected, row.High, row.FieldExpected, row.RemoteInferredExpected, 1)
		}
	} else {
		index, err := indexStored(ctx, rc.CustomerID)
		if err != nil {
			return nil, err
		}
		raw, err := rawRows(ctx, rc, index, run, zoneID, date)
		if err != nil {
			return nil, err
		}
		for _, r := range raw {
			addRow(r.Row.IntervalIndex, r.Row.Low, r.Row.Expected, r.Row.High, r.Row.FieldExpected, r.Row.RemoteInferredExpected, r.Factor)
		}
	}
	out := make([]DemandInterval, Intervals)
	for i := 0; i < Intervals; i++ {
		s := sums[i]
		if s == nil {
			s = &sum{}
		}
		expected := round3(s.expected)
		field, remote := round3(s.field), round3(s.remote)
		if preview != nil {
			f, r := shiftSplit(expected, field, remote, preview[zoneID])
			field, remote = round3(f), round3(r)
		}
		out[i] = DemandInterval{
			IntervalIndex: i, IntervalStart: intervalStartOf(date, i),
			Low: round3(s.low), Expected: expected, High: round3(s.high),
			FieldExpected: field, RemoteInferredExpected: remote,
		}
	}
	return out, nil
}

// runFieldShare: field share of the run's stored split.
func runFieldShare(ctx context.Context, rc reqctx.RequestContext, zoneID, date string) (float64, error) {
	demand, err := zoneDemand(ctx, rc, zoneID, date, nil, "")
	if err != nil {
		return 0, err
	}
	var field, remote float64
	for _, d := range demand {
		field += d.FieldExpected
		remote += d.RemoteInferredExpected
	}
	if field+remote <= 0 {
		return 0, nil
	}
	return field / (field + remote), nil
}
