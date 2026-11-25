// SPDX-License-Identifier: AGPL-3.0-only

// Retrain on demand or degradation.
package business

import (
	"context"
	"errors"
	"fmt"
	"log"
	"sync"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/access"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/auditlog"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/dataerr"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/engines"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/reqctx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
)

// KeyAutoRetrain: degradation also retrains.
const KeyAutoRetrain = "forecast.auto_retrain"

const defaultAutoRetrain = true

// autoRetrain reads the setting (default on).
func autoRetrain(ctx context.Context, tenant string) bool {
	return readSetting(ctx, tenant, KeyAutoRetrain, defaultAutoRetrain)
}

// retrainWG: tests wait for background retrains.
var retrainWG sync.WaitGroup

var retraining = struct {
	sync.Mutex
	m map[string]bool
}{m: map[string]bool{}}

// claimRetrain: one retrain per customer at a time.
func claimRetrain(tenant string) bool {
	retraining.Lock()
	defer retraining.Unlock()
	if retraining.m[tenant] {
		return false
	}
	retraining.m[tenant] = true
	return true
}

func releaseRetrain(tenant string) {
	retraining.Lock()
	delete(retraining.m, tenant)
	retraining.Unlock()
}

// newRetrain: the experiment before it runs.
func newRetrain(ctx context.Context, rc reqctx.RequestContext, trigger string, deg *DegradationResult) ForecastExperiment {
	tenant := rc.CustomerID
	e := newExperiment(rc, ExperimentRetrain, trigger, championModel(ctx, tenant))
	if ch := challengerModel(ctx, tenant); ch != "" {
		e.ChallengerModel = &ch
	}
	days := forecastHorizonDays(ctx, tenant)
	e.Params = ExperimentParams{HorizonDays: &days}
	if deg != nil {
		n, limit, worst := len(deg.Alerted), deg.Limit, 0.0
		for _, z := range deg.Alerted {
			worst = max(worst, z.WAPE)
		}
		e.Params.DegradedZones, e.Params.DegradationWAPE = &n, &limit
		e.Metrics.WorstZoneWAPE = &worst
		e.Illustrative, e.DataSource = deg.Illustrative, deg.DataSource
	}
	return e
}

// runRetrain refits today's champion, scores it.
func runRetrain(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, e ForecastExperiment) (ForecastExperiment, error) {
	tenant := rc.CustomerID
	days := forecastHorizonDays(ctx, tenant)
	run, err := CreateForecastRun(ctx, conn, rc, map[string]any{"horizon_start_date": todayIn(ctx, tenant), "horizon_days": float64(days)})
	if err == nil {
		e.ForecastRunID, e.DatasetSnapshotID = &run.ID, run.DatasetSnapshotID
		e.Illustrative, e.DataSource = run.Illustrative, run.DataSource
		if run.Status != "succeeded" {
			err = fmt.Errorf("%w: the retrained forecast run failed", ErrEngineAnswer)
		}
	}
	finishExperiment(&e, err)
	saveExperiment(ctx, tenant, e)
	scored := false
	if err == nil && engineMode() == engines.ModeEngine {
		if _, berr := startBacktest(ctx, conn, rc, BacktestOptions{Trigger: e.Trigger}); berr != nil {
			log.Printf("forecast: retrain backtest not started: %v", berr)
		} else {
			scored = true
		}
	}
	outcome, summary := "success", fmt.Sprintf("Forecast retrained (%s, model %s, %d day(s)).", e.Trigger, e.ModelVersion, days)
	if err != nil {
		outcome, summary = "failure", fmt.Sprintf("Forecast retraining failed (%s, %s).", e.Trigger, *e.ErrorClass)
	}
	detail := map[string]any{"experiment_id": e.ID, "trigger": e.Trigger, "model_version": e.ModelVersion, "horizon_days": days, "backtest_started": scored}
	if e.ForecastRunID != nil {
		detail["forecast_run_id"] = *e.ForecastRunID
	}
	if e.DatasetSnapshotID != nil {
		detail["dataset_snapshot_id"] = *e.DatasetSnapshotID
	}
	if e.Params.DegradedZones != nil {
		detail["degraded_zones"] = *e.Params.DegradedZones
	}
	challengerAudit(rc, "forecast.retrain_triggered", outcome, summary, detail)
	return e, err
}

// retrainAfterDegradation: the worker path.
func retrainAfterDegradation(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, res *DegradationResult) bool {
	if res == nil || len(res.Alerted) == 0 || !autoRetrain(ctx, rc.CustomerID) {
		return false
	}
	if getModelStoredState(ctx, rc.CustomerID).IsPaused || !claimRetrain(rc.CustomerID) {
		return false
	}
	defer releaseRetrain(rc.CustomerID)
	e, err := runRetrain(ctx, conn, rc, newRetrain(ctx, rc, TriggerDegradation, res))
	if err != nil {
		log.Printf("forecast: automatic retrain failed: %v", err)
	}
	return e.Status == "succeeded"
}

// RetrainForecastModel: "Retrain now", async.
func RetrainForecastModel(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext) (ForecastExperiment, error) {
	meta := auditlog.WriteMeta{Action: "forecast.retrain_triggered", EntityType: "model"}
	if err := auditlog.GuardWithAudit(rc, auditlog.Guard{ModuleID: access.ModuleAdminForecastModel}, meta); err != nil {
		return ForecastExperiment{}, err
	}
	tenant := rc.CustomerID
	if getModelStoredState(ctx, tenant).IsPaused {
		return ForecastExperiment{}, dataerr.Conflict("The forecast is paused. Resume it before retraining.")
	}
	if !claimRetrain(tenant) {
		return ForecastExperiment{}, dataerr.Conflict("A retrain is already running.")
	}
	e := newRetrain(ctx, rc, TriggerManual, nil)
	saveExperiment(ctx, tenant, e)
	bg, cancel := context.WithTimeout(context.WithoutCancel(tenancy.Detach(ctx)), backtestTimeout)
	retrainWG.Add(1)
	go func() {
		defer retrainWG.Done()
		defer cancel()
		defer releaseRetrain(tenant)
		if _, err := runRetrain(bg, conn, rc, e); err != nil && !errors.Is(err, context.Canceled) {
			log.Printf("forecast: retrain failed: %v", err)
		}
	}()
	return e, nil
}
