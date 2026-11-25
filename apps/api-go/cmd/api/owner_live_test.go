// SPDX-License-Identifier: AGPL-3.0-only

package main

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/auditlog"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/business"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
)

func ownerSessions(t *testing.T, probe *pgxpool.Pool) int {
	t.Helper()
	var n int
	if err := probe.QueryRow(context.Background(), `SELECT count(*) FROM pg_stat_activity WHERE application_name = $1`, ownerAppName).Scan(&n); err != nil {
		t.Fatalf("pg_stat_activity: %v", err)
	}
	return n
}

func waitNoOwnerSessions(t *testing.T, probe *pgxpool.Pool) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for ownerSessions(t, probe) != 0 {
		if time.Now().After(deadline) {
			t.Fatalf("owner sessions still open: %d", ownerSessions(t, probe))
		}
		time.Sleep(50 * time.Millisecond)
	}
}

func TestNoOwnerPoolRemainsAfterStartUp_LivePostgres(t *testing.T) {
	dbURL := os.Getenv("OPENDISPATCH_TEST_DATABASE_URL")
	if dbURL == "" {
		t.Skip("OPENDISPATCH_TEST_DATABASE_URL is not set: skipped, not faked.")
	}
	ctx := context.Background()
	probe, err := pgxpool.New(ctx, dbURL)
	if err != nil {
		t.Fatal(err)
	}
	defer probe.Close()
	defer func() { business.TestResetDB, business.TestResetMasterDB = nil, nil }()
	defer auditlog.SetTestTruncate(nil)

	err = withOwner(ctx, dbURL, func(owner *tenancy.Connection) error {
		if err := owner.Pool.Ping(ctx); err != nil {
			return err
		}
		if n := ownerSessions(t, probe); n == 0 {
			t.Fatal("the probe cannot see an open owner session")
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	waitNoOwnerSessions(t, probe)

	for _, c := range []struct{ mode, routes string }{{"demo", ""}, {"demo", "1"}, {"oidc", ""}, {"oidc", "1"}} {
		t.Run(c.mode+" test-routes="+c.routes, func(t *testing.T) {
			business.TestResetDB, business.TestResetMasterDB = nil, nil
			getenv := func(k string) string {
				if k == "OPENDISPATCH_TEST_ROUTES" {
					return c.routes
				}
				return ""
			}
			if err := ownerStartup(ctx, c.mode, dbURL, "../../migrations", getenv); err != nil {
				t.Fatal(err)
			}
			if n := ownerPoolsOpen(); n != 0 {
				t.Fatalf("%d owner pools open after start-up", n)
			}
			waitNoOwnerSessions(t, probe)
			wantResets := c.mode == "demo" && c.routes == "1"
			if got := business.TestResetDB != nil; got != wantResets {
				t.Fatalf("test resets wired = %v, want %v", got, wantResets)
			}
		})
	}
}
