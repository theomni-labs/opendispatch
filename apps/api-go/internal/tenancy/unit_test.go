// SPDX-License-Identifier: AGPL-3.0-only

package tenancy

import (
	"context"
	"errors"
	"fmt"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
)

func TestUnit_LivePostgres(t *testing.T) {
	ownerURL := liveTestDatabaseURL()
	if ownerURL == "" {
		t.Skip(noLiveDBReason)
	}
	ctx := context.Background()
	owner := openLiveTestPool(t, 3)
	now := time.Now().UnixNano()
	schema := fmt.Sprintf("unit_live_%d", now)
	roleName := fmt.Sprintf("unit_role_%d", now)
	rolePassword := newUUIDv4()
	tenantA, tenantB := newUUIDv4(), newUUIDv4()
	mustExec(t, ctx, owner, fmt.Sprintf(`CREATE ROLE %s LOGIN PASSWORD '%s' NOSUPERUSER NOBYPASSRLS`, roleName, rolePassword))
	mustExec(t, ctx, owner, `CREATE SCHEMA `+schema)
	mustExec(t, ctx, owner, fmt.Sprintf(`
		CREATE TABLE %s.widgets (tenant_id uuid NOT NULL, id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL UNIQUE);
		GRANT USAGE ON SCHEMA %s TO %s;
		GRANT SELECT, INSERT ON %s.widgets TO %s;
	`, schema, schema, roleName, schema, roleName))
	isoSQL, err := TenantIsolationSQL(schema + ".widgets")
	if err != nil {
		t.Fatal(err)
	}
	mustExec(t, ctx, owner, isoSQL)
	t.Cleanup(func() {
		bg := context.Background()
		owner.Exec(bg, `DROP SCHEMA IF EXISTS `+schema+` CASCADE`) //nolint:errcheck
		owner.Exec(bg, `DROP ROLE IF EXISTS `+roleName)            //nolint:errcheck
	})
	pool := openTestPoolAt(t, withCredentials(t, ownerURL, roleName, rolePassword), 3)

	insert := func(ctx context.Context, tenant, name string) error {
		_, err := WithTenant(ctx, pool, tenant, func(ctx context.Context, tx pgx.Tx) (struct{}, error) {
			_, err := tx.Exec(ctx, `INSERT INTO `+schema+`.widgets (tenant_id, name) VALUES ($1, $2)`, tenant, name)
			return struct{}{}, err
		})
		return err
	}
	count := func(tenant string) int {
		n, err := WithTenant(context.Background(), pool, tenant, func(ctx context.Context, tx pgx.Tx) (int, error) {
			var n int
			return n, tx.QueryRow(ctx, `SELECT count(*) FROM `+schema+`.widgets`).Scan(&n)
		})
		if err != nil {
			t.Fatal(err)
		}
		return n
	}

	t.Run("a rolled back unit keeps none of its writes", func(t *testing.T) {
		uc, unit, owned := BeginUnit(ctx)
		if !owned || !InUnit(uc) {
			t.Fatal("a fresh unit must be owned and carried by its context")
		}
		if err := insert(uc, tenantA, "r1"); err != nil {
			t.Fatal(err)
		}
		if err := insert(uc, tenantA, "r2"); err != nil {
			t.Fatal(err)
		}
		unit.Rollback(ctx)
		if n := count(tenantA); n != 0 {
			t.Fatalf("rolled back unit left %d rows", n)
		}
	})

	t.Run("a committed unit keeps all writes; a failed step only undoes itself", func(t *testing.T) {
		uc, unit, _ := BeginUnit(ctx)
		if err := insert(uc, tenantA, "c1"); err != nil {
			t.Fatal(err)
		}
		if err := insert(uc, tenantA, "c1"); err == nil {
			t.Fatal("a duplicate name must fail")
		}
		if err := insert(uc, tenantA, "c2"); err != nil {
			t.Fatalf("the unit must survive a failed step: %v", err)
		}
		if n := count(tenantA); n != 0 {
			t.Fatalf("writes visible before commit: %d", n)
		}
		if err := unit.Commit(ctx); err != nil {
			t.Fatal(err)
		}
		if n := count(tenantA); n != 2 {
			t.Fatalf("want 2 rows after commit, got %d", n)
		}
	})

	t.Run("a nested unit joins; another customer or Detach stands alone", func(t *testing.T) {
		uc, unit, _ := BeginUnit(ctx)
		inner, _, owned := BeginUnit(uc)
		if owned {
			t.Fatal("a nested BeginUnit must join the open unit")
		}
		if err := insert(inner, tenantA, "n1"); err != nil {
			t.Fatal(err)
		}
		if err := insert(uc, tenantB, "b1"); err != nil {
			t.Fatal(err)
		}
		if err := insert(Detach(uc), tenantA, "d1"); err != nil {
			t.Fatal(err)
		}
		unit.Rollback(ctx)
		if n := count(tenantB); n != 1 {
			t.Fatalf("another customer's write is not part of the unit, got %d", n)
		}
		if n := count(tenantA); n != 3 {
			t.Fatalf("want c1, c2 and d1 only, got %d", n)
		}
	})

	t.Run("a closed unit cannot commit twice", func(t *testing.T) {
		_, unit, _ := BeginUnit(ctx)
		if err := unit.Commit(ctx); err != nil {
			t.Fatal(err)
		}
		if err := unit.Commit(ctx); err == nil || errors.Is(err, context.Canceled) {
			t.Fatalf("second commit must fail, got %v", err)
		}
	})
}
