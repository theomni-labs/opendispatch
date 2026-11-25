// SPDX-License-Identifier: AGPL-3.0-only

package business

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/access"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/auditlog"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/dataerr"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/engines"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/forecastcal"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/reqctx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
)

// ErrEngineAnswer: the engine answered, but not usefully.
var ErrEngineAnswer = errors.New("engine answer is not usable")

// engineErrorClass names a failure without any body.
func engineErrorClass(err error) string {
	switch {
	case errors.Is(err, engines.ErrTimeout):
		return "timeout"
	case errors.Is(err, engines.ErrBreakerOpen):
		return "breaker_open"
	case errors.Is(err, engines.ErrStatus):
		return "status"
	case errors.Is(err, engines.ErrTooLarge):
		return "too_large"
	case errors.Is(err, engines.ErrInvalidResponse), errors.Is(err, ErrEngineAnswer):
		return "invalid_response"
	case errors.Is(err, ErrEngineInput):
		return "request_not_built"
	}
	return "unreachable"
}

// auditEngineFailure records the class, never a body.
func auditEngineFailure(rc reqctx.RequestContext, name engines.Name, err error) {
	class := engineErrorClass(err)
	id := string(name)
	_, _ = auditlog.RecordAudit(rc, auditlog.AuditInput{
		Action: "engine.failed", EntityType: "engine", EntityID: &id, ActorType: "system", Outcome: "failure",
		SummaryEn: fmt.Sprintf("The %s engine could not be used (%s).", name, class),
		Detail:    map[string]any{"engine": string(name), "error_class": class},
	}, "", "")
}

// askEngine sends a built request; a failure is audited.
func askEngine(ctx context.Context, rc reqctx.RequestContext, name engines.Name, request []byte, err error) ([]byte, error) {
	if err == nil {
		var body []byte
		if body, err = callEngine(ctx, rc.CustomerID, name, func() ([]byte, error) { return request, nil }); err == nil {
			return body, nil
		}
	}
	auditEngineFailure(rc, name, err)
	return nil, err
}

type answerHeader struct {
	SchemaVersion string `json:"schema_version"`
	Engine        struct {
		Name string `json:"name"`
	} `json:"engine"`
}

func checkAnswerHeader(name engines.Name, body []byte) error {
	var h answerHeader
	if json.Unmarshal(body, &h) != nil || h.SchemaVersion != "1.0" || h.Engine.Name != string(name) {
		return fmt.Errorf("%w: header", ErrEngineAnswer)
	}
	return nil
}

// mergeKept puts next over prev, replacing prev's items with the same key.
func mergeKept(prev, next []byte, field, key string) []byte {
	var p, n map[string]any
	if json.Unmarshal(prev, &p) != nil || json.Unmarshal(next, &n) != nil {
		return next
	}
	if p["roster_date"] != n["roster_date"] {
		return next
	}
	fresh := map[any]bool{}
	nItems, _ := n[field].([]any)
	for _, it := range nItems {
		if m, ok := it.(map[string]any); ok {
			fresh[m[key]] = true
		}
	}
	merged := []any{}
	pItems, _ := p[field].([]any)
	for _, it := range pItems {
		if m, ok := it.(map[string]any); ok && !fresh[m[key]] {
			merged = append(merged, it)
		}
	}
	n[field] = append(merged, nItems...)
	out, err := json.Marshal(n)
	if err != nil {
		return next
	}
	return out
}

// casesUsedKey: capacity each zone was asked.
const casesUsedKey = "opendispatch_cases_per_interval"

// stampCasesUsed notes the zone's capacity sent.
func stampCasesUsed(body []byte, zoneID string, sent *float64) []byte {
	var doc map[string]any
	if json.Unmarshal(body, &doc) != nil {
		return body
	}
	v := 1.0
	if sent != nil {
		v = *sent
	}
	doc[casesUsedKey] = map[string]any{zoneID: v}
	out, err := json.Marshal(doc)
	if err != nil {
		return body
	}
	return out
}

// mergeCasesUsed keeps other zones' capacities.
func mergeCasesUsed(prev, next []byte) []byte {
	var p, n map[string]any
	if json.Unmarshal(prev, &p) != nil || json.Unmarshal(next, &n) != nil || p["roster_date"] != n["roster_date"] {
		return next
	}
	merged := map[string]any{}
	if old, ok := p[casesUsedKey].(map[string]any); ok {
		for k, v := range old {
			merged[k] = v
		}
	}
	if fresh, ok := n[casesUsedKey].(map[string]any); ok {
		for k, v := range fresh {
			merged[k] = v
		}
	}
	n[casesUsedKey] = merged
	out, err := json.Marshal(n)
	if err != nil {
		return next
	}
	return out
}

