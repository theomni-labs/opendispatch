// SPDX-License-Identifier: AGPL-3.0-only

package business

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/access"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/fixtures"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
)

// roleMappingBackend holds the group-to-role rules: memory by default (unit tests), Postgres in the api.
type roleMappingBackend interface {
	all(ctx context.Context, tenantID string) ([]RoleMapping, error)
	upsert(ctx context.Context, m RoleMapping) error
	remove(ctx context.Context, tenantID, id string) error
}

var roleMappings roleMappingBackend = memoryRoleMappings{}

// UsePostgresRoleMappings moves the group rules into the role_mappings table.
func UsePostgresRoleMappings(conn *tenancy.Connection) { roleMappings = pgRoleMappings{conn: conn} }

// UseMemoryRoleMappings puts the in-memory store back (tests).
func UseMemoryRoleMappings() { roleMappings = memoryRoleMappings{} }

func allRoleMappings(ctx context.Context, tenantID string) ([]RoleMapping, error) {
	return roleMappings.all(ctx, tenantID)
}

func oneRoleMapping(ctx context.Context, tenantID, id string) (*RoleMapping, error) {
	rows, err := allRoleMappings(ctx, tenantID)
	if err != nil {
		return nil, err
	}
	for _, m := range rows {
		if m.ID == id {
			row := m
			return &row, nil
		}
	}
	return nil, nil
}

func saveRoleMapping(ctx context.Context, m RoleMapping) error { return roleMappings.upsert(ctx, m) }

func deleteRoleMapping(ctx context.Context, tenantID, id string) error {
	return roleMappings.remove(ctx, tenantID, id)
}

type memoryRoleMappings struct{}

func (memoryRoleMappings) all(_ context.Context, _ string) ([]RoleMapping, error) {
	identityMu.Lock()
	seedRoleMappingsLocked()
	out := make([]RoleMapping, len(roleMappingStore))
	copy(out, roleMappingStore)
	identityMu.Unlock()
	return out, nil
}

func (memoryRoleMappings) upsert(_ context.Context, m RoleMapping) error {
	identityMu.Lock()
	defer identityMu.Unlock()
	seedRoleMappingsLocked()
	for i, x := range roleMappingStore {
		if x.ID == m.ID {
			roleMappingStore[i] = m
			return nil
		}
	}
	roleMappingStore = append(roleMappingStore, m)
	return nil
}

func (memoryRoleMappings) remove(_ context.Context, _, id string) error {
	identityMu.Lock()
	defer identityMu.Unlock()
	seedRoleMappingsLocked()
	for i, x := range roleMappingStore {
		if x.ID == id {
			roleMappingStore = append(roleMappingStore[:i], roleMappingStore[i+1:]...)
			return nil
		}
	}
	return nil
}

type pgRoleMappings struct{ conn *tenancy.Connection }

func (p pgRoleMappings) all(ctx context.Context, tenantID string) ([]RoleMapping, error) {
	return tenancy.WithTenant(ctx, p.conn.Pool, tenantID, func(ctx context.Context, tx pgx.Tx) ([]RoleMapping, error) {
		rows, err := tx.Query(ctx, `SELECT id::text, tenant_id::text, created_at, updated_at, created_by::text, data_source, identity_provider_id,
			group_match, group_match_type, assigned_role, zone_ids::text[], priority, is_enabled FROM role_mappings ORDER BY priority, id`)
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		var out []RoleMapping
		for rows.Next() {
			var m RoleMapping
			var created, updated time.Time
			var role string
			if err := rows.Scan(&m.ID, &m.TenantID, &created, &updated, &m.CreatedBy, &m.DataSource, &m.IdentityProviderID,
				&m.GroupMatch, &m.GroupMatchType, &role, &m.ZoneIDs, &m.Priority, &m.IsEnabled); err != nil {
				return nil, err
			}
			m.AssignedRole = access.Role(role)
			m.CreatedAt, m.UpdatedAt = isoOf(created), isoOf(updated)
			if m.ZoneIDs == nil {
				m.ZoneIDs = []string{}
			}
			out = append(out, m)
		}
		return out, rows.Err()
	})
}

func (p pgRoleMappings) upsert(ctx context.Context, m RoleMapping) error {
	zones := m.ZoneIDs
	if zones == nil {
		zones = []string{}
	}
	_, err := tenancy.WithTenant(ctx, p.conn.Pool, m.TenantID, func(ctx context.Context, tx pgx.Tx) (struct{}, error) {
		_, err := tx.Exec(ctx, `INSERT INTO role_mappings (tenant_id, id, data_source, created_at, updated_at, created_by, identity_provider_id,
			group_match, group_match_type, assigned_role, zone_ids, priority, is_enabled)
			VALUES ($1, $2, $3, $4::timestamptz, $5::timestamptz, $6, $7, $8, $9, $10, $11::uuid[], $12, $13)
			ON CONFLICT (tenant_id, id) DO UPDATE SET updated_at = EXCLUDED.updated_at, identity_provider_id = EXCLUDED.identity_provider_id,
			  group_match = EXCLUDED.group_match, group_match_type = EXCLUDED.group_match_type, assigned_role = EXCLUDED.assigned_role,
			  zone_ids = EXCLUDED.zone_ids, priority = EXCLUDED.priority, is_enabled = EXCLUDED.is_enabled`,
			m.TenantID, m.ID, m.DataSource, m.CreatedAt, m.UpdatedAt, uuidOrNil(m.CreatedBy), m.IdentityProviderID,
			m.GroupMatch, m.GroupMatchType, string(m.AssignedRole), zones, m.Priority, m.IsEnabled)
		return struct{}{}, err
	})
	return err
}

func (p pgRoleMappings) remove(ctx context.Context, tenantID, id string) error {
	_, err := tenancy.WithTenant(ctx, p.conn.Pool, tenantID, func(ctx context.Context, tx pgx.Tx) (struct{}, error) {
		_, err := tx.Exec(ctx, `DELETE FROM role_mappings WHERE id = $1`, id)
		return struct{}{}, err
	})
	return err
}

// ReseedRoleMappingsForTest puts the group rules back to the fixtures (test routes only, owner connection).
func ReseedRoleMappingsForTest(ctx context.Context, owner *tenancy.Connection) error {
	rows, err := fixtures.Records[RoleMapping]("RoleMapping")
	if err != nil {
		return err
	}
	tx, err := owner.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx) //nolint:errcheck // no-op once committed
	if _, err := tx.Exec(ctx, `DELETE FROM role_mappings`); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return err
	}
	seed := pgRoleMappings{conn: owner}
	for i, m := range rows {
		m.CreatedAt = nudgedCreatedAt(m.CreatedAt, i)
		if err := seed.upsert(ctx, m); err != nil {
			return err
		}
	}
	return nil
}
