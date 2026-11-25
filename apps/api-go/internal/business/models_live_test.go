// SPDX-License-Identifier: AGPL-3.0-only

// CreateForecastRun's Postgres shadow write (live).
package business

import (
	"context"
	"testing"

	"github.com/jackc/pgx/v5"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/dataerr"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
)

// forecastRunRowInPostgres: a real SELECT, not the
// in-memory store. An earlier version of this test
// never checked Postgres at all (review finding #7).
func forecastRunRowInPostgres(t *testing.T, ctx context.Context, conn *tenancy.Connection, tenantID, id string) (modelVersion, status string, found bool) {
	t.Helper()
	_, err := tenancy.WithTenant(ctx, conn.Pool, tenantID, func(ctx context.Context, tx pgx.Tx) (struct{}, error) {
		row := tx.QueryRow(ctx, `SELECT model_version, status FROM forecast_runs WHERE id = $1`, id)
		scanErr := row.Scan(&modelVersion, &status)
		if scanErr == pgx.ErrNoRows {
			return struct{}{}, nil
		}
		if scanErr != nil {
			return struct{}{}, scanErr
		}
		found = true
		return struct{}{}, nil
	})
	check(t, err)
	return modelVersion, status, found
}

func TestCreateForecastRun_ConflictWhenPaused(t *testing.T) {
	conn := openConn(t)
	ctx := context.Background()
	resetModelDeps()
	rc, _ := adminCtx(t)
	_, err := PauseModel(rc, map[string]any{"reason": "maintenance"})
	check(t, err)

	_, err = CreateForecastRun(ctx, conn, rc, map[string]any{"horizon_start_date": "2026-09-14", "horizon_days": 3.0})
	if errCode(err) != dataerr.CodeConflict {
		t.Fatalf("got %v, want Conflict while paused", err)
	}
}

func TestCreateForecastRun_UsesActiveVersionAndFieldShare(t *testing.T) {
	conn := openConn(t)
	ctx := context.Background()
	resetModelDeps()
	rc, _ := adminCtx(t)
	active := newModelVersion(rc, "v3", "active")
	active.EngineVersion = strPtr("1.2.0")
	SeedModelVersionsForTest(active)

	run, err := CreateForecastRun(ctx, conn, rc, map[string]any{"horizon_start_date": "2026-09-14", "horizon_days": 3.0})
	check(t, err)
	if run.ModelVersion != "v3" || run.EngineVersion == nil || *run.EngineVersion != "1.2.0" {
		t.Fatalf("got %+v, want model v3 / engine 1.2.0", run)
	}
	if run.Status != "succeeded" || !run.Illustrative || run.RuleSetVersion == nil {
		t.Fatalf("got %+v, want a succeeded, illustrative run with a rule set version", run)
	}
	if oneForecastRunRow(run.ID) == nil {
		t.Fatalf("forecast run was not stored in memory")
	}
	modelVersion, status, found := forecastRunRowInPostgres(t, ctx, conn, rc.CustomerID, run.ID)
	if !found {
		t.Fatalf("forecast run %s was not written to Postgres", run.ID)
	}
	if modelVersion != "v3" || status != "succeeded" {
		t.Fatalf("got model_version=%q status=%q in Postgres, want v3/succeeded", modelVersion, status)
	}
}