// ---- forecaster ----

func forecastStaleMessage(err error, date string) string {
	return fmt.Sprintf("Stale: the forecaster could not be used on %s (%s); this is the last good run.", date, engineErrorClass(err))
}

// markForecastStale notes the failure on the last good run.
func markForecastStale(ctx context.Context, rc reqctx.RequestContext, err error, date string) error {
	last, lerr := loadLatestForecastRun(ctx, rc.CustomerID, false)
	if lerr != nil || last == nil {
		return lerr
	}
	msg := forecastStaleMessage(err, date)
	last.ErrorMessage, last.UpdatedAt = &msg, datactx.NowISO()
	return forecastRunBackendInUse.save(ctx, rc.CustomerID, *last)
}

func forecastHorizonOK(doc ForecasterEngineOutput, start string, days int) bool {
	return doc.Horizon.StartDate == start && doc.Horizon.Days == days && len(doc.Values) > 0 && doc.ModelVersion != "" && doc.Engine.Version != "" && forecastValuesOK(doc, start, days)
}

func storeEngineForecastValues(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, run ForecastRun, doc ForecasterEngineOutput, at string) error {
	valueAt := func(i int) ForecastValue {
		v := doc.Values[i]
		rec := datactx.NewRecord(rc, "", at)
		rec.DataSource = doc.DataSource
		return ForecastValue{BaseRecord: rec, ForecastRunID: run.ID, ZoneID: v.ZoneID, SubZoneID: v.SubZoneID, IntervalStart: v.IntervalStart, IntervalIndex: v.IntervalIndex,
			Low: v.Low, Expected: v.Expected, High: v.High, FieldExpected: v.FieldExpected, RemoteInferredExpected: v.RemoteInferredExpected}
	}
	// Postgres: rows built per INSERT
	if forecastInPostgres() {
		return insertForecastValuesOf(ctx, conn, rc.CustomerID, len(doc.Values), valueAt)
	}
	values := make([]ForecastValue, len(doc.Values))
	for i := range doc.Values {
		values[i] = valueAt(i)
	}
	allForecastValueRows()
	forecastValueMu.Lock()
	forecastValueStore = append(forecastValueStore, values...)
	forecastValueMu.Unlock()
	return nil
}

// engineForecastWrite stores the run and values and shapes the audit entry.
func engineForecastWrite(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, doc ForecasterEngineOutput, sources []string, startedAt string) (auditlog.AuditedWrite[ForecastRun], error) {
	return engineForecastWriteAsOf(ctx, conn, rc, doc, sources, startedAt, "")
}

// engineForecastWriteAsOf: asOf, if set, is created_at.
func engineForecastWriteAsOf(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, doc ForecasterEngineOutput, sources []string, startedAt, asOf string) (auditlog.AuditedWrite[ForecastRun], error) {
	at := datactx.NowISO()
	engineVersion, ruleSet := doc.Engine.Version, doc.RuleSetVersion
	run := ForecastRun{
		BaseRecord: datactx.NewRecord(rc, "", at), ModelVersion: doc.ModelVersion, EngineVersion: &engineVersion, Status: "succeeded",
		HorizonStartDate: doc.Horizon.StartDate, HorizonDays: doc.Horizon.Days, RangeCoverage: doc.RangeCoverage, Illustrative: doc.Illustrative,
		InputDataSources: sources, StartedAt: &startedAt, FinishedAt: &at, DatasetSnapshotID: optStr(doc.SnapshotID),
	}
	if asOf != "" {
		run.CreatedAt = asOf
	}
	run.DataSource = doc.DataSource
	if ruleSet != "" {
		run.RuleSetVersion = &ruleSet
	}
	if !forecastInPostgres() {
		if err := upsertForecastRunLive(ctx, conn, rc.CustomerID, run); err != nil {
			return auditlog.AuditedWrite[ForecastRun]{}, err
		}
	}
	if err := forecastRunBackendInUse.save(ctx, rc.CustomerID, run); err != nil {
		return auditlog.AuditedWrite[ForecastRun]{}, err
	}
	if err := storeEngineForecastValues(ctx, conn, rc, run, doc, at); err != nil {
		run.Status, run.UpdatedAt = "failed", datactx.NowISO()
		msg := "The forecaster's values could not be stored."
		run.ErrorMessage = &msg
		_ = forecastRunBackendInUse.save(tenancy.Detach(ctx), rc.CustomerID, run) // kept on failure
		return auditlog.AuditedWrite[ForecastRun]{}, fmt.Errorf("%w: store values", ErrEngineAnswer)
	}
	keepForecastLocations(ctx, rc, run.ID, doc)
	runID := run.ID
	calendar := forecastcal.SourceSettings
	return auditlog.AuditedWrite[ForecastRun]{
		Result: run, EntityID: &runID,
		SummaryEn: fmt.Sprintf("Forecast run for %d day(s) from %s finished (engine %s, model %s, calendar %s).", run.HorizonDays, run.HorizonStartDate, engineVersion, run.ModelVersion, calendar),
		Detail: map[string]any{"horizon_start_date": run.HorizonStartDate, "horizon_days": run.HorizonDays, "model_version": run.ModelVersion, "engine_version": engineVersion,
			"calendar": calendar, "dataset_snapshot_id": doc.SnapshotID},
	}, nil
}

