// SPDX-License-Identifier: AGPL-3.0-only

package business

import (
	"context"
	"encoding/json"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
)

// providerBackend keeps the identity providers.
type providerBackend interface {
	all(ctx context.Context, tenant string) ([]IdentityProvider, error)
	one(ctx context.Context, tenant, id string) (*IdentityProvider, error)
	save(ctx context.Context, tenant string, p IdentityProvider) error
	remove(ctx context.Context, tenant, id string) error
}

var providerStoreBackend providerBackend = memoryProviders{}

// UsePostgresIdentityProviders keeps them in Postgres.
func UsePostgresIdentityProviders(conn *tenancy.Connection) {
	providerStoreBackend = pgProviders{conn: conn}
}

// UseMemoryIdentityProviders puts the memory store back.
func UseMemoryIdentityProviders() { providerStoreBackend = memoryProviders{} }

type memoryProviders struct{}

func (memoryProviders) all(context.Context, string) ([]IdentityProvider, error) {
	return allProviderRowsMemory(), nil
}

func (memoryProviders) one(_ context.Context, _, id string) (*IdentityProvider, error) {
	return oneProviderRowMemory(id), nil
}

func (memoryProviders) save(_ context.Context, _ string, p IdentityProvider) error {
	upsertProviderRowMemory(p)
	return nil
}

func (memoryProviders) remove(_ context.Context, _, id string) error {
	removeProviderRowMemory(id)
	return nil
}

type pgProviders struct{ conn *tenancy.Connection }

const providerColumns = `id, preset_id, display_name, protocol, is_enabled, email_domains, config, claim_mapping, has_secret, signed_assertions_required, last_test_at, last_test_ok, data_source, sync_status, last_sync_at, last_sync_error`

func scanProvider(row pgx.Row) (*IdentityProvider, error) {
	var p IdentityProvider
	var domains, config, claims []byte
	var testAt, syncAt *time.Time
	var syncStatus *string
	err := row.Scan(&p.ID, &p.PresetID, &p.DisplayName, &p.Protocol, &p.IsEnabled, &domains, &config, &claims, &p.HasSecret, &p.SignedAssertionsRequired, &testAt, &p.LastTestOk, &p.DataSource,
		&syncStatus, &syncAt, &p.LastSyncError)
	if err != nil {
		return nil, err
	}
	if err := json.Unmarshal(domains, &p.EmailDomains); err != nil {
		return nil, err
	}
	if err := json.Unmarshal(config, &p.Config); err != nil {
		return nil, err
	}
	if err := json.Unmarshal(claims, &p.ClaimMapping); err != nil {
		return nil, err
	}
	p.LastTestAt = nullableTimeToISO(testAt)
	p.LastSyncAt = nullableTimeToISO(syncAt)
	if syncStatus != nil {
		p.SyncStatus = *syncStatus
	}
	return &p, nil
}

func (p pgProviders) all(ctx context.Context, tenant string) ([]IdentityProvider, error) {
	return tenancy.WithTenant(ctx, p.conn.Pool, tenant, func(ctx context.Context, tx pgx.Tx) ([]IdentityProvider, error) {
		rows, err := tx.Query(ctx, `SELECT `+providerColumns+` FROM identity_providers ORDER BY created_at, id`)
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		var out []IdentityProvider
		for rows.Next() {
			row, err := scanProvider(rows)
			if err != nil {
				return nil, err
			}
			out = append(out, *row)
		}
		return out, rows.Err()
	})
}

func (p pgProviders) one(ctx context.Context, tenant, id string) (*IdentityProvider, error) {
	return tenancy.WithTenant(ctx, p.conn.Pool, tenant, func(ctx context.Context, tx pgx.Tx) (*IdentityProvider, error) {
		row, err := scanProvider(tx.QueryRow(ctx, `SELECT `+providerColumns+` FROM identity_providers WHERE id = $1`, id))
		if err == pgx.ErrNoRows {
			return nil, nil
		}
		return row, err
	})
}

func (p pgProviders) save(ctx context.Context, tenant string, v IdentityProvider) error {
	if v.EmailDomains == nil {
		v.EmailDomains = []string{}
	}
	if v.Config == nil {
		v.Config = map[string]string{}
	}
	domains, err := json.Marshal(v.EmailDomains)
	if err != nil {
		return err
	}
	config, err := json.Marshal(v.Config)
	if err != nil {
		return err
	}
	claims, err := json.Marshal(v.ClaimMapping)
	if err != nil {
		return err
	}
	testAt, err := optTime(v.LastTestAt)
	if err != nil {
		return err
	}
	syncAt, err := optTime(v.LastSyncAt)
	if err != nil {
		return err
	}
	var syncStatus *string
	if v.SyncStatus != "" {
		syncStatus = &v.SyncStatus
	}
	_, err = tenancy.WithTenant(ctx, p.conn.Pool, tenant, func(ctx context.Context, tx pgx.Tx) (struct{}, error) {
		_, err := tx.Exec(ctx, `INSERT INTO identity_providers (tenant_id, id, data_source, preset_id, display_name, protocol, is_enabled, email_domains, config, claim_mapping,
				has_secret, signed_assertions_required, last_test_at, last_test_ok, sync_status, last_sync_at, last_sync_error)
			VALUES (current_setting('app.tenant_id')::uuid, $1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9::jsonb, $10, $11, $12, $13, $14, $15, $16)
			ON CONFLICT (tenant_id, id) DO UPDATE SET display_name = EXCLUDED.display_name, is_enabled = EXCLUDED.is_enabled, email_domains = EXCLUDED.email_domains,
				config = EXCLUDED.config, claim_mapping = EXCLUDED.claim_mapping, has_secret = EXCLUDED.has_secret,
				signed_assertions_required = EXCLUDED.signed_assertions_required, last_test_at = EXCLUDED.last_test_at, last_test_ok = EXCLUDED.last_test_ok,
				sync_status = EXCLUDED.sync_status, last_sync_at = EXCLUDED.last_sync_at, last_sync_error = EXCLUDED.last_sync_error, updated_at = now()`,
			v.ID, v.DataSource, v.PresetID, v.DisplayName, v.Protocol, v.IsEnabled, domains, config, claims, v.HasSecret, v.SignedAssertionsRequired, testAt, v.LastTestOk,
			syncStatus, syncAt, v.LastSyncError)
		return struct{}{}, err
	})
	return err
}

func (p pgProviders) remove(ctx context.Context, tenant, id string) error {
	_, err := tenancy.WithTenant(ctx, p.conn.Pool, tenant, func(ctx context.Context, tx pgx.Tx) (struct{}, error) {
		_, err := tx.Exec(ctx, `DELETE FROM identity_providers WHERE id = $1`, id)
		return struct{}{}, err
	})
	return err
}

func saveProvider(ctx context.Context, tenant string, p IdentityProvider) error {
	return providerStoreBackend.save(ctx, tenant, p)
}

// ReseedIdentityForTest empties the providers table.
func ReseedIdentityForTest(ctx context.Context, owner *tenancy.Connection) error {
	if _, isPg := providerStoreBackend.(pgProviders); !isPg {
		return nil
	}
	_, err := owner.Pool.Exec(ctx, `DELETE FROM identity_providers`)
	return err
}
