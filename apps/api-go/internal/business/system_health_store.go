// SPDX-License-Identifier: AGPL-3.0-only

package business

import (
	"context"
	"encoding/json"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/fixtures"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/reqctx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
)

// healthBackend keeps job runs and diagnostics bundles.
type healthBackend interface {
	jobRuns(ctx context.Context, rc reqctx.RequestContext) ([]JobRun, error)
	saveBundle(ctx context.Context, tenant string, b DiagnosticsBundle) error
	bundle(ctx context.Context, tenant, id string) (*DiagnosticsBundle, error)
	databaseDetail(ctx context.Context, rc reqctx.RequestContext) string
}

var healthStoreBackend healthBackend = memoryHealth{}

// UsePostgresSystemHealth keeps them in Postgres.
func UsePostgresSystemHealth(conn *tenancy.Connection) { healthStoreBackend = pgHealth{conn: conn} }

// UseMemorySystemHealth puts the memory store back.
func UseMemorySystemHealth() { healthStoreBackend = memoryHealth{} }

type memoryHealth struct{}

func (memoryHealth) jobRuns(_ context.Context, rc reqctx.RequestContext) ([]JobRun, error) {
	seedJobsOnce(rc)
	return allJobRuns(), nil
}

func (memoryHealth) saveBundle(_ context.Context, _ string, b DiagnosticsBundle) error {
	upsertDiagnosticsBundleMemory(b)
	return nil
}

func (memoryHealth) bundle(_ context.Context, _, id string) (*DiagnosticsBundle, error) {
	return oneDiagnosticsBundleMemory(id), nil
}

func (memoryHealth) databaseDetail(context.Context, reqctx.RequestContext) string {
	return "Demo store"
}

type pgHealth struct{ conn *tenancy.Connection }

