// SPDX-License-Identifier: AGPL-3.0-only

package business

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/fixtures"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
)

// integrationBackend keeps integrations.
type integrationBackend interface {
	integrations(ctx context.Context, tenant string) ([]Integration, error)
	save(ctx context.Context, tenant string, i Integration) error
}

var integrationData integrationBackend = memoryIntegrations{}

// UsePostgresIntegrations: Postgres store.
func UsePostgresIntegrations(conn *tenancy.Connection) { integrationData = pgIntegrations{conn: conn} }

// UseMemoryIntegrations: memory store (tests).
func UseMemoryIntegrations() { integrationData = memoryIntegrations{} }

func allIntegrations(ctx context.Context, tenant string) ([]Integration, error) {
	return integrationData.integrations(ctx, tenant)
}

func saveIntegration(ctx context.Context, tenant string, i Integration) error {
	return integrationData.save(ctx, tenant, i)
}

type memoryIntegrations struct{}

func (memoryIntegrations) integrations(context.Context, string) ([]Integration, error) {
	return allIntegrationsMemory(), nil
}

func (memoryIntegrations) save(_ context.Context, _ string, i Integration) error {
	UpsertIntegrationForTest(i)
	return nil
}

type pgIntegrations struct{ conn *tenancy.Connection }

func (p pgIntegrations) integrations(ctx context.Context, tenant string) ([]Integration, error) {
	return tenancy.WithTenant(ctx, p.conn.Pool, tenant, func(ctx context.Context, tx pgx.Tx) ([]Integration, error) {
		rows, err := tx.Query(ctx, `SELECT id::text, tenant_id::text, data_source, created_at, updated_at, created_by::text, kind, name_en, direction, is_enabled,
			endpoint_label, credential_ref, health, last_success_at, last_error_at, last_error_message, fallback_timeout_seconds FROM integrations ORDER BY created_at, id`)
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		var out []Integration
		for rows.Next() {
			var i Integration
			var created, updated time.Time
			var okAt, errAt *time.Time
			var timeout *int32
			if err := rows.Scan(&i.ID, &i.TenantID, &i.DataSource, &created, &updated, &i.CreatedBy, &i.Kind, &i.NameEn, &i.Direction, &i.IsEnabled,
				&i.EndpointLabel, &i.CredentialRef, &i.Health, &okAt, &errAt, &i.LastErrorMessage, &timeout); err != nil {
				return nil, err
			}
			i.CreatedAt, i.UpdatedAt = datactx.ToRiyadhISO(created), datactx.ToRiyadhISO(updated)
			i.LastSuccessAt, i.LastErrorAt = nullableTimeToISO(okAt), nullableTimeToISO(errAt)
			if timeout != nil {
				v := int(*timeout)
				i.FallbackTimeoutSeconds = &v
			}
			out = append(out, i)
		}
		return out, rows.Err()
	})
}

func (p pgIntegrations) save(ctx context.Context, tenant string, i Integration) error {
	created, err := parseTime(i.CreatedAt)
	if err != nil {
		return err
	}
	updated, err := parseTime(i.UpdatedAt)
	if err != nil {
		return err
	}
	okAt, err := optTime(i.LastSuccessAt)
	if err != nil {
		return err
	}
	errAt, err := optTime(i.LastErrorAt)
	if err != nil {
		return err
	}
	_, err = tenancy.WithTenant(ctx, p.conn.Pool, tenant, func(ctx context.Context, tx pgx.Tx) (struct{}, error) {
		_, err := tx.Exec(ctx, `INSERT INTO integrations (tenant_id, id, data_source, created_at, updated_at, created_by, kind, name_en, direction, is_enabled, endpoint_label,
				credential_ref, health, last_success_at, last_error_at, last_error_message, fallback_timeout_seconds)
			VALUES (current_setting('app.tenant_id')::uuid, $1::uuid, $2, $3, $4, $5::uuid, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
			ON CONFLICT (tenant_id, id) DO UPDATE SET updated_at = EXCLUDED.updated_at, kind = EXCLUDED.kind, name_en = EXCLUDED.name_en, direction = EXCLUDED.direction,
				is_enabled = EXCLUDED.is_enabled, endpoint_label = EXCLUDED.endpoint_label, credential_ref = EXCLUDED.credential_ref, health = EXCLUDED.health,
				last_success_at = EXCLUDED.last_success_at, last_error_at = EXCLUDED.last_error_at, last_error_message = EXCLUDED.last_error_message,
				fallback_timeout_seconds = EXCLUDED.fallback_timeout_seconds`,
			i.ID, i.DataSource, created, updated, i.CreatedBy, i.Kind, i.NameEn, i.Direction, i.IsEnabled, i.EndpointLabel, i.CredentialRef, i.Health,
			okAt, errAt, i.LastErrorMessage, i.FallbackTimeoutSeconds)
		return struct{}{}, err
	})
	return err
}

// ReseedIntegrationsForTest: fixtures, owner.
func ReseedIntegrationsForTest(ctx context.Context, owner *tenancy.Connection) error {
	if _, isPg := integrationData.(pgIntegrations); !isPg {
		return nil
	}
	if _, err := owner.Pool.Exec(ctx, `DELETE FROM integrations`); err != nil {
		return err
	}
	rows, err := fixtures.Records[Integration]("Integration")
	if err != nil {
		return err
	}
	tenant, err := fixtures.TenantID()
	if err != nil {
		return err
	}
	seed := pgIntegrations{conn: owner}
	for idx, i := range rows {
		i.CreatedAt = nudgedCreatedAt(i.CreatedAt, idx)
		if err := seed.save(ctx, tenant, i); err != nil {
			return err
		}
	}
	return nil
}
