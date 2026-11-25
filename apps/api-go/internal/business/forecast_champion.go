// SPDX-License-Identifier: AGPL-3.0-only

package business

import (
	"context"
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/auditlog"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/forecastcal"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/reqctx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
)

// Champion and challenger settings.
const (
	KeyChampionModel     = "forecast.champion_model"
	KeyChallengerModel   = "forecast.challenger_model"
	DefaultChampionModel = "ensemble-4"
	// spec names LightGBM;, 3 Oct
	DefaultChallengerModel = "lightgbm-1"
)

type forecastModelKey struct{}

// withForecastModel asks for one model version.
func withForecastModel(ctx context.Context, model string) context.Context {
	return context.WithValue(ctx, forecastModelKey{}, model)
}

func modelSetting(ctx context.Context, tenant, key, fallback string) string {
	v := strings.TrimSpace(readSetting(ctx, tenant, key, fallback))
	if len(v) > 64 {
		log.Printf("settings: %s is over 64 characters, ignored", key)
		return fallback
	}
	return v
}

// championModel: the model the plans use.
func championModel(ctx context.Context, tenant string) string {
	if v := modelSetting(ctx, tenant, KeyChampionModel, DefaultChampionModel); v != "" {
		return v
	}
	return DefaultChampionModel
}

// challengerModel: "" when off or the champion.
func challengerModel(ctx context.Context, tenant string) string {
	v := modelSetting(ctx, tenant, KeyChallengerModel, DefaultChallengerModel)
	if v == championModel(ctx, tenant) {
		return ""
	}
	return v
}

// requestedForecastModel: override or champion.
func requestedForecastModel(ctx context.Context, tenant string) string {
	if v, ok := ctx.Value(forecastModelKey{}).(string); ok && v != "" {
		return v
	}
	return championModel(ctx, tenant)
}

// isChallengerRun: made by today's challenger.
func isChallengerRun(ctx context.Context, tenant string, r ForecastRun) bool {
	ch := challengerModel(ctx, tenant)
	return ch != "" && r.ModelVersion == ch
}

// challengerCreatedAt: 1s before the champion.
func challengerCreatedAt(champion string) string {
	t, err := parseTime(champion)
	if err != nil {
		return champion
	}
	return datactx.ToRiyadhISO(t.Add(-time.Second))
}

// runChallengerForecast stores a challenger run.
func runChallengerForecast(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, champion ForecastRun) (*ForecastRun, error) {
	model := challengerModel(ctx, rc.CustomerID)
	if model == "" || champion.Status != "succeeded" {
		return nil, nil
	}
	startedAt := datactx.NowISO()
	doc, sources, err := askForecaster(withForecastModel(ctx, model), conn, rc, champion.HorizonStartDate, champion.HorizonDays)
	if err != nil {
		return nil, err
	}
	if doc.ModelVersion != model {
		challengerAudit(rc, "forecast.challenger_skipped", "failure", fmt.Sprintf("Challenger %s not stored: the engine ran %s.", model, doc.ModelVersion),
			map[string]any{"requested": model, "ran": doc.ModelVersion})
		return nil, fmt.Errorf("%w: challenger %s ran as %s", ErrEngineAnswer, model, doc.ModelVersion)
	}
	at := datactx.NowISO()
	engineVersion := doc.Engine.Version
	run := ForecastRun{
		BaseRecord: datactx.NewRecord(rc, "", challengerCreatedAt(champion.CreatedAt)), ModelVersion: doc.ModelVersion, EngineVersion: &engineVersion, Status: "succeeded",
		HorizonStartDate: doc.Horizon.StartDate, HorizonDays: doc.Horizon.Days, RangeCoverage: doc.RangeCoverage, Illustrative: doc.Illustrative,
		InputDataSources: sources, StartedAt: &startedAt, FinishedAt: &at, DatasetSnapshotID: optStr(doc.SnapshotID),
	}
	run.UpdatedAt, run.DataSource = at, doc.DataSource
	if doc.RuleSetVersion != "" {
		rs := doc.RuleSetVersion
		run.RuleSetVersion = &rs
	}
	if !forecastInPostgres() {
		if err := upsertForecastRunLive(ctx, conn, rc.CustomerID, run); err != nil {
			return nil, err
		}
	}
	if err := forecastRunBackendInUse.save(ctx, rc.CustomerID, run); err != nil {
		return nil, err
	}
	if err := storeEngineForecastValues(ctx, conn, rc, run, doc, at); err != nil {
		run.Status, run.UpdatedAt = "failed", datactx.NowISO()
		msg := "The challenger's values could not be stored."
		run.ErrorMessage = &msg
		_ = forecastRunBackendInUse.save(tenancy.Detach(ctx), rc.CustomerID, run) // kept on failure
		return nil, err
	}
	calendar := forecastcal.SourceSettings
	challengerAudit(rc, "forecast.challenger_run_created", "success",
		fmt.Sprintf("Challenger forecast run for %d day(s) from %s finished (engine %s, model %s, calendar %s).", run.HorizonDays, run.HorizonStartDate, engineVersion, run.ModelVersion, calendar),
		map[string]any{"run_id": run.ID, "champion_run_id": champion.ID, "champion": champion.ModelVersion, "challenger": run.ModelVersion, "engine_version": engineVersion,
			"horizon_start_date": run.HorizonStartDate, "horizon_days": run.HorizonDays, "calendar": calendar, "dataset_snapshot_id": doc.SnapshotID})
	saveExperiment(ctx, rc.CustomerID, challengerExperiment(rc, champion, run, startedAt))
	return &run, nil
}

func challengerAudit(rc reqctx.RequestContext, action, outcome, summary string, detail map[string]any) {
	id := "forecast"
	if _, err := auditlog.RecordAudit(rc, auditlog.AuditInput{Action: action, EntityType: "model", EntityID: &id, ActorType: "system", Outcome: outcome, SummaryEn: summary, Detail: detail}, "", ""); err != nil {
		log.Printf("forecast: audit %s failed: %v", action, err)
	}
}

// afterChampionRun: a failure only logs.
func afterChampionRun(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, champion ForecastRun) bool {
	run, err := runChallengerForecast(ctx, conn, rc, champion)
	if err != nil {
		log.Printf("forecast: challenger run failed (%s): %v", engineErrorClass(err), err)
	}
	return run != nil
}
