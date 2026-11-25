// SPDX-License-Identifier: AGPL-3.0-only

// Worker cycle: SPIKE, scheduler/job-runner only.
// No engine calls, no the customer feeds: neither exists
// yet. Runs existing
// business logic on an interval, against
// Today(): demo.today or the Riyadh clock.
package business

import (
	"context"
	"fmt"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/access"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/dataerr"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/engines"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/reqctx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
)

// WorkerActors: system request contexts, one per
// module the cycle needs edit access to (no single
// role holds every edit right).
type WorkerActors struct {
	// Roster: ops.field_planner edit (Planner or
	// DispatchSupervisor).
	Roster reqctx.RequestContext
	// Forecast: admin.forecast_model edit
	// (Administrator only).
	Forecast reqctx.RequestContext
}

// NewWorkerActors builds both system actors, one
// tenant, whole-install scope, a fixed user id per
// role so audit trails read "the worker".
func NewWorkerActors(tenantID string) WorkerActors {
	whole := access.ZoneScope{Kind: access.ScopeWholeInstall}
	return WorkerActors{
		Roster: reqctx.RequestContext{
			CustomerID: tenantID, UserID: workerSystemUserID("roster"),
			Role: access.RolePlanner, ZoneScope: whole, InstallMode: access.InstallPrivate,
		},
		Forecast: reqctx.RequestContext{
			CustomerID: tenantID, UserID: workerSystemUserID("forecast"),
			Role: access.RoleAdministrator, ZoneScope: whole, InstallMode: access.InstallPrivate,
		},
	}
}

func workerSystemUserID(role string) string {
	return "00000000-0000-4000-9000-" + workerSystemSuffix(role)
}

func workerSystemSuffix(role string) string {
	switch role {
	case "roster":
		return "000000000001"
	case "forecast":
		return "000000000002"
	case "dispatch":
		return "000000000003"
	default:
		return "000000000000"
	}
}

// WorkerCycleReport: what one cycle did.
type WorkerCycleReport struct {
	RostersBuilt    int
	RostersSkipped  int
	RostersFailed   []string
	ForecastCreated bool
	ForecastSkipped bool
	ForecastStale   bool
	// ForecastNoInput: no zone with history yet
	ForecastNoInput bool
	RostersStale    []string
	// ChallengerCreated: a challenger run was stored
	ChallengerCreated bool
	// DegradedZones: zones over the error limit
	DegradedZones []string
	// Retrained: the degradation retrained the model
	Retrained bool
	// AccuracyStored: the rolling window was stored
	AccuracyStored bool
	AccuracyDays   int
}

// RunWorkerCycle: one pass. Builds tomorrow's roster
// per zone (skips past draft/rejected) and creates
// today's forecast run if none has succeeded yet.
// Idempotent: safe to call again same day.
func RunWorkerCycle(ctx context.Context, conn *tenancy.Connection, actors WorkerActors) (WorkerCycleReport, error) {
	var report WorkerCycleReport

	if err := runForecastJob(ctx, conn, actors.Forecast, &report); err != nil {
		return report, err
	}
	checkForecastDegradation(ctx, conn, actors.Forecast, &report)
	if err := runRosterJob(ctx, conn, actors.Roster, &report); err != nil {
		return report, err
	}
	if err := runRollingAccuracyJob(ctx, conn, actors.Forecast, &report); err != nil {
		return report, err
	}
	return report, nil
}

func runForecastJob(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, report *WorkerCycleReport) error {
	today := todayIn(ctx, rc.CustomerID)
	runs, err := loadForecastRuns(ctx, rc.CustomerID, false)
	if err != nil {
		return err
	}
	for _, r := range runs {
		if r.Status == "succeeded" && r.HorizonStartDate == today {
			report.ForecastSkipped = true
			return nil
		}
	}
	if engineMode() == engines.ModeEngine {
		return runEngineForecast(ctx, conn, rc, today, report)
	}
	_, err = CreateForecastRun(ctx, conn, rc, map[string]any{"horizon_start_date": today, "horizon_days": 1.0})
	if err != nil {
		return fmt.Errorf("worker: create forecast run: %w", err)
	}
	report.ForecastCreated = true
	return nil
}

// runRosterJob builds only where none exists yet.
// Never rebuilds an existing one, draft or not:
// BuildRoster replaces every line, and an unattended
// caller must not wipe a planner's edits.
func runRosterJob(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, report *WorkerCycleReport) error {
	// no history: nothing to plan from
	if report.ForecastNoInput {
		return nil
	}
	zones, err := allZones(ctx, conn, rc.CustomerID)
	if err != nil {
		return fmt.Errorf("worker: list zones: %w", err)
	}
	plan, err := loadPlan(ctx, conn, rc)
	if err != nil {
		return fmt.Errorf("worker: load plan: %w", err)
	}
	tomorrow := shiftDateBy(todayIn(ctx, rc.CustomerID), 1)
	for _, zone := range zones {
		if rosterFor(plan, zone.ID, tomorrow) != nil {
			report.RostersSkipped++
			continue
		}
		// forecast_run_id: nil, so BuildRoster
		// auto-links today's latest run (now a
		// real Postgres row, see CreateForecastRun).
		body := map[string]any{"zone_id": zone.ID, "roster_date": tomorrow, "forecast_run_id": nil}
		var stale bool
		_, err := buildRoster(ctx, conn, rc, body, &stale)
		if stale {
			report.RostersStale = append(report.RostersStale, zone.NameEn)
		}
		if err == nil {
			report.RostersBuilt++
			continue
		}
		if errCodeOf(err) == dataerr.CodeConflict {
			// Built between loadPlan and here: skip.
			report.RostersSkipped++
			continue
		}
		report.RostersFailed = append(report.RostersFailed, fmt.Sprintf("%s: %v", zone.NameEn, err))
	}
	return nil
}

func errCodeOf(err error) dataerr.Code {
	de, ok := err.(*dataerr.DataError)
	if !ok {
		return ""
	}
	return de.Code
}