// databaseDetail: TimescaleDB mode
func (p pgHealth) databaseDetail(ctx context.Context, rc reqctx.RequestContext) string {
	mode, err := tenancy.WithTenant(ctx, p.conn.Pool, rc.CustomerID, func(ctx context.Context, tx pgx.Tx) (string, error) {
		var version string
		if err := tx.QueryRow(ctx, `SELECT COALESCE((SELECT extversion FROM pg_extension WHERE extname = 'timescaledb'), '')`).Scan(&version); err != nil || version == "" {
			return "", err
		}
		var hyper bool
		err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM timescaledb_information.hypertables
			WHERE hypertable_schema = 'public' AND hypertable_name = 'forecast_values')`).Scan(&hyper)
		if err != nil || !hyper {
			return "TimescaleDB " + version + " installed; forecast values in a plain table", err
		}
		return "TimescaleDB " + version + "; forecast values in a hypertable", nil
	})
	if err != nil {
		return "Postgres; TimescaleDB mode unknown"
	}
	if mode == "" {
		return "Plain Postgres; no TimescaleDB"
	}
	return mode
}

func insertJobRun(ctx context.Context, tx pgx.Tx, j JobRun) error {
	started, err := optTime(j.StartedAt)
	if err != nil {
		return err
	}
	finished, err := optTime(j.FinishedAt)
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `INSERT INTO job_runs (tenant_id, id, data_source, created_by, job_name, kind, status, started_at, finished_at, duration_ms, message)
		VALUES (current_setting('app.tenant_id')::uuid, $1::uuid, $2, $3::uuid, $4, $5, $6, $7, $8, $9, $10)
		ON CONFLICT (tenant_id, id) DO NOTHING`,
		j.ID, j.DataSource, j.CreatedBy, j.JobName, j.Kind, j.Status, started, finished, j.DurationMs, j.Message)
	return err
}

func (p pgHealth) jobRuns(ctx context.Context, rc reqctx.RequestContext) ([]JobRun, error) {
	return tenancy.WithTenant(ctx, p.conn.Pool, rc.CustomerID, func(ctx context.Context, tx pgx.Tx) ([]JobRun, error) {
		var n int
		if err := tx.QueryRow(ctx, `SELECT count(*) FROM job_runs`).Scan(&n); err != nil {
			return nil, err
		}
		if n == 0 {
			for _, j := range seedJobs(rc) {
				if err := insertJobRun(ctx, tx, j); err != nil {
					return nil, err
				}
			}
		}
		return scanJobRuns(ctx, tx)
	})
}

func scanJobRuns(ctx context.Context, tx pgx.Tx) ([]JobRun, error) {
	rows, err := tx.Query(ctx, `SELECT id::text, tenant_id::text, data_source, created_at, updated_at, created_by::text, job_name, kind, status, started_at, finished_at, duration_ms, message
		FROM job_runs ORDER BY started_at, id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []JobRun
	for rows.Next() {
		var j JobRun
		var created, updated time.Time
		var started, finished *time.Time
		if err := rows.Scan(&j.ID, &j.TenantID, &j.DataSource, &created, &updated, &j.CreatedBy, &j.JobName, &j.Kind, &j.Status, &started, &finished, &j.DurationMs, &j.Message); err != nil {
			return nil, err
		}
		j.CreatedAt, j.UpdatedAt = datactx.ToRiyadhISO(created), datactx.ToRiyadhISO(updated)
		j.StartedAt, j.FinishedAt = nullableTimeToISO(started), nullableTimeToISO(finished)
		out = append(out, j)
	}
	return out, rows.Err()
}

func (p pgHealth) saveBundle(ctx context.Context, tenant string, b DiagnosticsBundle) error {
	at, err := parseTime(b.GeneratedAt)
	if err != nil {
		return err
	}
	includes, err := json.Marshal(b.Includes)
	if err != nil {
		return err
	}
	_, err = tenancy.WithTenant(ctx, p.conn.Pool, tenant, func(ctx context.Context, tx pgx.Tx) (struct{}, error) {
		_, err := tx.Exec(ctx, `INSERT INTO diagnostics_bundles (tenant_id, id, generated_at, generated_by_user_id, size_bytes, personal_data_removed, includes)
			VALUES (current_setting('app.tenant_id')::uuid, $1::uuid, $2, $3::uuid, $4, $5, $6::jsonb)
			ON CONFLICT (tenant_id, id) DO UPDATE SET generated_at = EXCLUDED.generated_at, size_bytes = EXCLUDED.size_bytes, includes = EXCLUDED.includes`,
			b.ID, at, b.GeneratedByUserID, b.SizeBytes, b.PersonalDataRemoved, includes)
		return struct{}{}, err
	})
	return err
}

func (p pgHealth) bundle(ctx context.Context, tenant, id string) (*DiagnosticsBundle, error) {
	return tenancy.WithTenant(ctx, p.conn.Pool, tenant, func(ctx context.Context, tx pgx.Tx) (*DiagnosticsBundle, error) {
		var b DiagnosticsBundle
		var at time.Time
		var includes []byte
		err := tx.QueryRow(ctx, `SELECT id::text, generated_at, generated_by_user_id::text, size_bytes, personal_data_removed, includes FROM diagnostics_bundles WHERE id = $1::uuid`, id).
			Scan(&b.ID, &at, &b.GeneratedByUserID, &b.SizeBytes, &b.PersonalDataRemoved, &includes)
		if err == pgx.ErrNoRows {
			return nil, nil
		}
		if err != nil {
			return nil, err
		}
		b.GeneratedAt = datactx.ToRiyadhISO(at)
		if err := json.Unmarshal(includes, &b.Includes); err != nil {
			return nil, err
		}
		return &b, nil
	})
}

func loadJobRuns(ctx context.Context, rc reqctx.RequestContext) ([]JobRun, error) {
	return healthStoreBackend.jobRuns(ctx, rc)
}

func saveDiagnosticsBundle(ctx context.Context, tenant string, b DiagnosticsBundle) error {
	return healthStoreBackend.saveBundle(ctx, tenant, b)
}

func loadDiagnosticsBundle(ctx context.Context, tenant, id string) (*DiagnosticsBundle, error) {
	return healthStoreBackend.bundle(ctx, tenant, id)
}

// ReseedSystemHealthForTest puts job runs back to the samples.
func ReseedSystemHealthForTest(ctx context.Context, owner *tenancy.Connection) error {
	if _, isPg := healthStoreBackend.(pgHealth); !isPg {
		return nil
	}
	if _, err := owner.Pool.Exec(ctx, `DELETE FROM job_runs`); err != nil {
		return err
	}
	if _, err := owner.Pool.Exec(ctx, `DELETE FROM diagnostics_bundles`); err != nil {
		return err
	}
	tenant, err := fixtures.TenantID()
	if err != nil {
		return err
	}
	_, err = tenancy.WithTenant(ctx, owner.Pool, tenant, func(ctx context.Context, tx pgx.Tx) (struct{}, error) {
		for _, j := range seedJobs(reqctx.RequestContext{CustomerID: tenant}) {
			if err := insertJobRun(ctx, tx, j); err != nil {
				return struct{}{}, err
			}
		}
		return struct{}{}, nil
	})
	return err
}