// storeEngineForecastRun keeps the engine's own versions and flags.
func storeEngineForecastRun(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, doc ForecasterEngineOutput, sources []string, startedAt string) (ForecastRun, error) {
	return storeEngineForecastRunAsOf(ctx, conn, rc, doc, sources, startedAt, "")
}

// storeEngineForecastRunAsOf: a past day's run.
func storeEngineForecastRunAsOf(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, doc ForecasterEngineOutput, sources []string, startedAt, asOf string) (ForecastRun, error) {
	return auditlog.WriteWithAudit(ctx, rc, auditlog.Guard{ModuleID: access.ModuleAdminForecastModel}, auditlog.WriteMeta{Action: "forecast.run_created", EntityType: "forecast_run"}, func(ctx context.Context) (auditlog.AuditedWrite[ForecastRun], error) {
		return engineForecastWriteAsOf(ctx, conn, rc, doc, sources, startedAt, asOf)
	})
}

// ErrNothingToSend: no case history yet.
var ErrNothingToSend = fmt.Errorf("%w: nothing to send yet", ErrEngineInput)

// forecasterHasInput: a live sub-zone has cases.
func forecasterHasInput(s forecasterSource) bool {
	active := map[string]bool{}
	for _, z := range s.Zones {
		active[z.ID] = z.IsActive
	}
	subs := map[string]bool{}
	for _, sz := range s.SubZones {
		subs[sz.ID] = sz.IsActive && active[sz.ZoneID]
	}
	for _, r := range s.History {
		if subs[r.SubZoneID] {
			return true
		}
	}
	for _, r := range s.Aggregated {
		if subs[r.SubZoneID] {
			return true
		}
	}
	return false
}

// askForecaster asks chunk by chunk and merges the answers.
func askForecaster(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, start string, days int) (ForecasterEngineOutput, []string, error) {
	return askForecasterWith(ctx, conn, rc, start, days, false)
}

// quiet: ErrNothingToSend, never audited.
func askForecasterWith(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, start string, days int, quiet bool) (ForecasterEngineOutput, []string, error) {
	var doc ForecasterEngineOutput
	src, err := loadForecasterSource(ctx, conn, rc, start, days)
	if err != nil && !errors.Is(err, ErrEngineInput) {
		return doc, nil, fmt.Errorf("read forecast inputs: %w", err)
	}
	if quiet && err == nil && !forecasterHasInput(src) {
		return doc, nil, ErrNothingToSend
	}
	if err != nil {
		_, err = askEngine(ctx, rc, engines.Forecaster, nil, err)
		return doc, nil, err
	}
	if doc, err = askForecasterChunks(ctx, rc, src, forecastChunkDays(ctx, rc.CustomerID)); err != nil {
		return ForecasterEngineOutput{}, nil, err
	}
	doc.SnapshotID = datasetSnapshotID(src)
	if err := applyRulesToForecast(ctx, rc.CustomerID, &doc); err != nil {
		return ForecasterEngineOutput{}, nil, fmt.Errorf("apply rules: %w", err)
	}
	// on failure the engine's forecast stays as it came
	if err := blendWithSegment(ctx, conn, rc.CustomerID, &doc); err != nil {
		log.Printf("forecast: segment shape not applied: %v", err)
		doc.Warnings = append(doc.Warnings, EngineWarning{Code: "SEGMENT_SHAPE_SKIPPED", Message: "Customer's segment shape could not be read; the engine's forecast is kept as it came."})
	}
	_, sources, _ := sourcesOf(src.Sources)
	illustrative, dataSource := inputProvenance(sources)
	warnProvenance(engines.Forecaster, doc.Illustrative, doc.DataSource, illustrative, dataSource)
	doc.Illustrative, doc.DataSource = illustrative, dataSource
	return doc, sources, nil
}

