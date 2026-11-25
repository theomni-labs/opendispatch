// SPDX-License-Identifier: AGPL-3.0-only

// Mirrors with-tenant.live.test.ts.
package tenancy

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
)

func TestWithTenant_LivePostgres(t *testing.T) {
	ownerURL := liveTestDatabaseURL()
	if ownerURL == "" {
		t.Skip(noLiveDBReason)
	}
	ctx := context.Background()
	owner := openLiveTestPool(t, 3)

	now := time.Now().UnixNano()
	schema := fmt.Sprintf("with_tenant_live_%d", now)
	roleName := fmt.Sprintf("with_tenant_role_%d", now)
	rolePassword := newUUIDv4()
	tenantA := newUUIDv4()
	tenantB := newUUIDv4()

	// Non-superuser: superuser bypasses FORCE RLS.
	mustExec(t, ctx, owner, fmt.Sprintf(`CREATE ROLE %s LOGIN PASSWORD '%s' NOSUPERUSER NOBYPASSRLS`, roleName, rolePassword))
	mustExec(t, ctx, owner, `CREATE SCHEMA `+schema)
	mustExec(t, ctx, owner, fmt.Sprintf(`
		CREATE TABLE %s.widgets (
			tenant_id uuid NOT NULL,
			id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
			name text NOT NULL
		);
		GRANT USAGE ON SCHEMA %s TO %s;
		GRANT SELECT, INSERT ON %s.widgets TO %s;
	`, schema, schema, roleName, schema, roleName))
	isoSQL, err := TenantIsolationSQL(schema + ".widgets")
	if err != nil {
		t.Fatalf("TenantIsolationSQL: %v", err)
	}
	mustExec(t, ctx, owner, isoSQL)
	mustExec(t, ctx, owner, fmt.Sprintf(`INSERT INTO %s.widgets (tenant_id, name) VALUES ($1, 'a-widget'), ($2, 'b-widget')`, schema), tenantA, tenantB)

	roleURL := withCredentials(t, ownerURL, roleName, rolePassword)
	rolePool := openTestPoolAt(t, roleURL, 3)
	bareRolePool := openTestPoolAt(t, roleURL, 1)

	t.Cleanup(func() {
		bg := context.Background()
		owner.Exec(bg, `DROP SCHEMA IF EXISTS `+schema+` CASCADE`) //nolint:errcheck
		owner.Exec(bg, `DROP ROLE IF EXISTS `+roleName)            //nolint:errcheck
	})

	t.Run("fails closed: a bare query with no tenant set raises", func(t *testing.T) {
		err := drainErr(ctx, bareRolePool, `SELECT * FROM `+schema+`.widgets`)
		if err == nil {
			t.Fatal("want an error, got none — RLS must have let a bare query through")
		}
		msg := strings.ToLower(err.Error())
		if !strings.Contains(msg, "unrecognized configuration parameter") && !strings.Contains(msg, "app.tenant_id") {
			t.Fatalf("got %v, want an unrecognized-GUC error", err)
		}
	})

	t.Run("withTenant(tenantA) sees only tenant A's rows", func(t *testing.T) {
		names, err := WithTenant(ctx, rolePool, tenantA, func(ctx context.Context, tx pgx.Tx) ([]string, error) {
			return queryNames(ctx, tx, schema)
		})
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if !equalStrings(names, []string{"a-widget"}) {
			t.Errorf("got %v, want [a-widget]", names)
		}
	})

	t.Run("withTenant(tenantB) sees only tenant B's rows", func(t *testing.T) {
		names, err := WithTenant(ctx, rolePool, tenantB, func(ctx context.Context, tx pgx.Tx) ([]string, error) {
			return queryNames(ctx, tx, schema)
		})
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if !equalStrings(names, []string{"b-widget"}) {
			t.Errorf("got %v, want [b-widget]", names)
		}
	})

	t.Run("SET LOCAL does not survive past the transaction on a pooled connection", func(t *testing.T) {
		single := openTestPoolAt(t, roleURL, 1)

		tx, err := single.Begin(ctx)
		if err != nil {
			t.Fatalf("begin: %v", err)
		}
		if _, err := tx.Exec(ctx, `SELECT set_config('app.tenant_id', $1, true)`, tenantA); err != nil {
			t.Fatalf("set_config: %v", err)
		}
		rows, err := tx.Query(ctx, `SELECT name FROM `+schema+`.widgets`)
		if err != nil {
			t.Fatalf("query inside tx: %v", err)
		}
		var n int
		for rows.Next() {
			n++
		}
		rows.Close()
		if n != 1 {
			t.Fatalf("got %d rows inside the transaction, want 1", n)
		}
		if err := tx.Commit(ctx); err != nil {
			t.Fatalf("commit: %v", err)
		}

		// Reused conn: GUC reset; uuid cast fails on ''.
		err = drainErr(ctx, single, `SELECT * FROM `+schema+`.widgets`)
		if err == nil {
			t.Fatal("want an error: SET LOCAL must not have survived the transaction")
		}
		if !strings.Contains(strings.ToLower(err.Error()), "invalid input syntax for type uuid") {
			t.Fatalf("got %v, want an invalid-uuid error", err)
		}
	})

	t.Run("rejects a non-uuid tenant id before ever opening a transaction", func(t *testing.T) {
		_, err := WithTenant(ctx, rolePool, "not-a-uuid", func(ctx context.Context, tx pgx.Tx) (string, error) {
			return "never", nil
		})
		var missing *MissingTenantError
		if !errors.As(err, &missing) {
			t.Fatalf("got %v, want *MissingTenantError", err)
		}
	})
}
