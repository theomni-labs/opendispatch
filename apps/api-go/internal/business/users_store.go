// SPDX-License-Identifier: AGPL-3.0-only

package business

import (
	"context"
	"errors"
	"log"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/access"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/dataerr"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/fixtures"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
)

// userStore holds users: memory by default (unit tests), Postgres in the api.
type userStore interface {
	all(ctx context.Context, tenantID string) ([]User, error)
	upsert(ctx context.Context, u User) error
}

var userBackend userStore = memoryUsers{}

// UsePostgresUsers moves users into the users table.
func UsePostgresUsers(conn *tenancy.Connection) { userBackend = pgUsers{conn: conn} }

// UseMemoryUsers puts the in-memory store back (tests).
func UseMemoryUsers() { userBackend = memoryUsers{} }

func allUsers(ctx context.Context, tenantID string) ([]User, error) {
	return userBackend.all(ctx, tenantID)
}

func oneUser(ctx context.Context, tenantID, id string) (*User, error) {
	rows, err := allUsers(ctx, tenantID)
	if err != nil {
		return nil, err
	}
	for _, u := range rows {
		if u.ID == id {
			return &u, nil
		}
	}
	return nil, nil
}

func saveUser(ctx context.Context, u User) error {
	return userBackend.upsert(ctx, u)
}

type memoryUsers struct{}

func (memoryUsers) all(_ context.Context, _ string) ([]User, error) {
	usersMu.Lock()
	out := make([]User, len(usersStore))
	copy(out, usersStore)
	usersMu.Unlock()
	return out, nil
}

func (memoryUsers) upsert(_ context.Context, u User) error {
	usersMu.Lock()
	defer usersMu.Unlock()
	for i, x := range usersStore {
		if x.ID == u.ID {
			usersStore[i] = u
			return nil
		}
	}
	usersStore = append(usersStore, u)
	return nil
}

type pgUsers struct{ conn *tenancy.Connection }

const userColumns = `id::text, tenant_id::text, created_at, updated_at, created_by::text, data_source, keycloak_subject, email,
	display_name, assigned_role, zone_ids::text[], status, is_emergency_admin, last_sign_in_at, preferred_locale`

func (p pgUsers) all(ctx context.Context, tenantID string) ([]User, error) {
	return tenancy.WithTenant(ctx, p.conn.Pool, tenantID, func(ctx context.Context, tx pgx.Tx) ([]User, error) {
		rows, err := tx.Query(ctx, `SELECT `+userColumns+` FROM users ORDER BY created_at, id`)
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		var out []User
		for rows.Next() {
			var u User
			var created, updated time.Time
			var lastSignIn *time.Time
			var role string
			if err := rows.Scan(&u.ID, &u.TenantID, &created, &updated, &u.CreatedBy, &u.DataSource, &u.KeycloakSubject, &u.Email,
				&u.DisplayName, &role, &u.ZoneIDs, &u.Status, &u.IsEmergencyAdmin, &lastSignIn, &u.PreferredLocale); err != nil {
				return nil, err
			}
			u.AssignedRole = access.Role(role)
			u.CreatedAt, u.UpdatedAt = created.UTC().Format(time.RFC3339Nano), updated.UTC().Format(time.RFC3339Nano)
			if lastSignIn != nil {
				s := lastSignIn.UTC().Format(time.RFC3339Nano)
				u.LastSignInAt = &s
			}
			if u.ZoneIDs == nil {
				u.ZoneIDs = []string{}
			}
			out = append(out, u)
		}
		return out, rows.Err()
	})
}

func (p pgUsers) upsert(ctx context.Context, u User) error {
	zones := u.ZoneIDs
	if zones == nil {
		zones = []string{}
	}
	_, err := tenancy.WithTenant(ctx, p.conn.Pool, u.TenantID, func(ctx context.Context, tx pgx.Tx) (struct{}, error) {
		_, err := tx.Exec(ctx, `INSERT INTO users (tenant_id, id, data_source, created_at, updated_at, created_by, keycloak_subject, email,
			display_name, assigned_role, zone_ids, status, is_emergency_admin, last_sign_in_at, preferred_locale)
			VALUES ($1, $2, $3, $4::timestamptz, $5::timestamptz, $6, $7, $8, $9, $10, $11::uuid[], $12, $13, $14::timestamptz, $15)
			ON CONFLICT (tenant_id, id) DO UPDATE SET updated_at = EXCLUDED.updated_at, keycloak_subject = EXCLUDED.keycloak_subject,
			  email = EXCLUDED.email, display_name = EXCLUDED.display_name, assigned_role = EXCLUDED.assigned_role, zone_ids = EXCLUDED.zone_ids,
			  status = EXCLUDED.status, is_emergency_admin = EXCLUDED.is_emergency_admin, last_sign_in_at = EXCLUDED.last_sign_in_at,
			  preferred_locale = EXCLUDED.preferred_locale`,
			u.TenantID, u.ID, u.DataSource, u.CreatedAt, u.UpdatedAt, u.CreatedBy, u.KeycloakSubject, u.Email,
			u.DisplayName, string(u.AssignedRole), zones, u.Status, u.IsEmergencyAdmin, u.LastSignInAt, u.PreferredLocale)
		return struct{}{}, err
	})
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "23505" {
		return dataerr.Conflict("A user with " + u.Email + " already exists.")
	}
	return err
}

// ambientTenant: the demo install's tenant, for code that runs without a request.
func ambientTenant() string {
	id, err := fixtures.TenantID()
	if err != nil {
		log.Printf("users: no demo tenant: %v", err)
	}
	return id
}

// usersOrLog: for spots that cannot return an error (a cosmetic name, a state seed); a failure is logged, never hidden.
func usersOrLog(ctx context.Context, tenantID string) []User {
	rows, err := allUsers(ctx, tenantID)
	if err != nil {
		log.Printf("users: read failed: %v", err)
		return nil
	}
	return rows
}

// ReseedUsersForTest puts the users table back to the fixtures (test routes only, owner connection).
func ReseedUsersForTest(ctx context.Context, owner *tenancy.Connection) error {
	rows, err := fixtures.Records[User]("User")
	if err != nil {
		return err
	}
	ids := make([]string, 0, len(rows))
	seed := pgUsers{conn: owner}
	for i, u := range rows {
		ids = append(ids, u.ID)
		u.CreatedAt = nudgedCreatedAt(u.CreatedAt, i)
		if err := seed.upsert(ctx, u); err != nil {
			return err
		}
	}
	tx, err := owner.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx) //nolint:errcheck // no-op once committed
	if _, err := tx.Exec(ctx, `SET LOCAL session_replication_role = replica`); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `DELETE FROM users WHERE id <> ALL($1::uuid[])`, ids); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// TestResetDB clears database-backed state that ResetAllState cannot; set by main, called by test routes only.
var TestResetDB func(ctx context.Context) error

// TestResetMasterDB puts master data (locations, people, shifts) back to the fixtures; test routes only.
var TestResetMasterDB func(ctx context.Context) error
