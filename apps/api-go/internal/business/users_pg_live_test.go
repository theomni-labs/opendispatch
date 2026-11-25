// SPDX-License-Identifier: AGPL-3.0-only

// Live: users in Postgres.
package business

import (
	"context"
	"testing"

	"github.com/jackc/pgx/v5"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/dataerr"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/reqctx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
)

func usePgUsers(t *testing.T) *tenancy.Connection {
	t.Helper()
	conn := openConn(t)
	UsePostgresUsers(conn)
	t.Cleanup(UseMemoryUsers)
	return conn
}

func newUserIn(t *testing.T, conn *tenancy.Connection, rc reqctx.RequestContext, email, role string) User {
	t.Helper()
	u, err := CreateUser(context.Background(), conn, rc, map[string]any{"email": email, "display_name": email, "assigned_role": role, "zone_ids": []any{}})
	check(t, err)
	return u
}

func TestUsersPg_LifecycleAndLastAdminGuard(t *testing.T) {
	conn := usePgUsers(t)
	rc, _ := adminCtx(t)
	ctx := context.Background()

	first := newUserIn(t, conn, rc, "first@example.com", "administrator")
	second := newUserIn(t, conn, rc, "second@example.com", "administrator")
	if first.Status != "invited" || first.TenantID != rc.CustomerID {
		t.Fatalf("got %+v", first)
	}

	dup, err := CreateUser(ctx, conn, rc, map[string]any{"email": "FIRST@example.com", "display_name": "Dup", "assigned_role": "administrator", "zone_ids": []any{}})
	if errCode(err) != dataerr.CodeConflict {
		t.Fatalf("duplicate email: got %v %v, want Conflict", dup, err)
	}

	disabled, err := DisableUser(rc, second.ID)
	check(t, err)
	if disabled.Status != "disabled" {
		t.Fatalf("got %q", disabled.Status)
	}
	if _, err := DisableUser(rc, first.ID); errCode(err) != dataerr.CodeConflict {
		t.Fatalf("the last active administrator must not be disabled: got %v", err)
	}
	enabled, err := EnableUser(rc, second.ID)
	check(t, err)
	if enabled.Status != "invited" {
		t.Fatalf("never signed in: got %q, want invited", enabled.Status)
	}

	renamed, err := UpdateUser(ctx, conn, rc, first.ID, map[string]any{"display_name": "First Renamed", "assigned_role": "administrator", "zone_ids": []any{}})
	check(t, err)
	got, err := GetUser(rc, first.ID)
	check(t, err)
	if got.DisplayName != "First Renamed" || renamed.DisplayName != got.DisplayName {
		t.Fatalf("got %+v", got)
	}
}

func TestUsersPg_ZoneScopedRoleKeepsItsZones(t *testing.T) {
	conn := usePgUsers(t)
	rc, _ := adminCtx(t)
	ctx := context.Background()
	city, err := CreateCity(ctx, conn, rc, map[string]any{"case_code": "RD", "name_en": "Riyadh"})
	check(t, err)
	zone, err := CreateZone(ctx, conn, rc, map[string]any{"city_id": city.ID, "name_en": "Riyadh Central"})
	check(t, err)
	created, err := CreateUser(ctx, conn, rc, map[string]any{"email": "planner@example.com", "display_name": "Planner", "assigned_role": "planner", "zone_ids": []any{zone.ID}})
	check(t, err)
	read, err := GetUser(rc, created.ID)
	check(t, err)
	if len(read.ZoneIDs) != 1 || read.ZoneIDs[0] != zone.ID {
		t.Fatalf("got zones %v, want [%s]", read.ZoneIDs, zone.ID)
	}
}

func TestUsersPg_TenantsNeverSeeEachOther(t *testing.T) {
	conn := usePgUsers(t)
	a, _ := adminCtx(t)
	b, _ := adminCtx(t)
	ua := newUserIn(t, conn, a, "same@example.com", "administrator")
	ub := newUserIn(t, conn, b, "same@example.com", "administrator") // the same email in another tenant is allowed
	if ua.ID == ub.ID {
		t.Fatal("ids must differ")
	}
	pageA, err := ListUsers(a, ListUsersQuery{})
	check(t, err)
	if len(pageA.Items) != 1 || pageA.Items[0].ID != ua.ID {
		t.Fatalf("tenant A sees %+v", pageA.Items)
	}
	if _, err := GetUser(a, ub.ID); errCode(err) != dataerr.CodeNotFound {
		t.Fatalf("a user of another tenant must be NotFound, got %v", err)
	}
}

func TestUsersPg_RowsAreReallyInThePostgresTable(t *testing.T) {
	conn := usePgUsers(t)
	rc, tenant := adminCtx(t)
	newUserIn(t, conn, rc, "row@example.com", "administrator")
	n, err := tenancy.WithTenant(context.Background(), conn.Pool, tenant, func(ctx context.Context, tx pgx.Tx) (int, error) {
		var n int
		return n, tx.QueryRow(ctx, `SELECT count(*) FROM users WHERE email = 'row@example.com'`).Scan(&n)
	})
	check(t, err)
	if n != 1 {
		t.Fatalf("want 1 row in users, got %d", n)
	}
	var none int
	if conn.Pool.QueryRow(context.Background(), `SELECT count(*) FROM users`).Scan(&none) == nil {
		t.Fatal("a query with no tenant set must fail")
	}
}
