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

// scenarioBackend keeps what-if scenarios.
type scenarioBackend interface {
	all(ctx context.Context, tenant string) ([]Scenario, error)
	save(ctx context.Context, tenant string, s Scenario) error
	remove(ctx context.Context, tenant, id string) error
}

var scenarioStoreBackend scenarioBackend = memoryScenarios{}

// UsePostgresScenarios keeps scenarios in Postgres.
func UsePostgresScenarios(conn *tenancy.Connection) { scenarioStoreBackend = pgScenarios{conn: conn} }

// UseMemoryScenarios puts the in-memory store back (tests).
func UseMemoryScenarios() { scenarioStoreBackend = memoryScenarios{} }

type memoryScenarios struct{}

func (memoryScenarios) all(context.Context, string) ([]Scenario, error) {
	return allScenarioRowsMemory(), nil
}

func (memoryScenarios) save(_ context.Context, _ string, s Scenario) error {
	upsertScenarioRowMemory(s)
	return nil
}

func (memoryScenarios) remove(_ context.Context, _, id string) error {
	removeScenarioRowMemory(id)
	return nil
}

type pgScenarios struct{ conn *tenancy.Connection }

const scenarioColumns = `id::text, tenant_id::text, data_source, created_at, updated_at, created_by::text, name, to_char(base_date, 'YYYY-MM-DD'), zone_ids::text[], adjustments, status, last_run_at`

func (p pgScenarios) all(ctx context.Context, tenant string) ([]Scenario, error) {
	return tenancy.WithTenant(ctx, p.conn.Pool, tenant, func(ctx context.Context, tx pgx.Tx) ([]Scenario, error) {
		rows, err := tx.Query(ctx, `SELECT `+scenarioColumns+` FROM scenarios ORDER BY created_at, id`)
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		var out []Scenario
		for rows.Next() {
			var s Scenario
			var created, updated time.Time
			var lastRun *time.Time
			var adj []byte
			if err := rows.Scan(&s.ID, &s.TenantID, &s.DataSource, &created, &updated, &s.CreatedBy, &s.Name, &s.BaseDate, &s.ZoneIDs, &adj, &s.Status, &lastRun); err != nil {
				return nil, err
			}
			s.CreatedAt, s.UpdatedAt = datactx.ToRiyadhISO(created), datactx.ToRiyadhISO(updated)
			s.LastRunAt = nullableTimeToISO(lastRun)
			if err := json.Unmarshal(adj, &s.Adjustments); err != nil {
				return nil, err
			}
			out = append(out, s)
		}
		return out, rows.Err()
	})
}

func saveScenarioTx(ctx context.Context, tx pgx.Tx, s Scenario) error {
	created, err := optTime(nullableUUID(s.CreatedAt))
	if err != nil {
		return err
	}
	updated, err := optTime(nullableUUID(s.UpdatedAt))
	if err != nil {
		return err
	}
	lastRun, err := optTime(s.LastRunAt)
	if err != nil {
		return err
	}
	adj, err := json.Marshal(s.Adjustments)
	if err != nil {
		return err
	}
	zones := s.ZoneIDs
	if zones == nil {
		zones = []string{}
	}
	_, err = tx.Exec(ctx, `INSERT INTO scenarios (tenant_id, id, data_source, created_at, updated_at, created_by, name, base_date, zone_ids, adjustments, status, last_run_at)
		VALUES (current_setting('app.tenant_id')::uuid, $1::uuid, $2, COALESCE($3, now()), COALESCE($4, now()), $5::uuid, $6, $7::date, $8::uuid[], $9::jsonb, $10, $11)
		ON CONFLICT (tenant_id, id) DO UPDATE SET name = EXCLUDED.name, base_date = EXCLUDED.base_date, zone_ids = EXCLUDED.zone_ids,
			adjustments = EXCLUDED.adjustments, status = EXCLUDED.status, last_run_at = EXCLUDED.last_run_at, updated_at = EXCLUDED.updated_at`,
		s.ID, s.DataSource, created, updated, s.CreatedBy, s.Name, s.BaseDate, zones, adj, s.Status, lastRun)
	return err
}

func (p pgScenarios) save(ctx context.Context, tenant string, s Scenario) error {
	_, err := tenancy.WithTenant(ctx, p.conn.Pool, tenant, func(ctx context.Context, tx pgx.Tx) (struct{}, error) {
		return struct{}{}, saveScenarioTx(ctx, tx, s)
	})
	return err
}

func (p pgScenarios) remove(ctx context.Context, tenant, id string) error {
	_, err := tenancy.WithTenant(ctx, p.conn.Pool, tenant, func(ctx context.Context, tx pgx.Tx) (struct{}, error) {
		_, err := tx.Exec(ctx, `DELETE FROM scenarios WHERE id = $1::uuid`, id)
		return struct{}{}, err
	})
	return err
}

func loadScenarios(ctx context.Context, tenant string) ([]Scenario, error) {
	return scenarioStoreBackend.all(ctx, tenant)
}

func loadScenario(ctx context.Context, tenant, id string) (*Scenario, error) {
	all, err := scenarioStoreBackend.all(ctx, tenant)
	if err != nil {
		return nil, err
	}
	for _, s := range all {
		if s.ID == id {
			row := s
			return &row, nil
		}
	}
	return nil, nil
}

func saveScenario(ctx context.Context, tenant string, s Scenario) error {
	return scenarioStoreBackend.save(ctx, tenant, s)
}

func deleteScenario(ctx context.Context, tenant, id string) error {
	return scenarioStoreBackend.remove(ctx, tenant, id)
}

// ReseedScenariosForTest puts the scenarios table back to the fixtures (owner connection).
func ReseedScenariosForTest(ctx context.Context, owner *tenancy.Connection) error {
	if _, isPg := scenarioStoreBackend.(pgScenarios); !isPg {
		return nil
	}
	for _, q := range []string{`DELETE FROM simulation_results`, `DELETE FROM simulation_runs`, `DELETE FROM scenarios`} {
		if _, err := owner.Pool.Exec(ctx, q); err != nil {
			return err
		}
	}
	rows, err := fixtures.Records[Scenario]("Scenario")
	if err != nil {
		return err
	}
	tenant, err := fixtures.TenantID()
	if err != nil {
		return err
	}
	seed := pgScenarios{conn: owner}
	for _, s := range rows {
		if err := seed.save(ctx, tenant, s); err != nil {
			return err
		}
	}
	return nil
}
