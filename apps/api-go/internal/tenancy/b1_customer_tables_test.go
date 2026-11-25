// SPDX-License-Identifier: AGPL-3.0-only

// Mirrors b1-customer-tables.live.test.ts.
package tenancy

import (
	"context"
	"fmt"
	"path/filepath"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Floor: tables the catalog must list.
var allCustomerTables = []string{
	"users", "role_mappings", "case_types", "break_rules", "classification_rules",
	"holidays", "model_versions", "integrations", "notification_rules", "settings",
	"scenarios", "audit_events", "cities", "zones", "sub_zones", "standby_points",
	"vehicles", "agents", "agent_skills", "rule_versions", "shift_patterns",
	"leave_requests", "forecast_runs", "forecast_values", "import_jobs",
	"data_quality_issues", "notifications", "cases", "assignments",
	"assignment_events", "assignment_comparisons", "rosters", "roster_assignments",
	"approvals", "overrides", "simulation_runs", "simulation_results",
	"dashboard_rollups", "productivity_rollups", "sessions", "feed_events", "agent_status_history", "agent_live_state",
	"weather_days", "forecast_accuracy_rollups", "import_case_snapshots", "vehicle_maintenance",
	"forecast_accuracy_hour_totals", "sick_leave_history", "attendance_spans", "agent_shift_eligibility", "forecast_experiments",
	"import_mappings",
}

func realMigrationsDir(t *testing.T) string {
	t.Helper()
	dir, err := filepath.Abs(filepath.Join("..", "..", "migrations"))
	if err != nil {
		t.Fatalf("resolve migrations dir: %v", err)
	}
	return dir
}

func TestB1CustomerTables_LivePostgres(t *testing.T) {
	ownerURL := liveTestDatabaseURL()
	if ownerURL == "" {
		t.Skip(noLiveDBReason)
	}
	ctx := context.Background()
	owner := openLiveTestPool(t, 3)

	// The real re-proof: real migrations, not fixtures.
	results, err := ApplyMigrations(ctx, ApplyMigrationsOptions{Pool: owner, Dir: realMigrationsDir(t)})
	if err != nil {
		t.Fatalf("apply real migrations: %v", err)
	}
	if len(results) < len(allCustomerTables) {
		t.Fatalf("applied %d migration files, want at least %d (one per table)", len(results), len(allCustomerTables))
	}

	now := time.Now().UnixNano()
	roleName := fmt.Sprintf("b1_smoke_role_go_%d", now)
	rolePassword := newUUIDv4()
	tenantA := newUUIDv4()
	tenantB := newUUIDv4()
	insertedInto := []string{"case_types", "cities", "users", "settings", "holidays"}

	// Non-superuser: owner always bypasses RLS (FORCE).
	mustExec(t, ctx, owner, fmt.Sprintf(`CREATE ROLE %s LOGIN PASSWORD '%s' NOSUPERUSER NOBYPASSRLS`, roleName, rolePassword))
	mustExec(t, ctx, owner, fmt.Sprintf(`GRANT USAGE ON SCHEMA public TO %s`, roleName))
	// Read every table: the fails-closed proof needs it.
	mustExec(t, ctx, owner, fmt.Sprintf(`GRANT SELECT ON ALL TABLES IN SCHEMA public TO %s`, roleName))
	quotedInsertable := ""
	for i, tbl := range insertedInto {
		if i > 0 {
			quotedInsertable += ", "
		}
		quotedInsertable += `"` + tbl + `"`
	}
	mustExec(t, ctx, owner, fmt.Sprintf(`GRANT INSERT ON %s TO %s`, quotedInsertable, roleName))

	roleURL := withCredentials(t, ownerURL, roleName, rolePassword)
	rolePool := openTestPoolAt(t, roleURL, 3)
	bareRolePool := openTestPoolAt(t, roleURL, 1)

	t.Cleanup(func() {
		bg := context.Background()
		for _, tbl := range insertedInto {
			owner.Exec(bg, fmt.Sprintf(`DELETE FROM %q WHERE tenant_id IN ($1, $2)`, tbl), tenantA, tenantB) //nolint:errcheck
		}
		owner.Exec(bg, `REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM `+roleName) //nolint:errcheck
		owner.Exec(bg, `REVOKE ALL PRIVILEGES ON SCHEMA public FROM `+roleName)               //nolint:errcheck
		owner.Exec(bg, `DROP ROLE IF EXISTS `+roleName)                                       //nolint:errcheck
	})

	t.Run("fails closed: every customer table in the catalog", func(t *testing.T) {
		tables := catalogCustomerTables(t, ctx, owner)
		known := map[string]bool{}
		for _, table := range tables {
			known[table] = true
		}
		for _, table := range allCustomerTables {
			if !known[table] {
				t.Fatalf("the catalog lacks %s", table)
			}
		}
		for _, table := range tables {
			t.Run(table, func(t *testing.T) {
				err := drainErr(ctx, bareRolePool, fmt.Sprintf(`SELECT * FROM %q`, table))
				if err == nil {
					t.Fatalf("%s: want an error, RLS let a bare query through", table)
				}
			})
		}
	})

	t.Run("catalog: every public table is a customer table", func(t *testing.T) {
		rows, err := owner.Query(ctx, `
			SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity,
			  (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid AND p.polname = 'tenant_isolation'
			     AND pg_get_expr(p.polqual, p.polrelid) LIKE '%tenant_id = (current_setting(''app.tenant_id''::text))::uuid%'
			     AND pg_get_expr(p.polwithcheck, p.polrelid) LIKE '%tenant_id = (current_setting(''app.tenant_id''::text))::uuid%'),
			  (SELECT count(*) FROM pg_index i JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = i.indkey[0]
			     WHERE i.indrelid = c.oid AND a.attname <> 'tenant_id')
			FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
			WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') ORDER BY c.relname`)
		if err != nil {
			t.Fatal(err)
		}
		defer rows.Close()
		seen := 0
		for rows.Next() {
			var name string
			var rls, forced bool
			var policies, badIdx int
			if err := rows.Scan(&name, &rls, &forced, &policies, &badIdx); err != nil {
				t.Fatal(err)
			}
			seen++
			if !rls || !forced || policies != 1 || badIdx != 0 {
				t.Errorf("%s: rls=%t forced=%t tenant policies=%d indexes not led by tenant_id=%d", name, rls, forced, policies, badIdx)
			}
		}
		if seen < len(allCustomerTables) {
			t.Errorf("saw %d public tables, want at least %d", seen, len(allCustomerTables))
		}
	})

	t.Run("weather_days: A can never see B's row", func(t *testing.T) {
		cityB := newUUIDv4()
		insertRow(t, ctx, owner, tenantB, `INSERT INTO "cities" (tenant_id, id, data_source, name_en) VALUES ($1, '`+cityB+`', 'SYNTHETIC', 'B Weather City')`)
		insertRow(t, ctx, owner, tenantB, `INSERT INTO "weather_days" (tenant_id, data_source, city_id, date, rain_mm, source, fetched_at)
			VALUES ($1, 'PUBLIC_OPEN_DATA', '`+cityB+`', '2026-01-01', 2.5, 'open-meteo:archive:era5', now())`)
		t.Cleanup(func() {
			owner.Exec(context.Background(), `DELETE FROM "cities" WHERE tenant_id = $1 AND id = $2`, tenantB, cityB) //nolint:errcheck
		})
		if n := countRows(t, ctx, rolePool, tenantA, `SELECT id FROM "weather_days"`); n != 0 {
			t.Errorf("tenant A saw %d of B's weather rows, want 0", n)
		}
		if n := countRows(t, ctx, rolePool, tenantB, `SELECT id FROM "weather_days"`); n != 1 {
			t.Errorf("tenant B saw %d of its weather rows, want 1", n)
		}
	})

	t.Run("vehicle_maintenance: A never sees B's window, nor points at B's vehicle", func(t *testing.T) {
		vehB := newUUIDv4()
		insertRow(t, ctx, owner, tenantB, `INSERT INTO "vehicles" (tenant_id, id, data_source, code, plate_number) VALUES ($1, '`+vehB+`', 'SYNTHETIC', 'VEH-B-MNT', 'B 0001')`)
		insertRow(t, ctx, owner, tenantB, `INSERT INTO "vehicle_maintenance" (tenant_id, data_source, vehicle_id, starts_at, ends_at, reason)
			VALUES ($1, 'SYNTHETIC', '`+vehB+`', '2026-09-14T08:00:00+03:00', '2026-09-14T12:00:00+03:00', 'Service')`)
		t.Cleanup(func() {
			owner.Exec(context.Background(), `DELETE FROM "vehicles" WHERE tenant_id = $1 AND id = $2`, tenantB, vehB) //nolint:errcheck
		})
		if n := countRows(t, ctx, rolePool, tenantA, `SELECT id FROM "vehicle_maintenance"`); n != 0 {
			t.Errorf("tenant A saw %d of B's maintenance rows, want 0", n)
		}
		if n := countRows(t, ctx, rolePool, tenantB, `SELECT id FROM "vehicle_maintenance"`); n != 1 {
			t.Errorf("tenant B saw %d of its maintenance rows, want 1", n)
		}
		_, err := owner.Exec(ctx, `INSERT INTO "vehicle_maintenance" (tenant_id, data_source, vehicle_id, starts_at, ends_at, reason)
			VALUES ($1, 'SYNTHETIC', '`+vehB+`', '2026-09-15T08:00:00+03:00', '2026-09-15T12:00:00+03:00', 'Cross')`, tenantA)
		if err == nil {
			t.Error("a window of tenant A pointing at tenant B's vehicle was accepted")
		}
	})
	t.Run("forecast_accuracy_rollups: A can never see B's row", func(t *testing.T) {
		cityB, zoneB := newUUIDv4(), newUUIDv4()
		insertRow(t, ctx, owner, tenantB, `INSERT INTO "cities" (tenant_id, id, data_source, name_en) VALUES ($1, '`+cityB+`', 'SYNTHETIC', 'B Accuracy City')`)
		insertRow(t, ctx, owner, tenantB, `INSERT INTO "zones" (tenant_id, id, data_source, city_id, name_en) VALUES ($1, '`+zoneB+`', 'SYNTHETIC', '`+cityB+`', 'B Zone')`)
		insertRow(t, ctx, owner, tenantB, `INSERT INTO "forecast_accuracy_rollups" (tenant_id, data_source, zone_id, window_start, window_end, window_days,
			dimension, bucket, days, forecast_sum, actual_sum, abs_error_sum, ape_sum, ape_count, data_sources, illustrative, computed_at)
			VALUES ($1, 'SYNTHETIC', '`+zoneB+`', '2026-08-16', '2026-09-12', 28, 'zone', 0, 28, 100, 90, 10, 0.5, 28, '{SYNTHETIC}', true, now())`)
		t.Cleanup(func() {
			bg := context.Background()
			owner.Exec(bg, `DELETE FROM "zones" WHERE tenant_id = $1 AND id = $2`, tenantB, zoneB)  //nolint:errcheck
			owner.Exec(bg, `DELETE FROM "cities" WHERE tenant_id = $1 AND id = $2`, tenantB, cityB) //nolint:errcheck
		})
		if n := countRows(t, ctx, rolePool, tenantA, `SELECT id FROM "forecast_accuracy_rollups"`); n != 0 {
			t.Errorf("tenant A saw %d of B's accuracy rows, want 0", n)
		}
		if n := countRows(t, ctx, rolePool, tenantB, `SELECT id FROM "forecast_accuracy_rollups"`); n != 1 {
			t.Errorf("tenant B saw %d of its accuracy rows, want 1", n)
		}
	})
	t.Run("forecast_accuracy_hour_totals: A can never see B's row", func(t *testing.T) {
		insertRow(t, ctx, owner, tenantB, `INSERT INTO "forecast_accuracy_hour_totals" (tenant_id, data_source, window_start, window_end, window_days,
			bucket, zones, days, forecast_sum, actual_sum, abs_error_sum, ape_sum, ape_count, data_sources, illustrative, computed_at)
			VALUES ($1, 'SYNTHETIC', '2026-08-16', '2026-09-12', 28, 9, 3, 28, 100, 90, 10, 0.5, 28, '{SYNTHETIC}', true, now())`)
		t.Cleanup(func() {
			owner.Exec(context.Background(), `DELETE FROM "forecast_accuracy_hour_totals" WHERE tenant_id = $1`, tenantB) //nolint:errcheck
		})
		if n := countRows(t, ctx, rolePool, tenantA, `SELECT id FROM "forecast_accuracy_hour_totals"`); n != 0 {
			t.Errorf("tenant A saw %d of B's hour totals, want 0", n)
		}
		if n := countRows(t, ctx, rolePool, tenantB, `SELECT id FROM "forecast_accuracy_hour_totals"`); n != 1 {
			t.Errorf("tenant B saw %d of its hour totals, want 1", n)
		}
	})
	t.Run("import_mappings: A can never see B's row", func(t *testing.T) {
		insertRow(t, ctx, owner, tenantB, `INSERT INTO "import_mappings" (tenant_id, data_source, version, base_version)
			VALUES ($1, 'SYNTHETIC', 'customer_case_b2', 'generic_csv_v1')`)
		t.Cleanup(func() {
			owner.Exec(context.Background(), `DELETE FROM "import_mappings" WHERE tenant_id = $1`, tenantB) //nolint:errcheck
		})
		if n := countRows(t, ctx, rolePool, tenantA, `SELECT id FROM "import_mappings"`); n != 0 {
			t.Errorf("tenant A saw %d of B's mappings, want 0", n)
		}
		if n := countRows(t, ctx, rolePool, tenantB, `SELECT id FROM "import_mappings"`); n != 1 {
			t.Errorf("tenant B saw %d of its mappings, want 1", n)
		}
	})
	t.Run("forecast_experiments: A can never see B's row", func(t *testing.T) {
		insertRow(t, ctx, owner, tenantB, `INSERT INTO "forecast_experiments" (tenant_id, data_source, kind, trigger, status, model_version)
			VALUES ($1, 'SYNTHETIC', 'backtest', 'manual', 'succeeded', 'ensemble-4')`)
		t.Cleanup(func() {
			owner.Exec(context.Background(), `DELETE FROM "forecast_experiments" WHERE tenant_id = $1`, tenantB) //nolint:errcheck
		})
		if n := countRows(t, ctx, rolePool, tenantA, `SELECT id FROM "forecast_experiments"`); n != 0 {
			t.Errorf("tenant A saw %d of B's experiments, want 0", n)
		}
		if n := countRows(t, ctx, rolePool, tenantB, `SELECT id FROM "forecast_experiments"`); n != 1 {
			t.Errorf("tenant B saw %d of its experiments, want 1", n)
		}
	})

	t.Run("sick_leave_history and attendance_spans: A never sees B's rows, nor points at B's", func(t *testing.T) {
		cityB, zoneB, svB := newUUIDv4(), newUUIDv4(), newUUIDv4()
		insertRow(t, ctx, owner, tenantB, `INSERT INTO "cities" (tenant_id, id, data_source, name_en) VALUES ($1, '`+cityB+`', 'SYNTHETIC', 'B Sick City')`)
		insertRow(t, ctx, owner, tenantB, `INSERT INTO "zones" (tenant_id, id, data_source, city_id, name_en) VALUES ($1, '`+zoneB+`', 'SYNTHETIC', '`+cityB+`', 'B Sick Zone')`)
		insertRow(t, ctx, owner, tenantB, `INSERT INTO "agents" (tenant_id, id, data_source, code, name_en, kind) VALUES ($1, '`+svB+`', 'SYNTHETIC', 'SVR-B-SICK', 'B Person', 'field')`)
		insertRow(t, ctx, owner, tenantB, `INSERT INTO "sick_leave_history" (tenant_id, data_source, zone_id, month, agents, sick_days)
			VALUES ($1, 'SYNTHETIC', '`+zoneB+`', '2026-08-01', 40, 17)`)
		insertRow(t, ctx, owner, tenantB, `INSERT INTO "attendance_spans" (tenant_id, data_source, agent_id, work_date, started_at, ended_at)
			VALUES ($1, 'SYNTHETIC', '`+svB+`', '2026-09-12', '2026-09-12T06:00:00+03:00', '2026-09-12T14:00:00+03:00')`)
		t.Cleanup(func() {
			owner.Exec(context.Background(), `DELETE FROM "agents" WHERE tenant_id = $1 AND id = $2`, tenantB, svB)   //nolint:errcheck
			owner.Exec(context.Background(), `DELETE FROM "zones" WHERE tenant_id = $1 AND id = $2`, tenantB, zoneB)  //nolint:errcheck
			owner.Exec(context.Background(), `DELETE FROM "cities" WHERE tenant_id = $1 AND id = $2`, tenantB, cityB) //nolint:errcheck
		})
		for _, table := range []string{"sick_leave_history", "attendance_spans"} {
			if n := countRows(t, ctx, rolePool, tenantA, `SELECT id FROM "`+table+`"`); n != 0 {
				t.Errorf("tenant A saw %d of B's %s rows, want 0", n, table)
			}
			if n := countRows(t, ctx, rolePool, tenantB, `SELECT id FROM "`+table+`"`); n != 1 {
				t.Errorf("tenant B saw %d of its %s rows, want 1", n, table)
			}
		}
		if _, err := owner.Exec(ctx, `INSERT INTO "sick_leave_history" (tenant_id, data_source, zone_id, month, agents, sick_days)
			VALUES ($1, 'SYNTHETIC', '`+zoneB+`', '2026-07-01', 1, 0)`, tenantA); err == nil {
			t.Error("a sick-leave row of tenant A pointing at tenant B's zone was accepted")
		}
		if _, err := owner.Exec(ctx, `INSERT INTO "attendance_spans" (tenant_id, data_source, agent_id, work_date, started_at, ended_at)
			VALUES ($1, 'SYNTHETIC', '`+svB+`', '2026-09-12', '2026-09-12T06:00:00+03:00', '2026-09-12T14:00:00+03:00')`, tenantA); err == nil {
			t.Error("an attendance span of tenant A pointing at tenant B's agent was accepted")
		}
	})

	t.Run("case_types: tenant A and B each see only their own row", func(t *testing.T) {
		insertRow(t, ctx, rolePool, tenantA, `INSERT INTO "case_types" (tenant_id, data_source, name_en) VALUES ($1, 'SYNTHETIC', 'A-only case type')`)
		insertRow(t, ctx, rolePool, tenantB, `INSERT INTO "case_types" (tenant_id, data_source, name_en) VALUES ($1, 'SYNTHETIC', 'B-only case type')`)

		namesA := stringColumn(t, ctx, rolePool, tenantA, `SELECT name_en FROM "case_types"`)
		if !equalStrings(namesA, []string{"A-only case type"}) {
			t.Errorf("as A: got %v, want [A-only case type]", namesA)
		}
		namesB := stringColumn(t, ctx, rolePool, tenantB, `SELECT name_en FROM "case_types"`)
		if !equalStrings(namesB, []string{"B-only case type"}) {
			t.Errorf("as B: got %v, want [B-only case type]", namesB)
		}
	})

	t.Run("cities: A can never see B's row, even by id", func(t *testing.T) {
		cityBID := newUUIDv4()
		insertRow(t, ctx, rolePool, tenantB, `INSERT INTO "cities" (tenant_id, id, data_source, name_en) VALUES ($1, '`+cityBID+`', 'SYNTHETIC', 'B City')`)

		n := countRows(t, ctx, rolePool, tenantA, `SELECT id FROM "cities" WHERE id = '`+cityBID+`'`)
		if n != 0 {
			t.Errorf("tenant A saw %d rows of B's city, want 0", n)
		}
		n = countRows(t, ctx, rolePool, tenantB, `SELECT id FROM "cities" WHERE id = '`+cityBID+`'`)
		if n != 1 {
			t.Errorf("tenant B saw %d rows of its own city, want 1", n)
		}
	})

	t.Run("users: A can never see B's row, even by id", func(t *testing.T) {
		userBID := newUUIDv4()
		insertRow(t, ctx, rolePool, tenantB,
			`INSERT INTO "users" (tenant_id, id, data_source, email, display_name, assigned_role, status, preferred_locale)
			 VALUES ($1, '`+userBID+`', 'SYNTHETIC', 'b-only@example.com', 'B Only', 'planner', 'active', 'en')`)

		n := countRows(t, ctx, rolePool, tenantA, `SELECT id FROM "users" WHERE id = '`+userBID+`'`)
		if n != 0 {
			t.Errorf("tenant A saw %d rows of B's user, want 0", n)
		}
		n = countRows(t, ctx, rolePool, tenantB, `SELECT id FROM "users" WHERE id = '`+userBID+`'`)
		if n != 1 {
			t.Errorf("tenant B saw %d rows of its own user, want 1", n)
		}
	})

	t.Run("settings: A and B each read back their own value for the same key", func(t *testing.T) {
		insertRow(t, ctx, rolePool, tenantA, `INSERT INTO "settings" (tenant_id, data_source, key, value) VALUES ($1, 'SYNTHETIC', 'shared.key', 'A value')`)
		insertRow(t, ctx, rolePool, tenantB, `INSERT INTO "settings" (tenant_id, data_source, key, value) VALUES ($1, 'SYNTHETIC', 'shared.key', 'B value')`)

		valuesA := stringColumn(t, ctx, rolePool, tenantA, `SELECT value FROM "settings" WHERE key = 'shared.key'`)
		if !equalStrings(valuesA, []string{"A value"}) {
			t.Errorf("as A: got %v, want [A value]", valuesA)
		}
		valuesB := stringColumn(t, ctx, rolePool, tenantB, `SELECT value FROM "settings" WHERE key = 'shared.key'`)
		if !equalStrings(valuesB, []string{"B value"}) {
			t.Errorf("as B: got %v, want [B value]", valuesB)
		}
	})

	t.Run("holidays: A can never see B's row, even by id", func(t *testing.T) {
		holidayBID := newUUIDv4()
		insertRow(t, ctx, rolePool, tenantB,
			`INSERT INTO "holidays" (tenant_id, id, data_source, name_en, name_ar, start_date, end_date, kind)
			 VALUES ($1, '`+holidayBID+`', 'SYNTHETIC', 'B Holiday', 'B Holiday', '2026-01-01', '2026-01-01', 'public')`)

		n := countRows(t, ctx, rolePool, tenantA, `SELECT id FROM "holidays" WHERE id = '`+holidayBID+`'`)
		if n != 0 {
			t.Errorf("tenant A saw %d rows of B's holiday, want 0", n)
		}
		n = countRows(t, ctx, rolePool, tenantB, `SELECT id FROM "holidays" WHERE id = '`+holidayBID+`'`)
		if n != 1 {
			t.Errorf("tenant B saw %d rows of its own holiday, want 1", n)
		}
	})
}

// catalogCustomerTables: every public table.
func catalogCustomerTables(t *testing.T, ctx context.Context, owner *pgxpool.Pool) []string {
	t.Helper()
	rows, err := owner.Query(ctx, `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
		WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') ORDER BY c.relname`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			t.Fatal(err)
		}
		out = append(out, name)
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	return out
}