// keepValuesMaxDays: longer runs keep no values.
const keepValuesMaxDays = 14

// keptForecast: what the readers need of an answer.
func keptForecast(doc ForecasterEngineOutput) ([]byte, error) {
	doc.LocationDistributions = nil
	// screens read stored values when none are kept
	if doc.Horizon.Days > keepValuesMaxDays {
		doc.Values = nil
	}
	return json.Marshal(doc)
}

// keepForecast keeps the answer for the readers of other processes.
func keepForecast(ctx context.Context, tenant string, doc ForecasterEngineOutput) error {
	kept, err := keptForecast(doc)
	if err != nil {
		return err
	}
	return keepAnswer(ctx, tenant, engines.Forecaster, doc.Horizon.StartDate, kept, nil)
}

// runEngineForecast asks the forecaster; on failure the last good run stays, marked stale.
func runEngineForecast(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, today string, report *WorkerCycleReport) error {
	if getModelStoredState(ctx, rc.CustomerID).IsPaused {
		return fmt.Errorf("worker: create forecast run: %w", dataerr.Conflict("The forecast is paused. Resume it before running the forecast."))
	}
	startedAt := datactx.NowISO()
	doc, sources, err := askForecasterWith(ctx, conn, rc, today, forecastHorizonDays(ctx, rc.CustomerID), true)
	if errors.Is(err, ErrNothingToSend) {
		log.Print("worker: no active sub-zone with case history yet; forecaster not asked")
		report.ForecastNoInput = true
		return nil
	}
	var run ForecastRun
	if err == nil {
		if run, err = storeEngineForecastRun(ctx, conn, rc, doc, sources, startedAt); err != nil {
			auditEngineFailure(rc, engines.Forecaster, err)
		}
	}
	if err != nil {
		report.ForecastStale = true
		return markForecastStale(ctx, rc, err, today)
	}
	if err := keepForecast(ctx, rc.CustomerID, doc); err != nil {
		return err
	}
	report.ForecastCreated = true
	report.ChallengerCreated = afterChampionRun(ctx, conn, rc, run)
	return nil
}

// createEngineForecastRun serves POST /forecasts/runs in engine mode.
func createEngineForecastRun(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, date string, days int) (auditlog.AuditedWrite[ForecastRun], error) {
	startedAt := datactx.NowISO()
	doc, sources, err := askForecaster(ctx, conn, rc, date, days)
	if err == nil {
		var out auditlog.AuditedWrite[ForecastRun]
		if out, err = engineForecastWrite(ctx, conn, rc, doc, sources, startedAt); err == nil {
			if err = keepForecast(ctx, rc.CustomerID, doc); err == nil {
				afterChampionRun(ctx, conn, rc, out.Result)
				return out, nil
			}
		}
		auditEngineFailure(rc, engines.Forecaster, err)
	}
	if serr := markForecastStale(ctx, rc, err, date); serr != nil {
		return auditlog.AuditedWrite[ForecastRun]{}, serr
	}
	return failedForecastRun(ctx, conn, rc, date, days, err)
}

// failedForecastRun records that the forecaster could not be used.
func failedForecastRun(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, date string, days int, cause error) (auditlog.AuditedWrite[ForecastRun], error) {
	active, err := activeModelVersion(ctx, rc.CustomerID)
	if err != nil {
		return auditlog.AuditedWrite[ForecastRun]{}, err
	}
	modelVersion := "none"
	if active != nil {
		modelVersion = active.Version
	}
	at := datactx.NowISO()
	msg := fmt.Sprintf("The forecaster could not be used (%s).", engineErrorClass(cause))
	run := ForecastRun{
		BaseRecord: datactx.NewRecord(rc, "", at), ModelVersion: modelVersion, Status: "failed", HorizonStartDate: date, HorizonDays: days,
		RangeCoverage: engineRangeCover, Illustrative: true, InputDataSources: []string{"SYNTHETIC"}, StartedAt: &at, FinishedAt: &at, ErrorMessage: &msg,
	}
	if !forecastInPostgres() {
		if err := upsertForecastRunLive(ctx, conn, rc.CustomerID, run); err != nil {
			return auditlog.AuditedWrite[ForecastRun]{}, err
		}
	}
	if err := forecastRunBackendInUse.save(ctx, rc.CustomerID, run); err != nil {
		return auditlog.AuditedWrite[ForecastRun]{}, err
	}
	runID := run.ID
	return auditlog.AuditedWrite[ForecastRun]{
		Result: run, EntityID: &runID,
		SummaryEn: fmt.Sprintf("Forecast run for %d day(s) from %s failed (%s).", days, date, engineErrorClass(cause)),
		Detail:    map[string]any{"horizon_start_date": date, "horizon_days": days, "error_class": engineErrorClass(cause)},
	}, nil
}

