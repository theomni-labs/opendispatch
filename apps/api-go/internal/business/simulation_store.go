// SPDX-License-Identifier: AGPL-3.0-only

package business

import (
	"context"
	"encoding/json"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/fixtures"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
)

// simBackend keeps simulation runs and their results.
type simBackend interface {
	runs(ctx context.Context, tenant string) ([]SimulationRun, error)
	results(ctx context.Context, tenant, runID string) ([]SimulationResult, error)
	save(ctx context.Context, tenant string, run SimulationRun, results []SimulationResult, scenario *Scenario) error
}

var simStoreBackend simBackend = memorySims{}

// UsePostgresSimulations keeps runs and results in Postgres.
func UsePostgresSimulations(conn *tenancy.Connection) { simStoreBackend = pgSims{conn: conn} }

// UseMemorySimulations puts the in-memory store back (tests).
func UseMemorySimulations() { simStoreBackend = memorySims{} }

type memorySims struct{}

func (memorySims) runs(context.Context, string) ([]SimulationRun, error) {
	return allSimulationRunsMemory(), nil
}

func (memorySims) results(_ context.Context, _, runID string) ([]SimulationResult, error) {
	var out []SimulationResult
	for _, r := range allSimulationResultsMemory() {
		if runID == "" || r.SimulationRunID == runID {
			out = append(out, r)
		}
	}
	return out, nil
}

func (memorySims) save(_ context.Context, _ string, run SimulationRun, results []SimulationResult, scenario *Scenario) error {
	upsertSimulationRunMemory(run)
	if len(results) > 0 {
		upsertSimulationResultsMemory(results)
	}
	if scenario != nil {
		upsertScenarioRowMemory(*scenario)
	}
	return nil
}

type pgSims struct{ conn *tenancy.Connection }

func (p pgSims) runs(ctx context.Context, tenant string) ([]SimulationRun, error) {
	return tenancy.WithTenant(ctx, p.conn.Pool, tenant, func(ctx context.Context, tx pgx.Tx) ([]SimulationRun, error) {
		rows, err := tx.Query(ctx, `SELECT id::text, tenant_id::text, data_source, created_at, updated_at, created_by::text, roster_id::text, scenario_id::text,
			to_char(run_date, 'YYYY-MM-DD'), assignment_policy, primary_clock_start, threshold_seconds, status, illustrative, engine_version, finished_at
			FROM simulation_runs ORDER BY created_at, id`)
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		var out []SimulationRun
		for rows.Next() {
			var r SimulationRun
			var created, updated time.Time
			var finished *time.Time
			if err := rows.Scan(&r.ID, &r.TenantID, &r.DataSource, &created, &updated, &r.CreatedBy, &r.RosterID, &r.ScenarioID, &r.RunDate, &r.AssignmentPolicy,
				&r.PrimaryClockStart, &r.ThresholdSeconds, &r.Status, &r.Illustrative, &r.EngineVersion, &finished); err != nil {
				return nil, err
			}
			r.CreatedAt, r.UpdatedAt = datactx.ToRiyadhISO(created), datactx.ToRiyadhISO(updated)
			r.FinishedAt = nullableTimeToISO(finished)
			out = append(out, r)
		}
		return out, rows.Err()
	})
}

func (p pgSims) results(ctx context.Context, tenant, runID string) ([]SimulationResult, error) {
	return tenancy.WithTenant(ctx, p.conn.Pool, tenant, func(ctx context.Context, tx pgx.Tx) ([]SimulationResult, error) {
		rows, err := tx.Query(ctx, `SELECT id::text, tenant_id::text, data_source, created_at, updated_at, created_by::text, simulation_run_id::text, zone_id::text,
			interval_start, case_count, field_case_count, from_registration, from_assignment, median_assigned_to_arrived_seconds, p90_assigned_to_arrived_seconds
			FROM simulation_results WHERE $1 = '' OR simulation_run_id = NULLIF($1, '')::uuid ORDER BY created_at, id`, runID)
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		var out []SimulationResult
		for rows.Next() {
			var r SimulationResult
			var created, updated time.Time
			var zone *string
			var interval *time.Time
			var cases, field *int
			var fromReg, fromAsg []byte
			if err := rows.Scan(&r.ID, &r.TenantID, &r.DataSource, &created, &updated, &r.CreatedBy, &r.SimulationRunID, &zone, &interval, &cases, &field,
				&fromReg, &fromAsg, &r.MedianAssignedToArrivedSecond, &r.P90AssignedToArrivedSeconds); err != nil {
				return nil, err
			}
			r.CreatedAt, r.UpdatedAt = datactx.ToRiyadhISO(created), datactx.ToRiyadhISO(updated)
			if zone != nil {
				r.ZoneID = *zone
			}
			if cases != nil {
				r.CaseCount = *cases
			}
			if field != nil {
				r.FieldCaseCount = *field
			}
			r.IntervalStart = nullableTimeToISO(interval)
			if len(fromReg) > 0 {
				if err := json.Unmarshal(fromReg, &r.FromRegistration); err != nil {
					return nil, err
				}
			}
			if len(fromAsg) > 0 {
				if err := json.Unmarshal(fromAsg, &r.FromAssignment); err != nil {
					return nil, err
				}
			}
			out = append(out, r)
		}
		return out, rows.Err()
	})
}

