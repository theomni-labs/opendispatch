// SPDX-License-Identifier: AGPL-3.0-only

// RLS on a TimescaleDB hypertable.
package tenancy

import (
	"context"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
)

func TestForecastValuesHypertable_LivePostgres(t *testing.T) {
	ownerURL := liveTestDatabaseURL()
	if ownerURL == "" {
		t.Skip(noLiveDBReason)
	}
	ctx := context.Background()
	owner := openLiveTestPool(t, 3)
	if _, err := ApplyMigrations(ctx, ApplyMigrationsOptions{Pool: owner, Dir: realMigrationsDir(t)}); err != nil {
		t.Fatalf("apply real migrations: %v", err)
	}

	var hyper bool
	if err := owner.QueryRow(ctx, `SELECT to_regclass('timescaledb_information.hypertables') IS NOT NULL`).Scan(&hyper); err != nil {
		t.Fatal(err)
	}
	if hyper {
		if err := owner.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM timescaledb_information.hypertables
			WHERE hypertable_schema = 'public' AND hypertable_name = 'forecast_values')`).Scan(&hyper); err != nil {
			t.Fatal(err)
		}
	}
	var pk string
	if err := owner.QueryRow(ctx, `SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'forecast_values_pkey'`).Scan(&pk); err != nil {
		t.Fatal(err)
	}
	if !hyper {
		if pk != "PRIMARY KEY (tenant_id, id)" {
			t.Fatalf("plain mode: pkey %q, want (tenant_id, id)", pk)
		}
		t.Skip("plain Postgres mode: forecast_values is not a hypertable")
	}
	if pk != "PRIMARY KEY (tenant_id, id, interval_start)" {
		t.Fatalf("hypertable pkey %q, want (tenant_id, id, interval_start)", pk)
	}

	now := time.Now().UnixNano()
	roleName := fmt.Sprintf("hyper_role_go_%d", now)
	rolePassword := newUUIDv4()
	tenantA, tenantB := newUUIDv4(), newUUIDv4()
	mustExec(t, ctx, owner, fmt.Sprintf(`CREATE ROLE %s LOGIN PASSWORD '%s' NOSUPERUSER NOBYPASSRLS`, roleName, rolePassword))
	mustExec(t, ctx, owner, `GRANT USAGE ON SCHEMA public TO `+roleName)
	mustExec(t, ctx, owner, `GRANT SELECT, INSERT, UPDATE, DELETE ON "forecast_values" TO `+roleName)
	t.Cleanup(func() {
		bg := context.Background()
		for _, tbl := range []string{"forecast_values", "forecast_runs", "zones", "cities"} {
			owner.Exec(bg, fmt.Sprintf(`DELETE FROM %q WHERE tenant_id IN ($1, $2)`, tbl), tenantA, tenantB) //nolint:errcheck
		}
		owner.Exec(bg, `REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM `+roleName) //nolint:errcheck
		owner.Exec(bg, `REVOKE ALL PRIVILEGES ON SCHEMA public FROM `+roleName)               //nolint:errcheck
		owner.Exec(bg, `DROP OWNED BY `+roleName)                                             //nolint:errcheck
		owner.Exec(bg, `DROP ROLE IF EXISTS `+roleName)                                       //nolint:errcheck
	})

	// parents per tenant, then rows in three chunks
	runs := map[string]string{}
	zones := map[string]string{}
	for _, tenant := range []string{tenantA, tenantB} {
		city, zone, run := newUUIDv4(), newUUIDv4(), newUUIDv4()
		insertRow(t, ctx, owner, tenant, `INSERT INTO "cities" (tenant_id, id, data_source, name_en) VALUES ($1, '`+city+`', 'SYNTHETIC', 'Hyper City')`)
		insertRow(t, ctx, owner, tenant, `INSERT INTO "zones" (tenant_id, id, data_source, city_id, name_en) VALUES ($1, '`+zone+`', 'SYNTHETIC', '`+city+`', 'Hyper Zone')`)
		insertRow(t, ctx, owner, tenant, `INSERT INTO "forecast_runs" (tenant_id, id, data_source, model_version, status, horizon_start_date, horizon_days)
			VALUES ($1, '`+run+`', 'SYNTHETIC', 'test', 'completed', '2026-01-01', 1)`)
		runs[tenant], zones[tenant] = run, zone
	}
	rolePool := openTestPoolAt(t, withCredentials(t, ownerURL, roleName, rolePassword), 1)
	freshPool := openTestPoolAt(t, withCredentials(t, ownerURL, roleName, rolePassword), 1)
	insertValues := func(tenant string) {
		insertRow(t, ctx, rolePool, tenant, `INSERT INTO "forecast_values" (tenant_id, data_source, forecast_run_id, zone_id, interval_start, interval_index, expected)
			SELECT $1, 'SYNTHETIC', '`+runs[tenant]+`', '`+zones[tenant]+`', d, 0, 1.5
			FROM unnest(ARRAY['2020-01-01', '2020-06-01', '2020-12-01']::timestamptz[]) d`)
	}
	insertValues(tenantA)
	insertValues(tenantB)

	t.Run("fails closed on a fresh connection", func(t *testing.T) {
		if err := drainErr(ctx, freshPool, `SELECT * FROM "forecast_values"`); err == nil {
			t.Fatal("want an error: RLS let a bare query through")
		}
	})

	t.Run("fails closed on a reused pooled connection", func(t *testing.T) {
		if n := countRows(t, ctx, rolePool, tenantA, `SELECT id FROM "forecast_values"`); n != 3 {
			t.Fatalf("tenant A saw %d rows, want 3", n)
		}
		if err := drainErr(ctx, rolePool, `SELECT * FROM "forecast_values"`); err == nil {
			t.Fatal("want an error: the tenant leaked into the next query")
		}
	})

	t.Run("A never sees B's rows, in any chunk", func(t *testing.T) {
		for _, tenant := range []string{tenantA, tenantB} {
			got := stringColumn(t, ctx, rolePool, tenant, `SELECT DISTINCT tenant_id::text FROM "forecast_values"`)
			if len(got) != 1 || got[0] != tenant {
				t.Errorf("tenant %s saw tenants %v", tenant, got)
			}
		}
	})

	t.Run("WITH CHECK refuses another tenant's row", func(t *testing.T) {
		_, err := WithTenant(ctx, rolePool, tenantA, func(ctx context.Context, tx pgx.Tx) (struct{}, error) {
			_, err := tx.Exec(ctx, `INSERT INTO "forecast_values" (tenant_id, data_source, forecast_run_id, zone_id, interval_start, interval_index)
				VALUES ($1, 'SYNTHETIC', $2, $3, '2020-01-02', 0)`, tenantB, runs[tenantB], zones[tenantB])
			return struct{}{}, err
		})
		if err == nil || !strings.Contains(err.Error(), "row-level security") {
			t.Fatalf("want a row-level security error, got %v", err)
		}
	})

	t.Run("chunks: private schema, no direct read", func(t *testing.T) {
		rows, err := owner.Query(ctx, `SELECT c::text FROM show_chunks('forecast_values') c`)
		if err != nil {
			t.Fatal(err)
		}
		var chunks []string
		for rows.Next() {
			var c string
			if err := rows.Scan(&c); err != nil {
				t.Fatal(err)
			}
			chunks = append(chunks, c)
		}
		rows.Close()
		if len(chunks) < 3 {
			t.Fatalf("got %d chunks, want at least 3", len(chunks))
		}
		for _, c := range chunks {
			if !strings.HasPrefix(c, "opendispatch_chunks.") {
				t.Errorf("chunk %s outside opendispatch_chunks", c)
			}
			if err := drainErr(ctx, freshPool, `SELECT * FROM `+c); err == nil || !strings.Contains(err.Error(), "permission denied") {
				t.Errorf("%s: want permission denied, got %v", c, err)
			}
		}
	})

	t.Run("every chunk index starts with tenant_id", func(t *testing.T) {
		var bad int
		if err := owner.QueryRow(ctx, `SELECT count(*) FROM pg_index i
			JOIN pg_class c ON c.oid = i.indrelid JOIN pg_namespace n ON n.oid = c.relnamespace
			JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = i.indkey[0]
			WHERE n.nspname = 'opendispatch_chunks' AND a.attname <> 'tenant_id'`).Scan(&bad); err != nil {
			t.Fatal(err)
		}
		if bad != 0 {
			t.Errorf("%d chunk indexes not led by tenant_id", bad)
		}
	})
}