// ---- optimizer ----

// askOptimizer asks for one zone and day; the answer becomes the plan's baseline.
func askOptimizer(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, plan *PlanReader, zoneID, date string, locked []RosterAssignment) (*optimizerOutputDoc, error) {
	doc, err := askOptimizerOnce(ctx, conn, rc, plan, zoneID, date, locked)
	if err != nil {
		log.Printf("engines: optimizer gave no answer for zone %s on %s (%s): %v", zoneID, date, engineErrorClass(err), err)
	}
	return doc, err
}

func askOptimizerOnce(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, plan *PlanReader, zoneID, date string, locked []RosterAssignment) (*optimizerOutputDoc, error) {
	run, err := loadLatestForecastRun(ctx, rc.CustomerID, false)
	if err != nil {
		return nil, err
	}
	var request []byte
	var casesUsed *float64
	if run == nil {
		err = inputErr("no forecast run")
	} else {
		var src optimizerSource
		if src, err = loadOptimizerSource(ctx, conn, rc, plan, zoneID, date, *run); err != nil && !errors.Is(err, ErrEngineInput) {
			return nil, err
		}
		src.Fixed = locked
		casesUsed = src.CasesPerInterval
		if err == nil {
			request, err = buildOptimizerRequest(src)
		}
	}
	body, err := askEngine(ctx, rc, engines.Optimizer, request, err)
	var doc optimizerOutputDoc
	if err == nil {
		if err = checkAnswerHeader(engines.Optimizer, body); err == nil && (json.Unmarshal(body, &doc) != nil || doc.RosterDate != date) {
			err = fmt.Errorf("%w: roster date", ErrEngineAnswer)
		}
		if err != nil {
			auditEngineFailure(rc, engines.Optimizer, err)
		}
	}
	if err != nil {
		return nil, err
	}
	merge := func(prev, next []byte) []byte {
		for _, f := range []string{"gap_cells", "roster_assignments", "vehicle_assignments"} {
			next = mergeKept(prev, next, f, "zone_id")
		}
		return mergeCasesUsed(prev, next)
	}
	return &doc, keepAnswer(ctx, rc.CustomerID, engines.Optimizer, date, stampCasesUsed(body, zoneID, casesUsed), merge)
}

// ---- simulator ----

// askSimulator asks about one roster and one day of cases; the answer is kept.
func askSimulator(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, plan *PlanReader, roster *Roster, caseDate, policy string) ([]byte, int, error) {
	var request []byte
	src, err := loadSimulatorSourceFor(ctx, conn, rc, plan, roster, caseDate, policy)
	if err != nil && !errors.Is(err, ErrEngineInput) {
		return nil, 0, err
	}
	if err == nil {
		request, err = buildSimulatorRequest(src)
	}
	body, err := askEngine(ctx, rc, engines.Simulator, request, err)
	if err == nil {
		if err = checkAnswerHeader(engines.Simulator, body); err != nil {
			auditEngineFailure(rc, engines.Simulator, err)
		}
	}
	if err != nil {
		return nil, 0, err
	}
	body = stampProvenance(engines.Simulator, body, src.Sources)
	merge := func(prev, next []byte) []byte { return mergeKept(prev, next, "zones", "zone_id") }
	if err := keepAnswer(ctx, rc.CustomerID, engines.Simulator, caseDate, body, merge); err != nil {
		return nil, 0, err
	}
	return body, src.Dropped, nil
}

// RunSimulatorForRoster asks the simulator about one zone's day.
func RunSimulatorForRoster(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, zoneID, date, policy string) error {
	plan, err := loadPlan(ctx, conn, rc)
	if err != nil {
		return err
	}
	roster := rosterFor(plan, zoneID, date)
	if roster == nil {
		err = inputErr("no roster for the zone and day")
		auditEngineFailure(rc, engines.Simulator, err)
		return err
	}
	_, _, err = askSimulator(ctx, conn, rc, plan, roster, date, policy)
	return err
}