func saveRunTx(ctx context.Context, tx pgx.Tx, run SimulationRun) error {
	created, err := optTime(nullableUUID(run.CreatedAt))
	if err != nil {
		return err
	}
	updated, err := optTime(nullableUUID(run.UpdatedAt))
	if err != nil {
		return err
	}
	finished, err := optTime(run.FinishedAt)
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `INSERT INTO simulation_runs (tenant_id, id, data_source, created_at, updated_at, created_by, roster_id, scenario_id, run_date, assignment_policy,
			primary_clock_start, threshold_seconds, status, illustrative, engine_version, finished_at)
		VALUES (current_setting('app.tenant_id')::uuid, $1::uuid, $2, COALESCE($3, now()), COALESCE($4, now()), $5::uuid, $6::uuid, $7::uuid, $8::date, $9, $10, $11, $12, $13, $14, $15)
		ON CONFLICT (tenant_id, id) DO UPDATE SET assignment_policy = EXCLUDED.assignment_policy, primary_clock_start = EXCLUDED.primary_clock_start,
			threshold_seconds = EXCLUDED.threshold_seconds, status = EXCLUDED.status, illustrative = EXCLUDED.illustrative,
			engine_version = EXCLUDED.engine_version, finished_at = EXCLUDED.finished_at, updated_at = EXCLUDED.updated_at`,
		run.ID, run.DataSource, created, updated, run.CreatedBy, run.RosterID, run.ScenarioID, run.RunDate, run.AssignmentPolicy,
		run.PrimaryClockStart, run.ThresholdSeconds, run.Status, run.Illustrative, run.EngineVersion, finished)
	return err
}

func saveResultTx(ctx context.Context, tx pgx.Tx, r SimulationResult) error {
	created, err := optTime(nullableUUID(r.CreatedAt))
	if err != nil {
		return err
	}
	updated, err := optTime(nullableUUID(r.UpdatedAt))
	if err != nil {
		return err
	}
	interval, err := optTime(r.IntervalStart)
	if err != nil {
		return err
	}
	fromReg, err := json.Marshal(r.FromRegistration)
	if err != nil {
		return err
	}
	fromAsg, err := json.Marshal(r.FromAssignment)
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `INSERT INTO simulation_results (tenant_id, id, data_source, created_at, updated_at, created_by, simulation_run_id, zone_id, interval_start,
			case_count, field_case_count, from_registration, from_assignment, median_assigned_to_arrived_seconds, p90_assigned_to_arrived_seconds)
		VALUES (current_setting('app.tenant_id')::uuid, $1::uuid, $2, COALESCE($3, now()), COALESCE($4, now()), $5::uuid, $6::uuid, $7::uuid, $8, $9, $10, $11::jsonb, $12::jsonb, $13, $14)
		ON CONFLICT (tenant_id, id) DO UPDATE SET case_count = EXCLUDED.case_count, field_case_count = EXCLUDED.field_case_count,
			from_registration = EXCLUDED.from_registration, from_assignment = EXCLUDED.from_assignment,
			median_assigned_to_arrived_seconds = EXCLUDED.median_assigned_to_arrived_seconds,
			p90_assigned_to_arrived_seconds = EXCLUDED.p90_assigned_to_arrived_seconds, updated_at = EXCLUDED.updated_at`,
		r.ID, r.DataSource, created, updated, r.CreatedBy, r.SimulationRunID, nullableUUID(r.ZoneID), interval, r.CaseCount, r.FieldCaseCount,
		fromReg, fromAsg, r.MedianAssignedToArrivedSecond, r.P90AssignedToArrivedSeconds)
	return err
}

func (p pgSims) save(ctx context.Context, tenant string, run SimulationRun, results []SimulationResult, scenario *Scenario) error {
	return p.saveAll(ctx, tenant, []SimulationRun{run}, results, scenario)
}

func (p pgSims) saveAll(ctx context.Context, tenant string, runs []SimulationRun, results []SimulationResult, scenario *Scenario) error {
	_, err := tenancy.WithTenant(ctx, p.conn.Pool, tenant, func(ctx context.Context, tx pgx.Tx) (struct{}, error) {
		for _, run := range runs {
			if err := saveRunTx(ctx, tx, run); err != nil {
				return struct{}{}, err
			}
		}
		for _, r := range results {
			if err := saveResultTx(ctx, tx, r); err != nil {
				return struct{}{}, err
			}
		}
		if scenario != nil {
			return struct{}{}, saveScenarioTx(ctx, tx, *scenario)
		}
		return struct{}{}, nil
	})
	return err
}

func loadSimulationRuns(ctx context.Context, tenant string) ([]SimulationRun, error) {
	return simStoreBackend.runs(ctx, tenant)
}

func loadSimulationResults(ctx context.Context, tenant, runID string) ([]SimulationResult, error) {
	return simStoreBackend.results(ctx, tenant, runID)
}

// ReseedSimulationsForTest puts the run and result tables back to the fixtures (owner connection).
func ReseedSimulationsForTest(ctx context.Context, owner *tenancy.Connection) error {
	if _, isPg := simStoreBackend.(pgSims); !isPg {
		return nil
	}
	for _, q := range []string{`DELETE FROM simulation_results`, `DELETE FROM simulation_runs`} {
		if _, err := owner.Pool.Exec(ctx, q); err != nil {
			return err
		}
	}
	runs, err := fixtures.Records[SimulationRun]("SimulationRun")
	if err != nil {
		return err
	}
	results, err := fixtures.Records[SimulationResult]("SimulationResult")
	if err != nil {
		return err
	}
	tenant, err := fixtures.TenantID()
	if err != nil {
		return err
	}
	return pgSims{conn: owner}.saveAll(ctx, tenant, runs, results, nil)
}
